use std::fs::{File, OpenOptions};
use std::io::{self, BufRead, BufReader, Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

const IDENTITY_BYTES: usize = 256;

pub fn open_shared(path: &Path) -> io::Result<File> {
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        use windows_sys::Win32::Storage::FileSystem::{
            FILE_SHARE_DELETE, FILE_SHARE_READ, FILE_SHARE_WRITE,
        };
        options.share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE);
    }
    options.open(path)
}

pub fn first_line(path: &Path) -> io::Result<String> {
    let mut line = String::new();
    BufReader::new(open_shared(path)?)
        .take(IDENTITY_BYTES as u64)
        .read_line(&mut line)?;
    Ok(line.trim_start_matches('\u{feff}').trim().to_string())
}

#[derive(Debug, PartialEq)]
pub struct Lines {
    pub restarted: bool,
    pub lines: Vec<String>,
}

pub struct LogTail {
    path: PathBuf,
    offset: u64,
    identity: Vec<u8>,
    partial: Vec<u8>,
}

impl LogTail {
    pub fn new(path: PathBuf) -> Self {
        Self {
            path,
            offset: 0,
            identity: Vec::new(),
            partial: Vec::new(),
        }
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    fn identity(file: &mut File) -> io::Result<Vec<u8>> {
        let mut head = vec![0; IDENTITY_BYTES];
        file.seek(SeekFrom::Start(0))?;
        let read = file.read(&mut head)?;
        head.truncate(read);
        if let Some(end) = head.iter().position(|&byte| byte == b'\n') {
            head.truncate(end);
        }
        Ok(head)
    }

    pub fn read(&mut self, finish: bool) -> io::Result<Lines> {
        let mut file = open_shared(&self.path)?;
        let len = file.metadata()?.len();
        let identity = Self::identity(&mut file)?;
        let same_file = self.offset == 0 || identity.starts_with(&self.identity);
        let restarted = self.offset > 0 && (!same_file || len < self.offset);
        if restarted || self.offset == 0 {
            self.offset = 0;
            self.partial.clear();
        }
        if identity.len() > self.identity.len() || restarted {
            self.identity = identity;
        }

        file.seek(SeekFrom::Start(self.offset))?;
        let mut chunk = Vec::new();
        file.read_to_end(&mut chunk)?;
        self.offset += chunk.len() as u64;
        self.partial.extend_from_slice(&chunk);

        let complete = match self.partial.iter().rposition(|&byte| byte == b'\n') {
            Some(end) => {
                let rest = self.partial.split_off(end + 1);
                std::mem::replace(&mut self.partial, rest)
            }
            None => Vec::new(),
        };
        let mut lines: Vec<String> = String::from_utf8_lossy(&complete)
            .lines()
            .map(|line| line.trim_start_matches('\u{feff}').to_string())
            .collect();
        if finish && !self.partial.is_empty() {
            lines.push(String::from_utf8_lossy(&std::mem::take(&mut self.partial)).into_owned());
        }
        Ok(Lines { restarted, lines })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn append(path: &Path, text: &str) {
        let mut file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(path)
            .unwrap();
        file.write_all(text.as_bytes()).unwrap();
    }

    fn lines(tail: &mut LogTail) -> Vec<String> {
        tail.read(false).unwrap().lines
    }

    #[test]
    fn follows_new_lines_and_waits_for_partial_ones() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("netstats.csv");
        append(&path, "header,a\r\n1,2\r\n3,");
        let mut tail = LogTail::new(path.clone());

        assert_eq!(lines(&mut tail), vec!["header,a", "1,2"]);
        assert!(lines(&mut tail).is_empty());

        append(&path, "4\r\n5,6\r\n");
        assert_eq!(lines(&mut tail), vec!["3,4", "5,6"]);

        append(&path, "7,8");
        assert!(lines(&mut tail).is_empty());
        assert_eq!(tail.read(true).unwrap().lines, vec!["7,8"]);
    }

    #[test]
    fn starts_over_when_the_file_is_rotated_or_truncated() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("ShooterGame.log");
        append(&path, "Log file open, 10/04/26 15:02:14\nfirst\nsecond\n");
        let mut tail = LogTail::new(path.clone());
        assert_eq!(lines(&mut tail).len(), 3);

        std::fs::rename(&path, dir.path().join("ShooterGame-backup.log")).unwrap();
        append(
            &path,
            "Log file open, 10/07/26 21:10:01\nnew one\nwith more lines than before\n",
        );
        let read = tail.read(false).unwrap();
        assert!(read.restarted);
        assert_eq!(
            read.lines,
            vec![
                "Log file open, 10/07/26 21:10:01",
                "new one",
                "with more lines than before"
            ]
        );

        std::fs::write(&path, "x\n").unwrap();
        let read = tail.read(false).unwrap();
        assert!(read.restarted);
        assert_eq!(read.lines, vec!["x"]);
    }

    #[test]
    fn a_header_written_in_several_steps_is_still_the_same_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("netstats.csv");
        append(&path, "game.frametime");
        let mut tail = LogTail::new(path.clone());
        assert!(lines(&mut tail).is_empty());

        append(&path, "_average,network.rtt_average\n0.004,0.013\n");
        let read = tail.read(false).unwrap();
        assert!(!read.restarted);
        assert_eq!(
            read.lines,
            vec!["game.frametime_average,network.rtt_average", "0.004,0.013"]
        );
    }

    #[test]
    fn reads_while_the_game_keeps_the_file_open_for_writing() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("ShooterGame.log");
        let mut writer = File::create(&path).unwrap();
        writer
            .write_all(b"\xef\xbb\xbfLog file open\nline\n")
            .unwrap();
        writer.flush().unwrap();

        let mut tail = LogTail::new(path.clone());
        assert_eq!(lines(&mut tail), vec!["Log file open", "line"]);
        assert_eq!(first_line(&path).unwrap(), "Log file open");
    }
}

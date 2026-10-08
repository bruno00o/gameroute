pub mod import;
pub mod netstats;
pub mod shooter;
pub mod tail;
pub mod watch;

use crate::config::GAME_LOG_SLACK_SECS;
use crate::models::game_ping::GamePingSample;
use crate::services::riot_scanner::riot_install_path;
use chrono::{DateTime, Duration, Utc};
use netstats::{is_netstats, log_start, NetstatsParser};
use shooter::ShooterParser;
use std::io;
use std::path::{Path, PathBuf};
use tail::LogTail;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GameLogKind {
    League,
    Valorant,
}

impl GameLogKind {
    pub fn for_game(name: &str) -> Option<Self> {
        let name = name.to_lowercase();
        if name.contains("league of legends") || name.contains("teamfight tactics") {
            Some(Self::League)
        } else if name.contains("valorant") {
            Some(Self::Valorant)
        } else {
            None
        }
    }

    pub fn logs_dir(self) -> Option<PathBuf> {
        let dir = match self {
            Self::League => riot_install_path("league_of_legends.live")
                .unwrap_or_else(|| PathBuf::from(r"C:\Riot Games\League of Legends"))
                .join("Logs")
                .join("GameLogs"),
            Self::Valorant => PathBuf::from(std::env::var_os("LOCALAPPDATA")?)
                .join("VALORANT")
                .join("Saved")
                .join("Logs"),
        };
        dir.is_dir().then_some(dir)
    }
}

fn slack() -> Duration {
    Duration::seconds(GAME_LOG_SLACK_SECS)
}

pub fn netstats_files(dir: &Path) -> Vec<PathBuf> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut files: Vec<PathBuf> = entries
        .flatten()
        .filter(|entry| entry.path().is_dir())
        .filter_map(|entry| {
            std::fs::read_dir(entry.path())
                .ok()?
                .flatten()
                .map(|file| file.path())
                .find(|path| is_netstats(path))
        })
        .collect();
    files.sort_by_key(|path| path.file_name().map(|name| name.to_os_string()));
    files
}

pub fn read_netstats(path: &Path) -> io::Result<Vec<GamePingSample>> {
    let start = log_start(path)
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "no start time in name"))?;
    let mut parser = NetstatsParser::new(start);
    let lines = LogTail::new(path.to_path_buf()).read(true)?.lines;
    Ok(lines.iter().filter_map(|line| parser.push(line)).collect())
}

pub fn read_shooter_log(path: &Path) -> io::Result<Vec<GamePingSample>> {
    let mut parser = ShooterParser::default();
    let lines = LogTail::new(path.to_path_buf()).read(true)?.lines;
    Ok(lines.iter().flat_map(|line| parser.push(line)).collect())
}

struct NetstatsFile {
    tail: LogTail,
    start: DateTime<Utc>,
    parser: NetstatsParser,
}

impl NetstatsFile {
    fn open(path: PathBuf) -> Option<Self> {
        let start = log_start(&path)?;
        Some(Self {
            tail: LogTail::new(path),
            start,
            parser: NetstatsParser::new(start),
        })
    }

    fn read(&mut self, finish: bool) -> io::Result<Vec<GamePingSample>> {
        let read = self.tail.read(finish)?;
        if read.restarted {
            self.parser = NetstatsParser::new(self.start);
        }
        Ok(read
            .lines
            .iter()
            .filter_map(|line| self.parser.push(line))
            .collect())
    }
}

enum Following {
    League {
        dir: PathBuf,
        current: Option<NetstatsFile>,
    },
    Valorant {
        tail: LogTail,
        parser: ShooterParser,
    },
}

pub struct GameLogFollower {
    session_id: i64,
    since: DateTime<Utc>,
    following: Following,
}

impl GameLogFollower {
    pub fn new(kind: GameLogKind, dir: PathBuf, session_id: i64, since: DateTime<Utc>) -> Self {
        let following = match kind {
            GameLogKind::League => Following::League { dir, current: None },
            GameLogKind::Valorant => Following::Valorant {
                tail: LogTail::new(dir.join("ShooterGame.log")),
                parser: ShooterParser::default(),
            },
        };
        Self {
            session_id,
            since,
            following,
        }
    }

    pub fn poll(&mut self, finish: bool) -> io::Result<Vec<GamePingSample>> {
        let since = self.since - slack();
        let mut samples = match &mut self.following {
            Following::League { dir, current } => {
                let latest = netstats_files(dir)
                    .pop()
                    .filter(|path| log_start(path).is_some_and(|start| start >= since));
                let mut samples = Vec::new();
                if latest.as_deref() != current.as_ref().map(|file| file.tail.path()) {
                    if let Some(previous) = current.as_mut() {
                        samples.extend(previous.read(true).unwrap_or_default());
                    }
                    *current = latest.and_then(NetstatsFile::open);
                }
                if let Some(file) = current.as_mut() {
                    samples.extend(file.read(finish)?);
                }
                samples
            }
            Following::Valorant { tail, parser } => {
                let read = tail.read(finish)?;
                if read.restarted {
                    *parser = ShooterParser::default();
                }
                read.lines
                    .iter()
                    .flat_map(|line| parser.push(line))
                    .collect()
            }
        };
        samples.retain(|sample| sample.at().is_some_and(|at| at >= since));
        for sample in &mut samples {
            sample.session_id = self.session_id;
        }
        Ok(samples)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::insights::PingSource;
    use chrono::{Local, TimeZone};
    use std::io::Write;

    const NETSTATS: &str =
        include_str!("../../../tests/fixtures/game_logs/2026-10-08T19-35-06_netstats.csv");
    const SHOOTER: &str = include_str!("../../../tests/fixtures/game_logs/ShooterGame.txt");

    fn local(h: u32, m: u32, s: u32) -> DateTime<Utc> {
        Local
            .with_ymd_and_hms(2026, 10, 8, h, m, s)
            .unwrap()
            .with_timezone(&Utc)
    }

    fn write_match(dir: &Path, stamp: &str, text: &str) -> PathBuf {
        let folder = dir.join(stamp);
        std::fs::create_dir_all(&folder).unwrap();
        std::fs::write(folder.join(format!("{stamp}_r3dlog.txt")), "log").unwrap();
        let path = folder.join(format!("{stamp}_netstats.csv"));
        std::fs::write(&path, text).unwrap();
        path
    }

    fn append(path: &Path, text: &str) {
        std::fs::OpenOptions::new()
            .append(true)
            .open(path)
            .unwrap()
            .write_all(text.as_bytes())
            .unwrap();
    }

    #[test]
    fn games_with_readable_logs_are_recognised_by_name() {
        assert_eq!(
            GameLogKind::for_game("League of Legends"),
            Some(GameLogKind::League)
        );
        assert_eq!(
            GameLogKind::for_game("Teamfight Tactics"),
            Some(GameLogKind::League)
        );
        assert_eq!(
            GameLogKind::for_game("VALORANT"),
            Some(GameLogKind::Valorant)
        );
        assert_eq!(GameLogKind::for_game("Counter-Strike 2"), None);
    }

    #[test]
    fn league_follower_tails_the_current_match_then_the_next_one() {
        let dir = tempfile::tempdir().unwrap();
        let lines: Vec<&str> = NETSTATS.lines().collect();
        write_match(
            dir.path(),
            "2026-10-08T18-47-12",
            &format!("{}\n{}\n", lines[0], lines[1]),
        );
        let current = write_match(
            dir.path(),
            "2026-10-08T19-35-06",
            &format!("{}\n{}\n{}", lines[0], lines[1], &lines[2][..20]),
        );
        let mut follower = GameLogFollower::new(
            GameLogKind::League,
            dir.path().into(),
            191,
            local(19, 30, 0),
        );

        let first = follower.poll(false).unwrap();
        assert_eq!(first.len(), 1);
        assert_eq!(first[0].session_id, 191);
        assert_eq!(first[0].peer_port, Some(7318));
        assert!(follower.poll(false).unwrap().is_empty());

        append(&current, &format!("{}\n{}\n", &lines[2][20..], lines[3]));
        assert_eq!(follower.poll(false).unwrap().len(), 2);

        append(&current, &format!("{}\n", lines[4]));
        let next = write_match(
            dir.path(),
            "2026-10-08T20-10-00",
            &format!("{}\n{}\n", lines[0], lines[5]),
        );
        let switched = follower.poll(false).unwrap();
        assert_eq!(switched.len(), 2);
        assert!(switched[1].at().unwrap() > local(20, 10, 0));

        append(&next, &format!("{}\n{}\n", lines[6], lines[9]));
        assert_eq!(follower.poll(true).unwrap().len(), 1);
    }

    #[test]
    fn league_follower_ignores_matches_older_than_the_session() {
        let dir = tempfile::tempdir().unwrap();
        write_match(dir.path(), "2026-10-08T19-35-06", NETSTATS);
        let mut follower =
            GameLogFollower::new(GameLogKind::League, dir.path().into(), 1, local(20, 0, 0));

        assert!(follower.poll(true).unwrap().is_empty());
    }

    #[test]
    fn valorant_follower_reads_the_live_log() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("ShooterGame.log");
        let (head, rest) = SHOOTER.split_at(SHOOTER.find("[2026.10.04-13.15.56").unwrap());
        std::fs::write(&path, head).unwrap();
        let since = Utc.with_ymd_and_hms(2026, 10, 4, 13, 2, 14).unwrap();
        let mut follower = GameLogFollower::new(GameLogKind::Valorant, dir.path().into(), 7, since);

        let regions = follower.poll(false).unwrap();
        assert_eq!(regions.len(), 3);
        assert!(regions
            .iter()
            .all(|s| s.source == PingSource::GameRegion && s.session_id == 7));

        append(&path, rest);
        let losses = follower.poll(false).unwrap();
        assert_eq!(losses.len(), 2);
        assert!(losses
            .iter()
            .all(|s| s.peer_ip.as_deref() == Some("162.249.72.1")));
    }

    #[test]
    fn whole_files_read_the_same_samples_as_the_live_follower() {
        let dir = tempfile::tempdir().unwrap();
        let path = write_match(dir.path(), "2026-10-08T19-35-06", NETSTATS);
        let mut follower =
            GameLogFollower::new(GameLogKind::League, dir.path().into(), 0, local(19, 35, 0));

        assert_eq!(read_netstats(&path).unwrap(), follower.poll(true).unwrap());
        assert_eq!(netstats_files(dir.path()), vec![path]);

        let shooter = dir.path().join("ShooterGame.log");
        std::fs::write(&shooter, SHOOTER).unwrap();
        assert_eq!(read_shooter_log(&shooter).unwrap().len(), 5);
    }
}

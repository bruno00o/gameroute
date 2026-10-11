use super::zone::LogZone;
use crate::models::game_ping::GamePingSample;
use crate::models::insights::PingSource;
use chrono::{DateTime, Duration, NaiveDateTime, Utc};
use std::path::Path;

const SUFFIX: &str = "_netstats.csv";
const SUMMARY_MIN_SECS: f64 = 60.0;

pub fn is_netstats(path: &Path) -> bool {
    path.file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| name.ends_with(SUFFIX))
}

pub fn log_start(path: &Path, zone: LogZone) -> Option<DateTime<Utc>> {
    let name = path.file_name()?.to_str()?;
    let stamp = NaiveDateTime::parse_from_str(name.get(..19)?, "%Y-%m-%dT%H-%M-%S").ok()?;
    zone.to_utc(stamp)
}

struct Columns {
    duration: usize,
    rtt: usize,
    jitter: usize,
    lost: usize,
    sent: usize,
    peer_ip: usize,
    peer_port: usize,
    status: usize,
}

impl Columns {
    fn from_header(fields: &[&str]) -> Option<Self> {
        let index = |name: &str| fields.iter().position(|field| field.trim() == name);
        Some(Self {
            duration: index("stats.duration")?,
            rtt: index("network.rtt_average")?,
            jitter: index("network.rtt_jitter")?,
            lost: index("network.packets_lost")?,
            sent: index("network.packets_sent")?,
            peer_ip: index("network.peer_address")?,
            peer_port: index("network.peer_port")?,
            status: index("network.status")?,
        })
    }
}

pub struct NetstatsParser {
    start: DateTime<Utc>,
    columns: Option<Columns>,
    elapsed_secs: f64,
}

impl NetstatsParser {
    pub fn new(start: DateTime<Utc>) -> Self {
        Self {
            start,
            columns: None,
            elapsed_secs: 0.0,
        }
    }

    pub fn push(&mut self, line: &str) -> Option<GamePingSample> {
        let fields: Vec<&str> = line.trim().split(',').collect();
        let Some(columns) = &self.columns else {
            self.columns = Columns::from_header(&fields);
            return None;
        };
        let field = |index: usize| fields.get(index).map(|field| field.trim());
        let number = |index: usize| field(index).and_then(|field| field.parse::<f64>().ok());

        let duration = number(columns.duration)?;
        if duration >= SUMMARY_MIN_SECS && duration >= 0.9 * self.elapsed_secs {
            return None;
        }
        self.elapsed_secs += duration;
        let rtt_secs = number(columns.rtt).filter(|rtt| *rtt > 0.0)?;
        if field(columns.status)? != "Connected" {
            return None;
        }

        let at = self.start + Duration::milliseconds((self.elapsed_secs * 1000.0).round() as i64);
        let mut sample = GamePingSample::new(PingSource::Game, at);
        sample.peer_ip = field(columns.peer_ip)
            .filter(|ip| ip.parse::<std::net::IpAddr>().is_ok())
            .map(str::to_string);
        sample.peer_port = field(columns.peer_port).and_then(|port| port.parse().ok());
        sample.rtt_ms = Some(round(rtt_secs * 1000.0));
        sample.jitter_ms = number(columns.jitter).map(|jitter| round(jitter * 1000.0));
        sample.packets_lost = number(columns.lost).map(|lost| lost as i64);
        sample.packets_sent = number(columns.sent).map(|sent| sent as i64);
        Some(sample)
    }
}

fn round(ms: f64) -> f64 {
    (ms * 1000.0).round() / 1000.0
}

#[cfg(test)]
mod tests {
    use super::super::zone::offset;
    use super::*;
    use chrono::TimeZone;

    const FIXTURE: &str =
        include_str!("../../../tests/fixtures/game_logs/2026-10-08T19-35-06_netstats.csv");

    fn start() -> DateTime<Utc> {
        Utc.with_ymd_and_hms(2026, 10, 8, 17, 35, 6).unwrap()
    }

    fn parse(text: &str) -> Vec<GamePingSample> {
        let mut parser = NetstatsParser::new(start());
        text.lines().filter_map(|line| parser.push(line)).collect()
    }

    #[test]
    fn rows_become_round_trip_times_to_the_match_server() {
        let samples = parse(FIXTURE);

        assert_eq!(samples.len(), 8);
        let first = &samples[0];
        assert_eq!(first.source, PingSource::Game);
        assert_eq!(first.measured_at, "2026-10-08T17:35:16.004Z");
        assert_eq!(first.peer_ip.as_deref(), Some("162.249.72.5"));
        assert_eq!(first.peer_port, Some(7318));
        assert_eq!(first.rtt_ms, Some(13.816));
        assert_eq!(first.jitter_ms, Some(3.137));
        assert_eq!(first.packets_lost, Some(0));
        assert_eq!(first.packets_sent, Some(457));
        assert_eq!(samples[7].packets_lost, Some(2));
        assert_eq!(samples[7].measured_at, "2026-10-08T17:36:26.017Z");
    }

    #[test]
    fn the_closing_summary_row_is_not_a_sample() {
        let samples = parse(FIXTURE);

        assert!(samples.iter().all(|sample| sample.rtt_ms != Some(12.78)));
    }

    #[test]
    fn disconnected_or_empty_rows_are_skipped_but_keep_the_clock() {
        let text = "stats.duration,network.rtt_average,network.rtt_jitter,network.packets_lost,network.packets_sent,network.peer_address,network.peer_port,network.status\n\
                    10.0,0.014,0.003,0,400,162.249.72.5,7318,Connected\n\
                    10.0,0.000,0.000,0,0,0.0.0.0,0,Disconnected\n\
                    10.0,0.020,0.003,0,400,162.249.72.5,7318,Reconnecting\n\
                    not,a,row\n\
                    10.0,0.015,0.003,1,400,162.249.72.5,7318,Connected\n";

        let samples = parse(text);

        let times: Vec<&str> = samples.iter().map(|s| s.measured_at.as_str()).collect();
        assert_eq!(
            times,
            vec!["2026-10-08T17:35:16.000Z", "2026-10-08T17:35:46.000Z"]
        );
    }

    #[test]
    fn rows_need_a_header_first() {
        assert!(parse("10.0,0.014,0.003,0,400,162.249.72.5,7318,Connected\n").is_empty());
    }

    #[test]
    fn match_start_comes_from_the_local_file_name() {
        let path = Path::new("GameLogs/2026-10-08T19-35-06/2026-10-08T19-35-06_netstats.csv");

        assert!(is_netstats(path));
        assert_eq!(log_start(path, offset(2)), Some(start()));
        assert_eq!(
            log_start(path, offset(0)),
            Some(Utc.with_ymd_and_hms(2026, 10, 8, 19, 35, 6).unwrap())
        );
        assert!(!is_netstats(Path::new("2026-10-08T19-35-06_netlog.txt")));
        assert_eq!(log_start(Path::new("netstats.csv"), offset(2)), None);
    }
}

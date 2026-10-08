use super::insights::PingSource;
use chrono::{DateTime, SecondsFormat, Utc};
use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct GamePingSample {
    pub session_id: i64,
    #[sqlx(try_from = "String")]
    pub source: PingSource,
    pub measured_at: String,
    pub peer_ip: Option<String>,
    pub peer_port: Option<i32>,
    pub region: Option<String>,
    pub rtt_ms: Option<f64>,
    pub jitter_ms: Option<f64>,
    pub packets_lost: Option<i64>,
    pub packets_sent: Option<i64>,
}

impl GamePingSample {
    pub fn new(source: PingSource, at: DateTime<Utc>) -> Self {
        Self {
            session_id: 0,
            source,
            measured_at: at.to_rfc3339_opts(SecondsFormat::Millis, true),
            peer_ip: None,
            peer_port: None,
            region: None,
            rtt_ms: None,
            jitter_ms: None,
            packets_lost: None,
            packets_sent: None,
        }
    }

    pub fn at(&self) -> Option<DateTime<Utc>> {
        DateTime::parse_from_rfc3339(&self.measured_at)
            .ok()
            .map(|at| at.with_timezone(&Utc))
    }

    pub fn has_peer(&self, ip: &str, port: i32) -> bool {
        self.peer_ip.as_deref() == Some(ip) && self.peer_port == Some(port)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    #[test]
    fn sample_serializes_for_the_live_event() {
        let mut sample = GamePingSample::new(
            PingSource::Game,
            Utc.with_ymd_and_hms(2026, 10, 8, 17, 35, 16).unwrap(),
        );
        sample.session_id = 191;
        sample.peer_ip = Some("162.249.72.5".to_string());
        sample.peer_port = Some(7318);
        sample.rtt_ms = Some(13.8);

        let json = serde_json::to_value(&sample).unwrap();
        assert_eq!(json["sessionId"], 191);
        assert_eq!(json["source"], "game");
        assert_eq!(json["measuredAt"], "2026-10-08T17:35:16.000Z");
        assert_eq!(json["peerPort"], 7318);
        assert_eq!(json["rttMs"], 13.8);
        assert!(json["region"].is_null());
        assert!(sample.has_peer("162.249.72.5", 7318));
        assert!(!sample.has_peer("162.249.72.5", 7319));
    }
}

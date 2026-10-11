use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct IpPeriod {
    pub id: i64,
    pub session_id: i64,
    pub ip: String,
    pub protocol: String,
    pub port: i32,
    pub started_at: String,
    pub ended_at: String,
    pub packet_count: i64,
    pub is_game_server: bool,
    pub flow_kind: Option<String>,
}

#[derive(Debug, Clone)]
pub struct IpPeriodData {
    pub session_id: i64,
    pub ip: String,
    pub protocol: String,
    pub port: i32,
    pub started_at: String,
    pub ended_at: String,
    pub packet_count: i64,
}

impl IpPeriodData {
    pub fn new(
        session_id: i64,
        ip: String,
        protocol: String,
        port: i32,
        timestamp: String,
        packet_count: i64,
    ) -> Self {
        Self {
            session_id,
            ip,
            protocol,
            port,
            started_at: timestamp.clone(),
            ended_at: timestamp,
            packet_count,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct IpPeriodSummary {
    pub ip: String,

    pub protocol: String,

    pub port: i32,

    pub total_duration_secs: i64,

    pub total_packet_count: i64,

    pub period_count: i32,

    pub first_seen_at: String,

    pub last_seen_at: String,

    pub is_game_server: bool,

    pub flow_kind: Option<String>,
}

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct FlowPeriod {
    #[sqlx(flatten)]
    pub period: IpPeriod,
    pub asn: Option<String>,
    pub operator_name: Option<String>,
    pub city: Option<String>,
    pub country: Option<String>,
}

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct TraceCandidate {
    pub ip: String,
    pub protocol: String,
    pub port: i32,
    pub is_game_server: bool,
    pub is_voice: bool,
    pub total_secs: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct IpActivityUpsert {
    pub period_id: i64,
    pub is_new: bool,
    pub became_game_server: bool,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct MatchPeriodBackfill {
    pub recognised: usize,
    pub absorbed: usize,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_ip_period_serialization() {
        let period = IpPeriod {
            id: 1,
            session_id: 1,
            ip: "185.60.112.157".to_string(),
            protocol: "TCP".to_string(),
            port: 27015,
            started_at: "2026-01-25T10:00:00Z".to_string(),
            ended_at: "2026-01-25T10:30:00Z".to_string(),
            packet_count: 1500,
            is_game_server: false,
            flow_kind: None,
        };

        let json = serde_json::to_string(&period).unwrap();
        assert!(json.contains("sessionId"));
        assert!(json.contains("startedAt"));
        assert!(json.contains("endedAt"));
        assert!(json.contains("packetCount"));
    }

    #[test]
    fn test_ip_period_data_new() {
        let data = IpPeriodData::new(1, "8.8.8.8".to_string(), "UDP".to_string(), 27015, "2026-01-25T10:00:00Z".to_string(), 42);

        assert_eq!(data.session_id, 1);
        assert_eq!(data.ip, "8.8.8.8");
        assert_eq!(data.protocol, "UDP");
        assert_eq!(data.port, 27015);
        assert_eq!(data.started_at, data.ended_at);
        assert_eq!(data.packet_count, 42);
    }
}

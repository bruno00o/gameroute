use serde::{Deserialize, Serialize};

use super::hop::ProbedHop;
use super::ip_period::{IpPeriod, IpPeriodSummary};
use super::severity::Severity;
use super::traceroute_record::TracerouteWithHops;

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub id: i64,
    pub game_name: String,
    pub started_at: String,
    pub ended_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct SessionListItem {
    pub id: i64,
    pub game_name: String,
    pub started_at: String,
    pub ended_at: Option<String>,

    pub unique_ip_count: i32,

    pub traceroute_count: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionDetail {
    pub id: i64,
    pub game_name: String,
    pub started_at: String,
    pub ended_at: Option<String>,
    pub ip_periods: Vec<IpPeriod>,
    pub ip_summaries: Vec<IpPeriodSummary>,
    pub traceroutes: Vec<TracerouteWithHops>,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct DbHop {
    pub id: i64,
    pub traceroute_id: i64,
    pub hop_number: i32,
    pub ip: Option<String>,
    pub hostname: Option<String>,
    pub latency_min: Option<f64>,
    pub latency_avg: Option<f64>,
    pub latency_max: Option<f64>,
    pub packet_loss: Option<f64>,
    pub is_problem_hop: bool,
    pub source: Option<String>,
    #[sqlx(skip)]
    #[serde(default)]
    pub loss_status: Option<Severity>,
}

impl ProbedHop for DbHop {
    fn ip(&self) -> Option<&str> {
        self.ip.as_deref()
    }

    fn responded(&self) -> bool {
        self.latency_avg.is_some()
    }

    fn loss_pct(&self) -> f64 {
        self.packet_loss.unwrap_or(0.0)
    }

    fn rtt_avg(&self) -> Option<f64> {
        self.latency_avg
    }

    fn rtt_range(&self) -> Option<(f64, f64)> {
        self.latency_min.zip(self.latency_max)
    }
}

#[derive(Debug, Clone)]
pub struct HopData {
    pub hop_number: i32,
    pub ip: Option<String>,
    pub hostname: Option<String>,
    pub latency_min: Option<f64>,
    pub latency_avg: Option<f64>,
    pub latency_max: Option<f64>,
    pub packet_loss: Option<f64>,
    pub is_problem_hop: bool,
    pub source: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_session_serialization() {
        let session = Session {
            id: 1,
            game_name: "Valorant".to_string(),
            started_at: "2026-01-25T10:00:00Z".to_string(),
            ended_at: Some("2026-01-25T12:00:00Z".to_string()),
        };

        let json = serde_json::to_string(&session).unwrap();
        assert!(json.contains("gameName"));
        assert!(json.contains("startedAt"));
        assert!(!json.contains("game_name"));

        assert!(!json.contains("averageLatency"));
        assert!(!json.contains("createdAt"));
    }

    #[test]
    fn test_hop_serialization() {
        let hop = DbHop {
            id: 1,
            traceroute_id: 1,
            hop_number: 3,
            ip: Some("192.168.1.1".to_string()),
            hostname: Some("router.local".to_string()),
            latency_min: Some(1.5),
            latency_avg: Some(2.0),
            latency_max: Some(3.5),
            packet_loss: Some(0.0),
            is_problem_hop: false,
            source: Some("ICMP".to_string()),
            loss_status: None,
        };

        let json = serde_json::to_string(&hop).unwrap();
        assert!(json.contains("tracerouteId"));
        assert!(json.contains("hopNumber"));
        assert!(json.contains("latencyMin"));
        assert!(json.contains("isProblemHop"));
        assert!(json.contains("\"lossStatus\":null"));

        assert!(!json.contains("serverIpId"));
    }

    #[test]
    fn test_session_list_item_serialization() {
        let item = SessionListItem {
            id: 1,
            game_name: "Valorant".to_string(),
            started_at: "2026-01-25T10:00:00Z".to_string(),
            ended_at: None,
            unique_ip_count: 5,
            traceroute_count: 3,
        };

        let json = serde_json::to_string(&item).unwrap();
        assert!(json.contains("uniqueIpCount"));
        assert!(json.contains("tracerouteCount"));
    }
}

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

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FlowOperator {
    pub asn: Option<u32>,
    pub name: Option<String>,
    pub city: Option<String>,
    pub country: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TraceMeasure {
    pub traceroute_id: i64,
    pub started_at: String,
    pub completed_at: Option<String>,
    pub offset_secs: i64,
    pub measured_hop: Option<i32>,
    pub at_destination: bool,
    pub ping_ms: Option<f64>,
    pub loss_pct: Option<f64>,
    pub jitter_ms: Option<f64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MeasuredFlow {
    pub period_id: i64,
    pub ip: String,
    pub protocol: String,
    pub port: i32,
    pub started_at: String,
    pub ended_at: String,
    pub duration_secs: i64,
    pub packet_count: i64,
    pub operator: Option<FlowOperator>,
    pub trace: Option<TraceMeasure>,
    pub status: Severity,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionMatch {
    pub number: u32,
    #[serde(flatten)]
    pub flow: MeasuredFlow,
    pub voice: Option<MeasuredFlow>,
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

    #[test]
    fn test_session_match_flattens_its_flow() {
        let flow = MeasuredFlow {
            period_id: 7,
            ip: "162.249.72.5".to_string(),
            protocol: "UDP".to_string(),
            port: 7220,
            started_at: "2026-09-13T14:27:00Z".to_string(),
            ended_at: "2026-09-13T15:09:36Z".to_string(),
            duration_secs: 2556,
            packet_count: 512,
            operator: Some(FlowOperator {
                asn: Some(6507),
                name: Some("Riot Games, Inc".to_string()),
                city: None,
                country: None,
            }),
            trace: Some(TraceMeasure {
                traceroute_id: 3,
                started_at: "2026-09-13T14:27:41Z".to_string(),
                completed_at: None,
                offset_secs: 41,
                measured_hop: Some(8),
                at_destination: false,
                ping_ms: Some(17.6),
                loss_pct: Some(0.0),
                jitter_ms: Some(1.0),
            }),
            status: Severity::Ok,
        };
        let item = SessionMatch {
            number: 3,
            flow,
            voice: None,
        };

        let json = serde_json::to_value(&item).unwrap();
        assert_eq!(json["number"], 3);
        assert_eq!(json["periodId"], 7);
        assert_eq!(json["durationSecs"], 2556);
        assert_eq!(json["operator"]["asn"], 6507);
        assert_eq!(json["trace"]["offsetSecs"], 41);
        assert_eq!(json["trace"]["atDestination"], false);
        assert_eq!(json["trace"]["pingMs"], 17.6);
        assert_eq!(json["status"], "ok");
        assert!(json["voice"].is_null());
        assert!(json.get("flow").is_none());
    }
}

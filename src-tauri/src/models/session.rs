use serde::{Deserialize, Serialize};

use super::hop::ProbedHop;
use super::insights::UsualPing;
use super::live_probe::{AccessMeasure, RegionEstimate};
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

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MatchSummary {
    pub match_count: u32,
    pub median_ping_ms: Option<f64>,
    pub median_ping_at_least: bool,
    pub median_ping_by_game: bool,
    pub status: Option<Severity>,
}

impl MatchSummary {
    pub fn needs_review(&self) -> bool {
        matches!(
            self.status,
            Some(Severity::Watch | Severity::Degraded | Severity::Critical)
        )
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct SessionListItem {
    pub id: i64,
    pub game_name: String,
    pub started_at: String,
    pub ended_at: Option<String>,
    pub end_estimated: bool,
    pub unique_ip_count: i32,
    pub traceroute_count: i32,
    #[sqlx(skip)]
    #[serde(flatten)]
    pub matches: MatchSummary,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SessionListFilter {
    pub search: Option<String>,
    pub game: Option<String>,
    pub to_review: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionListPage {
    pub items: Vec<SessionListItem>,
    pub total: i64,
    pub recorded: i64,
    pub first_started_at: Option<String>,
    pub games: Vec<String>,
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
    pub usual: Option<UsualPing>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GameMeasure {
    pub measured_at: String,
    pub sample_count: u32,
    pub ping_ms: f64,
    pub jitter_ms: Option<f64>,
    pub loss_pct: Option<f64>,
    pub packets_lost: i64,
    pub usual: Option<UsualPing>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegionPing {
    pub region: String,
    pub ping_ms: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegionPings {
    pub measured_at: String,
    pub pings: Vec<RegionPing>,
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
    pub game: Option<GameMeasure>,
    pub region_pings: Option<RegionPings>,
    pub access: Option<AccessMeasure>,
    pub region_estimate: Option<RegionEstimate>,
    pub status: Severity,
}

impl MeasuredFlow {
    pub fn ping_ms(&self) -> Option<f64> {
        match &self.game {
            Some(game) => Some(game.ping_ms),
            None => self.trace.as_ref()?.ping_ms,
        }
    }

    pub fn ping_at_least(&self) -> bool {
        self.game.is_none()
            && self
                .trace
                .as_ref()
                .is_some_and(|trace| !trace.at_destination)
    }

    pub fn loss_pct(&self) -> Option<f64> {
        self.game
            .as_ref()
            .and_then(|game| game.loss_pct)
            .or_else(|| self.trace.as_ref()?.loss_pct)
    }
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
            end_estimated: false,
            unique_ip_count: 5,
            traceroute_count: 3,
            matches: MatchSummary {
                match_count: 4,
                median_ping_ms: Some(17.6),
                median_ping_at_least: true,
                median_ping_by_game: false,
                status: Some(Severity::Watch),
            },
        };

        let json = serde_json::to_value(&item).unwrap();
        assert_eq!(json["uniqueIpCount"], 5);
        assert_eq!(json["tracerouteCount"], 3);
        assert_eq!(json["endEstimated"], false);
        assert_eq!(json["matchCount"], 4);
        assert_eq!(json["medianPingMs"], 17.6);
        assert_eq!(json["medianPingAtLeast"], true);
        assert_eq!(json["medianPingByGame"], false);
        assert_eq!(json["status"], "watch");
        assert!(json.get("matches").is_none());
    }

    #[test]
    fn test_session_without_matches_has_no_status() {
        let json = serde_json::to_value(MatchSummary::default()).unwrap();
        assert_eq!(json["matchCount"], 0);
        assert!(json["medianPingMs"].is_null());
        assert!(json["status"].is_null());
    }

    #[test]
    fn test_only_statuses_past_a_threshold_need_review() {
        let review = |status| {
            MatchSummary {
                status,
                ..MatchSummary::default()
            }
            .needs_review()
        };
        assert!(!review(None));
        assert!(!review(Some(Severity::Unmeasured)));
        assert!(!review(Some(Severity::Ok)));
        assert!(review(Some(Severity::Watch)));
        assert!(review(Some(Severity::Degraded)));
        assert!(review(Some(Severity::Critical)));
    }

    #[test]
    fn test_list_filter_defaults_missing_fields() {
        let filter: SessionListFilter = serde_json::from_str(r#"{"search":"riot"}"#).unwrap();
        assert_eq!(filter.search.as_deref(), Some("riot"));
        assert!(filter.game.is_none());
        assert!(!filter.to_review);

        let filter: SessionListFilter =
            serde_json::from_str(r#"{"game":"VALORANT","toReview":true}"#).unwrap();
        assert_eq!(filter.game.as_deref(), Some("VALORANT"));
        assert!(filter.to_review);
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
                usual: Some(UsualPing {
                    median_ms: Some(17.2),
                    sample_count: 20,
                }),
            }),
            game: Some(GameMeasure {
                measured_at: "2026-09-13T14:27:10.000Z".to_string(),
                sample_count: 250,
                ping_ms: 13.3,
                jitter_ms: Some(2.3),
                loss_pct: Some(0.0),
                packets_lost: 0,
                usual: None,
            }),
            region_pings: Some(RegionPings {
                measured_at: "2026-09-13T14:20:00.000Z".to_string(),
                pings: vec![RegionPing {
                    region: "Paris".to_string(),
                    ping_ms: 4.0,
                }],
            }),
            access: None,
            region_estimate: None,
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
        assert_eq!(json["trace"]["usual"]["medianMs"], 17.2);
        assert_eq!(json["trace"]["usual"]["sampleCount"], 20);
        assert_eq!(json["regionPings"]["pings"][0]["region"], "Paris");
        assert_eq!(json["game"]["pingMs"], 13.3);
        assert_eq!(json["status"], "ok");
        assert!(json["voice"].is_null());
        assert!(json.get("flow").is_none());
        assert_eq!(item.flow.ping_ms(), Some(13.3));
        assert!(!item.flow.ping_at_least());
        assert_eq!(item.flow.loss_pct(), Some(0.0));
    }
}

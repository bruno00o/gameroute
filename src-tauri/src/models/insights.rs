use super::severity::Severity;
use serde::Serialize;

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct SessionQualityPoint {
    pub session_id: i64,
    pub game_name: String,
    pub started_at: String,
    pub avg_latency: Option<f64>,
    pub problem_hop_ratio: f64,
    pub ip_count: i64,
}

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ServerStability {
    pub ip: String,
    pub asn: Option<String>,
    pub isp: Option<String>,
    pub country: Option<String>,
    pub lat: Option<f64>,
    pub lon: Option<f64>,
    pub avg_latency: Option<f64>,
    pub avg_packet_loss: Option<f64>,
    pub traceroute_count: i64,
    pub problem_hop_ratio: f64,
    pub is_game_server: bool,
}

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct HourlyQuality {
    pub hour: i32,
    pub session_count: i64,
    pub avg_latency: Option<f64>,
    pub problem_hop_ratio: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum PingSource {
    Trace,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PingBasis {
    pub source: PingSource,
    pub at_destination: bool,
    pub measured_hop: Option<i32>,
    pub measured_asn: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentPing {
    pub median_ms: f64,
    pub loss_pct: f64,
    pub sample_count: u32,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsualPing {
    pub median_ms: Option<f64>,
    pub sample_count: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum IncidentCause {
    Latency,
    Loss,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerIncident {
    pub session_id: i64,
    pub match_number: u32,
    pub started_at: String,
    pub measured_at: String,
    pub status: Severity,
    pub cause: IncidentCause,
    pub basis: PingBasis,
    pub ping_ms: f64,
    pub usual_ms: Option<f64>,
    pub loss_pct: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerSummaryItem {
    pub game_name: String,
    pub asn: Option<u32>,
    pub operator: Option<String>,
    pub city: Option<String>,
    pub ips: Vec<String>,
    pub match_count: u32,
    pub last_played_at: String,
    pub basis: Option<PingBasis>,
    pub recent: Option<RecentPing>,
    pub usual: UsualPing,
    pub status: Option<Severity>,
    pub last_incident: Option<ServerIncident>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerSummary {
    pub since: String,
    pub usual_max_samples: u32,
    pub usual_min_samples: u32,
    pub servers: Vec<ServerSummaryItem>,
}

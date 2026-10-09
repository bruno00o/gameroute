use super::insights::PingBasis;
use super::live_status::{LivePoint, MatchIncident};
use super::severity::Severity;
use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecapPeak {
    pub value: f64,
    pub at: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecapPoint {
    pub point: LivePoint,
    pub basis: PingBasis,
    pub at_least: bool,
    pub hop_ip: Option<String>,
    pub sample_count: u32,
    pub sent: i64,
    pub lost: i64,
    pub loss_pct: Option<f64>,
    pub ping_ms: Option<f64>,
    pub jitter_ms: Option<f64>,
    pub jitter_peak: Option<RecapPeak>,
    pub worst: Option<RecapPeak>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TimelineCell {
    pub offset_secs: i64,
    pub status: Severity,
    pub ping_ms: Option<f64>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MatchRecap {
    pub session_id: i64,
    pub period_id: i64,
    pub server_ip: String,
    pub server_port: i32,
    pub started_at: String,
    pub ended_at: String,
    pub duration_secs: i64,
    pub bucket_secs: i64,
    pub primary: Option<LivePoint>,
    pub points: Vec<RecapPoint>,
    pub cells: Vec<TimelineCell>,
    pub incidents: Vec<MatchIncident>,
}

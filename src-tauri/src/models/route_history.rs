use super::session::DbHop;
use super::traceroute::OperatorRoute;
use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RouteOperator {
    pub asn: Option<u32>,
    pub name: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LatestRouteTrace {
    pub traceroute_id: i64,
    pub session_id: i64,
    pub match_number: u32,
    pub started_at: String,
    pub target_ip: String,
    pub hops: Vec<DbHop>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsualRoute {
    pub game_name: String,
    pub route: OperatorRoute,
    pub trace_count: u32,
    pub total_traces: u32,
    pub persistent_loss: Option<f64>,
    pub latest: LatestRouteTrace,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RouteChange {
    pub game_name: String,
    pub started_at: String,
    pub ended_at: String,
    pub session_id: i64,
    pub match_number: u32,
    pub trace_count: u32,
    pub path: Vec<RouteOperator>,
    pub via: Vec<RouteOperator>,
    pub instead_of: Vec<RouteOperator>,
    pub total_ms: f64,
    pub usual_total_ms: f64,
    pub loss_pct: f64,
    pub returned: bool,
}

use serde::Serialize;

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct NetworkMapEntry {
    pub ip: String,
    pub country: Option<String>,
    pub city: Option<String>,
    pub lat: Option<f64>,
    pub lon: Option<f64>,
    pub asn: Option<String>,
    pub isp: Option<String>,
    pub session_count: i64,
    pub total_duration_secs: f64,
    pub total_packets: i64,
}

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct RecurringProblemHop {
    pub ip: String,
    pub asn: Option<String>,
    pub isp: Option<String>,
    pub occurrence_count: i64,
    pub avg_latency: Option<f64>,
    pub avg_packet_loss: Option<f64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkOverviewStats {
    pub unique_server_ips: i64,
    pub total_traceroutes: i64,
    pub total_problem_hops: i64,
    pub avg_latency: Option<f64>,
}

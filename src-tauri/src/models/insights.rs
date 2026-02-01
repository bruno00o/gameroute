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
    pub avg_latency: Option<f64>,
    pub avg_packet_loss: Option<f64>,
    pub traceroute_count: i64,
    pub problem_hop_ratio: f64,
}

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct HourlyQuality {
    pub hour: i32,
    pub session_count: i64,
    pub avg_latency: Option<f64>,
    pub problem_hop_ratio: f64,
}

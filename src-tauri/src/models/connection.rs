use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CapturedConnection {
    pub remote_ip: String,
    pub remote_port: u16,
    pub protocol: String,
    pub captured_at: String,
}

impl CapturedConnection {
    pub fn new(remote_ip: String, remote_port: u16, protocol: String) -> Self {
        Self {
            remote_ip,
            remote_port,
            protocol,
            captured_at: chrono::Utc::now().to_rfc3339(),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerIpCapturedEvent {
    pub ip: String,
    pub port: u16,
    pub protocol: String,
    pub captured_at: String,
}

impl From<&CapturedConnection> for ServerIpCapturedEvent {
    fn from(conn: &CapturedConnection) -> Self {
        Self {
            ip: conn.remote_ip.clone(),
            port: conn.remote_port,
            protocol: conn.protocol.clone(),
            captured_at: conn.captured_at.clone(),
        }
    }
}

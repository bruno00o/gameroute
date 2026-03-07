use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TracedServerIp {
    pub current_period_id: Option<i64>,
    pub server_ip: String,
    pub first_seen_at: String,
    pub total_packet_count: i32,
}

impl TracedServerIp {
    pub fn new(server_ip: String) -> Self {
        Self {
            current_period_id: None,
            server_ip,
            first_seen_at: chrono::Utc::now().to_rfc3339(),
            total_packet_count: 1,
        }
    }

    pub fn with_timestamp(server_ip: String, first_seen_at: String) -> Self {
        Self {
            current_period_id: None,
            server_ip,
            first_seen_at,
            total_packet_count: 1,
        }
    }

    pub fn set_period_id(&mut self, period_id: i64) {
        self.current_period_id = Some(period_id);
    }

    pub fn increment_packets(&mut self) {
        self.total_packet_count += 1;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_traced_server_ip_new() {
        let ip = TracedServerIp::new("185.60.112.157".to_string());

        assert_eq!(ip.server_ip, "185.60.112.157");
        assert!(ip.current_period_id.is_none());
        assert!(!ip.first_seen_at.is_empty());
        assert_eq!(ip.total_packet_count, 1);
    }

    #[test]
    fn test_traced_server_ip_with_timestamp() {
        let ip = TracedServerIp::with_timestamp(
            "8.8.8.8".to_string(),
            "2026-01-25T10:00:00Z".to_string(),
        );

        assert_eq!(ip.server_ip, "8.8.8.8");
        assert_eq!(ip.first_seen_at, "2026-01-25T10:00:00Z");
        assert!(ip.current_period_id.is_none());
    }

    #[test]
    fn test_set_period_id() {
        let mut ip = TracedServerIp::new("1.1.1.1".to_string());
        assert!(ip.current_period_id.is_none());

        ip.set_period_id(42);
        assert_eq!(ip.current_period_id, Some(42));
    }

    #[test]
    fn test_increment_packets() {
        let mut ip = TracedServerIp::new("1.1.1.1".to_string());
        assert_eq!(ip.total_packet_count, 1);

        ip.increment_packets();
        ip.increment_packets();
        assert_eq!(ip.total_packet_count, 3);
    }
}

use crate::models::severity::Severity;
use crate::models::HopResult;
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TracerouteStartedEvent {
    pub server_ip_count: u32,
    pub server_ips: Vec<String>,
    pub started_at: String,
}

impl TracerouteStartedEvent {
    pub fn new(server_ip_count: u32, server_ips: Vec<String>) -> Self {
        Self {
            server_ip_count,
            server_ips,
            started_at: chrono::Utc::now().to_rfc3339(),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TracerouteProgressEvent {
    pub current_ip: String,
    pub current_index: u32,
    pub total_count: u32,
    pub progress: u32,
}

impl TracerouteProgressEvent {
    pub fn new(current_ip: String, current_index: u32, total_count: u32) -> Self {
        let progress = (current_index.saturating_sub(1) * 100)
            .checked_div(total_count)
            .unwrap_or(0)
            .min(100);

        Self {
            current_ip,
            current_index,
            total_count,
            progress,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TracerouteServerIpCompleteEvent {
    pub index: u32,
    pub target_ip: String,
    pub success: bool,
    pub status: Severity,
}

impl TracerouteServerIpCompleteEvent {
    pub fn new(index: u32, target_ip: String, success: bool, status: Severity) -> Self {
        Self {
            index,
            target_ip,
            success,
            status,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TracerouteAllCompleteEvent {
    pub total_count: u32,
    pub successful: u32,
    pub failed: u32,
    pub completed_at: String,
}

impl TracerouteAllCompleteEvent {
    pub fn new(total_count: u32, successful: u32, failed: u32) -> Self {
        Self {
            total_count,
            successful,
            failed,
            completed_at: chrono::Utc::now().to_rfc3339(),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TracerouteHopEvent {
    pub server_ip_index: u32,
    pub target_ip: String,
    pub hop_number: u32,
    pub ip: Option<String>,
    pub hostname: Option<String>,
    pub rtt_ms: Option<f64>,
    pub timeout: bool,
}

impl TracerouteHopEvent {
    pub fn from_hop_result(server_ip_index: u32, target_ip: &str, hop: &HopResult) -> Self {
        Self {
            server_ip_index,
            target_ip: target_ip.to_string(),
            hop_number: hop.hop_number,
            ip: hop.ip.clone(),
            hostname: hop.hostname.clone(),
            rtt_ms: hop.rtt_avg,
            timeout: !hop.responded,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_traceroute_started_event() {
        let event = TracerouteStartedEvent::new(
            3,
            vec![
                "1.1.1.1".to_string(),
                "2.2.2.2".to_string(),
                "3.3.3.3".to_string(),
            ],
        );

        assert_eq!(event.server_ip_count, 3);
        assert_eq!(event.server_ips.len(), 3);
        assert!(!event.started_at.is_empty());
    }

    #[test]
    fn test_traceroute_progress_event_percentage() {
        let event1 = TracerouteProgressEvent::new("1.1.1.1".to_string(), 1, 4);
        assert_eq!(event1.progress, 0);

        let event2 = TracerouteProgressEvent::new("2.2.2.2".to_string(), 2, 4);
        assert_eq!(event2.progress, 25);

        let event3 = TracerouteProgressEvent::new("3.3.3.3".to_string(), 3, 4);
        assert_eq!(event3.progress, 50);

        let event4 = TracerouteProgressEvent::new("4.4.4.4".to_string(), 4, 4);
        assert_eq!(event4.progress, 75);
    }

    #[test]
    fn test_traceroute_progress_event_zero_total() {
        let event = TracerouteProgressEvent::new("1.1.1.1".to_string(), 0, 0);
        assert_eq!(event.progress, 0);
    }

    #[test]
    fn test_traceroute_server_ip_complete_event() {
        let event =
            TracerouteServerIpCompleteEvent::new(1, "1.1.1.1".to_string(), true, Severity::Watch);
        assert_eq!(event.index, 1);
        assert_eq!(event.target_ip, "1.1.1.1");
        assert!(event.success);
        assert!(serde_json::to_string(&event)
            .unwrap()
            .contains("\"status\":\"watch\""));
    }

    #[test]
    fn test_traceroute_all_complete_event() {
        let event = TracerouteAllCompleteEvent::new(5, 4, 1);
        assert_eq!(event.total_count, 5);
        assert_eq!(event.successful, 4);
        assert_eq!(event.failed, 1);
        assert!(!event.completed_at.is_empty());
    }

    #[test]
    fn test_traceroute_hop_event_from_hop_result() {
        let hop = HopResult::new(
            3,
            Some("8.8.8.8".to_string()),
            Some("dns.google".to_string()),
            vec![Some(15.0), Some(16.0), Some(14.0)],
        );

        let event = TracerouteHopEvent::from_hop_result(1, "1.2.3.4", &hop);

        assert_eq!(event.server_ip_index, 1);
        assert_eq!(event.target_ip, "1.2.3.4");
        assert_eq!(event.hop_number, 3);
        assert_eq!(event.ip, Some("8.8.8.8".to_string()));
        assert_eq!(event.hostname, Some("dns.google".to_string()));
        assert!(event.rtt_ms.is_some());
        assert!(!event.timeout);
    }

    #[test]
    fn test_traceroute_hop_event_timeout() {
        let hop = HopResult::timeout(5, 3);
        let event = TracerouteHopEvent::from_hop_result(2, "5.6.7.8", &hop);

        assert_eq!(event.hop_number, 5);
        assert!(event.ip.is_none());
        assert!(event.rtt_ms.is_none());
        assert!(event.timeout);
    }
}

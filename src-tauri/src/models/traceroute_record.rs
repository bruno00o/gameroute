use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct TracerouteRecord {
    pub id: i64,
    pub session_id: i64,
    pub target_ip: String,
    pub started_at: String,
    pub completed_at: Option<String>,
    pub problem_hop_index: Option<i32>,
    pub traceroute_method: Option<String>,
}

#[derive(Debug, Clone)]
pub struct TracerouteData {
    pub session_id: i64,
    pub target_ip: String,
    pub started_at: String,
    pub traceroute_method: Option<String>,
}

impl TracerouteData {
    pub fn new(session_id: i64, target_ip: String, started_at: String) -> Self {
        Self {
            session_id,
            target_ip,
            started_at,
            traceroute_method: None,
        }
    }

    pub fn with_method(mut self, method: String) -> Self {
        self.traceroute_method = Some(method);
        self
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TracerouteWithHops {
    pub id: i64,
    pub session_id: i64,
    pub target_ip: String,
    pub started_at: String,
    pub completed_at: Option<String>,
    pub problem_hop_index: Option<i32>,
    pub traceroute_method: Option<String>,
    pub hops: Vec<super::session::DbHop>,
    #[serde(default)]
    pub status: super::severity::Severity,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_traceroute_record_serialization() {
        let record = TracerouteRecord {
            id: 1,
            session_id: 1,
            target_ip: "185.60.112.157".to_string(),
            started_at: "2026-01-25T10:00:00Z".to_string(),
            completed_at: Some("2026-01-25T10:00:25Z".to_string()),
            problem_hop_index: Some(5),
            traceroute_method: Some("ICMP (tracert)".to_string()),
        };

        let json = serde_json::to_string(&record).unwrap();
        assert!(json.contains("sessionId"));
        assert!(json.contains("targetIp"));
        assert!(json.contains("startedAt"));
        assert!(json.contains("completedAt"));
        assert!(json.contains("problemHopIndex"));
    }

    #[test]
    fn test_traceroute_data_new() {
        let data =
            TracerouteData::new(1, "8.8.8.8".to_string(), "2026-01-25T10:00:00Z".to_string());

        assert_eq!(data.session_id, 1);
        assert_eq!(data.target_ip, "8.8.8.8");
    }
}

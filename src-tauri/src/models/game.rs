use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectedGame {
    pub game_name: String,
    pub pid: u32,
    pub detected_at: String,
    pub exe_path: Option<String>,
    pub icon: Option<String>,
    #[serde(default)]
    pub is_manual: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunningProcess {
    pub pid: u32,
    pub name: String,
    pub path: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunningApp {
    pub name: String,
    pub pid: u32,
    pub process_count: u32,
    pub path: Option<String>,
}

impl DetectedGame {
    pub fn new(game_name: String, pid: u32, exe_path: Option<String>) -> Self {
        Self {
            game_name,
            pid,
            detected_at: chrono::Utc::now().to_rfc3339(),
            exe_path,
            icon: None,
            is_manual: false,
        }
    }

    pub fn new_manual(game_name: String, pid: u32, exe_path: Option<String>) -> Self {
        Self {
            game_name,
            pid,
            detected_at: chrono::Utc::now().to_rfc3339(),
            exe_path,
            icon: None,
            is_manual: true,
        }
    }
}

use super::{CapturedConnection, TracedServerIp};
use std::collections::HashSet;

#[derive(Debug, Clone, Default)]
pub struct MonitoringState {
    pub is_monitoring: bool,
    pub current_game: Option<DetectedGame>,
    pub is_manual_mode: bool,
    pub manual_pid: Option<u32>,
    pub current_session_id: Option<i64>,
    pub captured_ips: Vec<CapturedConnection>,
    pub traced_server_ips: Vec<TracedServerIp>,
    pub seen_server_ips: HashSet<String>,
    pub session_started_at: Option<String>,
    pub session_ended_at: Option<String>,
}

impl MonitoringState {
    pub fn start_session(&mut self) {
        self.session_started_at = Some(chrono::Utc::now().to_rfc3339());
        self.session_ended_at = None;
    }

    pub fn end_session(&mut self) {
        self.session_ended_at = Some(chrono::Utc::now().to_rfc3339());
    }

    pub fn session_duration_seconds(&self) -> Option<u64> {
        match (&self.session_started_at, &self.session_ended_at) {
            (Some(start), Some(end)) => {
                let start_dt = match chrono::DateTime::parse_from_rfc3339(start) {
                    Ok(dt) => dt,
                    Err(e) => {
                        log::warn!("Failed to parse session_started_at '{}': {}", start, e);
                        return None;
                    }
                };
                let end_dt = match chrono::DateTime::parse_from_rfc3339(end) {
                    Ok(dt) => dt,
                    Err(e) => {
                        log::warn!("Failed to parse session_ended_at '{}': {}", end, e);
                        return None;
                    }
                };
                Some((end_dt - start_dt).num_seconds().max(0) as u64)
            }
            _ => None,
        }
    }

    pub fn server_ip_count(&self) -> u32 {
        self.traced_server_ips.len() as u32
    }

    pub fn reset(&mut self) {
        self.current_game = None;
        self.current_session_id = None;
        self.captured_ips.clear();
        self.traced_server_ips.clear();
        self.seen_server_ips.clear();
        self.session_started_at = None;
        self.session_ended_at = None;
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GameEndedEvent {
    pub game_name: String,
    pub session_id: Option<i64>,
    pub server_ips: Vec<TracedServerIp>,
    pub session_duration: u64,
    pub server_ip_count: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IpCapacityReachedEvent {
    pub max_ips: usize,
}

impl IpCapacityReachedEvent {
    pub fn new(max_ips: usize) -> Self {
        Self { max_ips }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_session_duration_calculation() {
        let mut state = MonitoringState::default();
        state.session_started_at = Some("2026-01-22T10:00:00Z".to_string());
        state.session_ended_at = Some("2026-01-22T11:30:00Z".to_string());

        let duration = state.session_duration_seconds();
        assert_eq!(duration, Some(5400));
    }

    #[test]
    fn test_session_duration_without_end() {
        let mut state = MonitoringState::default();
        state.session_started_at = Some("2026-01-22T10:00:00Z".to_string());

        let duration = state.session_duration_seconds();
        assert_eq!(duration, None);
    }

    #[test]
    fn test_session_duration_without_start() {
        let mut state = MonitoringState::default();

        state.session_ended_at = Some("2026-01-22T11:30:00Z".to_string());

        let duration = state.session_duration_seconds();
        assert_eq!(duration, None);
    }

    #[test]
    fn test_server_ip_count_empty() {
        let state = MonitoringState::default();
        assert_eq!(state.server_ip_count(), 0);
    }

    #[test]
    fn test_server_ip_count_with_ips() {
        let mut state = MonitoringState::default();

        state
            .traced_server_ips
            .push(TracedServerIp::new("1.1.1.1".to_string()));
        state
            .traced_server_ips
            .push(TracedServerIp::new("2.2.2.2".to_string()));

        assert_eq!(state.server_ip_count(), 2);
    }

    #[test]
    fn test_start_session() {
        let mut state = MonitoringState::default();
        assert!(state.session_started_at.is_none());
        assert!(state.session_ended_at.is_none());

        state.start_session();

        assert!(state.session_started_at.is_some());
        assert!(state.session_ended_at.is_none());
    }

    #[test]
    fn test_end_session() {
        let mut state = MonitoringState::default();
        state.start_session();
        assert!(state.session_ended_at.is_none());

        state.end_session();

        assert!(state.session_ended_at.is_some());
    }

    #[test]
    fn test_reset() {
        let mut state = MonitoringState::default();
        state.current_game = Some(DetectedGame::new("Test".to_string(), 1234, None));
        state.current_session_id = Some(42);
        state
            .traced_server_ips
            .push(TracedServerIp::new("1.1.1.1".to_string()));
        state.seen_server_ips.insert("1.1.1.1".to_string());
        state.start_session();
        state.end_session();

        state.reset();

        assert!(state.current_game.is_none());
        assert!(state.current_session_id.is_none());
        assert!(state.traced_server_ips.is_empty());
        assert!(state.seen_server_ips.is_empty());
        assert!(state.session_started_at.is_none());
        assert!(state.session_ended_at.is_none());
    }
}

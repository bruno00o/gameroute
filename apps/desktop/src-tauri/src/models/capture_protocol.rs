//! IPC protocol types for communication between the Tauri app and the capture service.
//!
//! Wire format: [4 bytes: length u32 LE][N bytes: JSON payload]

use serde::{Deserialize, Serialize};
use std::time::Duration;

/// Current protocol version for compatibility checking.
pub const PROTOCOL_VERSION: u32 = 2;

// ── Tagged request/response enums ────────────────────────────────────────────

/// Top-level request sent from the Tauri app to the capture service.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum ServiceRequest {
    Capture(CaptureRequest),
    Traceroute(TracerouteRequest),
}

/// Top-level response sent from the capture service to the Tauri app.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum ServiceResponse {
    Capture(CaptureResponse),
    Traceroute(TracerouteResponse),
}

// ── Capture types (existing) ─────────────────────────────────────────────────

/// Request sent from the Tauri app to the capture service.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CaptureRequest {
    /// Unique session ID to correlate request/response.
    pub session_id: String,
    /// Local UDP ports to monitor for outgoing traffic.
    pub local_ports: Vec<u16>,
    /// Duration in seconds to capture packets.
    pub duration_secs: u32,
}

impl CaptureRequest {
    pub fn new(session_id: String, local_ports: Vec<u16>, duration_secs: u32) -> Self {
        Self {
            session_id,
            local_ports,
            duration_secs,
        }
    }
}

/// Response sent from the capture service to the Tauri app.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CaptureResponse {
    /// Session ID matching the request.
    pub session_id: String,
    /// Status of the capture operation.
    pub status: CaptureStatus,
    /// Captured remote endpoints (only populated on success).
    pub endpoints: Vec<CapturedEndpoint>,
    /// Error message if status is not Success.
    pub error_message: Option<String>,
    /// ETW delivery counters for this capture window (absent from older services).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stats: Option<CaptureStats>,
}

impl CaptureResponse {
    pub fn success(session_id: String, endpoints: Vec<CapturedEndpoint>) -> Self {
        Self {
            session_id,
            status: CaptureStatus::Success,
            endpoints,
            error_message: None,
            stats: None,
        }
    }

    pub fn error(session_id: String, status: CaptureStatus, message: String) -> Self {
        Self {
            session_id,
            status,
            endpoints: Vec::new(),
            error_message: Some(message),
            stats: None,
        }
    }

    pub fn with_stats(mut self, stats: CaptureStats) -> Self {
        self.stats = Some(stats);
        self
    }
}

/// What the ETW consumer received during a capture, and what the pktmon session
/// failed to deliver in real time over the same window (None if the session could not be queried).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct CaptureStats {
    pub events_received: u64,
    #[serde(default)]
    pub events_lost: Option<u32>,
    #[serde(default)]
    pub realtime_buffers_lost: Option<u32>,
}

impl CaptureStats {
    pub fn has_losses(&self) -> bool {
        self.events_lost.unwrap_or(0) > 0 || self.realtime_buffers_lost.unwrap_or(0) > 0
    }
}

/// Status of the capture operation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum CaptureStatus {
    /// Capture completed successfully.
    Success,
    /// Service is busy with another capture.
    ServiceBusy,
    /// Protocol version mismatch.
    VersionMismatch,
    /// No ports provided to capture.
    NoPorts,
    /// Capture tool (pktmon) failed.
    CaptureFailed,
    /// Internal service error.
    InternalError,
}

/// A captured remote endpoint from UDP traffic.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CapturedEndpoint {
    /// Local port that sent/received the traffic.
    pub local_port: u16,
    /// Remote IP address.
    pub remote_ip: String,
    /// Remote port.
    pub remote_port: u16,
    /// Number of packets observed for this endpoint.
    pub packet_count: u32,
}

impl CapturedEndpoint {
    pub fn new(local_port: u16, remote_ip: String, remote_port: u16) -> Self {
        Self {
            local_port,
            remote_ip,
            remote_port,
            packet_count: 1,
        }
    }
}

// ── Traceroute types (new) ───────────────────────────────────────────────────

/// Request to run a traceroute via the capture service.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TracerouteRequest {
    /// Unique session ID to correlate request/response.
    pub session_id: String,
    /// Target IP address to trace.
    pub target_ip: String,
    /// Transport protocol: "TCP", "UDP", or "ICMP".
    pub protocol: String,
    /// Destination port for TCP/UDP traceroutes.
    pub port: u16,
    /// Maximum number of hops (TTL).
    pub max_hops: u8,
}

/// Response from a traceroute executed by the capture service.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TracerouteResponse {
    /// Session ID matching the request.
    pub session_id: String,
    /// Status of the traceroute operation.
    pub status: TracerouteStatus,
    /// Hops discovered during the traceroute.
    pub hops: Vec<ServiceHop>,
    /// Whether the destination IP was reached.
    pub destination_reached: bool,
    /// Error message if status is not Success.
    pub error_message: Option<String>,
}

/// Status of a traceroute operation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum TracerouteStatus {
    Success,
    Failed,
    Timeout,
}

/// A single hop from a traceroute performed by the service.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServiceHop {
    /// TTL / hop number.
    pub ttl: u32,
    /// Responding IP address, or None if the hop timed out.
    pub ip: Option<String>,
    /// RTT measurements for each probe (None = timeout).
    pub rtt_probes: Vec<Option<f64>>,
}

impl ServiceHop {
    pub fn rtt_probes_from_samples(samples: &[Duration], total_sent: usize) -> Vec<Option<f64>> {
        let mut probes: Vec<Option<f64>> = samples
            .iter()
            .filter(|rtt| !rtt.is_zero())
            .map(|rtt| Some(rtt.as_secs_f64() * 1000.0))
            .collect();
        let len = total_sent.max(probes.len()).max(1);
        probes.resize(len, None);
        probes
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lost_probes_are_not_reported_as_zero_rtt() {
        let samples = [
            Duration::from_micros(14_500),
            Duration::ZERO,
            Duration::from_micros(12_000),
        ];
        assert_eq!(
            ServiceHop::rtt_probes_from_samples(&samples, 3),
            vec![Some(14.5), Some(12.0), None]
        );
    }

    #[test]
    fn silent_hop_keeps_one_timeout_per_probe() {
        assert_eq!(
            ServiceHop::rtt_probes_from_samples(&[Duration::ZERO; 3], 3),
            vec![None, None, None]
        );
        assert_eq!(ServiceHop::rtt_probes_from_samples(&[], 0), vec![None]);
    }

    #[derive(Deserialize)]
    #[serde(tag = "type")]
    enum OlderServiceResponse {
        Capture(OlderCaptureResponse),
    }

    #[derive(Deserialize)]
    struct OlderCaptureResponse {
        status: CaptureStatus,
        endpoints: Vec<CapturedEndpoint>,
    }

    #[test]
    fn an_older_app_still_reads_a_capture_response_with_stats() {
        let endpoint = CapturedEndpoint::new(5000, "1.2.3.4".into(), 7000);
        let response = ServiceResponse::Capture(
            CaptureResponse::success("s".into(), vec![endpoint]).with_stats(CaptureStats {
                events_received: 42,
                events_lost: Some(0),
                realtime_buffers_lost: Some(3),
            }),
        );
        let json = serde_json::to_vec(&response).unwrap();
        let OlderServiceResponse::Capture(old) = serde_json::from_slice(&json).unwrap();
        assert_eq!(old.status, CaptureStatus::Success);
        assert_eq!(old.endpoints.len(), 1);
    }

    #[test]
    fn a_response_from_an_older_service_has_no_stats() {
        let json = concat!(
            r#"{"type":"Capture","session_id":"s","status":"Success","#,
            r#""endpoints":[],"error_message":null}"#
        );
        let ServiceResponse::Capture(response) = serde_json::from_str(json).unwrap() else {
            panic!("expected a capture response");
        };
        assert_eq!(response.stats, None);
        let json = serde_json::to_string(&ServiceResponse::Capture(response)).unwrap();
        assert!(!json.contains("stats"));
    }

    #[test]
    fn stats_report_losses_only_when_a_counter_moved() {
        let mut stats = CaptureStats { events_received: 10, ..Default::default() };
        assert!(!stats.has_losses());
        stats.events_lost = Some(0);
        stats.realtime_buffers_lost = Some(0);
        assert!(!stats.has_losses());
        stats.realtime_buffers_lost = Some(1);
        assert!(stats.has_losses());
    }
}

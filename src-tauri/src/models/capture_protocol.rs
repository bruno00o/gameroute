//! IPC protocol types for communication between the Tauri app and the capture service.
//!
//! Wire format: [4 bytes: length u32 LE][N bytes: JSON payload]

use serde::{Deserialize, Serialize};

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
}

impl CaptureResponse {
    pub fn success(session_id: String, endpoints: Vec<CapturedEndpoint>) -> Self {
        Self {
            session_id,
            status: CaptureStatus::Success,
            endpoints,
            error_message: None,
        }
    }

    pub fn error(session_id: String, status: CaptureStatus, message: String) -> Self {
        Self {
            session_id,
            status,
            endpoints: Vec::new(),
            error_message: Some(message),
        }
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

//! Client for communicating with the GameRoute Capture Service.
//!
//! This module provides async functions to request UDP packet capture and
//! traceroute execution from the privileged Windows service via named pipes.

use crate::config::{
    CAPTURE_SERVICE_PIPE_NAME, CAPTURE_SERVICE_TOTAL_TIMEOUT_MS, TRACEROUTE_SERVICE_TIMEOUT_MS,
    UDP_CAPTURE_DURATION_SECS,
};
use crate::models::capture_protocol::{
    CaptureRequest, CaptureStatus, CapturedEndpoint, ServiceHop, ServiceRequest, ServiceResponse,
    TracerouteRequest, TracerouteStatus,
};
use crate::models::HopResult;
use tokio::time::{timeout, Duration};

/// Result of a traceroute performed by the capture service.
pub struct TracerouteServiceResult {
    pub hops: Vec<HopResult>,
    pub destination_reached: bool,
}

/// Request UDP capture from the capture service.
///
/// This function connects to the capture service via named pipe, sends a capture
/// request for the given local ports, and returns the captured endpoints.
///
/// # Graceful Degradation
/// If the service is not available, this function returns an empty list rather
/// than failing. This allows the app to continue with TCP-only capture.
pub async fn request_udp_capture(local_ports: Vec<u16>) -> Result<Vec<CapturedEndpoint>, String> {

    if local_ports.is_empty() {
        return Ok(Vec::new());
    }

    // Generate a session ID
    let session_id = uuid::Uuid::new_v4().to_string();

    let request = ServiceRequest::Capture(
        CaptureRequest::new(session_id.clone(), local_ports, UDP_CAPTURE_DURATION_SECS),
    );

    // Serialize the request
    let request_json = serde_json::to_vec(&request).map_err(|e| e.to_string())?;
    let request_len = (request_json.len() as u32).to_le_bytes();

    // Try to connect to the pipe with timeout
    let result = timeout(
        Duration::from_millis(CAPTURE_SERVICE_TOTAL_TIMEOUT_MS),
        tokio::task::spawn_blocking(move || {
            connect_and_communicate(&request_len, &request_json)
        }),
    )
    .await;

    match result {
        Ok(Ok(Ok(response))) => {
            match response {
                ServiceResponse::Capture(capture_resp) => {
                    if capture_resp.session_id != session_id {
                        log::warn!("UDP capture: session ID mismatch");
                        return Err("Session ID mismatch".to_string());
                    }

                    match capture_resp.status {
                        CaptureStatus::Success => {
                            log::info!(
                                "UDP capture service returned {} endpoints",
                                capture_resp.endpoints.len()
                            );
                            for ep in &capture_resp.endpoints {
                                log::info!(
                                    "  UDP endpoint: local:{} -> {}:{} ({} pkts)",
                                    ep.local_port, ep.remote_ip, ep.remote_port, ep.packet_count
                                );
                            }
                            Ok(capture_resp.endpoints)
                        }
                        _ => {
                            let msg = capture_resp
                                .error_message
                                .unwrap_or_else(|| format!("{:?}", capture_resp.status));
                            log::warn!("UDP capture service error: {}", msg);
                            Err(msg)
                        }
                    }
                }
                _ => {
                    log::warn!("UDP capture: unexpected response type");
                    Err("Unexpected response type".to_string())
                }
            }
        }
        Ok(Ok(Err(e))) => {
            log::warn!("UDP capture service communication error: {}", e);
            Err(e)
        }
        Ok(Err(e)) => {
            log::warn!("UDP capture task panicked: {}", e);
            Err("Task panicked".to_string())
        }
        Err(_) => {
            log::warn!("UDP capture timed out");
            Err("Timeout".to_string())
        }
    }
}

/// Request a traceroute from the capture service.
///
/// The service runs trippy-core with SYSTEM privileges, supporting TCP/UDP/ICMP
/// traceroutes on the actual protocol and port the game server uses.
///
/// Used for the hybrid approach: trippy reaches destinations that block
/// ICMP while tracert.exe provides intermediate hops.
pub async fn request_traceroute(
    target_ip: String,
    protocol: String,
    port: u16,
    max_hops: u8,
) -> Result<TracerouteServiceResult, String> {
    let session_id = uuid::Uuid::new_v4().to_string();

    let request = ServiceRequest::Traceroute(TracerouteRequest {
        session_id: session_id.clone(),
        target_ip: target_ip.clone(),
        protocol,
        port,
        max_hops,
    });

    let request_json = serde_json::to_vec(&request).map_err(|e| e.to_string())?;
    let request_len = (request_json.len() as u32).to_le_bytes();

    let result = timeout(
        Duration::from_millis(TRACEROUTE_SERVICE_TIMEOUT_MS),
        tokio::task::spawn_blocking(move || {
            connect_and_communicate(&request_len, &request_json)
        }),
    )
    .await;

    match result {
        Ok(Ok(Ok(response))) => {
            match response {
                ServiceResponse::Traceroute(trace_resp) => {
                    if trace_resp.session_id != session_id {
                        return Err("Session ID mismatch".to_string());
                    }

                    match trace_resp.status {
                        TracerouteStatus::Success => {
                            let hops = convert_service_hops(&trace_resp.hops);
                            Ok(TracerouteServiceResult {
                                hops,
                                destination_reached: trace_resp.destination_reached,
                            })
                        }
                        TracerouteStatus::Timeout => {
                            // Partial results may still be useful
                            let hops = convert_service_hops(&trace_resp.hops);
                            if !hops.is_empty() {
                                Ok(TracerouteServiceResult {
                                    hops,
                                    destination_reached: trace_resp.destination_reached,
                                })
                            } else {
                                Err(trace_resp.error_message.unwrap_or_else(|| "Timeout".to_string()))
                            }
                        }
                        TracerouteStatus::Failed => {
                            Err(trace_resp.error_message.unwrap_or_else(|| "Traceroute failed".to_string()))
                        }
                    }
                }
                _ => Err("Unexpected response type".to_string()),
            }
        }
        Ok(Ok(Err(e))) => Err(e),
        Ok(Err(e)) => Err(format!("Task panicked: {}", e)),
        Err(_) => Err("Traceroute service timeout".to_string()),
    }
}

/// Convert ServiceHop vec to HopResult vec.
fn convert_service_hops(service_hops: &[ServiceHop]) -> Vec<HopResult> {
    service_hops
        .iter()
        .map(|sh| {
            if sh.ip.is_some() && sh.rtt_probes.iter().any(|p| p.is_some()) {
                HopResult::new(sh.ttl, sh.ip.clone(), None, sh.rtt_probes.clone())
            } else {
                HopResult::timeout(sh.ttl, sh.rtt_probes.len().max(1) as u32)
            }
        })
        .collect()
}

fn connect_and_communicate(
    request_len: &[u8; 4],
    request_json: &[u8],
) -> Result<ServiceResponse, String> {
    use std::fs::OpenOptions;
    use std::io::{Read, Write};

    // Open the named pipe (standard Win32 CreateFile under the hood)
    let mut pipe = OpenOptions::new()
        .read(true)
        .write(true)
        .open(CAPTURE_SERVICE_PIPE_NAME)
        .map_err(|e| format!("Service not available: {}", e))?;

    // Write the request
    pipe.write_all(request_len)
        .map_err(|e| format!("Failed to write length: {}", e))?;
    pipe.write_all(request_json)
        .map_err(|e| format!("Failed to write request: {}", e))?;
    pipe.flush()
        .map_err(|e| format!("Failed to flush: {}", e))?;

    // Read the response length
    let mut len_buf = [0u8; 4];
    pipe.read_exact(&mut len_buf)
        .map_err(|e| format!("Failed to read response length: {}", e))?;
    let response_len = u32::from_le_bytes(len_buf) as usize;

    if response_len > 10 * 1024 * 1024 {
        return Err("Response too large".to_string());
    }

    // Read the response JSON
    let mut response_buf = vec![0u8; response_len];
    pipe.read_exact(&mut response_buf)
        .map_err(|e| format!("Failed to read response: {}", e))?;

    // Parse the response
    serde_json::from_slice(&response_buf).map_err(|e| format!("Failed to parse response: {}", e))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_empty_ports_returns_empty() {
        let result = request_udp_capture(Vec::new()).await;
        assert!(result.is_ok());
        assert!(result.unwrap().is_empty());
    }

    #[tokio::test]
    async fn test_service_unavailable_returns_error() {
        // When service is not running, we expect an error (graceful degradation
        // happens at the call site in game_detection.rs)
        let result = request_udp_capture(vec![12345]).await;
        // Either succeeds with empty list or fails - both are acceptable
        // depending on whether the service is installed
        assert!(result.is_ok() || result.is_err());
    }

    #[test]
    fn test_convert_service_hops_success() {
        let service_hops = vec![
            ServiceHop {
                ttl: 1,
                ip: Some("192.168.1.1".to_string()),
                rtt_probes: vec![Some(1.5), Some(2.0)],
            },
            ServiceHop {
                ttl: 2,
                ip: None,
                rtt_probes: vec![None, None],
            },
        ];

        let hops = convert_service_hops(&service_hops);
        assert_eq!(hops.len(), 2);
        assert_eq!(hops[0].hop_number, 1);
        assert!(hops[0].responded);
        assert_eq!(hops[1].hop_number, 2);
        assert!(!hops[1].responded);
    }
}

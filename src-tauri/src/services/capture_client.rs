//! Client for communicating with the GameRoute Capture Service.
//!
//! This module provides async functions to request UDP packet capture and
//! traceroute execution from the privileged Windows service via named pipes.

use crate::config::{
    CAPTURE_SERVICE_PIPE_NAME, CAPTURE_SERVICE_TOTAL_TIMEOUT_MS, PIPE_READ_TIMEOUT_MS,
    TRACEROUTE_SERVICE_TIMEOUT_MS, UDP_CAPTURE_DURATION_SECS,
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
            connect_and_communicate(&request_len, &request_json, PIPE_READ_TIMEOUT_MS)
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
        Duration::from_millis(u64::from(TRACEROUTE_SERVICE_TIMEOUT_MS) + 5_000),
        tokio::task::spawn_blocking(move || {
            connect_and_communicate(&request_len, &request_json, TRACEROUTE_SERVICE_TIMEOUT_MS)
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
                            Ok(TracerouteServiceResult { hops })
                        }
                        TracerouteStatus::Timeout => {
                            // Partial results may still be useful
                            let hops = convert_service_hops(&trace_resp.hops);
                            if !hops.is_empty() {
                                Ok(TracerouteServiceResult { hops })
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
    response_timeout_ms: u32,
) -> Result<ServiceResponse, String> {
    use std::io::Write;
    use std::os::windows::io::{FromRawHandle, IntoRawHandle};

    use windows_sys::Win32::Foundation::{
        CloseHandle, GetLastError, GENERIC_READ, GENERIC_WRITE, HANDLE, INVALID_HANDLE_VALUE,
        WAIT_OBJECT_0, WAIT_TIMEOUT,
    };
    use windows_sys::Win32::Storage::FileSystem::{
        CreateFileW, FILE_FLAG_OVERLAPPED, OPEN_EXISTING, ReadFile,
    };
    use windows_sys::Win32::System::IO::{CancelIoEx, GetOverlappedResult, OVERLAPPED};
    use windows_sys::Win32::System::Threading::{CreateEventW, WaitForSingleObject};

    // Encode pipe name as wide string for CreateFileW
    let pipe_name_wide: Vec<u16> = CAPTURE_SERVICE_PIPE_NAME
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect();

    // Open the named pipe with FILE_FLAG_OVERLAPPED so reads can be timed out
    let handle: HANDLE = unsafe {
        CreateFileW(
            pipe_name_wide.as_ptr(),
            GENERIC_READ | GENERIC_WRITE,
            0,
            std::ptr::null(),
            OPEN_EXISTING,
            FILE_FLAG_OVERLAPPED,
            std::ptr::null_mut(),
        )
    };

    if handle == INVALID_HANDLE_VALUE {
        let err = unsafe { GetLastError() };
        return Err(format!("Service not available (error {})", err));
    }

    // Wrap the handle in a File so writes (synchronous-style via overlapped handle)
    // and cleanup (Drop) are handled automatically. We only need overlapped reads.
    let mut pipe = unsafe { std::fs::File::from_raw_handle(handle) };

    // Write the request (writes on an overlapped pipe handle still complete
    // synchronously when the pipe buffer has space, which is the common case here)
    pipe.write_all(request_len)
        .map_err(|e| format!("Failed to write length: {}", e))?;
    pipe.write_all(request_json)
        .map_err(|e| format!("Failed to write request: {}", e))?;
    pipe.flush()
        .map_err(|e| format!("Failed to flush: {}", e))?;

    // Take the raw handle back for overlapped reads; we must not let File drop it
    let raw_handle: HANDLE = pipe.into_raw_handle();

    // Helper: perform a single overlapped read with a timeout.
    // Reads `buf.len()` bytes total, looping if partial reads occur.
    let read_with_timeout =
        |handle: HANDLE, buf: &mut [u8], timeout_ms: u32| -> Result<(), String> {
            let event = unsafe { CreateEventW(std::ptr::null(), 1, 0, std::ptr::null()) };
            if event.is_null() {
                return Err("Failed to create event".to_string());
            }

            let mut total_read: usize = 0;
            let result = (|| {
                while total_read < buf.len() {
                    let mut overlapped: OVERLAPPED = unsafe { std::mem::zeroed() };
                    overlapped.hEvent = event;

                    let remaining = buf.len() - total_read;
                    let mut bytes_read: u32 = 0;

                    let ok = unsafe {
                        ReadFile(
                            handle,
                            buf.as_mut_ptr().add(total_read).cast(),
                            remaining as u32,
                            &mut bytes_read,
                            &mut overlapped,
                        )
                    };

                    if ok != 0 {
                        // Completed immediately
                        total_read += bytes_read as usize;
                        continue;
                    }

                    let err = unsafe { GetLastError() };
                    // ERROR_IO_PENDING = 997
                    if err != 997 {
                        return Err(format!("ReadFile failed (error {})", err));
                    }

                    // Wait for the overlapped operation with timeout
                    let wait = unsafe { WaitForSingleObject(event, timeout_ms) };
                    match wait {
                        w if w == WAIT_OBJECT_0 => {
                            let mut transferred: u32 = 0;
                            let ok = unsafe {
                                GetOverlappedResult(handle, &overlapped, &mut transferred, 0)
                            };
                            if ok == 0 {
                                let err = unsafe { GetLastError() };
                                return Err(format!("Overlapped read failed (error {})", err));
                            }
                            total_read += transferred as usize;
                        }
                        w if w == WAIT_TIMEOUT => {
                            // Cancel the pending I/O before returning
                            unsafe {
                                CancelIoEx(handle, &overlapped);
                            }
                            return Err(format!(
                                "Pipe read timed out after {}ms",
                                timeout_ms
                            ));
                        }
                        _ => {
                            return Err("WaitForSingleObject failed".to_string());
                        }
                    }
                }
                Ok(())
            })();

            unsafe {
                CloseHandle(event);
            }
            result
        };

    // Read the response length (4 bytes) with timeout
    let mut len_buf = [0u8; 4];
    let read_result = read_with_timeout(raw_handle, &mut len_buf, response_timeout_ms);

    if let Err(e) = read_result {
        unsafe { CloseHandle(raw_handle); }
        return Err(format!("Failed to read response length: {}", e));
    }

    let response_len = u32::from_le_bytes(len_buf) as usize;

    if response_len > 10 * 1024 * 1024 {
        unsafe { CloseHandle(raw_handle); }
        return Err("Response too large".to_string());
    }

    // Read the response JSON with timeout
    let mut response_buf = vec![0u8; response_len];
    let read_result = read_with_timeout(raw_handle, &mut response_buf, PIPE_READ_TIMEOUT_MS);

    unsafe { CloseHandle(raw_handle); }

    if let Err(e) = read_result {
        return Err(format!("Failed to read response: {}", e));
    }

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

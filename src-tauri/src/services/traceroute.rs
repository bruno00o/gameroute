use crate::config::{LATENCY_INCREASE_THRESHOLD, PACKET_LOSS_THRESHOLD, TRACEROUTE_MAX_HOPS};
use crate::db::{get_hop_repository, get_traceroute_repository};
use crate::models::session::HopData;
use crate::models::{HopResult, TracedServerIp};
use std::collections::VecDeque;
use std::sync::Arc;
use std::time::Instant;
use tokio::sync::RwLock;

#[derive(Debug, Clone)]
pub struct TracerouteJob {
    pub target_ip: String,
    pub protocol: String,
    pub port: u16,
    pub index: u32,
    pub traceroute_id: Option<i64>,
}

#[allow(dead_code)] // Used via Tauri commands (invisible to clippy)
impl TracerouteJob {
    pub fn from_server_ip(server_ip: &TracedServerIp, index: u32) -> Self {
        Self {
            target_ip: server_ip.server_ip.clone(),
            protocol: "ICMP".to_string(),
            port: 0,
            index,
            traceroute_id: None,
        }
    }

    pub fn new(target_ip: String, index: u32, traceroute_id: Option<i64>) -> Self {
        Self {
            target_ip,
            protocol: "ICMP".to_string(),
            port: 0,
            index,
            traceroute_id,
        }
    }

    pub fn with_protocol(mut self, protocol: String, port: u16) -> Self {
        let normalized = protocol.to_uppercase();
        self.protocol = match normalized.as_str() {
            "TCP" | "UDP" | "ICMP" => normalized,
            _ => {
                log::warn!("Invalid protocol '{}', falling back to ICMP", protocol);
                "ICMP".to_string()
            }
        };
        self.port = port;
        self
    }
}

#[allow(dead_code)] // Fields used via Tauri commands (invisible to clippy)
#[derive(Debug, Clone)]
pub struct TracerouteResult {
    pub target_ip: String,
    pub index: u32,
    pub traceroute_id: Option<i64>,
    pub success: bool,
    pub hops: Vec<HopResult>,
    pub destination_reached: bool,
    pub total_hops: u32,
    pub method: String,
}

#[derive(Debug, Default)]
pub struct TracerouteState {
    pub is_running: bool,
    pub current_job: Option<TracerouteJob>,
    pub pending_jobs: VecDeque<TracerouteJob>,
    pub completed_count: u32,
    pub total_count: u32,
}

pub struct TracerouteService {
    pub state: Arc<RwLock<TracerouteState>>,
}

impl Default for TracerouteService {
    fn default() -> Self {
        Self::new()
    }
}

#[allow(dead_code)] // Methods used via Tauri commands (invisible to clippy)
impl TracerouteService {
    pub fn new() -> Self {
        Self {
            state: Arc::new(RwLock::new(TracerouteState::default())),
        }
    }

    pub async fn queue_traceroutes(&self, server_ips: &[TracedServerIp]) {
        if server_ips.is_empty() {
            log::debug!("No server IPs to queue for traceroute");
            return;
        }

        let jobs: VecDeque<TracerouteJob> = server_ips
            .iter()
            .enumerate()
            .map(|(i, ip)| TracerouteJob::from_server_ip(ip, (i + 1) as u32))
            .collect();

        let mut state = self.state.write().await;
        state.pending_jobs = jobs;
        state.total_count = server_ips.len() as u32;
        state.completed_count = 0;
        state.is_running = true;

        log::info!(
            "Queued {} traceroute jobs for post-session analysis",
            server_ips.len()
        );
    }

    pub async fn process_next_job<F, H>(
        &self,
        on_progress: F,
        on_hop: H,
    ) -> Option<TracerouteResult>
    where
        F: Fn(u32, u32, &str),
        H: Fn(&HopResult, u32, &str) + Send + Sync + 'static,
    {
        let job = {
            let mut state = self.state.write().await;
            if state.pending_jobs.is_empty() {
                state.is_running = false;
                state.current_job = None;
                return None;
            }
            let job = state.pending_jobs.pop_front().unwrap();
            state.current_job = Some(job.clone());
            job
        };

        {
            let state = self.state.read().await;
            on_progress(state.completed_count + 1, state.total_count, &job.target_ip);
        }

        let result = self.run_traceroute(&job, on_hop).await;

        {
            let mut state = self.state.write().await;
            state.completed_count += 1;
            state.current_job = None;

            if state.pending_jobs.is_empty() {
                state.is_running = false;
            }
        }

        Some(result)
    }

    /// Hybrid traceroute:
    /// 1. tracert.exe (ICMP) — provides intermediate hops
    /// 2. trippy via capture service (TCP/UDP) — reaches destinations that block ICMP
    ///
    /// Both run in parallel. Results are merged: tracert hops + destination from probe.
    async fn run_traceroute<H>(&self, job: &TracerouteJob, on_hop: H) -> TracerouteResult
    where
        H: Fn(&HopResult, u32, &str) + Send + Sync + 'static,
    {
        use super::tracert_parser;
        use crate::services::capture_client;

        log::info!(
            "Starting traceroute to {} (index {}, {} port {})",
            job.target_ip, job.index, job.protocol, job.port
        );

        let start_time = Instant::now();
        let target_ip = job.target_ip.clone();
        let job_index = job.index;

        let on_hop = Arc::new(on_hop);
        let on_hop_tracert = on_hop.clone();

        // 1. tracert.exe for intermediate hops (streams via on_hop)
        let tracert_fut = tracert_parser::run_tracert(
            &target_ip,
            TRACEROUTE_MAX_HOPS,
            move |hop, idx, ip| on_hop_tracert(hop, idx, ip),
            job_index,
        );

        // 2. Protocol-specific probe via capture service (TCP/UDP only)
        let should_probe = job.protocol != "ICMP" && job.port > 0;
        let probe_target = target_ip.clone();
        let probe_protocol = job.protocol.clone();
        let probe_port = job.port;

        let probe_fut = async move {
            if !should_probe {
                return None;
            }
            log::info!(
                "Running {} probe to {}:{} via capture service",
                probe_protocol, probe_target, probe_port
            );
            match capture_client::request_traceroute(
                probe_target,
                probe_protocol,
                probe_port,
                TRACEROUTE_MAX_HOPS,
            )
            .await
            {
                Ok(result) => Some(result),
                Err(e) => {
                    log::info!("Protocol probe failed (graceful): {}", e);
                    None
                }
            }
        };

        let (tracert_result, probe_result) = tokio::join!(tracert_fut, probe_fut);
        let elapsed = start_time.elapsed();

        // Process tracert results
        let mut hops = tracert_result.unwrap_or_else(|e| {
            log::error!("tracert.exe failed for {}: {}", target_ip, e);
            vec![]
        });

        let destination_reached_by_tracert =
            hops.iter().any(|h| h.ip.as_deref() == Some(target_ip.as_str()));
        let mut destination_reached = destination_reached_by_tracert;
        let mut method = "ICMP (tracert)".to_string();

        // If tracert didn't reach destination, merge probe result
        if !destination_reached {
            if let Some(probe) = probe_result {
                if probe.destination_reached {
                    // Find the destination hop from trippy to get TTL + RTT
                    if let Some(dest_hop) = probe
                        .hops
                        .iter()
                        .rev()
                        .find(|h| h.ip.as_deref() == Some(target_ip.as_str()))
                    {
                        let dest_ttl = dest_hop.hop_number as usize;

                        // Truncate tracert hops to destination TTL
                        if dest_ttl < hops.len() {
                            hops.truncate(dest_ttl);
                        }

                        // Place destination hop at the correct position
                        if dest_ttl > 0 && dest_ttl <= hops.len() {
                            hops[dest_ttl - 1] = dest_hop.clone();
                        } else {
                            hops.push(dest_hop.clone());
                        }

                        on_hop(dest_hop, job_index, &target_ip);
                        destination_reached = true;
                        method = format!(
                            "ICMP (tracert) + {} (trippy)",
                            job.protocol
                        );

                        log::info!(
                            "Protocol probe reached {} at TTL {} (avg RTT: {:.1}ms)",
                            target_ip,
                            dest_hop.hop_number,
                            dest_hop.rtt_avg.unwrap_or(0.0)
                        );
                    }
                }
            }
        }

        // Trim trailing timeout hops after last responding hop
        if let Some(last_responding) = hops.iter().rposition(|h| h.ip.is_some()) {
            hops.truncate(last_responding + 1);
        }

        let total_hops = hops.len() as u32;

        log::info!(
            "Completed traceroute to {} (index {}) in {:.2}s - {} hops, method: {}, destination_reached: {}",
            target_ip, job.index, elapsed.as_secs_f64(), total_hops, method, destination_reached
        );

        TracerouteResult {
            target_ip,
            index: job.index,
            traceroute_id: job.traceroute_id,
            success: total_hops > 0,
            hops,
            destination_reached,
            total_hops,
            method,
        }
    }

    pub async fn is_running(&self) -> bool {
        self.state.read().await.is_running
    }

    pub async fn get_progress(&self) -> (u32, u32) {
        let state = self.state.read().await;
        (state.completed_count, state.total_count)
    }

    pub async fn get_current_job(&self) -> Option<TracerouteJob> {
        self.state.read().await.current_job.clone()
    }

    pub async fn reset(&self) {
        let mut state = self.state.write().await;
        state.is_running = false;
        state.current_job = None;
        state.pending_jobs.clear();
        state.completed_count = 0;
        state.total_count = 0;
        log::debug!("Traceroute service state reset");
    }
}

/// Identify the first hop that shows a significant quality degradation.
///
/// Returns the `hop_number` (as i32) of the first hop where either:
/// - packet loss >= `PACKET_LOSS_THRESHOLD`, or
/// - latency increase (vs previous hop) >= `LATENCY_INCREASE_THRESHOLD`.
pub fn identify_problem_hop(hops: &[HopResult]) -> Option<i32> {
    let mut prev_latency: Option<f64> = None;

    for hop in hops {
        let packet_loss = if hop.probe_count > 0 {
            (hop.timeout_count as f64 / hop.probe_count as f64) * 100.0
        } else {
            0.0
        };

        if packet_loss >= PACKET_LOSS_THRESHOLD {
            return Some(hop.hop_number as i32);
        }

        if let (Some(prev), Some(current)) = (prev_latency, hop.rtt_avg) {
            if current - prev >= LATENCY_INCREASE_THRESHOLD {
                return Some(hop.hop_number as i32);
            }
        }

        prev_latency = hop.rtt_avg;
    }

    None
}

/// Convert a `TracerouteResult` into `HopData` rows and persist them to the database,
/// then mark the traceroute record as completed.
pub async fn persist_traceroute_result(result: &TracerouteResult) {
    let traceroute_id = match result.traceroute_id {
        Some(id) => id,
        None => return,
    };

    let problem_hop_index = identify_problem_hop(&result.hops);

    if let Some(hop_repo) = get_hop_repository() {
        // Determine if last hop came from a protocol probe (hybrid traceroute)
        let is_hybrid = result.method.contains('+');
        let last_hop_index = result.hops.len().saturating_sub(1);

        let hop_data: Vec<HopData> = result
            .hops
            .iter()
            .enumerate()
            .map(|(idx, hop)| {
                let packet_loss = if hop.probe_count > 0 {
                    (hop.timeout_count as f64 / hop.probe_count as f64) * 100.0
                } else {
                    0.0
                };

                let is_problem = problem_hop_index == Some(hop.hop_number as i32);

                // Last hop in hybrid mode came from protocol probe, others from ICMP
                let source = if is_hybrid && idx == last_hop_index {
                    // Extract protocol from method, e.g. "ICMP (tracert) + UDP (trippy)" → "UDP"
                    result
                        .method
                        .split('+')
                        .nth(1)
                        .and_then(|s| s.split_whitespace().next())
                        .map(|s| s.to_string())
                } else {
                    Some("ICMP".to_string())
                };

                HopData {
                    hop_number: hop.hop_number as i32,
                    ip: hop.ip.clone(),
                    hostname: hop.hostname.clone(),
                    latency_min: hop.rtt_min,
                    latency_avg: hop.rtt_avg,
                    latency_max: hop.rtt_max,
                    packet_loss: Some(packet_loss),
                    is_problem_hop: is_problem,
                    source,
                }
            })
            .collect();

        if !hop_data.is_empty() {
            if let Err(e) = hop_repo.insert_hops_batch(traceroute_id, &hop_data).await {
                log::error!(
                    "Failed to persist hops for traceroute {}: {}",
                    traceroute_id,
                    e
                );
            } else {
                log::debug!(
                    "Persisted {} hops for traceroute {}",
                    hop_data.len(),
                    traceroute_id
                );
            }
        }
    }

    if let Some(traceroute_repo) = get_traceroute_repository() {
        let completed_at = chrono::Utc::now().to_rfc3339();
        if let Err(e) = traceroute_repo
            .update_traceroute_completed(traceroute_id, &completed_at, problem_hop_index, Some(&result.method))
            .await
        {
            log::error!(
                "Failed to update traceroute {}: {}",
                traceroute_id,
                e
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn create_test_server_ips() -> Vec<TracedServerIp> {
        vec![
            TracedServerIp::new("1.1.1.1".to_string()),
            TracedServerIp::new("2.2.2.2".to_string()),
        ]
    }

    #[tokio::test]
    async fn test_queue_traceroutes() {
        let service = TracerouteService::new();
        let server_ips = create_test_server_ips();

        service.queue_traceroutes(&server_ips).await;

        let (completed, total) = service.get_progress().await;
        assert_eq!(total, 2);
        assert_eq!(completed, 0);
        assert!(service.is_running().await);
    }

    #[tokio::test]
    async fn test_empty_server_ips_no_queue() {
        let service = TracerouteService::new();
        service.queue_traceroutes(&[]).await;

        let (_, total) = service.get_progress().await;
        assert_eq!(total, 0);
        assert!(!service.is_running().await);
    }

    #[tokio::test]
    async fn test_reset_clears_state() {
        let service = TracerouteService::new();
        let server_ips = create_test_server_ips();

        service.queue_traceroutes(&server_ips).await;
        assert!(service.is_running().await);

        service.reset().await;

        assert!(!service.is_running().await);
        let (completed, total) = service.get_progress().await;
        assert_eq!(completed, 0);
        assert_eq!(total, 0);
    }

    #[tokio::test]
    async fn test_traceroute_job_from_server_ip() {
        let server_ip = TracedServerIp::new("8.8.8.8".to_string());
        let job = TracerouteJob::from_server_ip(&server_ip, 3);

        assert_eq!(job.target_ip, "8.8.8.8");
        assert_eq!(job.index, 3);
        assert_eq!(job.protocol, "ICMP");
        assert_eq!(job.port, 0);
        assert!(job.traceroute_id.is_none());
    }

    #[tokio::test]
    async fn test_traceroute_job_new() {
        let job = TracerouteJob::new("1.1.1.1".to_string(), 1, Some(42));

        assert_eq!(job.target_ip, "1.1.1.1");
        assert_eq!(job.index, 1);
        assert_eq!(job.traceroute_id, Some(42));
    }

    #[tokio::test]
    async fn test_traceroute_job_with_protocol() {
        let job = TracerouteJob::new("1.1.1.1".to_string(), 1, None)
            .with_protocol("TCP".to_string(), 27015);

        assert_eq!(job.protocol, "TCP");
        assert_eq!(job.port, 27015);
    }
}

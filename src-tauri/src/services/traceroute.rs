use crate::models::{HopResult, TracedServerIp};
use std::net::IpAddr;
use std::sync::Arc;
use std::time::Instant;
#[cfg(not(target_os = "windows"))]
use std::time::Duration;
use tokio::sync::RwLock;

#[cfg(not(target_os = "windows"))]
use trippy_core::{Builder, PortDirection, PrivilegeMode};

use crate::config::{TRACEROUTE_MAX_HOPS, TRACEROUTE_TIMEOUT_SECS};

#[derive(Debug, Clone)]
pub struct TracerouteJob {
    pub target_ip: String,
    pub index: u32,
    pub traceroute_id: Option<i64>,
}

#[allow(dead_code)]
impl TracerouteJob {
    pub fn from_server_ip(server_ip: &TracedServerIp, index: u32) -> Self {
        Self {
            target_ip: server_ip.server_ip.clone(),
            index,
            traceroute_id: None,
        }
    }

    pub fn new(target_ip: String, index: u32, traceroute_id: Option<i64>) -> Self {
        Self {
            target_ip,
            index,
            traceroute_id,
        }
    }
}

#[allow(dead_code)]
#[derive(Debug, Clone)]
pub struct TracerouteResult {
    pub target_ip: String,
    pub index: u32,
    pub traceroute_id: Option<i64>,
    pub success: bool,
    pub hops: Vec<HopResult>,
    pub destination_reached: bool,
    pub total_hops: u32,
}

#[derive(Debug, Default)]
pub struct TracerouteState {
    pub is_running: bool,
    pub current_job: Option<TracerouteJob>,
    pub pending_jobs: Vec<TracerouteJob>,
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

#[allow(dead_code)]
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

        let jobs: Vec<TracerouteJob> = server_ips
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
            let job = state.pending_jobs.remove(0);
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

    #[cfg(not(target_os = "windows"))]
    async fn run_traceroute<H>(&self, job: &TracerouteJob, on_hop: H) -> TracerouteResult
    where
        H: Fn(&HopResult, u32, &str) + Send + Sync + 'static,
    {
        log::info!(
            "Starting traceroute to {} (index {}) using trippy-core",
            job.target_ip,
            job.index
        );

        let start_time = Instant::now();

        let dst_ip: IpAddr = match job.target_ip.parse() {
            Ok(ip) => ip,
            Err(_) => {
                log::error!("Invalid target IP {}", job.target_ip);
                return TracerouteResult {
                    target_ip: job.target_ip.clone(),
                    index: job.index,
                    traceroute_id: job.traceroute_id,
                    success: false,
                    hops: vec![],
                    destination_reached: false,
                    total_hops: 0,
                };
            }
        };

        let tracer = match Builder::new(dst_ip)
            .privilege_mode(PrivilegeMode::Unprivileged)
            .max_ttl(TRACEROUTE_MAX_HOPS)
            .max_rounds(Some(1))
            .port_direction(PortDirection::new_fixed_dest(33434))
            .build()
        {
            Ok(t) => t,
            Err(e) => {
                log::error!("Failed to create tracer for {}: {}", job.target_ip, e);
                return TracerouteResult {
                    target_ip: job.target_ip.clone(),
                    index: job.index,
                    traceroute_id: job.traceroute_id,
                    success: false,
                    hops: vec![],
                    destination_reached: false,
                    total_hops: 0,
                };
            }
        };

        let job_index = job.index;
        let target_ip_clone = job.target_ip.clone();

        // Tracer is Clone; clone for the blocking thread, keep original for snapshot
        let tracer_clone = tracer.clone();
        let trace_result = tokio::time::timeout(
            Duration::from_secs(TRACEROUTE_TIMEOUT_SECS),
            tokio::task::spawn_blocking(move || tracer_clone.run()),
        )
        .await;

        let elapsed = start_time.elapsed();

        match trace_result {
            Ok(Ok(Ok(()))) => {
                let snapshot = tracer.snapshot();
                let mut hops: Vec<HopResult> = Vec::new();
                let mut destination_reached = false;
                let mut last_responding_index: Option<usize> = None;

                for hop in snapshot.hops() {
                    let hop_result = trippy_hop_to_result(hop);
                    let idx = hops.len();

                    if let Some(ref ip) = hop_result.ip {
                        if ip == &target_ip_clone {
                            destination_reached = true;
                        }
                        last_responding_index = Some(idx);
                    }

                    on_hop(&hop_result, job_index, &target_ip_clone);
                    hops.push(hop_result);
                }

                // Trim trailing timeout hops after destination or last responding hop
                if let Some(trim_after) = last_responding_index {
                    hops.truncate(trim_after + 1);
                }

                let total_hops = hops.len() as u32;

                log::info!(
                    "Completed traceroute to {} (index {}) in {:.2}s - {} hops, destination_reached: {}",
                    target_ip_clone,
                    job.index,
                    elapsed.as_secs_f64(),
                    total_hops,
                    destination_reached
                );

                TracerouteResult {
                    target_ip: target_ip_clone,
                    index: job.index,
                    traceroute_id: job.traceroute_id,
                    success: total_hops > 0,
                    hops,
                    destination_reached,
                    total_hops,
                }
            }
            Ok(Ok(Err(e))) => {
                log::error!("Traceroute to {} failed: {}", target_ip_clone, e);
                TracerouteResult {
                    target_ip: target_ip_clone,
                    index: job.index,
                    traceroute_id: job.traceroute_id,
                    success: false,
                    hops: vec![],
                    destination_reached: false,
                    total_hops: 0,
                }
            }
            Ok(Err(e)) => {
                log::error!(
                    "Traceroute blocking task for {} panicked: {}",
                    target_ip_clone,
                    e
                );
                TracerouteResult {
                    target_ip: target_ip_clone,
                    index: job.index,
                    traceroute_id: job.traceroute_id,
                    success: false,
                    hops: vec![],
                    destination_reached: false,
                    total_hops: 0,
                }
            }
            Err(_) => {
                log::warn!(
                    "Traceroute to {} timed out after {}s",
                    target_ip_clone,
                    TRACEROUTE_TIMEOUT_SECS
                );
                TracerouteResult {
                    target_ip: target_ip_clone,
                    index: job.index,
                    traceroute_id: job.traceroute_id,
                    success: false,
                    hops: vec![],
                    destination_reached: false,
                    total_hops: 0,
                }
            }
        }
    }

    #[cfg(target_os = "windows")]
    async fn run_traceroute<H>(&self, job: &TracerouteJob, on_hop: H) -> TracerouteResult
    where
        H: Fn(&HopResult, u32, &str) + Send + Sync + 'static,
    {
        use super::tracert_parser;

        log::info!(
            "Starting traceroute to {} (index {}) using tracert.exe",
            job.target_ip,
            job.index
        );

        let start_time = Instant::now();

        // Validate target IP
        if job.target_ip.parse::<IpAddr>().is_err() {
            log::error!("Invalid target IP {}", job.target_ip);
            return TracerouteResult {
                target_ip: job.target_ip.clone(),
                index: job.index,
                traceroute_id: job.traceroute_id,
                success: false,
                hops: vec![],
                destination_reached: false,
                total_hops: 0,
            };
        }

        let target_ip_clone = job.target_ip.clone();
        let job_index = job.index;

        match tracert_parser::run_tracert(
            &job.target_ip,
            TRACEROUTE_MAX_HOPS,
            TRACEROUTE_TIMEOUT_SECS,
            on_hop,
            job_index,
        )
        .await
        {
            Ok(mut hops) => {
                let elapsed = start_time.elapsed();
                let mut destination_reached = false;
                let mut last_responding_index: Option<usize> = None;

                for (idx, hop) in hops.iter().enumerate() {
                    if let Some(ref ip) = hop.ip {
                        if ip == &target_ip_clone {
                            destination_reached = true;
                        }
                        last_responding_index = Some(idx);
                    }
                }

                // Trim trailing timeout hops after destination or last responding hop
                if let Some(trim_after) = last_responding_index {
                    hops.truncate(trim_after + 1);
                }

                let total_hops = hops.len() as u32;

                log::info!(
                    "Completed traceroute to {} (index {}) in {:.2}s - {} hops, destination_reached: {}",
                    target_ip_clone,
                    job.index,
                    elapsed.as_secs_f64(),
                    total_hops,
                    destination_reached
                );

                TracerouteResult {
                    target_ip: target_ip_clone,
                    index: job.index,
                    traceroute_id: job.traceroute_id,
                    success: total_hops > 0,
                    hops,
                    destination_reached,
                    total_hops,
                }
            }
            Err(e) => {
                log::error!("Traceroute to {} failed: {}", target_ip_clone, e);
                TracerouteResult {
                    target_ip: target_ip_clone,
                    index: job.index,
                    traceroute_id: job.traceroute_id,
                    success: false,
                    hops: vec![],
                    destination_reached: false,
                    total_hops: 0,
                }
            }
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

#[cfg(not(target_os = "windows"))]
fn trippy_hop_to_result(hop: &trippy_core::Hop) -> HopResult {
    let ttl = hop.ttl() as u32;
    let ip = hop.addrs().next().map(|a| a.to_string());
    let total_sent = hop.total_sent() as u32;
    let total_recv = hop.total_recv() as u32;

    if ip.is_none() || total_recv == 0 {
        return HopResult::timeout(ttl, total_sent.max(1));
    }

    let mut rtt_probes: Vec<Option<f64>> = hop
        .samples()
        .iter()
        .map(|d| Some(d.as_secs_f64() * 1000.0))
        .collect();

    let timeout_count = total_sent.saturating_sub(total_recv);
    for _ in 0..timeout_count {
        rtt_probes.push(None);
    }

    HopResult::new(ttl, ip, None, rtt_probes)
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
        assert!(job.traceroute_id.is_none());
    }

    #[tokio::test]
    async fn test_traceroute_job_new() {
        let job = TracerouteJob::new("1.1.1.1".to_string(), 1, Some(42));

        assert_eq!(job.target_ip, "1.1.1.1");
        assert_eq!(job.index, 1);
        assert_eq!(job.traceroute_id, Some(42));
    }
}

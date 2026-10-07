use crate::config::{
    LATENCY_INCREASE_THRESHOLD, PACKET_LOSS_THRESHOLD, TRACEROUTE_MAX_CONCURRENT,
    TRACEROUTE_MAX_HOPS,
};
use crate::db::{get_hop_repository, get_traceroute_repository};
use crate::models::flow_kind::FlowKind;
use crate::models::session::HopData;
use crate::models::HopResult;
use std::collections::VecDeque;
use std::sync::Arc;
use std::time::Instant;
use tokio::sync::{RwLock, Semaphore};

#[derive(Debug, Clone)]
pub struct TracerouteJob {
    pub target_ip: String,
    pub protocol: String,
    pub port: u16,
    pub index: u32,
    pub traceroute_id: Option<i64>,
    pub kind: FlowKind,
    generation: u64,
}

impl TracerouteJob {
    pub fn new(target_ip: String, index: u32, traceroute_id: Option<i64>) -> Self {
        Self {
            target_ip,
            protocol: "ICMP".to_string(),
            port: 0,
            index,
            traceroute_id,
            kind: FlowKind::Game,
            generation: 0,
        }
    }

    pub fn with_kind(mut self, kind: FlowKind) -> Self {
        self.kind = kind;
        self
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

#[derive(Debug, Clone)]
pub struct TracerouteResult {
    pub target_ip: String,
    pub index: u32,
    pub traceroute_id: Option<i64>,
    pub success: bool,
    pub hops: Vec<HopResult>,
    pub method: String,
    pub probe_from_ttl: Option<u32>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BatchSummary {
    pub total: u32,
    pub succeeded: u32,
    pub failed: u32,
}

#[derive(Debug, Default)]
pub struct TracerouteState {
    pub is_running: bool,
    pub pending_jobs: VecDeque<TracerouteJob>,
    pub completed_count: u32,
    pub total_count: u32,
    succeeded: u32,
    failed: u32,
    generation: u64,
}

pub struct TracerouteService {
    pub state: Arc<RwLock<TracerouteState>>,
    permits: Arc<Semaphore>,
}

impl Default for TracerouteService {
    fn default() -> Self {
        Self::new()
    }
}

impl TracerouteService {
    pub fn new() -> Self {
        Self {
            state: Arc::new(RwLock::new(TracerouteState::default())),
            permits: Arc::new(Semaphore::new(TRACEROUTE_MAX_CONCURRENT)),
        }
    }

    pub fn permits(&self) -> Arc<Semaphore> {
        self.permits.clone()
    }

    pub async fn enqueue(&self, jobs: Vec<TracerouteJob>) -> u32 {
        let mut state = self.state.write().await;
        if !state.is_running {
            state.completed_count = 0;
            state.total_count = 0;
            state.succeeded = 0;
            state.failed = 0;
            state.is_running = true;
        }
        for mut job in jobs {
            state.total_count += 1;
            job.index = state.total_count;
            job.generation = state.generation;
            let position = state
                .pending_jobs
                .iter()
                .position(|pending| pending.kind.priority() > job.kind.priority())
                .unwrap_or(state.pending_jobs.len());
            state.pending_jobs.insert(position, job);
        }
        state.total_count
    }

    pub async fn process_next_job<F, H>(
        &self,
        on_progress: F,
        on_hop: H,
    ) -> Option<(TracerouteResult, Option<BatchSummary>)>
    where
        F: Fn(u32, u32, &str),
        H: Fn(&HopResult, u32, &str) + Send + Sync + 'static,
    {
        let (job, completed, total) = {
            let mut state = self.state.write().await;
            let job = state.pending_jobs.pop_front()?;
            (job, state.completed_count, state.total_count)
        };

        on_progress(completed + 1, total, &job.target_ip);

        let result = self.run_traceroute(&job, on_hop).await;
        let summary = self.record_completion(&job, result.success).await;

        Some((result, summary))
    }

    async fn record_completion(&self, job: &TracerouteJob, success: bool) -> Option<BatchSummary> {
        let mut state = self.state.write().await;
        if job.generation != state.generation {
            return None;
        }
        state.completed_count += 1;
        if success {
            state.succeeded += 1;
        } else {
            state.failed += 1;
        }
        if state.pending_jobs.is_empty() && state.completed_count >= state.total_count {
            state.is_running = false;
            return Some(BatchSummary {
                total: state.total_count,
                succeeded: state.succeeded,
                failed: state.failed,
            });
        }
        None
    }

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

        let tracert_fut = tracert_parser::run_tracert(
            &target_ip,
            TRACEROUTE_MAX_HOPS,
            move |hop, idx, ip| on_hop_tracert(hop, idx, ip),
            job_index,
        );

        let should_probe = job.protocol != "ICMP" && job.port > 0;
        let probe_target = target_ip.clone();
        let probe_protocol = job.protocol.clone();
        let probe_port = job.port;

        let probe_fut = async move {
            if !should_probe {
                return None;
            }
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
                    log::warn!("Protocol probe failed: {}", e);
                    None
                }
            }
        };

        let (tracert_result, probe_result) = tokio::join!(tracert_fut, probe_fut);
        let elapsed = start_time.elapsed();

        let mut hops = tracert_result.unwrap_or_else(|e| {
            log::error!("tracert.exe failed for {}: {}", target_ip, e);
            vec![]
        });

        let mut destination_reached = hops.iter().any(|h| h.ip.as_deref() == Some(target_ip.as_str()));
        let mut method = "ICMP (tracert)".to_string();
        let mut probe_from_ttl = None;

        if !destination_reached {
            if let Some(probe) = probe_result {
                if let Some(merged) = merge_probe_hops(&hops, &probe.hops, &target_ip) {
                    for hop in merged.hops.iter().filter(|h| h.hop_number >= merged.from_ttl) {
                        on_hop(hop, job_index, &target_ip);
                    }
                    hops = merged.hops;
                    destination_reached = merged.destination_reached;
                    probe_from_ttl = Some(merged.from_ttl);
                    method = format!("ICMP (tracert) + {} (trippy)", job.protocol);
                }
            }
        }

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
            method,
            probe_from_ttl,
        }
    }

    pub async fn is_running(&self) -> bool {
        self.state.read().await.is_running
    }

    pub async fn reset(&self) {
        let mut state = self.state.write().await;
        state.is_running = false;
        state.pending_jobs.clear();
        state.completed_count = 0;
        state.total_count = 0;
        state.succeeded = 0;
        state.failed = 0;
        state.generation += 1;
    }
}

#[derive(Debug)]
pub struct MergedHops {
    pub hops: Vec<HopResult>,
    pub from_ttl: u32,
    pub destination_reached: bool,
}

fn last_responding_ttl(hops: &[HopResult]) -> u32 {
    hops.iter()
        .filter(|h| h.ip.is_some())
        .map(|h| h.hop_number)
        .max()
        .unwrap_or(0)
}

pub fn merge_probe_hops(
    tracert: &[HopResult],
    probe: &[HopResult],
    target_ip: &str,
) -> Option<MergedHops> {
    let tracert_last = last_responding_ttl(tracert);
    let destination_ttl = probe
        .iter()
        .find(|h| h.ip.as_deref() == Some(target_ip))
        .map(|h| h.hop_number);

    let (keep_until, probe_until) = match destination_ttl {
        Some(dest) => (tracert_last.min(dest.saturating_sub(1)), dest),
        None => {
            let probe_last = last_responding_ttl(probe);
            if probe_last <= tracert_last {
                return None;
            }
            (tracert_last, probe_last)
        }
    };

    let mut hops: Vec<HopResult> = tracert
        .iter()
        .filter(|h| h.hop_number <= keep_until)
        .cloned()
        .collect();
    hops.extend(
        probe
            .iter()
            .filter(|h| h.hop_number > keep_until && h.hop_number <= probe_until)
            .cloned(),
    );

    Some(MergedHops {
        hops,
        from_ttl: keep_until + 1,
        destination_reached: destination_ttl.is_some(),
    })
}

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

fn probe_protocol(method: &str) -> Option<String> {
    method
        .split('+')
        .nth(1)
        .and_then(|s| s.split_whitespace().next())
        .map(|s| s.to_string())
}

pub async fn persist_traceroute_result(result: &TracerouteResult) {
    let traceroute_id = match result.traceroute_id {
        Some(id) => id,
        None => return,
    };

    let problem_hop_index = identify_problem_hop(&result.hops);
    let probe_source = probe_protocol(&result.method);

    if let Some(hop_repo) = get_hop_repository() {
        let hop_data: Vec<HopData> = result
            .hops
            .iter()
            .map(|hop| {
                let packet_loss = if hop.probe_count > 0 {
                    (hop.timeout_count as f64 / hop.probe_count as f64) * 100.0
                } else {
                    0.0
                };

                let from_probe = result
                    .probe_from_ttl
                    .is_some_and(|ttl| hop.hop_number >= ttl);
                let source = if from_probe {
                    probe_source.clone()
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
                    is_problem_hop: problem_hop_index == Some(hop.hop_number as i32),
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

    fn job(ip: &str) -> TracerouteJob {
        TracerouteJob::new(ip.to_string(), 0, None)
    }

    fn hop(ttl: u32, ip: Option<&str>, rtt: f64) -> HopResult {
        match ip {
            Some(ip) => HopResult::new(ttl, Some(ip.to_string()), None, vec![Some(rtt)]),
            None => HopResult::timeout(ttl, 1),
        }
    }

    #[tokio::test]
    async fn enqueue_assigns_indexes_and_totals() {
        let service = TracerouteService::new();

        assert_eq!(service.enqueue(vec![job("1.1.1.1"), job("2.2.2.2")]).await, 2);
        assert_eq!(service.enqueue(vec![job("3.3.3.3")]).await, 3);

        let state = service.state.read().await;
        assert!(state.is_running);
        let indexes: Vec<u32> = state.pending_jobs.iter().map(|j| j.index).collect();
        assert_eq!(indexes, vec![1, 2, 3]);
    }

    #[tokio::test]
    async fn game_jobs_jump_ahead_of_voice_and_other() {
        let service = TracerouteService::new();
        service
            .enqueue(vec![
                job("20.157.94.82").with_kind(FlowKind::Voice),
                job("3.5.1.1").with_kind(FlowKind::Other),
            ])
            .await;
        service.enqueue(vec![job("162.249.72.5")]).await;
        service.enqueue(vec![job("20.47.1.1").with_kind(FlowKind::Voice)]).await;

        let state = service.state.read().await;
        let order: Vec<&str> = state.pending_jobs.iter().map(|j| j.target_ip.as_str()).collect();
        assert_eq!(order, vec!["162.249.72.5", "20.157.94.82", "20.47.1.1", "3.5.1.1"]);
    }

    #[tokio::test]
    async fn enqueue_from_idle_restarts_counters() {
        let service = TracerouteService::new();
        service.enqueue(vec![job("1.1.1.1")]).await;
        service.reset().await;

        assert_eq!(service.enqueue(vec![job("2.2.2.2")]).await, 1);
    }

    #[tokio::test]
    async fn batch_summary_emitted_when_last_job_completes() {
        let service = TracerouteService::new();
        service.enqueue(vec![job("1.1.1.1"), job("2.2.2.2")]).await;

        let first = service.state.write().await.pending_jobs.pop_front().unwrap();
        let second = service.state.write().await.pending_jobs.pop_front().unwrap();

        assert_eq!(service.record_completion(&first, true).await, None);
        assert_eq!(
            service.record_completion(&second, false).await,
            Some(BatchSummary { total: 2, succeeded: 1, failed: 1 })
        );
        assert!(!service.is_running().await);
    }

    #[tokio::test]
    async fn completions_from_cancelled_batch_are_ignored() {
        let service = TracerouteService::new();
        service.enqueue(vec![job("1.1.1.1")]).await;
        let stale = service.state.write().await.pending_jobs.pop_front().unwrap();

        service.reset().await;
        service.enqueue(vec![job("2.2.2.2")]).await;

        assert_eq!(service.record_completion(&stale, true).await, None);
        let state = service.state.read().await;
        assert_eq!(state.completed_count, 0);
        assert!(state.is_running);
    }

    #[tokio::test]
    async fn reset_clears_state() {
        let service = TracerouteService::new();
        service.enqueue(vec![job("1.1.1.1"), job("2.2.2.2")]).await;

        service.reset().await;

        let state = service.state.read().await;
        assert!(!state.is_running);
        assert!(state.pending_jobs.is_empty());
        assert_eq!(state.total_count, 0);
    }

    #[test]
    fn job_with_protocol_normalizes() {
        let job = TracerouteJob::new("1.1.1.1".to_string(), 1, None).with_protocol("udp".to_string(), 7032);
        assert_eq!(job.protocol, "UDP");
        assert_eq!(job.port, 7032);

        let job = TracerouteJob::new("1.1.1.1".to_string(), 1, None).with_protocol("SCTP".to_string(), 1);
        assert_eq!(job.protocol, "ICMP");
    }

    #[test]
    fn merge_appends_probe_hops_beyond_last_icmp_hop() {
        let tracert = vec![
            hop(1, Some("192.168.1.254"), 0.5),
            hop(2, Some("10.0.0.1"), 3.0),
            hop(3, None, 0.0),
        ];
        let probe = vec![
            hop(1, Some("192.168.1.254"), 0.6),
            hop(2, Some("10.0.0.1"), 3.1),
            hop(3, Some("87.245.1.1"), 5.0),
            hop(4, Some("104.160.1.1"), 9.0),
            hop(5, None, 0.0),
        ];

        let merged = merge_probe_hops(&tracert, &probe, "162.249.72.5").unwrap();

        assert_eq!(merged.from_ttl, 3);
        assert!(!merged.destination_reached);
        let ttls: Vec<u32> = merged.hops.iter().map(|h| h.hop_number).collect();
        assert_eq!(ttls, vec![1, 2, 3, 4]);
        assert_eq!(merged.hops[3].ip.as_deref(), Some("104.160.1.1"));
    }

    #[test]
    fn merge_uses_probe_destination() {
        let tracert = vec![hop(1, Some("192.168.1.254"), 0.5), hop(2, Some("10.0.0.1"), 3.0)];
        let probe = vec![hop(1, None, 0.0), hop(2, None, 0.0), hop(3, Some("162.249.72.5"), 12.0)];

        let merged = merge_probe_hops(&tracert, &probe, "162.249.72.5").unwrap();

        assert!(merged.destination_reached);
        assert_eq!(merged.from_ttl, 3);
        let ips: Vec<Option<&str>> = merged.hops.iter().map(|h| h.ip.as_deref()).collect();
        assert_eq!(ips, vec![Some("192.168.1.254"), Some("10.0.0.1"), Some("162.249.72.5")]);
    }

    #[test]
    fn merge_ignores_probe_that_goes_no_further() {
        let tracert = vec![hop(1, Some("192.168.1.254"), 0.5), hop(2, Some("10.0.0.1"), 3.0)];
        let probe = vec![hop(1, Some("192.168.1.254"), 0.6), hop(2, None, 0.0)];

        assert!(merge_probe_hops(&tracert, &probe, "162.249.72.5").is_none());
    }

    #[test]
    fn probe_protocol_parses_hybrid_method() {
        assert_eq!(probe_protocol("ICMP (tracert) + UDP (trippy)"), Some("UDP".to_string()));
        assert_eq!(probe_protocol("ICMP (tracert)"), None);
    }
}

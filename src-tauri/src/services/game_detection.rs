use crate::config::{
    MAX_CAPTURED_IPS, MAX_CONSECUTIVE_DB_FAILURES, POLL_INTERVAL_SECS,
    PROCESS_ENUMERATION_TIMEOUT_SECS,
};
use crate::db::games::GameRepository;
use crate::models::capture_protocol::CapturedEndpoint;
use crate::models::{
    CapturedConnection, DetectedGame, GameEndedEvent, MonitoringState, ServerIpCapturedEvent,
    TracedServerIp,
};
use crate::platform;
use crate::services::capture_client;
use crate::services::network_capture::{capture_connections_for_pids, is_private_or_special_ip};
use crate::services::udp_capture;
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use tokio::sync::{mpsc, RwLock};
use tokio::time::{interval, Duration};

pub struct GameDetector {
    state: Arc<RwLock<MonitoringState>>,
    game_repo: Arc<GameRepository>,
    stop_tx: Option<mpsc::Sender<()>>,
}

impl GameDetector {
    pub fn new(state: Arc<RwLock<MonitoringState>>, game_repo: Arc<GameRepository>) -> Self {
        Self {
            state,
            game_repo,
            stop_tx: None,
        }
    }

    pub async fn start<F, G, H, C>(
        &mut self,
        on_game_detected: F,
        on_game_ended: G,
        on_ip_captured: H,
        on_capacity_reached: C,
    ) where
        F: Fn(DetectedGame) + Send + Sync + 'static,
        G: Fn(GameEndedEvent) + Send + Sync + 'static,
        H: Fn(ServerIpCapturedEvent) + Send + Sync + 'static,
        C: Fn(usize) + Send + Sync + 'static,
    {
        let (stop_tx, mut stop_rx) = mpsc::channel::<()>(1);
        self.stop_tx = Some(stop_tx);

        let state = self.state.clone();
        let game_repo = self.game_repo.clone();
        let on_detected = Arc::new(on_game_detected);
        let on_ended = Arc::new(on_game_ended);
        let on_ip = Arc::new(on_ip_captured);
        let on_cap = Arc::new(on_capacity_reached);

        tokio::spawn(async move {
            let mut poll_interval = interval(Duration::from_secs(POLL_INTERVAL_SECS));
            let mut last_detected_pid: Option<u32> = None;

            let mut captured_ip_set: HashSet<String> = HashSet::new();
            let mut capacity_notified = false;
            let mut consecutive_db_failures: u32 = 0;

            log::info!(
                "Game detection started (polling every {}s)",
                POLL_INTERVAL_SECS,
            );

            // Log monitored games once at startup for debugging detection issues
            if let Ok(games) = game_repo.get_monitored_games().await {
                for g in &games {
                    log::info!("Monitored game: '{}' -> exe='{}'", g.name, g.executable_name);
                }
            }

            loop {
                tokio::select! {
                    _ = stop_rx.recv() => {
                        log::info!("Game detection stopped");
                        break;
                    }
                    _ = poll_interval.tick() => {

                        let monitored_games = match game_repo.get_monitored_games().await {
                            Ok(games) => {
                                if consecutive_db_failures > 0 {
                                    log::info!(
                                        "Game repository recovered after {} consecutive failures",
                                        consecutive_db_failures
                                    );
                                    consecutive_db_failures = 0;
                                }
                                games
                            }
                            Err(e) => {
                                consecutive_db_failures += 1;
                                if consecutive_db_failures >= MAX_CONSECUTIVE_DB_FAILURES {
                                    log::error!(
                                        "Failed to fetch monitored games ({} consecutive failures): {}. \
                                         Detection continues but may not detect games until DB recovers.",
                                        consecutive_db_failures, e
                                    );
                                } else {
                                    log::warn!("Failed to fetch monitored games (attempt {}): {}", consecutive_db_failures, e);
                                }
                                continue;
                            }
                        };

                        let processes = match tokio::time::timeout(
                            Duration::from_secs(PROCESS_ENUMERATION_TIMEOUT_SECS),
                            tokio::task::spawn_blocking(platform::enumerate_running_processes),
                        )
                        .await
                        {
                            Ok(Ok(procs)) => procs,
                            Ok(Err(e)) => {
                                log::error!("Process enumeration task failed: {}", e);
                                continue;
                            }
                            Err(_) => {
                                log::warn!(
                                    "Process enumeration timed out after {}s, skipping poll cycle",
                                    PROCESS_ENUMERATION_TIMEOUT_SECS
                                );
                                continue;
                            }
                        };

                        let games = platform::detect_games_from_processes(&processes, &monitored_games);

                        if let Some(game) = games.first() {

                            let is_new_game = last_detected_pid.map(|pid| pid != game.pid).unwrap_or(true);

                            if is_new_game {
                                log::info!("Game detected: {} (PID: {})", game.game_name, game.pid);
                                last_detected_pid = Some(game.pid);

                                captured_ip_set.clear();
                                capacity_notified = false;

                                // Update last_played_at for the matched game
                                if let Some(entry) = monitored_games.iter().find(|e| e.name == game.game_name) {
                                    if let Err(e) = game_repo.update_last_played(entry.id).await {
                                        log::error!("Failed to update last_played_at: {}", e);
                                    }
                                }

                                {
                                    let mut state_guard = state.write().await;
                                    state_guard.current_game = Some(game.clone());
                                    state_guard.captured_ips.clear();
                                    state_guard.traced_server_ips.clear();
                                    state_guard.seen_server_ips.clear();
                                    state_guard.start_session();
                                }

                                on_detected(game.clone());
                            }

                            let game_pid = game.pid;
                            let related_pids = match tokio::time::timeout(
                                Duration::from_secs(PROCESS_ENUMERATION_TIMEOUT_SECS),
                                tokio::task::spawn_blocking(move || platform::get_related_pids(game_pid)),
                            )
                            .await
                            {
                                Ok(Ok(pids)) => pids,
                                Ok(Err(e)) => {
                                    log::error!("get_related_pids task failed: {}", e);
                                    continue;
                                }
                                Err(_) => {
                                    log::warn!("get_related_pids timed out, skipping poll cycle");
                                    continue;
                                }
                            };

                            // Capture TCP connections (synchronous, always available)
                            let pids_clone = related_pids.clone();
                            let tcp_connections = match tokio::time::timeout(
                                Duration::from_secs(PROCESS_ENUMERATION_TIMEOUT_SECS),
                                tokio::task::spawn_blocking(move || capture_connections_for_pids(&pids_clone)),
                            )
                            .await
                            {
                                Ok(Ok(conns)) => conns,
                                Ok(Err(e)) => {
                                    log::error!("TCP capture task failed: {}", e);
                                    Vec::new()
                                }
                                Err(_) => {
                                    log::warn!("TCP capture timed out, skipping TCP connections");
                                    Vec::new()
                                }
                            };

                            // Capture UDP connections via the privileged service (async, graceful degradation)
                            let udp_connections = capture_udp_connections(&related_pids).await;

                            // Merge TCP and UDP connections
                            let connections = merge_connections(tcp_connections, udp_connections);

                            for conn in connections {
                                let is_new = !captured_ip_set.contains(&conn.remote_ip);

                                if is_new {
                                    if captured_ip_set.len() >= MAX_CAPTURED_IPS {
                                        log::warn!("Captured IP set reached max capacity ({}), skipping new IPs", MAX_CAPTURED_IPS);
                                        if !capacity_notified {
                                            capacity_notified = true;
                                            on_cap(MAX_CAPTURED_IPS);
                                        }
                                        break;
                                    }

                                    captured_ip_set.insert(conn.remote_ip.clone());

                                    log::info!(
                                        "New server IP captured: {}:{} ({})",
                                        conn.remote_ip,
                                        conn.remote_port,
                                        conn.protocol
                                    );

                                    let traced_ip = TracedServerIp::new(conn.remote_ip.clone());

                                    {
                                        let mut state_guard = state.write().await;
                                        state_guard.captured_ips.push(conn.clone());
                                        state_guard.traced_server_ips.push(traced_ip);
                                        state_guard.seen_server_ips.insert(conn.remote_ip.clone());
                                    }
                                }

                                // Always emit for every connection (new or already-seen).
                                // For already-seen IPs, upsert_ip_activity extends the
                                // existing activity period. When the capacity limit is hit,
                                // `break` exits this inner for-loop; on the next poll tick
                                // the capacity check prevents adding NEW IPs while activity
                                // tracking for existing IPs continues normally.
                                on_ip(ServerIpCapturedEvent::from(&conn));
                            }
                        } else if last_detected_pid.is_some() {

                            {
                                let mut state_guard = state.write().await;
                                state_guard.end_session();
                            }

                            let (game_ended_event, ip_count) = {
                                let state_guard = state.read().await;
                                let session_duration = state_guard.session_duration_seconds().unwrap_or_else(|| {
                                    log::warn!("Session duration could not be calculated (missing timestamps)");
                                    0
                                });
                                let event = state_guard.current_game.as_ref().map(|game| {
                                    GameEndedEvent {
                                        game_name: game.game_name.clone(),
                                        session_id: state_guard.current_session_id,
                                        server_ips: state_guard.traced_server_ips.clone(),
                                        session_duration,
                                        server_ip_count: state_guard.server_ip_count(),
                                    }
                                });
                                (event, state_guard.traced_server_ips.len())
                            };

                            if let Some(event) = game_ended_event {
                                log::info!(
                                    "Game closed: {} (captured {} server IPs, {}s duration)",
                                    event.game_name,
                                    ip_count,
                                    event.session_duration
                                );
                                last_detected_pid = None;
                                captured_ip_set.clear();

                                on_ended(event);

                                {
                                    let mut state_guard = state.write().await;
                                    state_guard.reset();
                                }
                            }
                        }
                    }
                }
            }
        });
    }

    pub async fn start_manual<F, G, H, C>(
        &mut self,
        pid: u32,
        on_game_detected: F,
        on_game_ended: G,
        on_ip_captured: H,
        on_capacity_reached: C,
    ) where
        F: Fn(DetectedGame) + Send + Sync + 'static,
        G: Fn(GameEndedEvent) + Send + Sync + 'static,
        H: Fn(ServerIpCapturedEvent) + Send + Sync + 'static,
        C: Fn(usize) + Send + Sync + 'static,
    {
        let (stop_tx, mut stop_rx) = mpsc::channel::<()>(1);
        self.stop_tx = Some(stop_tx);

        let state = self.state.clone();
        let on_ended = Arc::new(on_game_ended);
        let on_ip = Arc::new(on_ip_captured);
        let on_cap = Arc::new(on_capacity_reached);

        let _ = on_game_detected;

        tokio::spawn(async move {
            let mut poll_interval = interval(Duration::from_secs(POLL_INTERVAL_SECS));

            let mut captured_ip_set: HashSet<String> = HashSet::new();
            let mut capacity_notified = false;

            {
                let mut state_guard = state.write().await;
                state_guard.start_session();
            }

            log::info!(
                "Manual monitoring started for PID {} (polling every {}s)",
                pid,
                POLL_INTERVAL_SECS
            );

            loop {
                tokio::select! {
                    _ = stop_rx.recv() => {
                        log::info!("Manual monitoring stopped");
                        break;
                    }
                    _ = poll_interval.tick() => {

                        let is_running = match tokio::time::timeout(
                            Duration::from_secs(PROCESS_ENUMERATION_TIMEOUT_SECS),
                            tokio::task::spawn_blocking(move || platform::is_process_running(pid)),
                        )
                        .await
                        {
                            Ok(Ok(running)) => running,
                            Ok(Err(e)) => {
                                log::error!("is_process_running task failed: {}", e);
                                // Assume still running to avoid false game-ended
                                true
                            }
                            Err(_) => {
                                log::warn!("is_process_running timed out, assuming still running");
                                true
                            }
                        };

                        if !is_running {

                            {
                                let mut state_guard = state.write().await;
                                state_guard.end_session();
                            }

                            let (game_ended_event, ip_count) = {
                                let state_guard = state.read().await;
                                let session_duration = state_guard.session_duration_seconds().unwrap_or_else(|| {
                                    log::warn!("Session duration could not be calculated (missing timestamps)");
                                    0
                                });
                                let event = state_guard.current_game.as_ref().map(|game| {
                                    GameEndedEvent {
                                        game_name: game.game_name.clone(),
                                        session_id: state_guard.current_session_id,
                                        server_ips: state_guard.traced_server_ips.clone(),
                                        session_duration,
                                        server_ip_count: state_guard.server_ip_count(),
                                    }
                                });
                                (event, state_guard.traced_server_ips.len())
                            };

                            if let Some(event) = game_ended_event {
                                log::info!(
                                    "Manual process closed: {} (PID: {}, captured {} IPs, {}s duration)",
                                    event.game_name,
                                    pid,
                                    ip_count,
                                    event.session_duration
                                );

                                on_ended(event);

                                {
                                    let mut state_guard = state.write().await;
                                    state_guard.is_manual_mode = false;
                                    state_guard.manual_pid = None;
                                    state_guard.reset();
                                }
                            }
                            break;
                        }

                        let related_pids = match tokio::time::timeout(
                            Duration::from_secs(PROCESS_ENUMERATION_TIMEOUT_SECS),
                            tokio::task::spawn_blocking(move || platform::get_related_pids(pid)),
                        )
                        .await
                        {
                            Ok(Ok(pids)) => pids,
                            Ok(Err(e)) => {
                                log::error!("get_related_pids task failed (manual): {}", e);
                                continue;
                            }
                            Err(_) => {
                                log::warn!("get_related_pids timed out (manual), skipping poll cycle");
                                continue;
                            }
                        };

                        // Capture TCP connections (synchronous, always available)
                        let pids_clone = related_pids.clone();
                        let tcp_connections = match tokio::time::timeout(
                            Duration::from_secs(PROCESS_ENUMERATION_TIMEOUT_SECS),
                            tokio::task::spawn_blocking(move || capture_connections_for_pids(&pids_clone)),
                        )
                        .await
                        {
                            Ok(Ok(conns)) => conns,
                            Ok(Err(e)) => {
                                log::error!("TCP capture task failed (manual): {}", e);
                                Vec::new()
                            }
                            Err(_) => {
                                log::warn!("TCP capture timed out (manual), skipping TCP connections");
                                Vec::new()
                            }
                        };

                        // Capture UDP connections via the privileged service (async, graceful degradation)
                        let udp_connections = capture_udp_connections(&related_pids).await;

                        // Merge TCP and UDP connections
                        let connections = merge_connections(tcp_connections, udp_connections);

                        for conn in connections {
                            let is_new = !captured_ip_set.contains(&conn.remote_ip);

                            if is_new {
                                if captured_ip_set.len() >= MAX_CAPTURED_IPS {
                                    log::warn!("Captured IP set reached max capacity ({}), skipping new IPs", MAX_CAPTURED_IPS);
                                    if !capacity_notified {
                                        capacity_notified = true;
                                        on_cap(MAX_CAPTURED_IPS);
                                    }
                                    break;
                                }

                                captured_ip_set.insert(conn.remote_ip.clone());

                                log::info!(
                                    "New server IP captured (manual): {}:{} ({})",
                                    conn.remote_ip,
                                    conn.remote_port,
                                    conn.protocol
                                );

                                let traced_ip = TracedServerIp::new(conn.remote_ip.clone());

                                {
                                    let mut state_guard = state.write().await;
                                    state_guard.captured_ips.push(conn.clone());
                                    state_guard.traced_server_ips.push(traced_ip);
                                    state_guard.seen_server_ips.insert(conn.remote_ip.clone());
                                }
                            }

                            // Always emit — upsert_ip_activity will extend the period
                            on_ip(ServerIpCapturedEvent::from(&conn));
                        }
                    }
                }
            }
        });
    }

    pub async fn stop(&mut self) {
        if let Some(tx) = self.stop_tx.take() {
            let _ = tx.send(()).await;
        }

        let mut state_guard = self.state.write().await;
        state_guard.is_monitoring = false;
        state_guard.is_manual_mode = false;
        state_guard.manual_pid = None;
        state_guard.reset();
    }
}

/// Capture UDP connections via the privileged capture service.
///
/// This function extracts local UDP ports for the given PIDs and requests
/// packet capture from the service. Returns an empty list on any error
/// (graceful degradation - the app continues with TCP-only capture).
async fn capture_udp_connections(related_pids: &HashSet<u32>) -> Vec<CapturedConnection> {
    // Get local UDP ports bound by the game processes
    let local_ports = udp_capture::get_udp_local_ports(related_pids);

    if local_ports.is_empty() {
        return Vec::new();
    }

    // Request capture from the privileged service
    match capture_client::request_udp_capture(local_ports.clone()).await {
        Ok(endpoints) => {
            let raw_count = endpoints.len();
            let connections = group_udp_endpoints(endpoints);

            log::info!(
                "UDP capture result: {} raw endpoints, {} public (ports: {:?})",
                raw_count,
                connections.len(),
                local_ports
            );

            connections
        }
        Err(e) => {
            log::info!("UDP capture failed for ports {:?}: {}", local_ports, e);
            Vec::new()
        }
    }
}

fn group_udp_endpoints(endpoints: Vec<CapturedEndpoint>) -> Vec<CapturedConnection> {
    let mut groups: Vec<(CapturedEndpoint, u32)> = Vec::new();
    let mut index: HashMap<String, usize> = HashMap::new();

    for endpoint in endpoints {
        if is_private_or_special_ip(&endpoint.remote_ip) {
            continue;
        }
        match index.get(&endpoint.remote_ip) {
            Some(&i) => {
                let (busiest, total) = &mut groups[i];
                *total = total.saturating_add(endpoint.packet_count);
                if endpoint.packet_count > busiest.packet_count {
                    *busiest = endpoint;
                }
            }
            None => {
                index.insert(endpoint.remote_ip.clone(), groups.len());
                let total = endpoint.packet_count;
                groups.push((endpoint, total));
            }
        }
    }

    groups
        .into_iter()
        .map(|(busiest, total)| {
            CapturedConnection::new(busiest.remote_ip, busiest.remote_port, "UDP".to_string())
                .with_packet_count(total)
        })
        .collect()
}

/// Merge TCP and UDP connections, deduplicating by remote IP.
///
/// TCP connections take priority (they're more reliable indicators of active connections).
fn merge_connections(
    tcp_connections: Vec<CapturedConnection>,
    udp_connections: Vec<CapturedConnection>,
) -> Vec<CapturedConnection> {
    let mut index: HashMap<String, usize> = HashMap::new();
    let mut result: Vec<CapturedConnection> =
        Vec::with_capacity(tcp_connections.len() + udp_connections.len());

    for conn in tcp_connections.into_iter().chain(udp_connections) {
        match index.get(&conn.remote_ip) {
            Some(&i) => {
                let kept = &mut result[i];
                kept.packet_count = kept.packet_count.or(conn.packet_count);
            }
            None => {
                index.insert(conn.remote_ip.clone(), result.len());
                result.push(conn);
            }
        }
    }

    result
}

#[cfg(test)]
mod tests {
    use super::*;

    fn endpoint(local_port: u16, remote_ip: &str, remote_port: u16, packet_count: u32) -> CapturedEndpoint {
        CapturedEndpoint {
            local_port,
            remote_ip: remote_ip.to_string(),
            remote_port,
            packet_count,
        }
    }

    #[test]
    fn udp_endpoints_of_one_address_add_up() {
        let connections = group_udp_endpoints(vec![
            endpoint(50000, "162.249.72.5", 7032, 380),
            endpoint(50001, "20.157.94.82", 27020, 45),
            endpoint(50002, "162.249.72.5", 7033, 12),
            endpoint(50000, "192.168.1.1", 53, 4),
        ]);

        assert_eq!(connections.len(), 2);
        let game = connections.iter().find(|c| c.remote_ip == "162.249.72.5").unwrap();
        assert_eq!(game.packet_count, Some(392));
        assert_eq!(game.remote_port, 7032);
        assert_eq!(game.protocol, "UDP");
        let voice = connections.iter().find(|c| c.remote_ip == "20.157.94.82").unwrap();
        assert_eq!(voice.packet_count, Some(45));
    }

    #[test]
    fn busiest_endpoint_gives_the_port() {
        let connections = group_udp_endpoints(vec![
            endpoint(50002, "162.249.72.5", 7033, 12),
            endpoint(50000, "162.249.72.5", 7032, 380),
        ]);

        assert_eq!(connections[0].remote_port, 7032);
        assert_eq!(connections[0].packet_count, Some(392));
    }

    #[test]
    fn merge_keeps_tcp_but_takes_the_udp_packet_count() {
        let tcp = vec![
            CapturedConnection::new("104.18.41.183".to_string(), 443, "TCP".to_string()),
            CapturedConnection::new("162.249.72.5".to_string(), 443, "TCP".to_string()),
        ];
        let udp = group_udp_endpoints(vec![
            endpoint(50000, "162.249.72.5", 7032, 380),
            endpoint(50001, "20.157.94.82", 27020, 45),
        ]);

        let merged = merge_connections(tcp, udp);

        assert_eq!(merged.len(), 3);
        assert_eq!(merged[0].packet_count, None);
        assert_eq!(merged[1].protocol, "TCP");
        assert_eq!(merged[1].remote_port, 443);
        assert_eq!(merged[1].packet_count, Some(380));
        assert_eq!(merged[2].remote_ip, "20.157.94.82");
        assert_eq!(merged[2].packet_count, Some(45));
    }
}

use crate::db::{
    get_game_repository, get_hop_repository, get_ip_period_repository, get_session_repository,
    get_traceroute_repository,
};
use crate::models::{
    session::HopData, DetectedGame, GameEndedEvent, HopResult, IpCapacityReachedEvent,
    MonitoringState, RunningApp, RunningProcess, ServerIpCapturedEvent, TracerouteAllCompleteEvent,
    TracerouteData, TracerouteHopEvent, TracerouteProgressEvent, TracerouteServerIpCompleteEvent,
    TracerouteStartedEvent,
};
use crate::platform;
use crate::services::traceroute::TracerouteJob;
use crate::services::{GameDetector, TracerouteService};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, State};
use tokio::sync::RwLock;

pub struct AppMonitoringState {
    pub monitoring_state: Arc<RwLock<MonitoringState>>,
    pub detector: Arc<RwLock<Option<GameDetector>>>,
    pub traceroute_service: Arc<TracerouteService>,
}

impl AppMonitoringState {
    pub fn new() -> Self {
        Self {
            monitoring_state: Arc::new(RwLock::new(MonitoringState::default())),
            detector: Arc::new(RwLock::new(None)),
            traceroute_service: Arc::new(TracerouteService::new()),
        }
    }
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct MonitoringError {
    pub code: String,
    pub message: String,
}

impl MonitoringError {
    pub fn already_monitoring() -> Self {
        Self {
            code: "ALREADY_MONITORING".to_string(),
            message: "Monitoring is already active".to_string(),
        }
    }

    pub fn not_monitoring() -> Self {
        Self {
            code: "NOT_MONITORING".to_string(),
            message: "Monitoring is not active".to_string(),
        }
    }

    pub fn process_not_found() -> Self {
        Self {
            code: "PROCESS_NOT_FOUND".to_string(),
            message: "The selected process no longer exists".to_string(),
        }
    }
}

/// Minimum latency increase (ms) between consecutive hops to flag as a problem hop.
const LATENCY_INCREASE_THRESHOLD: f64 = 50.0;
/// Minimum packet loss percentage to flag a hop as problematic.
const PACKET_LOSS_THRESHOLD: f64 = 10.0;

fn identify_problem_hop(hops: &[HopResult]) -> Option<i32> {
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

async fn run_traceroute_queue(
    app_handle: AppHandle,
    traceroute_service: Arc<TracerouteService>,
    event: GameEndedEvent,
) {
    if event.server_ips.is_empty() {
        log::debug!("No server IPs to traceroute - skipping");
        return;
    }

    let unique_ips: Vec<String> = if let (Some(session_id), Some(ip_period_repo)) =
        (event.session_id, get_ip_period_repository())
    {
        match ip_period_repo.get_unique_ips_for_session(session_id).await {
            Ok(ips) => ips,
            Err(e) => {
                log::warn!(
                    "Failed to get unique IPs from periods: {}, using event data",
                    e
                );
                event
                    .server_ips
                    .iter()
                    .map(|ip| ip.server_ip.clone())
                    .collect()
            }
        }
    } else {
        event
            .server_ips
            .iter()
            .map(|ip| ip.server_ip.clone())
            .collect()
    };

    if unique_ips.is_empty() {
        log::debug!("No unique IPs to traceroute");
        return;
    }

    let mut jobs: Vec<TracerouteJob> = Vec::new();
    let traceroute_repo = get_traceroute_repository();
    let now = chrono::Utc::now().to_rfc3339();

    for (i, ip) in unique_ips.iter().enumerate() {
        let mut job = TracerouteJob::new(ip.clone(), (i + 1) as u32, None);

        if let (Some(session_id), Some(ref repo)) = (event.session_id, &traceroute_repo) {
            let data = TracerouteData::new(session_id, ip.clone(), now.clone());
            match repo.insert_traceroute(&data).await {
                Ok(traceroute_id) => {
                    job.traceroute_id = Some(traceroute_id);
                    log::debug!("Created traceroute record {} for {}", traceroute_id, ip);
                }
                Err(e) => {
                    log::error!("Failed to create traceroute record for {}: {}", ip, e);
                }
            }
        }

        jobs.push(job);
    }

    {
        let state = traceroute_service.state.read().await;
        if state.is_running {
            log::warn!("Traceroute already running, skipping new queue");
            return;
        }
    }

    {
        let mut state_guard = traceroute_service.state.write().await;
        state_guard.pending_jobs = jobs.clone();
        state_guard.total_count = jobs.len() as u32;
        state_guard.completed_count = 0;
        state_guard.is_running = true;
    }

    let server_ips: Vec<String> = unique_ips.clone();
    let started_event = TracerouteStartedEvent::new(unique_ips.len() as u32, server_ips);
    log::info!(
        "Emitting traceroute-started event: {} IPs to trace",
        unique_ips.len()
    );
    let _ = app_handle.emit("traceroute-started", started_event);

    let mut successful = 0u32;
    let mut failed = 0u32;
    let app_for_progress = app_handle.clone();
    let app_for_complete = app_handle.clone();
    let app_for_hop = app_handle.clone();

    loop {
        let app_clone = app_for_progress.clone();
        let app_hop_clone = app_for_hop.clone();
        let result = traceroute_service
            .process_next_job(
                move |current, total, ip| {
                    let progress_event =
                        TracerouteProgressEvent::new(ip.to_string(), current, total);
                    log::debug!(
                        "Emitting traceroute-progress: {}/{} - {}",
                        current,
                        total,
                        ip
                    );
                    let _ = app_clone.emit("traceroute-progress", progress_event);
                },
                move |hop: &HopResult, index: u32, target_ip: &str| {
                    let hop_event = TracerouteHopEvent::from_hop_result(index, target_ip, hop);
                    log::debug!(
                        "Emitting traceroute-hop: hop {} to {} (ip: {:?}, rtt: {:?})",
                        hop.hop_number,
                        target_ip,
                        hop.ip,
                        hop.rtt_avg
                    );
                    let _ = app_hop_clone.emit("traceroute-hop", hop_event);
                },
            )
            .await;

        match result {
            Some(trace_result) => {
                if let Some(traceroute_id) = trace_result.traceroute_id {
                    let problem_hop_index = identify_problem_hop(&trace_result.hops);

                    if let Some(hop_repo) = get_hop_repository() {
                        let hop_data: Vec<HopData> = trace_result
                            .hops
                            .iter()
                            .map(|hop| {
                                let packet_loss = if hop.probe_count > 0 {
                                    (hop.timeout_count as f64 / hop.probe_count as f64) * 100.0
                                } else {
                                    0.0
                                };

                                let is_problem = problem_hop_index == Some(hop.hop_number as i32);

                                HopData {
                                    hop_number: hop.hop_number as i32,
                                    ip: hop.ip.clone(),
                                    hostname: hop.hostname.clone(),
                                    latency_min: hop.rtt_min,
                                    latency_avg: hop.rtt_avg,
                                    latency_max: hop.rtt_max,
                                    packet_loss: Some(packet_loss),
                                    is_problem_hop: is_problem,
                                }
                            })
                            .collect();

                        if !hop_data.is_empty() {
                            if let Err(e) =
                                hop_repo.insert_hops_batch(traceroute_id, &hop_data).await
                            {
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
                            .update_traceroute_completed(
                                traceroute_id,
                                &completed_at,
                                problem_hop_index,
                            )
                            .await
                        {
                            log::error!("Failed to update traceroute {}: {}", traceroute_id, e);
                        }
                    }
                }

                let complete_event = TracerouteServerIpCompleteEvent::new(
                    trace_result.index,
                    trace_result.target_ip.clone(),
                    trace_result.success,
                );
                log::info!(
                    "Emitting traceroute-server-ip-complete: index {} ({}) - success={}",
                    trace_result.index,
                    trace_result.target_ip,
                    trace_result.success
                );
                let _ = app_for_complete.emit("traceroute-server-ip-complete", complete_event);

                if trace_result.success {
                    successful += 1;
                } else {
                    failed += 1;
                }
            }
            None => {
                break;
            }
        }
    }

    let all_complete_event =
        TracerouteAllCompleteEvent::new(unique_ips.len() as u32, successful, failed);
    log::info!(
        "Emitting traceroute-all-complete: {}/{} successful, {} failed",
        successful,
        unique_ips.len(),
        failed
    );
    let _ = app_handle.emit("traceroute-all-complete", all_complete_event);
}

#[tauri::command]
pub async fn start_monitoring(
    app: AppHandle,
    state: State<'_, AppMonitoringState>,
) -> Result<(), MonitoringError> {
    log::info!("Starting game monitoring...");

    {
        let monitoring_state = state.monitoring_state.read().await;
        if monitoring_state.is_monitoring {
            log::warn!("Monitoring already active");
            return Err(MonitoringError::already_monitoring());
        }
    }

    {
        let mut monitoring_state = state.monitoring_state.write().await;
        monitoring_state.is_monitoring = true;
    }

    let game_repo = get_game_repository().ok_or_else(|| MonitoringError {
        code: "REPO_NOT_INITIALIZED".to_string(),
        message: "Game repository not initialized".to_string(),
    })?;

    let mut detector = GameDetector::new(state.monitoring_state.clone(), game_repo);

    let app_handle_detected = app.clone();
    let app_handle_ended = app.clone();
    let app_handle_ip = app.clone();
    let app_handle_cap = app.clone();

    let traceroute_service = state.traceroute_service.clone();
    let monitoring_state_for_detected = state.monitoring_state.clone();
    let monitoring_state_for_ip = state.monitoring_state.clone();

    detector
        .start(
            move |game: DetectedGame| {
                log::info!("Emitting game-detected event for: {}", game.game_name);

                let state_clone = monitoring_state_for_detected.clone();
                let game_name = game.game_name.clone();
                let detected_at = game.detected_at.clone();
                tokio::spawn(async move {
                    if let Some(session_repo) = get_session_repository() {
                        match session_repo.insert_session(&game_name, &detected_at).await {
                            Ok(session_id) => {
                                log::info!(
                                    "Session {} created in DB for {}",
                                    session_id,
                                    game_name
                                );
                                let mut state_guard = state_clone.write().await;
                                state_guard.current_session_id = Some(session_id);
                            }
                            Err(e) => log::error!("Failed to create session in DB: {}", e),
                        }
                    }
                });

                let _ = app_handle_detected.emit("game-detected", game);
            },
            move |event: GameEndedEvent| {
                log::info!(
                    "Emitting game-ended event for: {} ({} server IPs, {}s duration)",
                    event.game_name,
                    event.server_ip_count,
                    event.session_duration
                );

                if let Some(session_id) = event.session_id {
                    tokio::spawn(async move {
                        if let Some(session_repo) = get_session_repository() {
                            let ended_at = chrono::Utc::now().to_rfc3339();
                            if let Err(e) = session_repo
                                .update_session_ended(session_id, &ended_at)
                                .await
                            {
                                log::error!("Failed to update session ended: {}", e);
                            }
                        }
                    });
                }

                let _ = app_handle_ended.emit("game-ended", event.clone());

                if !event.server_ips.is_empty() {
                    let app = app_handle_ended.clone();
                    let service = traceroute_service.clone();
                    tokio::spawn(async move {
                        run_traceroute_queue(app, service, event).await;
                    });
                }
            },
            move |event: ServerIpCapturedEvent| {
                log::debug!("Emitting server-ip-captured event for: {}", event.ip);

                let state_clone = monitoring_state_for_ip.clone();
                let ip_clone = event.ip.clone();
                let captured_at = event.captured_at.clone();
                tokio::spawn(async move {
                    let session_id = {
                        let state_guard = state_clone.read().await;
                        state_guard.current_session_id
                    };

                    if let Some(session_id) = session_id {
                        if let Some(ip_period_repo) = get_ip_period_repository() {
                            match ip_period_repo
                                .upsert_ip_activity(session_id, &ip_clone, &captured_at)
                                .await
                            {
                                Ok((period_id, is_new)) => {
                                    if is_new {
                                        log::debug!(
                                            "IP period {} created for {}",
                                            period_id,
                                            ip_clone
                                        );
                                    } else {
                                        log::debug!(
                                            "IP period {} extended for {}",
                                            period_id,
                                            ip_clone
                                        );
                                    }

                                    let mut state_guard = state_clone.write().await;
                                    if let Some(traced_ip) = state_guard
                                        .traced_server_ips
                                        .iter_mut()
                                        .find(|ip| ip.server_ip == ip_clone)
                                    {
                                        traced_ip.set_period_id(period_id);
                                    }
                                }
                                Err(e) => {
                                    log::error!("Failed to upsert IP activity {}: {}", ip_clone, e)
                                }
                            }
                        }
                    }
                });

                let _ = app_handle_ip.emit("server-ip-captured", event);
            },
            move |max_ips: usize| {
                log::warn!("IP capacity reached: {} IPs", max_ips);
                let event = IpCapacityReachedEvent::new(max_ips);
                let _ = app_handle_cap.emit("ip-capacity-reached", event);
            },
        )
        .await;

    {
        let mut detector_guard = state.detector.write().await;
        *detector_guard = Some(detector);
    }

    log::info!("Game monitoring started successfully");
    Ok(())
}

#[tauri::command]
pub async fn stop_monitoring(
    app: AppHandle,
    state: State<'_, AppMonitoringState>,
) -> Result<(), MonitoringError> {
    log::info!("Stopping game monitoring...");

    {
        let monitoring_state = state.monitoring_state.read().await;
        if !monitoring_state.is_monitoring {
            log::warn!("Monitoring not active");
            return Err(MonitoringError::not_monitoring());
        }
    }

    // End session in DB, emit game-ended, and launch traceroutes before resetting state
    let game_ended_event = {
        let monitoring_state = state.monitoring_state.read().await;
        if let Some(session_id) = monitoring_state.current_session_id {
            let ended_at = chrono::Utc::now().to_rfc3339();
            if let Some(session_repo) = get_session_repository() {
                if let Err(e) = session_repo
                    .update_session_ended(session_id, &ended_at)
                    .await
                {
                    log::error!("Failed to update session ended on stop: {}", e);
                }
            }
            monitoring_state
                .current_game
                .as_ref()
                .map(|game| GameEndedEvent {
                    game_name: game.game_name.clone(),
                    session_id: Some(session_id),
                    server_ips: monitoring_state.traced_server_ips.clone(),
                    session_duration: monitoring_state.session_duration_seconds().unwrap_or(0),
                    server_ip_count: monitoring_state.server_ip_count(),
                })
        } else {
            None
        }
    };

    if let Some(ref event) = game_ended_event {
        let _ = app.emit("game-ended", event.clone());
    }

    {
        let mut detector_guard = state.detector.write().await;
        if let Some(ref mut detector) = *detector_guard {
            detector.stop().await;
        }
        *detector_guard = None;
    }

    {
        let mut monitoring_state = state.monitoring_state.write().await;
        monitoring_state.is_monitoring = false;
        monitoring_state.is_manual_mode = false;
        monitoring_state.manual_pid = None;
        monitoring_state.reset();
    }

    // Launch traceroutes after stopping the detector but before resetting the service
    if let Some(event) = game_ended_event {
        if !event.server_ips.is_empty() {
            let app_clone = app.clone();
            let service = state.traceroute_service.clone();
            tokio::spawn(async move {
                run_traceroute_queue(app_clone, service, event).await;
            });
        }
    }

    log::info!("Game monitoring stopped successfully");
    Ok(())
}

#[tauri::command]
pub async fn cancel_traceroute(
    app: AppHandle,
    state: State<'_, AppMonitoringState>,
) -> Result<(), MonitoringError> {
    log::info!("Cancelling traceroute queue...");
    state.traceroute_service.reset().await;

    let event = TracerouteAllCompleteEvent::new(0, 0, 0);
    let _ = app.emit("traceroute-all-complete", event);

    log::info!("Traceroute queue cancelled");
    Ok(())
}

#[tauri::command]
pub async fn get_monitoring_status(
    state: State<'_, AppMonitoringState>,
) -> Result<MonitoringStatusResponse, MonitoringError> {
    let monitoring_state = state.monitoring_state.read().await;

    Ok(MonitoringStatusResponse {
        is_monitoring: monitoring_state.is_monitoring,
        current_game: monitoring_state.current_game.clone(),
        is_manual_mode: monitoring_state.is_manual_mode,
        current_session_id: monitoring_state.current_session_id,
    })
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MonitoringStatusResponse {
    pub is_monitoring: bool,
    pub current_game: Option<DetectedGame>,
    pub is_manual_mode: bool,
    pub current_session_id: Option<i64>,
}

#[tauri::command]
pub async fn list_running_processes() -> Result<Vec<RunningProcess>, MonitoringError> {
    log::debug!("Listing running processes for manual selection...");
    let processes = platform::list_running_processes_filtered();
    log::debug!("Found {} processes after filtering", processes.len());
    Ok(processes)
}

#[tauri::command]
pub async fn list_running_apps() -> Result<Vec<RunningApp>, MonitoringError> {
    log::debug!("Listing running apps (grouped) for manual selection...");
    let apps = platform::list_running_apps_grouped();
    log::debug!("Found {} apps after grouping", apps.len());
    Ok(apps)
}

#[tauri::command]
pub async fn start_manual_monitoring(
    app: AppHandle,
    state: State<'_, AppMonitoringState>,
    pid: u32,
) -> Result<(), MonitoringError> {
    log::info!("Starting manual monitoring for PID {}...", pid);

    {
        let monitoring_state = state.monitoring_state.read().await;
        if monitoring_state.is_monitoring {
            log::info!("Monitoring already active, stopping first to switch to manual mode");
            drop(monitoring_state);

            {
                let mut detector_guard = state.detector.write().await;
                if let Some(ref mut detector) = *detector_guard {
                    detector.stop().await;
                }
                *detector_guard = None;
            }

            {
                let mut monitoring_state = state.monitoring_state.write().await;
                monitoring_state.is_monitoring = false;
                monitoring_state.is_manual_mode = false;
                monitoring_state.manual_pid = None;
                monitoring_state.reset();
            }

            state.traceroute_service.reset().await;
        }
    }

    let process_name = platform::get_process_name(pid);
    if process_name.is_none() {
        log::warn!("Process {} not found", pid);
        return Err(MonitoringError::process_not_found());
    }
    let process_name = process_name.unwrap();

    let display_name = if let Some(game_repo) = get_game_repository() {
        match game_repo.get_monitored_games().await {
            Ok(games) => games
                .iter()
                .find(|g| {
                    let exe_lower = g.executable_name.to_lowercase();
                    let name_lower = process_name.to_lowercase();
                    name_lower == exe_lower
                        || (!name_lower.ends_with(".exe")
                            && format!("{}.exe", name_lower) == exe_lower)
                })
                .map(|g| g.name.clone())
                .unwrap_or_else(|| process_name.clone()),
            Err(_) => process_name.clone(),
        }
    } else {
        process_name.clone()
    };

    let game = DetectedGame::new_manual(display_name.clone(), pid, None);

    {
        let mut monitoring_state = state.monitoring_state.write().await;
        monitoring_state.is_monitoring = true;
        monitoring_state.is_manual_mode = true;
        monitoring_state.manual_pid = Some(pid);
        monitoring_state.current_game = Some(game.clone());
    }

    let game_repo = get_game_repository().ok_or_else(|| MonitoringError {
        code: "REPO_NOT_INITIALIZED".to_string(),
        message: "Game repository not initialized".to_string(),
    })?;

    let mut detector = GameDetector::new(state.monitoring_state.clone(), game_repo);

    let app_handle_detected = app.clone();
    let app_handle_ended = app.clone();
    let app_handle_ip = app.clone();
    let app_handle_cap_manual = app.clone();

    let traceroute_service = state.traceroute_service.clone();
    let monitoring_state_for_detected = state.monitoring_state.clone();
    let monitoring_state_for_ip = state.monitoring_state.clone();

    if let Some(session_repo) = get_session_repository() {
        let detected_at = game.detected_at.clone();
        match session_repo
            .insert_session(&display_name, &detected_at)
            .await
        {
            Ok(session_id) => {
                log::info!(
                    "Session {} created in DB for manual game {}",
                    session_id,
                    display_name
                );
                let mut monitoring_state = state.monitoring_state.write().await;
                monitoring_state.current_session_id = Some(session_id);
            }
            Err(e) => log::error!("Failed to create session in DB: {}", e),
        }
    }

    detector
        .start_manual(
            pid,
            move |game: DetectedGame| {
                log::info!(
                    "Emitting game-detected event for manual game: {}",
                    game.game_name
                );

                let state_clone = monitoring_state_for_detected.clone();
                let game_name = game.game_name.clone();
                let detected_at = game.detected_at.clone();
                tokio::spawn(async move {
                    if let Some(session_repo) = get_session_repository() {
                        if let Ok(session_id) =
                            session_repo.insert_session(&game_name, &detected_at).await
                        {
                            let mut state_guard = state_clone.write().await;
                            if state_guard.current_session_id.is_none() {
                                state_guard.current_session_id = Some(session_id);
                            }
                        }
                    }
                });

                let _ = app_handle_detected.emit("game-detected", game);
            },
            move |event: GameEndedEvent| {
                log::info!(
                    "Emitting game-ended event for manual game: {} ({} server IPs, {}s duration)",
                    event.game_name,
                    event.server_ip_count,
                    event.session_duration
                );

                if let Some(session_id) = event.session_id {
                    tokio::spawn(async move {
                        if let Some(session_repo) = get_session_repository() {
                            let ended_at = chrono::Utc::now().to_rfc3339();
                            if let Err(e) = session_repo
                                .update_session_ended(session_id, &ended_at)
                                .await
                            {
                                log::error!("Failed to update session ended: {}", e);
                            }
                        }
                    });
                }

                let _ = app_handle_ended.emit("game-ended", event.clone());

                if !event.server_ips.is_empty() {
                    let app = app_handle_ended.clone();
                    let service = traceroute_service.clone();
                    tokio::spawn(async move {
                        run_traceroute_queue(app, service, event).await;
                    });
                }
            },
            move |event: ServerIpCapturedEvent| {
                log::debug!("Emitting server-ip-captured event for: {}", event.ip);

                let state_clone = monitoring_state_for_ip.clone();
                let ip_clone = event.ip.clone();
                let captured_at = event.captured_at.clone();
                tokio::spawn(async move {
                    let session_id = {
                        let state_guard = state_clone.read().await;
                        state_guard.current_session_id
                    };

                    if let Some(session_id) = session_id {
                        if let Some(ip_period_repo) = get_ip_period_repository() {
                            match ip_period_repo
                                .upsert_ip_activity(session_id, &ip_clone, &captured_at)
                                .await
                            {
                                Ok((period_id, is_new)) => {
                                    if is_new {
                                        log::debug!(
                                            "IP period {} created for {}",
                                            period_id,
                                            ip_clone
                                        );
                                    } else {
                                        log::debug!(
                                            "IP period {} extended for {}",
                                            period_id,
                                            ip_clone
                                        );
                                    }
                                    let mut state_guard = state_clone.write().await;
                                    if let Some(traced_ip) = state_guard
                                        .traced_server_ips
                                        .iter_mut()
                                        .find(|ip| ip.server_ip == ip_clone)
                                    {
                                        traced_ip.set_period_id(period_id);
                                    }
                                }
                                Err(e) => {
                                    log::error!("Failed to upsert IP activity {}: {}", ip_clone, e)
                                }
                            }
                        }
                    }
                });

                let _ = app_handle_ip.emit("server-ip-captured", event);
            },
            move |max_ips: usize| {
                log::warn!("IP capacity reached (manual): {} IPs", max_ips);
                let event = IpCapacityReachedEvent::new(max_ips);
                let _ = app_handle_cap_manual.emit("ip-capacity-reached", event);
            },
        )
        .await;

    {
        let mut detector_guard = state.detector.write().await;
        *detector_guard = Some(detector);
    }

    let _ = app.emit("game-detected", game);

    log::info!(
        "Manual monitoring started for process: {} (PID: {})",
        process_name,
        pid
    );
    Ok(())
}

use super::CommandError;
use crate::db::{
    get_game_repository, get_ip_period_repository, get_session_repository,
    get_traceroute_repository,
};
use crate::models::{
    DetectedGame, GameEndedEvent, HopResult, IpCapacityReachedEvent, MonitoringState, RunningApp,
    RunningProcess, ServerIpCapturedEvent, TracerouteAllCompleteEvent, TracerouteData,
    TracerouteHopEvent, TracerouteProgressEvent, TracerouteServerIpCompleteEvent,
    TracerouteStartedEvent,
};
use crate::platform;
use crate::services::flow_kind::classify_ip;
use crate::services::trace_targets::{is_traceable_game_server, select_session_targets, TraceTarget};
use crate::services::traceroute::{persist_traceroute_result, TracerouteJob};
use crate::services::{GameDetector, TracerouteService};
use std::collections::HashSet;
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

/// Build the `on_game_ended` callback shared by both auto and manual monitoring.
fn make_on_game_ended(
    app: AppHandle,
    traceroute_service: Arc<TracerouteService>,
) -> impl Fn(GameEndedEvent) + Send + Sync + 'static {
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

        if let Err(e) = app.emit("game-ended", event.clone()) {
            log::warn!("Failed to emit game-ended: {}", e);
        }

        if !event.server_ips.is_empty() {
            let app = app.clone();
            let service = traceroute_service.clone();
            tokio::spawn(async move {
                run_traceroute_queue(app, service, event).await;
            });
        }
    }
}

/// Build the `on_ip_captured` callback shared by both auto and manual monitoring.
fn make_on_ip_captured(
    app: AppHandle,
    monitoring_state: Arc<RwLock<MonitoringState>>,
    traceroute_service: Arc<TracerouteService>,
) -> impl Fn(ServerIpCapturedEvent) + Send + Sync + 'static {
    move |event: ServerIpCapturedEvent| {
        log::debug!("Emitting server-ip-captured event for: {}", event.ip);

        let state_clone = monitoring_state.clone();
        let ip_clone = event.ip.clone();
        let protocol = event.protocol.clone();
        let port = event.port as i32;
        let captured_at = event.captured_at.clone();
        let app_for_trace = app.clone();
        let service = traceroute_service.clone();
        tokio::spawn(async move {
            let session_id = {
                let state_guard = state_clone.read().await;
                state_guard.current_session_id
            };

            if let Some(session_id) = session_id {
                if let Some(ip_period_repo) = get_ip_period_repository() {
                    match ip_period_repo
                        .upsert_ip_activity(session_id, &ip_clone, &protocol, port, &captured_at)
                        .await
                    {
                        Ok(outcome) => {
                            {
                                let mut state_guard = state_clone.write().await;
                                if let Some(traced_ip) = state_guard
                                    .traced_server_ips
                                    .iter_mut()
                                    .find(|ip| ip.server_ip == ip_clone)
                                {
                                    traced_ip.set_period_id(outcome.period_id);
                                }
                            }

                            if outcome.became_game_server {
                                let port = u16::try_from(port).unwrap_or(0);
                                let kind = classify_ip(&ip_clone, &protocol, port);
                                if let Err(e) = ip_period_repo.set_flow_kind(outcome.period_id, kind).await {
                                    log::error!("Failed to classify flow {}: {}", ip_clone, e);
                                }
                                if is_traceable_game_server(&ip_clone, &protocol, i32::from(port)) {
                                    log::info!(
                                        "{} flow {} detected, tracing during the match",
                                        kind.as_str(),
                                        ip_clone
                                    );
                                    let target = TraceTarget {
                                        ip: ip_clone.clone(),
                                        protocol: protocol.clone(),
                                        port,
                                        kind,
                                    };
                                    enqueue_traceroutes(app_for_trace, service, session_id, vec![target]).await;
                                }
                            }
                        }
                        Err(e) => {
                            log::error!("Failed to upsert IP activity {}: {}", ip_clone, e)
                        }
                    }
                }
            }
        });

        if let Err(e) = app.emit("server-ip-captured", event) {
            log::warn!("Failed to emit server-ip-captured: {}", e);
        }
    }
}

/// Build the `on_capacity_reached` callback shared by both auto and manual monitoring.
fn make_on_capacity_reached(
    app: AppHandle,
) -> impl Fn(usize) + Send + Sync + 'static {
    move |max_ips: usize| {
        log::warn!("IP capacity reached: {} IPs", max_ips);
        let event = IpCapacityReachedEvent::new(max_ips);
        if let Err(e) = app.emit("ip-capacity-reached", event) {
            log::warn!("Failed to emit ip-capacity-reached: {}", e);
        }
    }
}

pub async fn enqueue_traceroutes(
    app_handle: AppHandle,
    traceroute_service: Arc<TracerouteService>,
    session_id: i64,
    targets: Vec<TraceTarget>,
) {
    let Some(traceroute_repo) = get_traceroute_repository() else {
        return;
    };

    let already_traced: HashSet<String> = match traceroute_repo.get_traced_ips(session_id).await {
        Ok(ips) => ips.into_iter().collect(),
        Err(e) => {
            log::error!("Failed to load traced IPs for session {}: {}", session_id, e);
            return;
        }
    };

    let now = chrono::Utc::now().to_rfc3339();
    let mut jobs = Vec::new();
    let mut seen = HashSet::new();

    for target in targets {
        if already_traced.contains(&target.ip)
            || !seen.insert(target.ip.clone())
            || target.ip.parse::<std::net::IpAddr>().is_err()
        {
            continue;
        }

        let data = TracerouteData::new(session_id, target.ip.clone(), now.clone());
        match traceroute_repo.insert_traceroute(&data).await {
            Ok(traceroute_id) => jobs.push(
                TracerouteJob::new(target.ip, 0, Some(traceroute_id))
                    .with_protocol(target.protocol, target.port)
                    .with_kind(target.kind),
            ),
            Err(e) => log::warn!("Skipping traceroute to {}: {}", target.ip, e),
        }
    }

    if jobs.is_empty() {
        return;
    }

    let server_ips: Vec<String> = jobs.iter().map(|j| j.target_ip.clone()).collect();
    let added = jobs.len();
    let total = traceroute_service.enqueue(jobs).await;

    if let Err(e) = app_handle.emit("traceroute-started", TracerouteStartedEvent::new(total, server_ips)) {
        log::warn!("Failed to emit traceroute-started: {}", e);
    }

    for _ in 0..added {
        tokio::spawn(run_next_traceroute(app_handle.clone(), traceroute_service.clone()));
    }
}

async fn run_next_traceroute(app: AppHandle, service: Arc<TracerouteService>) {
    let Ok(_permit) = service.permits().acquire_owned().await else {
        return;
    };

    let app_progress = app.clone();
    let app_hop = app.clone();
    let Some((result, summary)) = service
        .process_next_job(
            move |current, total, ip| {
                let event = TracerouteProgressEvent::new(ip.to_string(), current, total);
                if let Err(e) = app_progress.emit("traceroute-progress", event) {
                    log::warn!("Failed to emit traceroute-progress: {}", e);
                }
            },
            move |hop: &HopResult, index: u32, target_ip: &str| {
                let event = TracerouteHopEvent::from_hop_result(index, target_ip, hop);
                if let Err(e) = app_hop.emit("traceroute-hop", event) {
                    log::warn!("Failed to emit traceroute-hop: {}", e);
                }
            },
        )
        .await
    else {
        return;
    };

    persist_traceroute_result(&result).await;

    let complete_event =
        TracerouteServerIpCompleteEvent::new(result.index, result.target_ip.clone(), result.success);
    if let Err(e) = app.emit("traceroute-server-ip-complete", complete_event) {
        log::warn!("Failed to emit traceroute-server-ip-complete: {}", e);
    }

    if let Some(summary) = summary {
        let event = TracerouteAllCompleteEvent::new(summary.total, summary.succeeded, summary.failed);
        if let Err(e) = app.emit("traceroute-all-complete", event) {
            log::warn!("Failed to emit traceroute-all-complete: {}", e);
        }
    }
}

pub async fn trace_session_targets(
    app_handle: AppHandle,
    traceroute_service: Arc<TracerouteService>,
    session_id: i64,
) -> usize {
    let Some(ip_period_repo) = get_ip_period_repository() else {
        return 0;
    };

    let candidates = match ip_period_repo.get_trace_candidates(session_id).await {
        Ok(candidates) => candidates,
        Err(e) => {
            log::error!("Failed to load trace candidates for session {}: {}", session_id, e);
            return 0;
        }
    };

    let targets = select_session_targets(&candidates);
    let count = targets.len();
    log::info!(
        "Session {}: {} traceroute targets out of {} IPs",
        session_id,
        count,
        candidates.len()
    );
    enqueue_traceroutes(app_handle, traceroute_service, session_id, targets).await;
    count
}

async fn run_traceroute_queue(
    app_handle: AppHandle,
    traceroute_service: Arc<TracerouteService>,
    event: GameEndedEvent,
) {
    let Some(session_id) = event.session_id else {
        log::warn!("No session_id in GameEndedEvent, cannot run traceroutes");
        return;
    };

    trace_session_targets(app_handle, traceroute_service, session_id).await;
}

#[tauri::command]
pub async fn start_monitoring(
    app: AppHandle,
    state: State<'_, AppMonitoringState>,
) -> Result<(), CommandError> {
    log::info!("Starting game monitoring...");

    {
        let mut monitoring_state = state.monitoring_state.write().await;
        if monitoring_state.is_monitoring {
            log::warn!("Monitoring already active");
            return Err(CommandError::already_monitoring());
        }
        monitoring_state.is_monitoring = true;
    }

    let game_repo = get_game_repository().ok_or_else(|| CommandError {
        code: "REPO_NOT_INITIALIZED".to_string(),
        message: "Game repository not initialized".to_string(),
    })?;

    let mut detector = GameDetector::new(state.monitoring_state.clone(), game_repo);

    let app_handle_detected = app.clone();
    let monitoring_state_for_detected = state.monitoring_state.clone();

    let on_ended = make_on_game_ended(app.clone(), state.traceroute_service.clone());
    let on_ip = make_on_ip_captured(
        app.clone(),
        state.monitoring_state.clone(),
        state.traceroute_service.clone(),
    );
    let on_cap = make_on_capacity_reached(app.clone());

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

                if let Err(e) = app_handle_detected.emit("game-detected", game) {
                    log::warn!("Failed to emit game-detected: {}", e);
                }
            },
            on_ended,
            on_ip,
            on_cap,
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
) -> Result<(), CommandError> {
    log::info!("Stopping game monitoring...");

    {
        let monitoring_state = state.monitoring_state.read().await;
        if !monitoring_state.is_monitoring {
            log::warn!("Monitoring not active");
            return Err(CommandError::not_monitoring());
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
        if let Err(e) = app.emit("game-ended", event.clone()) {
            log::warn!("Failed to emit game-ended: {}", e);
        }
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
) -> Result<(), CommandError> {
    log::info!("Cancelling traceroute queue...");
    state.traceroute_service.reset().await;

    let event = TracerouteAllCompleteEvent::new(0, 0, 0);
    if let Err(e) = app.emit("traceroute-all-complete", event) {
        log::warn!("Failed to emit traceroute-all-complete: {}", e);
    }

    log::info!("Traceroute queue cancelled");
    Ok(())
}

#[tauri::command]
pub async fn get_monitoring_status(
    state: State<'_, AppMonitoringState>,
) -> Result<MonitoringStatusResponse, CommandError> {
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
pub async fn list_running_processes() -> Result<Vec<RunningProcess>, CommandError> {
    log::debug!("Listing running processes for manual selection...");
    let processes = platform::list_running_processes_filtered();
    log::debug!("Found {} processes after filtering", processes.len());
    Ok(processes)
}

#[tauri::command]
pub async fn list_running_apps() -> Result<Vec<RunningApp>, CommandError> {
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
) -> Result<(), CommandError> {
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
        return Err(CommandError::process_not_found());
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

    let game_repo = get_game_repository().ok_or_else(|| CommandError {
        code: "REPO_NOT_INITIALIZED".to_string(),
        message: "Game repository not initialized".to_string(),
    })?;

    let mut detector = GameDetector::new(state.monitoring_state.clone(), game_repo);

    let app_handle_detected = app.clone();
    let monitoring_state_for_detected = state.monitoring_state.clone();

    let on_ended = make_on_game_ended(app.clone(), state.traceroute_service.clone());
    let on_ip = make_on_ip_captured(
        app.clone(),
        state.monitoring_state.clone(),
        state.traceroute_service.clone(),
    );
    let on_cap = make_on_capacity_reached(app.clone());

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

                if let Err(e) = app_handle_detected.emit("game-detected", game) {
                    log::warn!("Failed to emit game-detected: {}", e);
                }
            },
            on_ended,
            on_ip,
            on_cap,
        )
        .await;

    {
        let mut detector_guard = state.detector.write().await;
        *detector_guard = Some(detector);
    }

    if let Err(e) = app.emit("game-detected", game) {
        log::warn!("Failed to emit game-detected: {}", e);
    }

    log::info!(
        "Manual monitoring started for process: {} (PID: {})",
        process_name,
        pid
    );
    Ok(())
}

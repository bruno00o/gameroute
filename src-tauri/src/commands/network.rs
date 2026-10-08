use crate::commands::monitoring::{run_next_traceroute, AppMonitoringState};
use crate::commands::CommandError;
use crate::db::{get_analytics_repository, get_ip_period_repository};
use crate::models::flow_kind::FlowKind;
use crate::models::network::{NetworkMapEntry, NetworkOverviewStats, RecurringProblemHop};
use crate::models::{TracedTarget, TracerouteStartedEvent};
use crate::services::severity::{self, Measurement, SeverityThresholds};
use crate::services::trace_address::{resolve_address, TraceAddressError};
use crate::services::trace_targets::{ignored_count, is_cdn};
use crate::services::traceroute::TracerouteJob;
use tauri::{AppHandle, Emitter, State};

#[tauri::command]
pub async fn get_network_map_data() -> Result<Vec<NetworkMapEntry>, CommandError> {
    let repo =
        get_analytics_repository().ok_or_else(|| CommandError::repo_not_initialized("Analytics"))?;
    repo.get_network_map_data()
        .await
        .map_err(|e| CommandError::internal(e.to_string()))
}

#[tauri::command]
pub async fn get_recurring_problem_hops() -> Result<Vec<RecurringProblemHop>, CommandError> {
    let repo =
        get_analytics_repository().ok_or_else(|| CommandError::repo_not_initialized("Analytics"))?;
    repo.get_recurring_problem_hops()
        .await
        .map_err(|e| CommandError::internal(e.to_string()))
}

#[tauri::command]
pub async fn get_network_overview_stats() -> Result<NetworkOverviewStats, CommandError> {
    let repo =
        get_analytics_repository().ok_or_else(|| CommandError::repo_not_initialized("Analytics"))?;
    let mut stats = repo
        .get_network_overview_stats()
        .await
        .map_err(|e| CommandError::internal(e.to_string()))?;
    stats.status = severity::severity(&Measurement {
        rtt_ms: stats.avg_latency,
        ..Measurement::default()
    });
    Ok(stats)
}

#[tauri::command]
pub fn get_severity_thresholds() -> SeverityThresholds {
    severity::thresholds()
}

#[tauri::command]
pub async fn trace_address(
    app: AppHandle,
    state: State<'_, AppMonitoringState>,
    address: String,
) -> Result<String, CommandError> {
    let ip = resolve_address(&address).await.map_err(|e| match e {
        TraceAddressError::Invalid => CommandError {
            code: "INVALID_ADDRESS".to_string(),
            message: e.to_string(),
        },
        TraceAddressError::Unresolved => CommandError {
            code: "UNRESOLVED_ADDRESS".to_string(),
            message: e.to_string(),
        },
    })?;
    let ip = ip.to_string();

    let service = state.traceroute_service.clone();
    let job = TracerouteJob::new(ip.clone(), 0, None).with_kind(FlowKind::Other);
    let total = service.enqueue(vec![job]).await;

    let target = TracedTarget {
        ip: ip.clone(),
        kind: None,
        protocol: "ICMP".to_string(),
        port: 0,
    };
    if let Err(e) = app.emit("traceroute-started", TracerouteStartedEvent::new(total, vec![target])) {
        log::warn!("Failed to emit traceroute-started: {}", e);
    }
    tokio::spawn(run_next_traceroute(app, service));

    Ok(ip)
}

#[tauri::command]
pub async fn get_ignored_connection_count(session_id: i64) -> Result<u32, CommandError> {
    let repo = get_ip_period_repository()
        .ok_or_else(|| CommandError::repo_not_initialized("IpPeriod"))?;
    let candidates = repo
        .get_trace_candidates(session_id)
        .await
        .map_err(|e| CommandError::internal(e.to_string()))?;
    Ok(ignored_count(&candidates, is_cdn) as u32)
}

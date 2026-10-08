use crate::commands::monitoring::{trace_session_targets, AppMonitoringState};
use crate::commands::{validate_pagination, CommandError};
use crate::db::{get_ip_period_repository, get_session_repository, get_traceroute_repository};
use crate::models::session::{SessionDetail, SessionListItem};
use crate::services::severity;
use crate::services::trace_targets::select_session_targets;
use tauri::{AppHandle, State};

#[tauri::command]
pub async fn get_sessions(limit: i32, offset: i32) -> Result<Vec<SessionListItem>, CommandError> {
    let (limit, offset) = validate_pagination(limit, offset);

    let repo = get_session_repository().ok_or_else(|| CommandError::repo_not_initialized("Session"))?;

    repo.get_sessions_with_counts(limit, offset)
        .await
        .map_err(|e| CommandError::internal(e.to_string()))
}

#[tauri::command]
pub async fn get_session_detail(id: i64) -> Result<Option<SessionDetail>, CommandError> {
    if id <= 0 {
        return Err(CommandError::validation("Invalid session ID"));
    }

    let session_repo =
        get_session_repository().ok_or_else(|| CommandError::repo_not_initialized("Session"))?;

    let session = match session_repo
        .get_session(id)
        .await
        .map_err(|e| CommandError::internal(e.to_string()))?
    {
        Some(s) => s,
        None => return Ok(None),
    };

    let ip_periods = if let Some(ip_period_repo) = get_ip_period_repository() {
        ip_period_repo
            .get_periods_for_session(id)
            .await
            .unwrap_or_else(|e| {
                log::error!("Failed to get IP periods for session {}: {}", id, e);
                Vec::new()
            })
    } else {
        Vec::new()
    };

    let ip_summaries = if let Some(ip_period_repo) = get_ip_period_repository() {
        ip_period_repo
            .get_ip_summaries_for_session(id)
            .await
            .unwrap_or_else(|e| {
                log::error!("Failed to get IP summaries for session {}: {}", id, e);
                Vec::new()
            })
    } else {
        Vec::new()
    };

    let mut traceroutes = if let Some(traceroute_repo) = get_traceroute_repository() {
        traceroute_repo
            .get_traceroutes_with_hops_for_session(id)
            .await
            .unwrap_or_else(|e| {
                log::error!("Failed to get traceroutes for session {}: {}", id, e);
                Vec::new()
            })
    } else {
        Vec::new()
    };
    traceroutes.iter_mut().for_each(severity::assess_traceroute);

    log::debug!(
        "Session {} detail: {} IP periods, {} summaries, {} traceroutes",
        id,
        ip_periods.len(),
        ip_summaries.len(),
        traceroutes.len()
    );

    Ok(Some(SessionDetail {
        id: session.id,
        game_name: session.game_name,
        started_at: session.started_at,
        ended_at: session.ended_at,
        ip_periods,
        ip_summaries,
        traceroutes,
    }))
}

#[tauri::command]
pub async fn search_sessions(
    query: String,
    limit: i32,
    offset: i32,
) -> Result<Vec<SessionListItem>, CommandError> {
    let (limit, offset) = validate_pagination(limit, offset);
    let repo =
        get_session_repository().ok_or_else(|| CommandError::repo_not_initialized("Session"))?;
    repo.search_sessions(&query, limit, offset)
        .await
        .map_err(|e| CommandError::internal(e.to_string()))
}

#[tauri::command]
pub async fn search_session_count(query: String) -> Result<i64, CommandError> {
    let repo =
        get_session_repository().ok_or_else(|| CommandError::repo_not_initialized("Session"))?;
    repo.search_session_count(&query)
        .await
        .map_err(|e| CommandError::internal(e.to_string()))
}

#[tauri::command]
pub async fn get_previous_session_id(
    game_name: String,
    before_started_at: String,
) -> Result<Option<i64>, CommandError> {
    let repo =
        get_session_repository().ok_or_else(|| CommandError::repo_not_initialized("Session"))?;

    repo.get_previous_session_id(&game_name, &before_started_at)
        .await
        .map_err(|e| CommandError::internal(e.to_string()))
}

#[tauri::command]
pub async fn delete_session(id: i64) -> Result<(), CommandError> {
    if id <= 0 {
        return Err(CommandError::validation("Invalid session ID"));
    }

    let repo = get_session_repository().ok_or_else(|| CommandError::repo_not_initialized("Session"))?;

    repo.delete_session(id)
        .await
        .map_err(|e| CommandError::internal(e.to_string()))
}

#[tauri::command]
pub async fn get_session_count() -> Result<i64, CommandError> {
    let repo = get_session_repository().ok_or_else(|| CommandError::repo_not_initialized("Session"))?;

    repo.get_session_count()
        .await
        .map_err(|e| CommandError::internal(e.to_string()))
}

#[tauri::command]
pub async fn retry_traceroutes(
    app: AppHandle,
    state: State<'_, AppMonitoringState>,
    session_id: i64,
) -> Result<(), CommandError> {
    if session_id <= 0 {
        return Err(CommandError::validation("Invalid session ID"));
    }

    if state.traceroute_service.is_running().await {
        return Err(CommandError {
            code: "TRACEROUTE_RUNNING".to_string(),
            message: "A traceroute is already running".to_string(),
        });
    }

    let ip_period_repo = get_ip_period_repository()
        .ok_or_else(|| CommandError::repo_not_initialized("IpPeriod"))?;

    let candidates = ip_period_repo
        .get_trace_candidates(session_id)
        .await
        .map_err(|e| CommandError::internal(e.to_string()))?;

    if select_session_targets(&candidates).is_empty() {
        return Err(CommandError::validation("No IPs found for this session"));
    }

    let traceroute_repo = get_traceroute_repository()
        .ok_or_else(|| CommandError::repo_not_initialized("Traceroute"))?;

    traceroute_repo
        .delete_traceroutes_for_session(session_id)
        .await
        .map_err(|e| CommandError::internal(e.to_string()))?;

    let traceroute_service = state.traceroute_service.clone();
    tokio::spawn(async move {
        trace_session_targets(app, traceroute_service, session_id).await;
    });

    Ok(())
}

use crate::commands::CommandError;
use crate::db::{get_ip_period_repository, get_session_repository, get_traceroute_repository};
use crate::models::session::{SessionDetail, SessionListItem};

const MAX_PAGINATION_LIMIT: i32 = 100;

#[tauri::command]
pub async fn get_sessions(limit: i32, offset: i32) -> Result<Vec<SessionListItem>, CommandError> {
    let validated_limit = if limit <= 0 {
        20
    } else if limit > MAX_PAGINATION_LIMIT {
        MAX_PAGINATION_LIMIT
    } else {
        limit
    };

    let validated_offset = if offset < 0 { 0 } else { offset };

    let repo = get_session_repository().ok_or_else(|| CommandError::repo_not_initialized("Session"))?;

    repo.get_sessions_with_counts(validated_limit, validated_offset)
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

    let traceroutes = if let Some(traceroute_repo) = get_traceroute_repository() {
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

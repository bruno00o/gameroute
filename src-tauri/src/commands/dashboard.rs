use crate::commands::CommandError;
use crate::db::get_session_repository;
use crate::models::dashboard::DashboardData;

#[tauri::command]
pub async fn get_dashboard_data() -> Result<DashboardData, CommandError> {
    let repo =
        get_session_repository().ok_or_else(|| CommandError::repo_not_initialized("Session"))?;

    let (total_sessions, total_play_time_secs, unique_games) = repo
        .get_dashboard_stats()
        .await
        .map_err(|e| CommandError::internal(e.to_string()))?;

    let recent_sessions = repo
        .get_recent_sessions(5)
        .await
        .map_err(|e| CommandError::internal(e.to_string()))?;

    Ok(DashboardData {
        total_sessions,
        total_play_time_secs,
        unique_games,
        recent_sessions,
    })
}

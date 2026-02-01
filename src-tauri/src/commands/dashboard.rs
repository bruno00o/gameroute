use crate::db::get_session_repository;
use crate::models::dashboard::DashboardData;

#[tauri::command]
pub async fn get_dashboard_data() -> Result<DashboardData, String> {
    let repo = get_session_repository().ok_or("Session repository not initialized")?;

    let (total_sessions, total_play_time_secs, unique_games) = repo
        .get_dashboard_stats()
        .await
        .map_err(|e| e.to_string())?;

    let recent_sessions = repo
        .get_recent_sessions(5)
        .await
        .map_err(|e| e.to_string())?;

    Ok(DashboardData {
        total_sessions,
        total_play_time_secs,
        unique_games,
        recent_sessions,
    })
}

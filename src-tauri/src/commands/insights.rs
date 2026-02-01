use crate::commands::CommandError;
use crate::db::get_analytics_repository;
use crate::models::insights::{HourlyQuality, ServerStability, SessionQualityPoint};

#[tauri::command]
pub async fn get_network_quality_over_time() -> Result<Vec<SessionQualityPoint>, CommandError> {
    let repo =
        get_analytics_repository().ok_or_else(|| CommandError::repo_not_initialized("Analytics"))?;
    repo.get_network_quality_over_time()
        .await
        .map_err(|e| CommandError::internal(e.to_string()))
}

#[tauri::command]
pub async fn get_server_stability() -> Result<Vec<ServerStability>, CommandError> {
    let repo =
        get_analytics_repository().ok_or_else(|| CommandError::repo_not_initialized("Analytics"))?;
    repo.get_server_stability()
        .await
        .map_err(|e| CommandError::internal(e.to_string()))
}

#[tauri::command]
pub async fn get_hourly_quality() -> Result<Vec<HourlyQuality>, CommandError> {
    let repo =
        get_analytics_repository().ok_or_else(|| CommandError::repo_not_initialized("Analytics"))?;
    repo.get_hourly_quality()
        .await
        .map_err(|e| CommandError::internal(e.to_string()))
}

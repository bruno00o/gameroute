use crate::db::get_analytics_repository;
use crate::models::insights::{HourlyQuality, ServerStability, SessionQualityPoint};

#[tauri::command]
pub async fn get_network_quality_over_time() -> Result<Vec<SessionQualityPoint>, String> {
    let repo = get_analytics_repository().ok_or("Analytics repository not initialized")?;
    repo.get_network_quality_over_time()
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_server_stability() -> Result<Vec<ServerStability>, String> {
    let repo = get_analytics_repository().ok_or("Analytics repository not initialized")?;
    repo.get_server_stability()
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_hourly_quality() -> Result<Vec<HourlyQuality>, String> {
    let repo = get_analytics_repository().ok_or("Analytics repository not initialized")?;
    repo.get_hourly_quality()
        .await
        .map_err(|e| e.to_string())
}

use crate::db::get_analytics_repository;
use crate::models::network::{NetworkMapEntry, NetworkOverviewStats, RecurringProblemHop};

#[tauri::command]
pub async fn get_network_map_data() -> Result<Vec<NetworkMapEntry>, String> {
    let repo = get_analytics_repository().ok_or("Analytics repository not initialized")?;
    repo.get_network_map_data()
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_recurring_problem_hops() -> Result<Vec<RecurringProblemHop>, String> {
    let repo = get_analytics_repository().ok_or("Analytics repository not initialized")?;
    repo.get_recurring_problem_hops()
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_network_overview_stats() -> Result<NetworkOverviewStats, String> {
    let repo = get_analytics_repository().ok_or("Analytics repository not initialized")?;
    repo.get_network_overview_stats()
        .await
        .map_err(|e| e.to_string())
}

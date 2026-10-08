use crate::commands::CommandError;
use crate::db::get_analytics_repository;
use crate::models::network::{NetworkMapEntry, NetworkOverviewStats, RecurringProblemHop};
use crate::services::severity::{self, Measurement, SeverityThresholds};

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

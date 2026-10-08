use crate::commands::CommandError;
use crate::config::SERVER_SUMMARY_DAYS;
use crate::db::{
    get_analytics_repository, get_ip_metadata_repository, get_ip_period_repository,
    get_traceroute_repository,
};
use crate::models::insights::{HourlyQuality, ServerStability, ServerSummary, SessionQualityPoint};
use crate::services::server_summary;
use chrono::{Duration, Utc};

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

#[tauri::command]
pub async fn get_server_summary(days: Option<u32>) -> Result<ServerSummary, CommandError> {
    let analytics =
        get_analytics_repository().ok_or_else(|| CommandError::repo_not_initialized("Analytics"))?;
    let periods =
        get_ip_period_repository().ok_or_else(|| CommandError::repo_not_initialized("IpPeriod"))?;
    let traceroutes = get_traceroute_repository()
        .ok_or_else(|| CommandError::repo_not_initialized("Traceroute"))?;
    let metadata = get_ip_metadata_repository();

    let days = days.unwrap_or(SERVER_SUMMARY_DAYS).clamp(1, 3650);
    server_summary::server_summary(
        &analytics,
        &periods,
        &traceroutes,
        metadata.as_deref(),
        Utc::now() - Duration::days(i64::from(days)),
    )
    .await
    .map_err(|e| CommandError::internal(e.to_string()))
}

use super::CommandError;
use crate::db::get_match_incident_repository;
use crate::models::live_status::{LiveStatus, MatchIncident};
use crate::services::live_status::LiveStatusService;
use std::sync::Arc;
use tauri::State;

#[tauri::command]
pub fn get_live_status(service: State<'_, Arc<LiveStatusService>>) -> Option<LiveStatus> {
    service.snapshot()
}

#[tauri::command]
pub async fn get_match_incidents(session_id: i64) -> Result<Vec<MatchIncident>, CommandError> {
    let repo = get_match_incident_repository()
        .ok_or_else(|| CommandError::repo_not_initialized("MatchIncident"))?;
    repo.get_for_session(session_id)
        .await
        .map_err(|e| CommandError::internal(e.to_string()))
}

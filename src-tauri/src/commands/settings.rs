use std::sync::atomic::Ordering;

use tauri::State;

use super::monitoring::AppMonitoringState;
use super::CommandError;
use crate::db::get_storage_repository;
use crate::models::settings::{AppSettings, StorageStats};
use crate::services::app_settings::{SettingsError, SettingsStore};
use crate::services::asn_resolver;
use crate::TraySettings;

impl From<SettingsError> for CommandError {
    fn from(e: SettingsError) -> Self {
        match e {
            SettingsError::UnsupportedRetention(_) => CommandError::validation(&e.to_string()),
            _ => CommandError::internal(format!("Failed to save settings: {e}")),
        }
    }
}

#[tauri::command]
pub fn get_app_settings(store: State<'_, SettingsStore>) -> AppSettings {
    store.get()
}

#[tauri::command]
pub fn set_minimize_to_tray(
    enabled: bool,
    store: State<'_, SettingsStore>,
    tray: State<'_, TraySettings>,
) -> Result<AppSettings, CommandError> {
    let settings = store.update(|s| s.minimize_to_tray = enabled)?;
    tray.minimize_to_tray.store(enabled, Ordering::Relaxed);
    Ok(settings)
}

#[tauri::command]
pub fn set_session_retention(
    days: Option<u32>,
    store: State<'_, SettingsStore>,
) -> Result<AppSettings, CommandError> {
    Ok(store.update(|s| s.session_retention_days = days)?)
}

#[tauri::command]
pub async fn get_storage_stats() -> Result<StorageStats, CommandError> {
    let repo =
        get_storage_repository().ok_or_else(|| CommandError::repo_not_initialized("Storage"))?;
    let mut stats = repo
        .get_stats()
        .await
        .map_err(|e| CommandError::internal(e.to_string()))?;
    stats.geolite_built_at = asn_resolver::get_resolver().and_then(|resolver| resolver.built_at());
    Ok(stats)
}

#[tauri::command]
pub async fn delete_all_data(state: State<'_, AppMonitoringState>) -> Result<(), CommandError> {
    if state.monitoring_state.read().await.is_monitoring {
        return Err(CommandError::already_monitoring());
    }
    let repo =
        get_storage_repository().ok_or_else(|| CommandError::repo_not_initialized("Storage"))?;
    repo.delete_all_data()
        .await
        .map_err(|e| CommandError::internal(e.to_string()))
}

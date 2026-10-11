use super::CommandError;
use crate::models::live_probe::{LiveProbeConfig, LiveProbeState};
use crate::services::live_probe::store::{LiveProbeConfigError, LiveProbeService};
use std::sync::Arc;
use tauri::State;

impl From<LiveProbeConfigError> for CommandError {
    fn from(e: LiveProbeConfigError) -> Self {
        match e {
            LiveProbeConfigError::InvalidBeacon(_) => CommandError::validation(&e.to_string()),
            _ => CommandError::internal(format!("Failed to save live probe settings: {e}")),
        }
    }
}

#[tauri::command]
pub fn get_live_probe_state(service: State<'_, Arc<LiveProbeService>>) -> LiveProbeState {
    service.state()
}

#[tauri::command]
pub fn get_live_probe_config(service: State<'_, Arc<LiveProbeService>>) -> LiveProbeConfig {
    service.config()
}

#[tauri::command]
pub fn set_live_probe_config(
    config: LiveProbeConfig,
    service: State<'_, Arc<LiveProbeService>>,
) -> Result<LiveProbeConfig, CommandError> {
    Ok(service.set_config(config)?)
}

use tauri::AppHandle;

use super::CommandError;
use crate::models::shell::MiniState;
use crate::services::mini_window::{self, MiniWindowError};

impl From<MiniWindowError> for CommandError {
    fn from(e: MiniWindowError) -> Self {
        CommandError::internal(format!("Mini window: {e}"))
    }
}

#[tauri::command]
pub fn get_mini_state(app: AppHandle) -> MiniState {
    mini_window::state(&app)
}

#[tauri::command]
pub async fn show_mini_window(app: AppHandle) -> Result<MiniState, CommandError> {
    mini_window::open(&app)?;
    Ok(mini_window::state(&app))
}

#[tauri::command]
pub async fn hide_mini_window(app: AppHandle) -> MiniState {
    mini_window::close(&app);
    mini_window::state(&app)
}

#[tauri::command]
pub async fn set_mini_collapsed(
    app: AppHandle,
    collapsed: bool,
) -> Result<MiniState, CommandError> {
    Ok(mini_window::set_collapsed(&app, collapsed)?)
}

#[tauri::command]
pub async fn set_mini_always_on_top(
    app: AppHandle,
    enabled: bool,
) -> Result<MiniState, CommandError> {
    Ok(mini_window::set_always_on_top(&app, enabled)?)
}

use serde::Serialize;
use tauri::State;

use crate::config::CAPTURE_SERVICE_PIPE_NAME;
use crate::TraySettings;

#[derive(Debug, Serialize)]
pub struct ServiceStatus {
    pub running: bool,
    pub error: Option<String>,
}

#[tauri::command]
pub async fn check_capture_service_status() -> ServiceStatus {
    match tokio::task::spawn_blocking(|| {
        use std::fs::OpenOptions;
        OpenOptions::new()
            .read(true)
            .write(true)
            .open(CAPTURE_SERVICE_PIPE_NAME)
            .map(|_| ())
    })
    .await
    {
        Ok(Ok(())) => ServiceStatus {
            running: true,
            error: None,
        },
        Ok(Err(e)) => ServiceStatus {
            running: false,
            error: Some(e.to_string()),
        },
        Err(e) => ServiceStatus {
            running: false,
            error: Some(e.to_string()),
        },
    }
}

#[tauri::command]
pub fn set_minimize_to_tray(enabled: bool, state: State<'_, TraySettings>) {
    state
        .minimize_to_tray
        .store(enabled, std::sync::atomic::Ordering::Relaxed);
}

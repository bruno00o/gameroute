use serde::Serialize;
use tauri::State;

use super::CommandError;
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
pub async fn restart_capture_service() -> Result<(), CommandError> {
    tokio::task::spawn_blocking(|| {
        // Try to start the existing service via sc start
        let output = std::process::Command::new("sc")
            .args(["start", "GameRouteCaptureService"])
            .output()
            .map_err(|e| CommandError::internal(format!("Failed to run sc command: {}", e)))?;

        if output.status.success() {
            log::info!("Capture service started successfully");
            Ok(())
        } else {
            let stderr = String::from_utf8_lossy(&output.stderr);
            let stdout = String::from_utf8_lossy(&output.stdout);
            let msg = if !stderr.is_empty() {
                stderr.to_string()
            } else {
                stdout.to_string()
            };

            // Service might already be running (error 1056) — that's fine
            if msg.contains("1056") {
                log::info!("Capture service is already running");
                Ok(())
            } else {
                log::error!("Failed to start capture service: {}", msg);
                Err(CommandError::internal(msg))
            }
        }
    })
    .await
    .map_err(|e| CommandError::internal(e.to_string()))?
}

#[tauri::command]
pub fn set_minimize_to_tray(enabled: bool, state: State<'_, TraySettings>) {
    state
        .minimize_to_tray
        .store(enabled, std::sync::atomic::Ordering::Relaxed);
}

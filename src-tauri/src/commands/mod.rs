pub mod asn;
pub mod dashboard;
pub mod games;
pub mod insights;
pub mod monitoring;
pub mod network;
pub mod sessions;

/// Shared structured error type for Tauri commands that previously used `String`.
#[derive(Debug, Clone, serde::Serialize)]
pub struct CommandError {
    pub code: String,
    pub message: String,
}

impl CommandError {
    pub fn repo_not_initialized(name: &str) -> Self {
        Self {
            code: "REPO_NOT_INITIALIZED".to_string(),
            message: format!("{} repository not initialized", name),
        }
    }

    pub fn validation(msg: &str) -> Self {
        Self {
            code: "VALIDATION_ERROR".to_string(),
            message: msg.to_string(),
        }
    }

    pub fn internal(msg: String) -> Self {
        Self {
            code: "INTERNAL_ERROR".to_string(),
            message: msg,
        }
    }
}

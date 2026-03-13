pub mod asn;
pub mod dashboard;
pub mod export;
pub mod games;
pub mod insights;
pub mod monitoring;
pub mod network;
pub mod service;
pub mod sessions;

use crate::config::{DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT};
use crate::services::asn_resolver;

/// Clamp pagination parameters to safe defaults.
pub fn validate_pagination(limit: i32, offset: i32) -> (i32, i32) {
    let limit = if limit <= 0 {
        DEFAULT_PAGE_LIMIT
    } else {
        limit.min(MAX_PAGE_LIMIT)
    };
    let offset = offset.max(0);
    (limit, offset)
}

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

    pub fn already_monitoring() -> Self {
        Self {
            code: "ALREADY_MONITORING".to_string(),
            message: "Monitoring is already active".to_string(),
        }
    }

    pub fn not_monitoring() -> Self {
        Self {
            code: "NOT_MONITORING".to_string(),
            message: "Monitoring is not active".to_string(),
        }
    }

    pub fn process_not_found() -> Self {
        Self {
            code: "PROCESS_NOT_FOUND".to_string(),
            message: "The selected process no longer exists".to_string(),
        }
    }
}

impl From<asn_resolver::AsnError> for CommandError {
    fn from(e: asn_resolver::AsnError) -> Self {
        match e {
            asn_resolver::AsnError::RateLimitExceeded => Self {
                code: "RATE_LIMIT_EXCEEDED".to_string(),
                message: "Rate limit reached, please try again in a few moments".to_string(),
            },
            asn_resolver::AsnError::HttpError(_) => Self {
                code: "NETWORK_ERROR".to_string(),
                message: "Unable to reach the resolution service".to_string(),
            },
            asn_resolver::AsnError::InvalidResponse => Self {
                code: "INVALID_RESPONSE".to_string(),
                message: "Invalid response from the resolution service".to_string(),
            },
        }
    }
}

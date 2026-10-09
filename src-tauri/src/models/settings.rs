use serde::{Deserialize, Serialize};

use crate::config::{
    DEFAULT_SESSION_RETENTION_DAYS, SESSION_RETENTION_CHOICES_DAYS, SUPPORTED_LOCALES,
};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AppSettings {
    pub minimize_to_tray: bool,
    pub session_retention_days: Option<u32>,
    pub locale: Option<String>,
    pub alerts: AlertSettings,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            minimize_to_tray: true,
            session_retention_days: Some(DEFAULT_SESSION_RETENTION_DAYS),
            locale: None,
            alerts: AlertSettings::default(),
        }
    }
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RecapMode {
    Always,
    #[default]
    Changed,
    Never,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AlertSettings {
    pub critical_alert: bool,
    pub do_not_disturb: bool,
    pub recap: RecapMode,
}

impl Default for AlertSettings {
    fn default() -> Self {
        Self {
            critical_alert: true,
            do_not_disturb: false,
            recap: RecapMode::default(),
        }
    }
}

pub fn is_supported_locale(locale: &str) -> bool {
    SUPPORTED_LOCALES.contains(&locale)
}

pub fn is_supported_retention(days: Option<u32>) -> bool {
    days.is_none_or(|days| SESSION_RETENTION_CHOICES_DAYS.contains(&days))
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageStats {
    pub database_bytes: i64,
    pub session_count: i64,
    pub address_count: i64,
    pub geolite_built_at: Option<String>,
}

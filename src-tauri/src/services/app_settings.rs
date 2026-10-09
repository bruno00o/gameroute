use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard, PoisonError};

use thiserror::Error;

use crate::models::settings::{is_supported_locale, is_supported_retention, AppSettings};

#[derive(Debug, Error)]
pub enum SettingsError {
    #[error("Unsupported session retention: {0:?} days")]
    UnsupportedRetention(Option<u32>),

    #[error("Unsupported locale: {0:?}")]
    UnsupportedLocale(String),

    #[error("{0}")]
    Io(#[from] std::io::Error),

    #[error("{0}")]
    Json(#[from] serde_json::Error),
}

pub struct SettingsStore {
    path: PathBuf,
    settings: Mutex<AppSettings>,
}

impl SettingsStore {
    pub fn load(path: PathBuf) -> Self {
        let settings = read_settings(&path);
        Self {
            path,
            settings: Mutex::new(settings),
        }
    }

    pub fn get(&self) -> AppSettings {
        self.lock().clone()
    }

    pub fn update(
        &self,
        change: impl FnOnce(&mut AppSettings),
    ) -> Result<AppSettings, SettingsError> {
        let mut settings = self.lock();
        let mut next = settings.clone();
        change(&mut next);
        if !is_supported_retention(next.session_retention_days) {
            return Err(SettingsError::UnsupportedRetention(
                next.session_retention_days,
            ));
        }
        if let Some(locale) = next.locale.as_deref().filter(|l| !is_supported_locale(l)) {
            return Err(SettingsError::UnsupportedLocale(locale.to_string()));
        }
        write_settings(&self.path, &next)?;
        *settings = next.clone();
        Ok(next)
    }

    fn lock(&self) -> MutexGuard<'_, AppSettings> {
        self.settings.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

fn read_settings(path: &Path) -> AppSettings {
    let text = match std::fs::read_to_string(path) {
        Ok(text) => text,
        Err(e) if e.kind() == ErrorKind::NotFound => return AppSettings::default(),
        Err(e) => return unreadable(path, &e),
    };
    let mut settings: AppSettings = match serde_json::from_str(&text) {
        Ok(settings) => settings,
        Err(e) => return unreadable(path, &e),
    };
    if !is_supported_retention(settings.session_retention_days) {
        log::warn!(
            "Unsupported session retention {:?} in {}, using the default",
            settings.session_retention_days,
            path.display()
        );
        settings.session_retention_days = AppSettings::default().session_retention_days;
    }
    if settings
        .locale
        .as_deref()
        .is_some_and(|l| !is_supported_locale(l))
    {
        settings.locale = None;
    }
    settings
}

fn unreadable(path: &Path, error: &dyn std::fmt::Display) -> AppSettings {
    log::warn!(
        "Could not read settings from {}: {}. Sessions are kept until the settings are saved again",
        path.display(),
        error
    );
    AppSettings {
        session_retention_days: None,
        ..AppSettings::default()
    }
}

fn write_settings(path: &Path, settings: &AppSettings) -> Result<(), SettingsError> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let staging = path.with_extension("json.tmp");
    std::fs::write(&staging, serde_json::to_vec_pretty(settings)?)?;
    std::fs::rename(&staging, path)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::DEFAULT_SESSION_RETENTION_DAYS;
    use crate::db::create_test_pool;
    use crate::db::sessions::SessionRepository;
    use crate::models::settings::{AlertSettings, RecapMode};
    use chrono::{Duration, Utc};

    fn settings_path(dir: &tempfile::TempDir) -> PathBuf {
        dir.path().join("settings.json")
    }

    #[test]
    fn missing_file_keeps_sessions_for_a_year() {
        let dir = tempfile::tempdir().unwrap();
        let store = SettingsStore::load(settings_path(&dir));

        assert_eq!(
            store.get(),
            AppSettings {
                minimize_to_tray: true,
                session_retention_days: Some(DEFAULT_SESSION_RETENTION_DAYS),
                locale: None,
                alerts: AlertSettings {
                    critical_alert: true,
                    do_not_disturb: false,
                    recap: RecapMode::Changed,
                },
            }
        );
        assert_eq!(DEFAULT_SESSION_RETENTION_DAYS, 365);
    }

    #[test]
    fn reads_saved_choices() {
        let dir = tempfile::tempdir().unwrap();
        let path = settings_path(&dir);

        std::fs::write(
            &path,
            r#"{"minimizeToTray":false,"sessionRetentionDays":180}"#,
        )
        .unwrap();
        assert_eq!(
            SettingsStore::load(path.clone()).get(),
            AppSettings {
                minimize_to_tray: false,
                session_retention_days: Some(180),
                ..AppSettings::default()
            }
        );

        std::fs::write(&path, r#"{"sessionRetentionDays":null}"#).unwrap();
        assert_eq!(
            SettingsStore::load(path.clone()).get(),
            AppSettings {
                session_retention_days: None,
                ..AppSettings::default()
            }
        );

        std::fs::write(&path, r#"{"minimizeToTray":false,"futureSetting":1}"#).unwrap();
        assert_eq!(
            SettingsStore::load(path).get().session_retention_days,
            Some(DEFAULT_SESSION_RETENTION_DAYS)
        );
    }

    #[test]
    fn unsupported_retention_falls_back_to_the_default() {
        let dir = tempfile::tempdir().unwrap();
        let path = settings_path(&dir);
        std::fs::write(&path, r#"{"sessionRetentionDays":3}"#).unwrap();

        assert_eq!(
            SettingsStore::load(path).get().session_retention_days,
            Some(DEFAULT_SESSION_RETENTION_DAYS)
        );
    }

    #[test]
    fn unreadable_file_keeps_every_session() {
        let dir = tempfile::tempdir().unwrap();
        let path = settings_path(&dir);
        std::fs::write(&path, "{not json").unwrap();

        let settings = SettingsStore::load(path).get();
        assert!(settings.minimize_to_tray);
        assert_eq!(settings.session_retention_days, None);
    }

    #[test]
    fn update_persists_across_loads() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("nested").join("settings.json");
        let store = SettingsStore::load(path.clone());

        store.update(|s| s.minimize_to_tray = false).unwrap();
        let saved = store.update(|s| s.session_retention_days = None).unwrap();

        assert_eq!(
            saved,
            AppSettings {
                minimize_to_tray: false,
                session_retention_days: None,
                ..AppSettings::default()
            }
        );
        assert_eq!(SettingsStore::load(path.clone()).get(), saved);
        assert!(!path.with_extension("json.tmp").exists());
    }

    #[test]
    fn update_rejects_unsupported_retention() {
        let dir = tempfile::tempdir().unwrap();
        let path = settings_path(&dir);
        let store = SettingsStore::load(path.clone());

        let result = store.update(|s| s.session_retention_days = Some(42));

        assert!(matches!(
            result,
            Err(SettingsError::UnsupportedRetention(Some(42)))
        ));
        assert_eq!(store.get(), AppSettings::default());
        assert!(!path.exists());
    }

    #[test]
    fn alerts_default_to_critical_only_and_old_files_still_load() {
        let dir = tempfile::tempdir().unwrap();
        let path = settings_path(&dir);
        std::fs::write(&path, r#"{"minimizeToTray":false}"#).unwrap();

        let settings = SettingsStore::load(path.clone()).get();
        assert!(settings.alerts.critical_alert);
        assert!(!settings.alerts.do_not_disturb);
        assert_eq!(settings.alerts.recap, RecapMode::Changed);
        assert_eq!(settings.locale, None);

        std::fs::write(
            &path,
            r#"{"locale":"fr","alerts":{"criticalAlert":false,"recap":"never"}}"#,
        )
        .unwrap();
        let settings = SettingsStore::load(path.clone()).get();
        assert_eq!(settings.locale.as_deref(), Some("fr"));
        assert!(!settings.alerts.critical_alert);
        assert!(!settings.alerts.do_not_disturb);
        assert_eq!(settings.alerts.recap, RecapMode::Never);

        std::fs::write(&path, r#"{"locale":"xx"}"#).unwrap();
        assert_eq!(SettingsStore::load(path).get().locale, None);
    }

    #[test]
    fn update_rejects_unsupported_locale() {
        let dir = tempfile::tempdir().unwrap();
        let store = SettingsStore::load(settings_path(&dir));

        assert!(store.update(|s| s.locale = Some("es".to_string())).is_ok());
        assert!(matches!(
            store.update(|s| s.locale = Some("de".to_string())),
            Err(SettingsError::UnsupportedLocale(_))
        ));
        assert_eq!(store.get().locale.as_deref(), Some("es"));
    }

    async fn session_aged(repo: &SessionRepository, days: i64) -> i64 {
        let started = Utc::now() - Duration::days(days);
        let id = repo
            .insert_session("VALORANT", &started.to_rfc3339())
            .await
            .unwrap();
        repo.update_session_ended(id, &(started + Duration::hours(2)).to_rfc3339())
            .await
            .unwrap();
        id
    }

    async fn sessions_left_after_startup(settings_json: Option<&str>) -> Vec<i64> {
        let dir = tempfile::tempdir().unwrap();
        let path = settings_path(&dir);
        if let Some(json) = settings_json {
            std::fs::write(&path, json).unwrap();
        }
        let repo = SessionRepository::new(create_test_pool().await);
        for days in [10, 120, 200, 400, 800] {
            session_aged(&repo, days).await;
        }

        let settings = SettingsStore::load(path).get();
        repo.clean_up_on_startup(settings.session_retention_days)
            .await
            .unwrap();

        let mut ages = Vec::new();
        for session in repo.get_all_sessions(100, 0).await.unwrap() {
            let started = chrono::DateTime::parse_from_rfc3339(&session.started_at).unwrap();
            ages.push((Utc::now() - started.with_timezone(&Utc)).num_days());
        }
        ages.sort_unstable();
        ages
    }

    #[tokio::test]
    async fn startup_applies_the_saved_retention() {
        assert_eq!(sessions_left_after_startup(None).await, vec![10, 120, 200]);
        assert_eq!(
            sessions_left_after_startup(Some(r#"{"sessionRetentionDays":90}"#)).await,
            vec![10]
        );
        assert_eq!(
            sessions_left_after_startup(Some(r#"{"sessionRetentionDays":730}"#)).await,
            vec![10, 120, 200, 400]
        );
        assert_eq!(
            sessions_left_after_startup(Some(r#"{"sessionRetentionDays":null}"#)).await,
            vec![10, 120, 200, 400, 800]
        );
    }
}

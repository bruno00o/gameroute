use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard, PoisonError};

use thiserror::Error;

use crate::models::shell::ShellSettings;

#[derive(Debug, Error)]
pub enum ShellSettingsError {
    #[error("{0}")]
    Io(#[from] std::io::Error),

    #[error("{0}")]
    Json(#[from] serde_json::Error),
}

pub struct ShellSettingsStore {
    path: PathBuf,
    settings: Mutex<ShellSettings>,
}

impl ShellSettingsStore {
    pub fn load(path: PathBuf) -> Self {
        let settings = read_settings(&path);
        Self {
            path,
            settings: Mutex::new(settings),
        }
    }

    pub fn get(&self) -> ShellSettings {
        self.lock().clone()
    }

    pub fn update(
        &self,
        change: impl FnOnce(&mut ShellSettings),
    ) -> Result<ShellSettings, ShellSettingsError> {
        let mut settings = self.lock();
        let mut next = settings.clone();
        change(&mut next);
        if next == *settings {
            return Ok(next);
        }
        write_settings(&self.path, &next)?;
        *settings = next.clone();
        Ok(next)
    }

    fn lock(&self) -> MutexGuard<'_, ShellSettings> {
        self.settings.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

fn read_settings(path: &Path) -> ShellSettings {
    let text = match std::fs::read_to_string(path) {
        Ok(text) => text,
        Err(e) if e.kind() == ErrorKind::NotFound => return ShellSettings::default(),
        Err(e) => return unreadable(path, &e),
    };
    serde_json::from_str(&text).unwrap_or_else(|e| unreadable(path, &e))
}

fn unreadable(path: &Path, error: &dyn std::fmt::Display) -> ShellSettings {
    log::warn!(
        "Could not read the mini window settings from {}: {}. Using the defaults",
        path.display(),
        error
    );
    ShellSettings::default()
}

fn write_settings(path: &Path, settings: &ShellSettings) -> Result<(), ShellSettingsError> {
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
    use crate::models::shell::MiniPosition;

    fn path(dir: &tempfile::TempDir) -> PathBuf {
        dir.path().join("shell.json")
    }

    #[test]
    fn missing_file_keeps_the_mini_window_off_the_top_of_games() {
        let dir = tempfile::tempdir().unwrap();
        let settings = ShellSettingsStore::load(path(&dir)).get();

        assert!(!settings.mini_always_on_top);
        assert!(!settings.mini_collapsed);
        assert_eq!(settings.mini_position, None);
    }

    #[test]
    fn unreadable_file_falls_back_to_the_defaults() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(path(&dir), "{not json").unwrap();

        assert_eq!(
            ShellSettingsStore::load(path(&dir)).get(),
            ShellSettings::default()
        );
    }

    #[test]
    fn reads_saved_choices_and_ignores_unknown_ones() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(
            path(&dir),
            r#"{"miniAlwaysOnTop":true,"miniPosition":{"x":10,"y":20},"future":1}"#,
        )
        .unwrap();

        let settings = ShellSettingsStore::load(path(&dir)).get();
        assert!(settings.mini_always_on_top);
        assert!(!settings.mini_collapsed);
        assert_eq!(settings.mini_position, Some(MiniPosition { x: 10, y: 20 }));
    }

    #[test]
    fn update_persists_across_loads_and_skips_identical_writes() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("nested").join("shell.json");
        let store = ShellSettingsStore::load(file.clone());

        store.update(|s| s.mini_collapsed = false).unwrap();
        assert!(!file.exists());

        let saved = store.update(|s| s.mini_collapsed = true).unwrap();

        assert_eq!(ShellSettingsStore::load(file.clone()).get(), saved);
        assert!(!file.with_extension("json.tmp").exists());
    }
}

use crate::models::live_probe::{LiveProbeConfig, LiveProbeState, ProbeProtocol};
use std::collections::HashSet;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::sync::{PoisonError, RwLock};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum LiveProbeConfigError {
    #[error("Invalid beacon {0}")]
    InvalidBeacon(String),

    #[error("{0}")]
    Io(#[from] std::io::Error),

    #[error("{0}")]
    Json(#[from] serde_json::Error),
}

pub fn validate(config: &LiveProbeConfig) -> Result<(), LiveProbeConfigError> {
    let mut ids = HashSet::new();
    for beacon in &config.beacons {
        let usable = !beacon.id.trim().is_empty()
            && !beacon.host.trim().is_empty()
            && (beacon.protocol == ProbeProtocol::Icmp || beacon.port.is_some_and(|p| p > 0));
        if !usable || !ids.insert(beacon.id.as_str()) {
            return Err(LiveProbeConfigError::InvalidBeacon(beacon.id.clone()));
        }
    }
    Ok(())
}

pub struct LiveProbeService {
    path: PathBuf,
    config: RwLock<LiveProbeConfig>,
    state: RwLock<LiveProbeState>,
}

impl LiveProbeService {
    pub fn load(path: PathBuf) -> Self {
        let config = read_config(&path);
        Self {
            path,
            config: RwLock::new(config),
            state: RwLock::new(LiveProbeState::default()),
        }
    }

    pub fn config(&self) -> LiveProbeConfig {
        self.config
            .read()
            .unwrap_or_else(PoisonError::into_inner)
            .clone()
    }

    pub fn set_config(
        &self,
        config: LiveProbeConfig,
    ) -> Result<LiveProbeConfig, LiveProbeConfigError> {
        validate(&config)?;
        let mut current = self.config.write().unwrap_or_else(PoisonError::into_inner);
        if let Some(dir) = self.path.parent() {
            std::fs::create_dir_all(dir)?;
        }
        let staging = self.path.with_extension("json.tmp");
        std::fs::write(&staging, serde_json::to_vec_pretty(&config)?)?;
        std::fs::rename(&staging, &self.path)?;
        *current = config.clone();
        Ok(config)
    }

    pub fn state(&self) -> LiveProbeState {
        self.state
            .read()
            .unwrap_or_else(PoisonError::into_inner)
            .clone()
    }

    pub fn publish(&self, state: LiveProbeState) {
        *self.state.write().unwrap_or_else(PoisonError::into_inner) = state;
    }

    pub fn clear(&self, session_id: i64) {
        let mut state = self.state.write().unwrap_or_else(PoisonError::into_inner);
        if state.session_id == Some(session_id) {
            *state = LiveProbeState::default();
        }
    }
}

fn read_config(path: &Path) -> LiveProbeConfig {
    let text = match std::fs::read_to_string(path) {
        Ok(text) => text,
        Err(e) if e.kind() == ErrorKind::NotFound => return LiveProbeConfig::default(),
        Err(e) => {
            log::warn!(
                "Could not read {}: {}, using the default probes",
                path.display(),
                e
            );
            return LiveProbeConfig::default();
        }
    };
    match serde_json::from_str::<LiveProbeConfig>(&text) {
        Ok(config) if validate(&config).is_ok() => config,
        Ok(_) | Err(_) => {
            log::warn!(
                "Invalid live probe settings in {}, using the default probes",
                path.display()
            );
            LiveProbeConfig::default()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_file_uses_the_default_table() {
        let dir = tempfile::tempdir().unwrap();
        let service = LiveProbeService::load(dir.path().join("live_probe.json"));
        assert_eq!(service.config(), LiveProbeConfig::default());
    }

    #[test]
    fn saved_choices_survive_a_restart() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("live_probe.json");
        let service = LiveProbeService::load(path.clone());
        let mut config = service.config();
        config.region = false;
        config
            .beacons
            .retain(|beacon| beacon.id != "gamelift-eu-west-3");
        service.set_config(config.clone()).unwrap();

        assert_eq!(LiveProbeService::load(path.clone()).config(), config);
        std::fs::write(&path, r#"{"floor":false}"#).unwrap();
        let partial = LiveProbeService::load(path).config();
        assert!(!partial.floor && partial.enabled && partial.region);
        assert_eq!(partial.beacons, LiveProbeConfig::default().beacons);
    }

    #[test]
    fn broken_beacons_are_rejected() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("live_probe.json");
        let service = LiveProbeService::load(path.clone());
        let mut config = service.config();
        config.beacons[0].port = None;
        assert!(service.set_config(config).is_err());

        let mut config = service.config();
        let copy = config.beacons[1].clone();
        config.beacons.push(copy);
        assert!(service.set_config(config).is_err());
        assert!(!path.exists());

        std::fs::write(&path, "{not json").unwrap();
        assert_eq!(
            LiveProbeService::load(path).config(),
            LiveProbeConfig::default()
        );
    }
}

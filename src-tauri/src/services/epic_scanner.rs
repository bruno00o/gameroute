use crate::db::get_game_repository;
use crate::models::game_library::{NewGame, ScanResult};
use crate::services::scanner_utils::resolve_executable_name;
use serde::Deserialize;
use std::path::PathBuf;

#[derive(Debug)]
pub enum EpicScanError {
    NotInstalled,
    IoError(String),
    RepositoryNotInitialized,
}

impl std::fmt::Display for EpicScanError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            EpicScanError::NotInstalled => write!(f, "Epic Games Store not found"),
            EpicScanError::IoError(msg) => write!(f, "Epic IO error: {}", msg),
            EpicScanError::RepositoryNotInitialized => {
                write!(f, "Game repository not initialized")
            }
        }
    }
}

impl std::error::Error for EpicScanError {}

#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
struct EpicManifest {
    app_name: String,
    display_name: String,
    install_location: String,
    launch_executable: Option<String>,
    #[serde(default)]
    b_is_incomplete_install: bool,
}

fn get_manifests_dir() -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        let path =
            PathBuf::from(r"C:\ProgramData\Epic\EpicGamesLauncher\Data\Manifests");
        if path.is_dir() {
            return Some(path);
        }
        None
    }

    #[cfg(not(target_os = "windows"))]
    {
        // Epic Games Store is Windows-only (discontinued on macOS)
        None
    }
}

pub async fn scan_epic_games() -> Result<ScanResult, EpicScanError> {
    let repo = get_game_repository().ok_or(EpicScanError::RepositoryNotInitialized)?;

    let manifests_dir = get_manifests_dir().ok_or(EpicScanError::NotInstalled)?;

    let entries = std::fs::read_dir(&manifests_dir)
        .map_err(|e| EpicScanError::IoError(e.to_string()))?;

    let mut games_found: u32 = 0;
    let mut games_added: u32 = 0;
    let mut games_updated: u32 = 0;

    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("item") {
            continue;
        }

        let content = match std::fs::read_to_string(&path) {
            Ok(c) => c,
            Err(e) => {
                log::debug!("Failed to read Epic manifest {:?}: {}", path, e);
                continue;
            }
        };

        let manifest: EpicManifest = match serde_json::from_str(&content) {
            Ok(m) => m,
            Err(e) => {
                log::debug!("Failed to parse Epic manifest {:?}: {}", path, e);
                continue;
            }
        };

        // Skip incomplete installs and entries with empty display names
        if manifest.b_is_incomplete_install || manifest.display_name.trim().is_empty() {
            continue;
        }

        games_found += 1;

        // Build full executable path
        let executable_path = if let Some(ref launch_exe) = manifest.launch_executable {
            let full_path = PathBuf::from(&manifest.install_location).join(launch_exe);
            Some(full_path.to_string_lossy().to_string())
        } else {
            Some(manifest.install_location.clone())
        };

        let executable_name = executable_path
            .as_deref()
            .map(resolve_executable_name)
            .unwrap_or_else(|| manifest.display_name.clone());

        let new_game = NewGame {
            name: manifest.display_name,
            executable_path,
            executable_name,
            source: "epic".to_string(),
            source_id: Some(manifest.app_name),
            icon_url: None,
            auto_detected: true,
        };

        match repo.upsert_game(&new_game).await {
            Ok((_id, inserted)) => {
                if inserted {
                    games_added += 1;
                } else {
                    games_updated += 1;
                }
            }
            Err(e) => {
                log::error!("Failed to upsert Epic game {}: {}", new_game.name, e);
            }
        }
    }

    log::info!(
        "Epic scan complete: {} found, {} added, {} updated",
        games_found,
        games_added,
        games_updated
    );

    Ok(ScanResult {
        games_found,
        games_added,
        games_updated,
    })
}

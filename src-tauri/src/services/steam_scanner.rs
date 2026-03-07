use crate::db::get_game_repository;
use crate::models::game_library::{NewGame, ScanResult};
use crate::services::scanner_utils::scan_executables_in_dir;

#[derive(Debug)]
pub enum SteamScanError {
    NotInstalled(String),
    LibraryError(String),
    RepositoryNotInitialized,
}

impl std::fmt::Display for SteamScanError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            SteamScanError::NotInstalled(msg) => write!(f, "Steam not found: {}", msg),
            SteamScanError::LibraryError(msg) => write!(f, "Steam library error: {}", msg),
            SteamScanError::RepositoryNotInitialized => {
                write!(f, "Game repository not initialized")
            }
        }
    }
}

impl std::error::Error for SteamScanError {}

pub async fn scan_steam_games() -> Result<ScanResult, SteamScanError> {
    let repo = get_game_repository().ok_or(SteamScanError::RepositoryNotInitialized)?;

    // Read Steam libraries and parse manifests on a blocking thread
    let parsed_games = tokio::task::spawn_blocking(move || {
        let steam_dir = steamlocate::SteamDir::locate()
            .map_err(|e| SteamScanError::NotInstalled(e.to_string()))?;

        let libraries = steam_dir
            .libraries()
            .map_err(|e| SteamScanError::LibraryError(e.to_string()))?;

        let mut games = Vec::new();

        for library_result in libraries {
            let library = match library_result {
                Ok(lib) => lib,
                Err(e) => {
                    log::warn!("Failed to read Steam library: {}", e);
                    continue;
                }
            };

            log::info!("Scanning Steam library: {}", library.path().display());

            for app_result in library.apps() {
                let app = match app_result {
                    Ok(a) => a,
                    Err(e) => {
                        log::debug!("Failed to read Steam app manifest: {}", e);
                        continue;
                    }
                };

                let name = match &app.name {
                    Some(n) if !n.is_empty() => n.clone(),
                    _ => continue,
                };

                let app_id = app.app_id;

                if name.starts_with("Steamworks")
                    || name.starts_with("Proton ")
                    || name.starts_with("Steam Linux Runtime")
                {
                    continue;
                }

                let install_dir = app.install_dir.to_string();
                let install_path = library.path().join("common").join(&install_dir);

                let executable_name = scan_executables_in_dir(&install_path, &name);
                log::debug!(
                    "Steam game '{}' (appid {}) -> executable: {}",
                    name, app_id, executable_name
                );

                let icon_url = format!(
                    "https://cdn.cloudflare.steamstatic.com/steam/apps/{}/header.jpg",
                    app_id
                );

                games.push(NewGame {
                    name,
                    executable_path: Some(install_path.to_string_lossy().to_string()),
                    executable_name,
                    source: "steam".to_string(),
                    source_id: Some(app_id.to_string()),
                    icon_url: Some(icon_url),
                    auto_detected: true,
                });
            }
        }
        Ok::<_, SteamScanError>(games)
    })
    .await
    .map_err(|e| SteamScanError::LibraryError(e.to_string()))??;

    let games_found: u32 = parsed_games.len() as u32;
    let mut games_added: u32 = 0;
    let mut games_updated: u32 = 0;

    for new_game in &parsed_games {
        match repo.upsert_game(new_game).await {
            Ok((_id, inserted)) => {
                if inserted {
                    games_added += 1;
                } else {
                    games_updated += 1;
                }
            }
            Err(e) => {
                log::error!(
                    "Failed to upsert Steam game {} : {}",
                    new_game.name,
                    e
                );
            }
        }
    }

    log::info!(
        "Steam scan complete: {} found, {} added, {} updated",
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

use crate::db::get_game_repository;
use crate::models::game_library::{NewGame, ScanResult};
use crate::services::scanner_utils::scan_executables_in_dir;
use std::path::PathBuf;

#[derive(Debug)]
pub enum RiotScanError {
    NotInstalled,
    IoError(String),
    RepositoryNotInitialized,
}

impl std::fmt::Display for RiotScanError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            RiotScanError::NotInstalled => write!(f, "Riot Games not found"),
            RiotScanError::IoError(msg) => write!(f, "Riot IO error: {}", msg),
            RiotScanError::RepositoryNotInitialized => {
                write!(f, "Game repository not initialized")
            }
        }
    }
}

impl std::error::Error for RiotScanError {}

struct RiotGameDef {
    name: &'static str,
    product_id: &'static str,
    /// Subdirectory under `product_install_full_path` that contains the main executable.
    /// The YAML path already includes the `live` component (e.g. `C:/Riot Games/VALORANT/live`).
    exe_subdir: &'static str,
}

/// Known Riot Games titles with their metadata folder names and executable locations.
const RIOT_GAMES: &[RiotGameDef] = &[
    RiotGameDef {
        name: "VALORANT",
        product_id: "valorant.live",
        exe_subdir: "ShooterGame\\Binaries\\Win64",
    },
    RiotGameDef {
        name: "League of Legends",
        product_id: "league_of_legends.live",
        exe_subdir: ".",
    },
    RiotGameDef {
        name: "Legends of Runeterra",
        product_id: "bacon.live",
        exe_subdir: ".",
    },
    RiotGameDef {
        name: "2XKO",
        product_id: "lion.live",
        exe_subdir: ".",
    },
];

fn get_metadata_dir() -> Option<PathBuf> {
    let path = PathBuf::from(r"C:\ProgramData\Riot Games\Metadata");
    if path.is_dir() {
        return Some(path);
    }
    None
}

/// Extract `product_install_full_path` from a Riot product_settings.yaml file.
///
/// The YAML is simple key-value; we just find the line and extract the value
/// without pulling in a full YAML parser.
fn extract_install_path(yaml_content: &str) -> Option<String> {
    for line in yaml_content.lines() {
        let trimmed = line.trim();
        if let Some(value) = trimmed.strip_prefix("product_install_full_path:") {
            let path = value.trim().trim_matches('"').trim_matches('\'');
            if !path.is_empty() {
                // Riot uses forward slashes in paths, normalize to backslashes
                return Some(path.replace('/', "\\"));
            }
        }
    }
    None
}

pub async fn scan_riot_games() -> Result<ScanResult, RiotScanError> {
    let repo = get_game_repository().ok_or(RiotScanError::RepositoryNotInitialized)?;

    let metadata_dir = get_metadata_dir().ok_or(RiotScanError::NotInstalled)?;

    let parsed_games = tokio::task::spawn_blocking(move || {
        let mut games = Vec::new();

        for def in RIOT_GAMES {
            let product_dir = metadata_dir.join(def.product_id);
            let settings_file = product_dir.join(format!("{}.product_settings.yaml", def.product_id));

            if !settings_file.exists() {
                log::debug!("Riot game '{}' not installed (no settings file)", def.name);
                continue;
            }

            let content = match std::fs::read_to_string(&settings_file) {
                Ok(c) => c,
                Err(e) => {
                    log::warn!(
                        "Failed to read Riot settings for '{}': {}",
                        def.name,
                        e
                    );
                    continue;
                }
            };

            let install_path = match extract_install_path(&content) {
                Some(p) => PathBuf::from(p),
                None => {
                    log::warn!(
                        "Could not extract install path for Riot game '{}'",
                        def.name
                    );
                    continue;
                }
            };

            let exe_dir = install_path.join(def.exe_subdir);
            let executable_name = if exe_dir.is_dir() {
                scan_executables_in_dir(&exe_dir, def.name)
            } else {
                log::debug!(
                    "Riot game '{}' exe dir not found: {}",
                    def.name,
                    exe_dir.display()
                );
                continue;
            };

            log::debug!(
                "Riot game '{}' ({}) -> executable: {}",
                def.name,
                def.product_id,
                executable_name
            );

            games.push(NewGame {
                name: def.name.to_string(),
                executable_path: Some(exe_dir.to_string_lossy().to_string()),
                executable_name,
                source: "riot".to_string(),
                source_id: Some(def.product_id.to_string()),
                icon_url: None,
                auto_detected: true,
            });
        }

        Ok::<_, RiotScanError>(games)
    })
    .await
    .map_err(|e| RiotScanError::IoError(e.to_string()))??;

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
                log::error!("Failed to upsert Riot game {}: {}", new_game.name, e);
            }
        }
    }

    log::info!(
        "Riot scan complete: {} found, {} added, {} updated",
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_install_path_quoted() {
        let yaml = r#"
product_install_full_path: "C:/Riot Games/VALORANT"
product_install_root: "C:/Riot Games"
"#;
        let path = extract_install_path(yaml).unwrap();
        assert_eq!(path, r"C:\Riot Games\VALORANT");
    }

    #[test]
    fn test_extract_install_path_unquoted() {
        let yaml = "product_install_full_path: C:/Riot Games/League of Legends\n";
        let path = extract_install_path(yaml).unwrap();
        assert_eq!(path, r"C:\Riot Games\League of Legends");
    }

    #[test]
    fn test_extract_install_path_missing() {
        let yaml = "some_other_key: value\n";
        assert!(extract_install_path(yaml).is_none());
    }

    #[test]
    fn test_extract_install_path_empty_value() {
        let yaml = "product_install_full_path: \n";
        assert!(extract_install_path(yaml).is_none());
    }
}

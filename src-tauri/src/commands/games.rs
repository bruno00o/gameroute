use crate::db::get_game_repository;
use crate::models::game_library::{GameListItem, NewGame, ScanResult};
use crate::services::epic_scanner;
use crate::services::scanner_utils::resolve_executable_name;
use crate::services::steam_scanner;

#[derive(Debug, Clone, serde::Serialize)]
pub struct GameCommandError {
    pub code: String,
    pub message: String,
}

impl GameCommandError {
    fn repo_not_initialized() -> Self {
        Self {
            code: "REPO_NOT_INITIALIZED".to_string(),
            message: "Game repository not initialized".to_string(),
        }
    }

    fn validation(msg: &str) -> Self {
        Self {
            code: "VALIDATION_ERROR".to_string(),
            message: msg.to_string(),
        }
    }

    fn internal(msg: String) -> Self {
        Self {
            code: "INTERNAL_ERROR".to_string(),
            message: msg,
        }
    }
}

#[tauri::command]
pub async fn scan_steam_games() -> Result<ScanResult, GameCommandError> {
    log::info!("Starting Steam scan...");
    steam_scanner::scan_steam_games()
        .await
        .map_err(|e| GameCommandError::internal(e.to_string()))
}

#[tauri::command]
pub async fn get_games(limit: i32, offset: i32) -> Result<Vec<GameListItem>, GameCommandError> {
    let repo = get_game_repository().ok_or_else(GameCommandError::repo_not_initialized)?;

    let limit = limit.clamp(1, 100);
    let offset = offset.max(0);

    repo.get_games(limit, offset)
        .await
        .map_err(|e| GameCommandError::internal(e.to_string()))
}

#[tauri::command]
pub async fn get_game_count() -> Result<i64, GameCommandError> {
    let repo = get_game_repository().ok_or_else(GameCommandError::repo_not_initialized)?;

    repo.get_game_count()
        .await
        .map_err(|e| GameCommandError::internal(e.to_string()))
}

#[tauri::command]
pub async fn add_manual_game(
    name: String,
    executable_path: String,
) -> Result<i64, GameCommandError> {
    let repo = get_game_repository().ok_or_else(GameCommandError::repo_not_initialized)?;

    let name = name.trim().to_string();
    if name.is_empty() || name.len() > 255 {
        return Err(GameCommandError::validation(
            "Game name must be between 1 and 255 characters",
        ));
    }

    let path = executable_path.trim().to_string();
    if path.is_empty() {
        return Err(GameCommandError::validation(
            "Executable path must not be empty",
        ));
    }

    let executable_name = resolve_executable_name(&path);

    let new_game = NewGame {
        name,
        executable_path: Some(path),
        executable_name,
        source: "manual".to_string(),
        source_id: None,
        icon_url: None,
        auto_detected: false,
    };

    let (id, _) = repo
        .upsert_game(&new_game)
        .await
        .map_err(|e| GameCommandError::internal(e.to_string()))?;

    log::info!("Manual game added: {} (id: {})", new_game.name, id);
    Ok(id)
}

#[tauri::command]
pub async fn remove_game(id: i64) -> Result<(), GameCommandError> {
    let repo = get_game_repository().ok_or_else(GameCommandError::repo_not_initialized)?;

    repo.delete_game(id)
        .await
        .map_err(|e| GameCommandError::internal(e.to_string()))
}

#[tauri::command]
pub async fn toggle_game_monitored(id: i64, monitored: bool) -> Result<(), GameCommandError> {
    let repo = get_game_repository().ok_or_else(GameCommandError::repo_not_initialized)?;

    repo.set_monitored(id, monitored)
        .await
        .map_err(|e| GameCommandError::internal(e.to_string()))
}

#[tauri::command]
pub async fn search_games(
    query: String,
    limit: i32,
    offset: i32,
) -> Result<Vec<GameListItem>, GameCommandError> {
    let repo = get_game_repository().ok_or_else(GameCommandError::repo_not_initialized)?;

    let limit = limit.clamp(1, 100);
    let offset = offset.max(0);

    repo.search_games(&query, limit, offset)
        .await
        .map_err(|e| GameCommandError::internal(e.to_string()))
}

#[tauri::command]
pub async fn search_game_count(query: String) -> Result<i64, GameCommandError> {
    let repo = get_game_repository().ok_or_else(GameCommandError::repo_not_initialized)?;

    repo.search_game_count(&query)
        .await
        .map_err(|e| GameCommandError::internal(e.to_string()))
}

#[tauri::command]
pub async fn scan_epic_games() -> Result<ScanResult, GameCommandError> {
    log::info!("Starting Epic Games scan...");
    epic_scanner::scan_epic_games()
        .await
        .map_err(|e| GameCommandError::internal(e.to_string()))
}

#[tauri::command]
pub async fn scan_all_games() -> Result<ScanResult, GameCommandError> {
    log::info!("Starting full game scan (Steam + Epic)...");
    let mut result = ScanResult::default();

    match steam_scanner::scan_steam_games().await {
        Ok(r) => result.merge(&r),
        Err(e) => log::warn!("Steam scan failed: {}", e),
    }

    match epic_scanner::scan_epic_games().await {
        Ok(r) => result.merge(&r),
        Err(e) => log::warn!("Epic scan failed: {}", e),
    }

    log::info!(
        "Full scan complete: {} found, {} added, {} updated",
        result.games_found,
        result.games_added,
        result.games_updated
    );

    Ok(result)
}


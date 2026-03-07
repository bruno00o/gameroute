use serde::{Deserialize, Serialize};

/// Full game row from the database.
#[derive(Debug, Clone, sqlx::FromRow, Serialize, Deserialize)]
pub struct Game {
    pub id: i64,
    pub name: String,
    pub executable_path: Option<String>,
    pub executable_name: String,
    pub source: String,
    pub source_id: Option<String>,
    pub icon_url: Option<String>,
    pub auto_detected: bool,
    pub monitored: bool,
    pub installed_at: Option<String>,
    pub last_played_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

/// Lightweight view for the game list page.
#[derive(Debug, Clone, sqlx::FromRow, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GameListItem {
    pub id: i64,
    pub name: String,
    pub executable_name: String,
    pub source: String,
    pub icon_url: Option<String>,
    pub monitored: bool,
    pub last_played_at: Option<String>,
    pub session_count: i32,
    pub total_play_time_secs: i64,
}

/// Minimal struct used by GameDetector for process matching.
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct MonitoredGameEntry {
    pub id: i64,
    pub name: String,
    pub executable_name: String,
    pub icon_url: Option<String>,
}

/// Data required to insert a new game.
pub struct NewGame {
    pub name: String,
    pub executable_path: Option<String>,
    pub executable_name: String,
    pub source: String,
    pub source_id: Option<String>,
    pub icon_url: Option<String>,
    pub auto_detected: bool,
}

/// Result of a game scan operation.
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanResult {
    pub games_found: u32,
    pub games_added: u32,
    pub games_updated: u32,
}

impl ScanResult {
    /// Merge another scan result into this one by summing all fields.
    pub fn merge(&mut self, other: &ScanResult) {
        self.games_found += other.games_found;
        self.games_added += other.games_added;
        self.games_updated += other.games_updated;
    }
}

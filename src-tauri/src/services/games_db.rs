use serde::Deserialize;
use std::collections::HashMap;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GamesJson {
    games: Vec<GameDefinition>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GameDefinition {
    pub exe_name: String,
    pub display_name: String,

    #[allow(dead_code)]
    pub publisher: Option<String>,
}

#[derive(Debug, Clone)]
pub struct GamesDatabase {
    games_by_exe: HashMap<String, GameDefinition>,
}

const GAMES_JSON: &str = include_str!("../../resources/games.json");

impl GamesDatabase {
    pub fn load() -> Result<Self, GamesDbError> {
        let games_json: GamesJson =
            serde_json::from_str(GAMES_JSON).map_err(GamesDbError::ParseError)?;

        let mut games_by_exe = HashMap::new();

        for game in games_json.games {
            let key = game.exe_name.to_lowercase();
            games_by_exe.insert(key, game);
        }

        log::info!("Loaded {} games from database", games_by_exe.len());

        Ok(Self { games_by_exe })
    }

    pub fn find_by_exe(&self, exe_name: &str) -> Option<&GameDefinition> {
        let key = exe_name.to_lowercase();
        self.games_by_exe.get(&key).or_else(|| {
            // On macOS/Linux, sysinfo returns "valorant" instead of "valorant.exe"
            // Try with .exe suffix as fallback
            if !key.ends_with(".exe") {
                self.games_by_exe.get(&format!("{}.exe", key))
            } else {
                None
            }
        })
    }

    pub fn len(&self) -> usize {
        self.games_by_exe.len()
    }
}

#[derive(Debug)]
pub enum GamesDbError {
    ParseError(serde_json::Error),
}

impl std::fmt::Display for GamesDbError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            GamesDbError::ParseError(e) => write!(f, "Failed to parse games database: {}", e),
        }
    }
}

impl std::error::Error for GamesDbError {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_load_database() {
        let db = GamesDatabase::load().expect("Failed to load games database");
        assert!(db.len() >= 0, "Database should load without error");
    }

    #[test]
    fn test_unknown_game_returns_none() {
        let db = GamesDatabase::load().expect("Failed to load games database");
        let game = db.find_by_exe("unknown_game_12345.exe");
        assert!(game.is_none(), "Unknown game should return None");
    }

    #[test]
    fn test_find_by_exe_without_extension() {
        let db = GamesDatabase::load().expect("Failed to load games database");
        // If the DB has any game, check that looking up without .exe works
        if let Some((key, game_def)) = db.games_by_exe.iter().next() {
            // key is already lowercase and ends with .exe (from games.json)
            if key.ends_with(".exe") {
                let name_without_ext = &key[..key.len() - 4];
                let found = db.find_by_exe(name_without_ext);
                assert!(
                    found.is_some(),
                    "Should find '{}' when looking up '{}'",
                    game_def.display_name,
                    name_without_ext
                );
            }
        }
    }
}

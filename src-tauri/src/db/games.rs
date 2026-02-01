use crate::db::DbError;
use crate::models::game_library::{GameListItem, MonitoredGameEntry, NewGame};
use sqlx::sqlite::SqlitePool;
use std::sync::{Arc, OnceLock};

pub struct GameRepository {
    pool: SqlitePool,
}

impl GameRepository {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }

    /// Insert or update a game by (source, source_id).
    /// Returns (id, was_inserted).
    pub async fn upsert_game(&self, game: &NewGame) -> Result<(i64, bool), DbError> {
        let now = chrono::Utc::now().to_rfc3339();

        // Try to find existing game by source + source_id
        if let Some(ref source_id) = game.source_id {
            let existing: Option<(i64,)> =
                sqlx::query_as("SELECT id FROM games WHERE source = $1 AND source_id = $2")
                    .bind(&game.source)
                    .bind(source_id)
                    .fetch_optional(&self.pool)
                    .await?;

            if let Some((id,)) = existing {
                sqlx::query(
                    "UPDATE games SET name = $1, executable_path = $2, executable_name = $3, icon_url = $4, updated_at = $5 WHERE id = $6",
                )
                .bind(&game.name)
                .bind(&game.executable_path)
                .bind(&game.executable_name)
                .bind(&game.icon_url)
                .bind(&now)
                .bind(id)
                .execute(&self.pool)
                .await?;

                return Ok((id, false));
            }
        }

        let result = sqlx::query(
            "INSERT INTO games (name, executable_path, executable_name, source, source_id, icon_url, auto_detected, monitored, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, 1, $8, $8)",
        )
        .bind(&game.name)
        .bind(&game.executable_path)
        .bind(&game.executable_name)
        .bind(&game.source)
        .bind(&game.source_id)
        .bind(&game.icon_url)
        .bind(game.auto_detected)
        .bind(&now)
        .execute(&self.pool)
        .await?;

        Ok((result.last_insert_rowid(), true))
    }

    pub async fn get_games(&self, limit: i32, offset: i32) -> Result<Vec<GameListItem>, DbError> {
        sqlx::query_as::<_, GameListItem>(
            "SELECT
                g.id, g.name, g.executable_name, g.source, g.icon_url,
                g.monitored, g.last_played_at,
                COALESCE(stats.session_count, 0) as session_count,
                COALESCE(stats.total_play_time_secs, 0) as total_play_time_secs
             FROM games g
             LEFT JOIN (
                 SELECT game_name,
                        COUNT(*) as session_count,
                        CAST(SUM(
                            CASE WHEN ended_at IS NOT NULL
                            THEN (julianday(ended_at) - julianday(started_at)) * 86400
                            ELSE 0 END
                        ) AS INTEGER) as total_play_time_secs
                 FROM sessions
                 GROUP BY game_name
             ) stats ON g.name = stats.game_name
             ORDER BY g.name ASC
             LIMIT $1 OFFSET $2",
        )
        .bind(limit)
        .bind(offset)
        .fetch_all(&self.pool)
        .await
        .map_err(Into::into)
    }

    pub async fn get_game_count(&self) -> Result<i64, DbError> {
        let row: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM games")
            .fetch_one(&self.pool)
            .await?;

        Ok(row.0)
    }

    pub async fn get_monitored_games(&self) -> Result<Vec<MonitoredGameEntry>, DbError> {
        sqlx::query_as::<_, MonitoredGameEntry>(
            "SELECT id, name, executable_name, icon_url FROM games WHERE monitored = 1",
        )
        .fetch_all(&self.pool)
        .await
        .map_err(Into::into)
    }

    pub async fn set_monitored(&self, id: i64, monitored: bool) -> Result<(), DbError> {
        let now = chrono::Utc::now().to_rfc3339();
        sqlx::query("UPDATE games SET monitored = $1, updated_at = $2 WHERE id = $3")
            .bind(monitored)
            .bind(&now)
            .bind(id)
            .execute(&self.pool)
            .await?;

        Ok(())
    }

    pub async fn delete_game(&self, id: i64) -> Result<(), DbError> {
        let result = sqlx::query("DELETE FROM games WHERE id = $1")
            .bind(id)
            .execute(&self.pool)
            .await?;

        if result.rows_affected() == 0 {
            log::warn!("Game {} not found for deletion", id);
        } else {
            log::info!("Game {} deleted", id);
        }

        Ok(())
    }

    pub async fn update_last_played(&self, id: i64) -> Result<(), DbError> {
        let now = chrono::Utc::now().to_rfc3339();
        sqlx::query("UPDATE games SET last_played_at = $1, updated_at = $1 WHERE id = $2")
            .bind(&now)
            .bind(id)
            .execute(&self.pool)
            .await?;

        Ok(())
    }

    pub async fn search_games(
        &self,
        query: &str,
        limit: i32,
        offset: i32,
    ) -> Result<Vec<GameListItem>, DbError> {
        let pattern = format!("%{}%", query);
        sqlx::query_as::<_, GameListItem>(
            "SELECT
                g.id, g.name, g.executable_name, g.source, g.icon_url,
                g.monitored, g.last_played_at,
                COALESCE(stats.session_count, 0) as session_count,
                COALESCE(stats.total_play_time_secs, 0) as total_play_time_secs
             FROM games g
             LEFT JOIN (
                 SELECT game_name,
                        COUNT(*) as session_count,
                        CAST(SUM(
                            CASE WHEN ended_at IS NOT NULL
                            THEN (julianday(ended_at) - julianday(started_at)) * 86400
                            ELSE 0 END
                        ) AS INTEGER) as total_play_time_secs
                 FROM sessions
                 GROUP BY game_name
             ) stats ON g.name = stats.game_name
             WHERE g.name LIKE $1 OR g.executable_name LIKE $1
             ORDER BY g.name ASC
             LIMIT $2 OFFSET $3",
        )
        .bind(&pattern)
        .bind(limit)
        .bind(offset)
        .fetch_all(&self.pool)
        .await
        .map_err(Into::into)
    }

    pub async fn search_game_count(&self, query: &str) -> Result<i64, DbError> {
        let pattern = format!("%{}%", query);
        let row: (i64,) = sqlx::query_as(
            "SELECT COUNT(*) FROM games WHERE name LIKE $1 OR executable_name LIKE $1",
        )
        .bind(&pattern)
        .fetch_one(&self.pool)
        .await?;

        Ok(row.0)
    }
}

static GAME_REPOSITORY: OnceLock<Arc<GameRepository>> = OnceLock::new();

pub fn init_game_repository(pool: SqlitePool) {
    let repo = GameRepository::new(pool);
    let _ = GAME_REPOSITORY.set(Arc::new(repo));
    log::info!("Game repository initialized");
}

pub fn get_game_repository() -> Option<Arc<GameRepository>> {
    GAME_REPOSITORY.get().cloned()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::create_test_pool;

    async fn create_test_repo() -> GameRepository {
        let pool = create_test_pool().await;
        GameRepository::new(pool)
    }

    #[tokio::test]
    async fn test_upsert_insert() {
        let repo = create_test_repo().await;

        let game = NewGame {
            name: "Counter-Strike 2".to_string(),
            executable_path: Some("/steam/cs2/cs2.exe".to_string()),
            executable_name: "cs2.exe".to_string(),
            source: "steam".to_string(),
            source_id: Some("730".to_string()),
            icon_url: None,
            auto_detected: true,
        };

        let (id, inserted) = repo.upsert_game(&game).await.unwrap();
        assert!(id > 0);
        assert!(inserted);
    }

    #[tokio::test]
    async fn test_upsert_update() {
        let repo = create_test_repo().await;

        let game = NewGame {
            name: "Counter-Strike 2".to_string(),
            executable_path: Some("/steam/cs2/cs2.exe".to_string()),
            executable_name: "cs2.exe".to_string(),
            source: "steam".to_string(),
            source_id: Some("730".to_string()),
            icon_url: None,
            auto_detected: true,
        };

        let (id1, inserted1) = repo.upsert_game(&game).await.unwrap();
        assert!(inserted1);

        let game2 = NewGame {
            name: "Counter-Strike 2 Updated".to_string(),
            executable_path: Some("/steam/cs2/cs2.exe".to_string()),
            executable_name: "cs2.exe".to_string(),
            source: "steam".to_string(),
            source_id: Some("730".to_string()),
            icon_url: None,
            auto_detected: true,
        };

        let (id2, inserted2) = repo.upsert_game(&game2).await.unwrap();
        assert!(!inserted2);
        assert_eq!(id1, id2);
    }

    #[tokio::test]
    async fn test_get_games_pagination() {
        let repo = create_test_repo().await;

        for i in 1..=5 {
            let game = NewGame {
                name: format!("Game {}", i),
                executable_path: None,
                executable_name: format!("game{}.exe", i),
                source: "manual".to_string(),
                source_id: None,
                icon_url: None,
                auto_detected: false,
            };
            repo.upsert_game(&game).await.unwrap();
        }

        let page1 = repo.get_games(2, 0).await.unwrap();
        assert_eq!(page1.len(), 2);

        let count = repo.get_game_count().await.unwrap();
        assert_eq!(count, 5);
    }

    #[tokio::test]
    async fn test_monitored_games() {
        let repo = create_test_repo().await;

        let game = NewGame {
            name: "Test Game".to_string(),
            executable_path: None,
            executable_name: "test.exe".to_string(),
            source: "manual".to_string(),
            source_id: None,
            icon_url: None,
            auto_detected: false,
        };
        let (id, _) = repo.upsert_game(&game).await.unwrap();

        let monitored = repo.get_monitored_games().await.unwrap();
        assert_eq!(monitored.len(), 1);

        repo.set_monitored(id, false).await.unwrap();
        let monitored = repo.get_monitored_games().await.unwrap();
        assert_eq!(monitored.len(), 0);
    }

    #[tokio::test]
    async fn test_delete_game() {
        let repo = create_test_repo().await;

        let game = NewGame {
            name: "To Delete".to_string(),
            executable_path: None,
            executable_name: "delete.exe".to_string(),
            source: "manual".to_string(),
            source_id: None,
            icon_url: None,
            auto_detected: false,
        };
        let (id, _) = repo.upsert_game(&game).await.unwrap();

        let count_before = repo.get_game_count().await.unwrap();
        assert_eq!(count_before, 1);

        repo.delete_game(id).await.unwrap();

        let count_after = repo.get_game_count().await.unwrap();
        assert_eq!(count_after, 0);
    }

    #[tokio::test]
    async fn test_search_games() {
        let repo = create_test_repo().await;

        for name in ["Valorant", "League of Legends", "Counter-Strike 2"] {
            let game = NewGame {
                name: name.to_string(),
                executable_path: None,
                executable_name: format!("{}.exe", name.to_lowercase().replace(' ', "_")),
                source: "manual".to_string(),
                source_id: None,
                icon_url: None,
                auto_detected: false,
            };
            repo.upsert_game(&game).await.unwrap();
        }

        let results = repo.search_games("val", 10, 0).await.unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].name, "Valorant");
    }
}

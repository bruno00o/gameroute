use crate::db::DbError;
use crate::models::dashboard::RecentSession;
use crate::models::session::{Session, SessionListItem};
use sqlx::sqlite::SqlitePool;
use std::sync::{Arc, OnceLock};

pub struct SessionRepository {
    pool: SqlitePool,
}

impl SessionRepository {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }

    pub async fn insert_session(&self, game_name: &str, started_at: &str) -> Result<i64, DbError> {
        let trimmed = game_name.trim();
        if trimmed.is_empty() {
            return Err(DbError::Validation(
                "game_name must not be empty".to_string(),
            ));
        }
        if trimmed.len() > 255 {
            return Err(DbError::Validation(
                "game_name must not exceed 255 characters".to_string(),
            ));
        }

        let result = sqlx::query("INSERT INTO sessions (game_name, started_at) VALUES ($1, $2)")
            .bind(trimmed)
            .bind(started_at)
            .execute(&self.pool)
            .await?;

        Ok(result.last_insert_rowid())
    }

    pub async fn update_session_ended(&self, id: i64, ended_at: &str) -> Result<(), DbError> {
        sqlx::query("UPDATE sessions SET ended_at = $1 WHERE id = $2")
            .bind(ended_at)
            .bind(id)
            .execute(&self.pool)
            .await?;

        Ok(())
    }

    pub async fn close_orphan_sessions(&self) -> Result<usize, DbError> {
        let result = sqlx::query(
            "UPDATE sessions SET ended_at = COALESCE(
                (SELECT MAX(ended_at) FROM ip_periods WHERE session_id = sessions.id),
                started_at
             ),
             end_estimated = 1
             WHERE ended_at IS NULL",
        )
        .execute(&self.pool)
        .await?;

        Ok(result.rows_affected() as usize)
    }

    pub async fn get_session(&self, id: i64) -> Result<Option<Session>, DbError> {
        sqlx::query_as::<_, Session>(
            "SELECT id, game_name, started_at, ended_at FROM sessions WHERE id = $1",
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await
        .map_err(Into::into)
    }

    #[allow(dead_code)] // Used by tests; production uses get_sessions_with_counts
    pub async fn get_all_sessions(&self, limit: i32, offset: i32) -> Result<Vec<Session>, DbError> {
        sqlx::query_as::<_, Session>(
            "SELECT id, game_name, started_at, ended_at
             FROM sessions
             ORDER BY started_at DESC
             LIMIT $1 OFFSET $2",
        )
        .bind(limit)
        .bind(offset)
        .fetch_all(&self.pool)
        .await
        .map_err(Into::into)
    }

    pub async fn get_sessions_with_counts(
        &self,
        limit: i32,
        offset: i32,
    ) -> Result<Vec<SessionListItem>, DbError> {
        sqlx::query_as::<_, SessionListItem>(
            "SELECT
                s.id,
                s.game_name,
                s.started_at,
                s.ended_at,
                COALESCE(ip_counts.unique_ip_count, 0) as unique_ip_count,
                COALESCE(tr_counts.traceroute_count, 0) as traceroute_count
             FROM sessions s
             LEFT JOIN (
                 SELECT session_id, COUNT(DISTINCT ip) as unique_ip_count
                 FROM ip_periods
                 GROUP BY session_id
             ) ip_counts ON ip_counts.session_id = s.id
             LEFT JOIN (
                 SELECT session_id, COUNT(*) as traceroute_count
                 FROM traceroutes
                 GROUP BY session_id
             ) tr_counts ON tr_counts.session_id = s.id
             ORDER BY s.started_at DESC
             LIMIT $1 OFFSET $2",
        )
        .bind(limit)
        .bind(offset)
        .fetch_all(&self.pool)
        .await
        .map_err(Into::into)
    }

    pub async fn delete_session(&self, id: i64) -> Result<(), DbError> {
        let result = sqlx::query("DELETE FROM sessions WHERE id = $1")
            .bind(id)
            .execute(&self.pool)
            .await?;

        if result.rows_affected() == 0 {
            log::warn!("Session {} not found for deletion", id);
        } else {
            log::info!("Session {} deleted (with cascade)", id);
        }

        Ok(())
    }

    /// Delete sessions older than `max_age_days`. Returns the number of deleted rows.
    pub async fn delete_old_sessions(&self, max_age_days: i64) -> Result<usize, DbError> {
        let result = sqlx::query(
            "DELETE FROM sessions WHERE ended_at IS NOT NULL AND julianday('now') - julianday(started_at) > $1",
        )
        .bind(max_age_days)
        .execute(&self.pool)
        .await?;

        let count = result.rows_affected() as usize;
        if count > 0 {
            log::info!(
                "Session retention: {} sessions deleted (older than {} days)",
                count,
                max_age_days
            );
        }
        Ok(count)
    }

    /// Find the ID of the most recent completed session for the same game,
    /// started before the given timestamp.
    pub async fn get_previous_session_id(
        &self,
        game_name: &str,
        before_started_at: &str,
    ) -> Result<Option<i64>, DbError> {
        let row: Option<(i64,)> = sqlx::query_as(
            "SELECT id FROM sessions
             WHERE game_name = $1 AND started_at < $2 AND ended_at IS NOT NULL
             ORDER BY started_at DESC
             LIMIT 1",
        )
        .bind(game_name)
        .bind(before_started_at)
        .fetch_optional(&self.pool)
        .await?;

        Ok(row.map(|r| r.0))
    }

    pub async fn search_sessions(
        &self,
        query: &str,
        limit: i32,
        offset: i32,
    ) -> Result<Vec<SessionListItem>, DbError> {
        let pattern = format!("%{}%", query);
        sqlx::query_as::<_, SessionListItem>(
            "SELECT
                s.id,
                s.game_name,
                s.started_at,
                s.ended_at,
                COALESCE(ip_counts.unique_ip_count, 0) as unique_ip_count,
                COALESCE(tr_counts.traceroute_count, 0) as traceroute_count
             FROM sessions s
             LEFT JOIN (
                 SELECT session_id, COUNT(DISTINCT ip) as unique_ip_count
                 FROM ip_periods
                 GROUP BY session_id
             ) ip_counts ON ip_counts.session_id = s.id
             LEFT JOIN (
                 SELECT session_id, COUNT(*) as traceroute_count
                 FROM traceroutes
                 GROUP BY session_id
             ) tr_counts ON tr_counts.session_id = s.id
             WHERE s.game_name LIKE $1
             ORDER BY s.started_at DESC
             LIMIT $2 OFFSET $3",
        )
        .bind(&pattern)
        .bind(limit)
        .bind(offset)
        .fetch_all(&self.pool)
        .await
        .map_err(Into::into)
    }

    pub async fn search_session_count(&self, query: &str) -> Result<i64, DbError> {
        let pattern = format!("%{}%", query);
        let row: (i64,) =
            sqlx::query_as("SELECT COUNT(*) FROM sessions WHERE game_name LIKE $1")
                .bind(&pattern)
                .fetch_one(&self.pool)
                .await?;
        Ok(row.0)
    }

    pub async fn get_session_count(&self) -> Result<i64, DbError> {
        let row: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM sessions")
            .fetch_one(&self.pool)
            .await?;

        Ok(row.0)
    }

    pub async fn get_dashboard_stats(&self) -> Result<(i64, i64, i64), DbError> {
        let row: (i64, i64, i64) = sqlx::query_as(
            "SELECT
                COUNT(*) as total_sessions,
                CAST(COALESCE(SUM(CASE WHEN ended_at IS NOT NULL
                    THEN (julianday(ended_at) - julianday(started_at)) * 86400
                    ELSE 0 END), 0) AS INTEGER) as total_play_time_secs,
                COUNT(DISTINCT game_name) as unique_games
             FROM sessions",
        )
        .fetch_one(&self.pool)
        .await?;

        Ok(row)
    }

    pub async fn get_recent_sessions(&self, limit: i32) -> Result<Vec<RecentSession>, DbError> {
        sqlx::query_as::<_, RecentSession>(
            "SELECT s.id, s.game_name, s.started_at, s.ended_at, g.icon_url
             FROM sessions s
             LEFT JOIN games g ON g.name = s.game_name
             ORDER BY s.started_at DESC
             LIMIT $1",
        )
        .bind(limit)
        .fetch_all(&self.pool)
        .await
        .map_err(Into::into)
    }
}

static SESSION_REPOSITORY: OnceLock<Arc<SessionRepository>> = OnceLock::new();

pub fn init_session_repository(pool: SqlitePool) {
    let repo = SessionRepository::new(pool);
    let _ = SESSION_REPOSITORY.set(Arc::new(repo));
    log::info!("Session repository initialized");
}

pub fn get_session_repository() -> Option<Arc<SessionRepository>> {
    SESSION_REPOSITORY.get().cloned()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::create_test_pool;
    use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
    use std::str::FromStr;

    async fn create_test_repo() -> SessionRepository {
        let pool = create_test_pool().await;
        SessionRepository::new(pool)
    }

    #[tokio::test]
    async fn test_insert_session() {
        let repo = create_test_repo().await;

        let id = repo
            .insert_session("Valorant", "2026-01-25T10:00:00Z")
            .await
            .expect("Failed to insert session");

        assert!(id > 0);

        let session = repo
            .get_session(id)
            .await
            .expect("Failed to get session")
            .expect("Session not found");

        assert_eq!(session.game_name, "Valorant");
        assert_eq!(session.started_at, "2026-01-25T10:00:00Z");
        assert!(session.ended_at.is_none());
    }

    #[tokio::test]
    async fn test_update_session_ended() {
        let repo = create_test_repo().await;

        let id = repo
            .insert_session("League of Legends", "2026-01-25T14:00:00Z")
            .await
            .unwrap();

        repo.update_session_ended(id, "2026-01-25T16:30:00Z")
            .await
            .unwrap();

        let session = repo.get_session(id).await.unwrap().unwrap();
        assert_eq!(session.ended_at, Some("2026-01-25T16:30:00Z".to_string()));
    }

    #[tokio::test]
    async fn test_close_orphan_sessions() {
        let repo = create_test_repo().await;

        let with_traffic = repo
            .insert_session("Valorant", "2026-01-25T10:00:00Z")
            .await
            .unwrap();
        let without_traffic = repo
            .insert_session("Valorant", "2026-01-25T12:00:00Z")
            .await
            .unwrap();
        let ended = repo
            .insert_session("Valorant", "2026-01-25T14:00:00Z")
            .await
            .unwrap();
        repo.update_session_ended(ended, "2026-01-25T15:00:00Z")
            .await
            .unwrap();

        for (started, finished) in [("10:00:05", "10:20:00"), ("10:30:00", "10:45:00")] {
            sqlx::query(
                "INSERT INTO ip_periods (session_id, ip, started_at, ended_at) VALUES ($1, '1.2.3.4', $2, $3)",
            )
            .bind(with_traffic)
            .bind(format!("2026-01-25T{started}Z"))
            .bind(format!("2026-01-25T{finished}Z"))
            .execute(&repo.pool)
            .await
            .unwrap();
        }

        assert_eq!(repo.close_orphan_sessions().await.unwrap(), 2);

        for (id, expected) in [
            (with_traffic, "2026-01-25T10:45:00Z"),
            (without_traffic, "2026-01-25T12:00:00Z"),
            (ended, "2026-01-25T15:00:00Z"),
        ] {
            let session = repo.get_session(id).await.unwrap().unwrap();
            assert_eq!(session.ended_at.as_deref(), Some(expected));
        }

        let estimated: Vec<(i64, bool)> =
            sqlx::query_as("SELECT id, end_estimated FROM sessions ORDER BY id")
                .fetch_all(&repo.pool)
                .await
                .unwrap();
        assert_eq!(
            estimated,
            vec![
                (with_traffic, true),
                (without_traffic, true),
                (ended, false)
            ]
        );
    }

    #[tokio::test]
    async fn test_migration_marks_sessions_closed_at_their_last_activity() {
        const END_ESTIMATED: i64 = 20261008000003;
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(SqliteConnectOptions::from_str("sqlite::memory:").unwrap())
            .await
            .unwrap();
        let all = sqlx::migrate!("./migrations");
        let mut before = sqlx::migrate!("./migrations");
        before.migrations = all
            .iter()
            .filter(|migration| migration.version < END_ESTIMATED)
            .cloned()
            .collect::<Vec<_>>()
            .into();
        before.run(&pool).await.unwrap();

        for (id, ended) in [
            (1, Some("2026-09-26T21:07:52.223646+00:00")),
            (2, Some("2026-09-26T21:54:04.807289700+00:00")),
            (3, Some("2026-09-27T10:00:00+00:00")),
            (4, None),
        ] {
            sqlx::query("INSERT INTO sessions (id, game_name, started_at, ended_at) VALUES ($1, 'VALORANT', $2, $3)")
                .bind(id)
                .bind(if id == 3 { "2026-09-27T10:00:00+00:00" } else { "2026-09-26T19:00:00+00:00" })
                .bind(ended)
                .execute(&pool)
                .await
                .unwrap();
        }
        for (session, ended) in [
            (1, "2026-09-26T21:07:52.223646+00:00"),
            (2, "2026-09-26T21:54:02.830193200+00:00"),
            (4, "2026-09-26T20:00:00+00:00"),
        ] {
            sqlx::query(
                "INSERT INTO ip_periods (session_id, ip, started_at, ended_at) VALUES ($1, '162.249.72.5', '2026-09-26T19:00:05+00:00', $2)",
            )
            .bind(session)
            .bind(ended)
            .execute(&pool)
            .await
            .unwrap();
        }

        all.run(&pool).await.unwrap();

        let rows: Vec<(i64, bool)> =
            sqlx::query_as("SELECT id, end_estimated FROM sessions ORDER BY id")
                .fetch_all(&pool)
                .await
                .unwrap();
        assert_eq!(rows, vec![(1, true), (2, false), (3, true), (4, false)]);
    }

    #[tokio::test]
    async fn test_get_session_not_found() {
        let repo = create_test_repo().await;

        let session = repo.get_session(999).await.unwrap();
        assert!(session.is_none());
    }

    #[tokio::test]
    async fn test_get_all_sessions_pagination() {
        let repo = create_test_repo().await;

        for i in 1..=5 {
            repo.insert_session(
                &format!("Game {}", i),
                &format!("2026-01-{:02}T10:00:00Z", i),
            )
            .await
            .unwrap();
        }

        let page1 = repo.get_all_sessions(2, 0).await.unwrap();
        assert_eq!(page1.len(), 2);

        assert_eq!(page1[0].game_name, "Game 5");
        assert_eq!(page1[1].game_name, "Game 4");

        let page2 = repo.get_all_sessions(2, 2).await.unwrap();
        assert_eq!(page2.len(), 2);
        assert_eq!(page2[0].game_name, "Game 3");
        assert_eq!(page2[1].game_name, "Game 2");

        let page3 = repo.get_all_sessions(2, 4).await.unwrap();
        assert_eq!(page3.len(), 1);
        assert_eq!(page3[0].game_name, "Game 1");
    }

    #[tokio::test]
    async fn test_delete_session() {
        let repo = create_test_repo().await;

        let id = repo
            .insert_session("CS:GO", "2026-01-25T20:00:00Z")
            .await
            .unwrap();

        assert!(repo.get_session(id).await.unwrap().is_some());

        repo.delete_session(id).await.unwrap();

        assert!(repo.get_session(id).await.unwrap().is_none());
    }

    #[tokio::test]
    async fn test_session_count() {
        let repo = create_test_repo().await;

        assert_eq!(repo.get_session_count().await.unwrap(), 0);

        repo.insert_session("Game 1", "2026-01-25T10:00:00Z")
            .await
            .unwrap();
        repo.insert_session("Game 2", "2026-01-25T11:00:00Z")
            .await
            .unwrap();

        assert_eq!(repo.get_session_count().await.unwrap(), 2);
    }

    #[tokio::test]
    async fn test_insert_session_empty_name_rejected() {
        let repo = create_test_repo().await;

        let result = repo.insert_session("", "2026-01-25T10:00:00Z").await;
        assert!(result.is_err());

        let result = repo.insert_session("   ", "2026-01-25T10:00:00Z").await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_insert_session_long_name_rejected() {
        let repo = create_test_repo().await;

        let long_name = "A".repeat(256);
        let result = repo
            .insert_session(&long_name, "2026-01-25T10:00:00Z")
            .await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_insert_session_trims_name() {
        let repo = create_test_repo().await;

        let id = repo
            .insert_session("  Valorant  ", "2026-01-25T10:00:00Z")
            .await
            .unwrap();

        let session = repo.get_session(id).await.unwrap().unwrap();
        assert_eq!(session.game_name, "Valorant");
    }
}

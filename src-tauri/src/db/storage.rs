use std::sync::{Arc, OnceLock};

use sqlx::sqlite::SqlitePool;

use crate::config::MATCH_MERGE_BACKUP_SUFFIX;
use crate::db::DbError;
use crate::models::settings::StorageStats;

pub struct StorageRepository {
    pool: SqlitePool,
}

impl StorageRepository {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }

    pub async fn get_stats(&self) -> Result<StorageStats, DbError> {
        let (database_bytes,): (i64,) = sqlx::query_as(
            "SELECT page_count * page_size FROM pragma_page_count(), pragma_page_size()",
        )
        .fetch_one(&self.pool)
        .await?;

        let (session_count, address_count): (i64, i64) = sqlx::query_as(
            "SELECT
                (SELECT COUNT(*) FROM sessions),
                (SELECT COUNT(DISTINCT ip) FROM ip_periods)",
        )
        .fetch_one(&self.pool)
        .await?;

        Ok(StorageStats {
            database_bytes,
            session_count,
            address_count,
            geolite_built_at: None,
        })
    }

    pub async fn delete_all_data(&self) -> Result<(), DbError> {
        let mut tx = self.pool.begin().await?;
        for table in [
            "hops",
            "traceroutes",
            "ip_periods",
            "sessions",
            "ip_metadata",
        ] {
            sqlx::query(&format!("DELETE FROM {table}"))
                .execute(&mut *tx)
                .await?;
        }
        tx.commit().await?;
        log::info!("All sessions and cached operators deleted");

        self.remove_backups().await?;

        for statement in ["VACUUM", "PRAGMA wal_checkpoint(TRUNCATE)"] {
            if let Err(e) = sqlx::query(statement).execute(&self.pool).await {
                log::warn!("{} after deleting all data failed: {}", statement, e);
            }
        }
        Ok(())
    }

    async fn remove_backups(&self) -> Result<(), DbError> {
        let (file,): (String,) =
            sqlx::query_as("SELECT file FROM pragma_database_list WHERE name = 'main'")
                .fetch_one(&self.pool)
                .await?;
        if file.is_empty() {
            return Ok(());
        }
        let backup = format!("{file}.{MATCH_MERGE_BACKUP_SUFFIX}");
        match std::fs::remove_file(&backup) {
            Ok(()) => log::info!("Removed database backup {}", backup),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(e.into()),
        }
        Ok(())
    }
}

static STORAGE_REPOSITORY: OnceLock<Arc<StorageRepository>> = OnceLock::new();

pub fn init_storage_repository(pool: SqlitePool) {
    let _ = STORAGE_REPOSITORY.set(Arc::new(StorageRepository::new(pool)));
}

pub fn get_storage_repository() -> Option<Arc<StorageRepository>> {
    STORAGE_REPOSITORY.get().cloned()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::create_test_pool;
    use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
    use std::str::FromStr;

    async fn seed(pool: &SqlitePool) {
        for statement in [
            "INSERT INTO sessions (id, game_name, started_at, ended_at) VALUES (1, 'VALORANT', '2026-09-13T14:00:00Z', '2026-09-13T16:00:00Z')",
            "INSERT INTO sessions (id, game_name, started_at, ended_at) VALUES (2, 'League of Legends', '2026-09-14T19:00:00Z', '2026-09-14T20:00:00Z')",
            "INSERT INTO ip_periods (session_id, ip, started_at, ended_at) VALUES (1, '162.249.72.5', '2026-09-13T14:01:00Z', '2026-09-13T14:30:00Z')",
            "INSERT INTO ip_periods (session_id, ip, started_at, ended_at) VALUES (1, '162.249.72.5', '2026-09-13T15:01:00Z', '2026-09-13T15:30:00Z')",
            "INSERT INTO ip_periods (session_id, ip, started_at, ended_at) VALUES (2, '104.160.141.3', '2026-09-14T19:01:00Z', '2026-09-14T19:40:00Z')",
            "INSERT INTO traceroutes (id, session_id, target_ip, started_at) VALUES (1, 1, '162.249.72.5', '2026-09-13T14:02:00Z')",
            "INSERT INTO hops (traceroute_id, hop_number, ip) VALUES (1, 1, '192.168.1.1')",
            "INSERT INTO ip_metadata (ip, asn, resolved_at) VALUES ('162.249.72.5', 'AS6507', '2026-09-13T14:01:00Z')",
            "INSERT INTO games (name, executable_name, created_at, updated_at) VALUES ('VALORANT', 'VALORANT-Win64-Shipping.exe', '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z')",
        ] {
            sqlx::query(statement).execute(pool).await.unwrap();
        }
    }

    async fn count(pool: &SqlitePool, table: &str) -> i64 {
        let (count,): (i64,) = sqlx::query_as(&format!("SELECT COUNT(*) FROM {table}"))
            .fetch_one(pool)
            .await
            .unwrap();
        count
    }

    #[tokio::test]
    async fn stats_count_sessions_and_addresses() {
        let pool = create_test_pool().await;
        let repo = StorageRepository::new(pool.clone());
        seed(&pool).await;

        let stats = repo.get_stats().await.unwrap();

        assert_eq!((stats.session_count, stats.address_count), (2, 2));
        assert!(stats.database_bytes > 0);
        assert_eq!(stats.geolite_built_at, None);
    }

    #[tokio::test]
    async fn delete_all_data_keeps_the_game_library() {
        let pool = create_test_pool().await;
        let repo = StorageRepository::new(pool.clone());
        seed(&pool).await;

        repo.delete_all_data().await.unwrap();

        for table in [
            "sessions",
            "ip_periods",
            "traceroutes",
            "hops",
            "ip_metadata",
        ] {
            assert_eq!(count(&pool, table).await, 0, "{table} should be empty");
        }
        assert_eq!(count(&pool, "games").await, 1);
    }

    #[tokio::test]
    async fn delete_all_data_removes_the_match_merge_backup() {
        let dir = tempfile::tempdir().unwrap();
        let db = dir.path().join("gameroute.db");
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(
                SqliteConnectOptions::from_str(&format!("sqlite:{}?mode=rwc", db.display()))
                    .unwrap()
                    .pragma("foreign_keys", "ON"),
            )
            .await
            .unwrap();
        sqlx::migrate!("./migrations").run(&pool).await.unwrap();
        seed(&pool).await;
        let backup = dir
            .path()
            .join(format!("gameroute.db.{MATCH_MERGE_BACKUP_SUFFIX}"));
        std::fs::write(&backup, b"copy").unwrap();
        let repo = StorageRepository::new(pool.clone());

        repo.delete_all_data().await.unwrap();

        assert!(!backup.exists());
        assert_eq!(count(&pool, "sessions").await, 0);
        pool.close().await;
    }
}

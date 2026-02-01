use sqlx::sqlite::SqlitePool;
use std::path::Path;
use thiserror::Error;

pub mod analytics;
pub mod games;
pub mod hops;
pub mod ip_metadata;
pub mod ip_periods;
pub mod sessions;
pub mod traceroutes;

pub use analytics::get_analytics_repository;
pub use games::get_game_repository;
pub use hops::get_hop_repository;
pub use ip_metadata::get_ip_metadata_repository;
pub use ip_periods::get_ip_period_repository;
pub use sessions::get_session_repository;
pub use traceroutes::get_traceroute_repository;

#[derive(Debug, Error)]
pub enum DbError {
    #[error("{0}")]
    Sqlx(#[from] sqlx::Error),

    #[error("Migration failed: {0}")]
    Migration(#[from] sqlx::migrate::MigrateError),

    #[error("{0}")]
    Io(#[from] std::io::Error),

    #[error("Validation error: {0}")]
    Validation(String),
}

pub async fn init_database(app_data_dir: &Path) -> Result<SqlitePool, DbError> {
    let db_path = app_data_dir.join("gameroute.db");

    if let Some(parent) = db_path.parent() {
        std::fs::create_dir_all(parent)?;
    }

    let db_url = format!("sqlite:{}?mode=rwc", db_path.display());
    let pool = SqlitePool::connect(&db_url).await?;

    sqlx::query("PRAGMA foreign_keys = ON")
        .execute(&pool)
        .await?;

    sqlx::migrate!("./migrations").run(&pool).await?;

    log::info!("Database initialized at {:?}", db_path);
    Ok(pool)
}

pub fn init_repositories(pool: &SqlitePool) {
    sessions::init_session_repository(pool.clone());
    ip_periods::init_ip_period_repository(pool.clone());
    traceroutes::init_traceroute_repository(pool.clone());
    hops::init_hop_repository(pool.clone());
    ip_metadata::init_ip_metadata_repository(pool.clone());
    games::init_game_repository(pool.clone());
    analytics::init_analytics_repository(pool.clone());
}

#[cfg(test)]
pub async fn create_test_pool() -> SqlitePool {
    let pool = SqlitePool::connect("sqlite::memory:")
        .await
        .expect("Failed to create in-memory database");

    sqlx::query("PRAGMA foreign_keys = ON")
        .execute(&pool)
        .await
        .expect("Failed to enable foreign keys");

    sqlx::migrate!("./migrations")
        .run(&pool)
        .await
        .expect("Failed to run migrations");

    pool
}

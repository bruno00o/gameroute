use crate::db::DbError;
use crate::models::shared_report::{SharedReport, SharedReportRecord};
use sqlx::sqlite::SqlitePool;
use std::sync::{Arc, OnceLock};

pub struct SharedReportRepository {
    pool: SqlitePool,
}

impl SharedReportRepository {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }

    pub async fn insert(&self, record: &SharedReportRecord) -> Result<(), DbError> {
        let report = &record.report;
        sqlx::query(
            "INSERT INTO shared_reports
                (id, url, game_name, recipient, created_at, expires_at, delete_token)
             VALUES ($1, $2, $3, $4, $5, $6, $7)",
        )
        .bind(&report.id)
        .bind(&report.url)
        .bind(&report.game_name)
        .bind(&report.recipient)
        .bind(&report.created_at)
        .bind(&report.expires_at)
        .bind(&record.delete_token)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn list(&self) -> Result<Vec<SharedReport>, DbError> {
        Ok(sqlx::query_as::<_, SharedReport>(
            "SELECT id, url, game_name, recipient, created_at, expires_at
             FROM shared_reports
             ORDER BY created_at DESC, id ASC",
        )
        .fetch_all(&self.pool)
        .await?)
    }

    pub async fn delete_expired(&self, now: &str) -> Result<u64, DbError> {
        let result = sqlx::query("DELETE FROM shared_reports WHERE expires_at <= $1")
            .bind(now)
            .execute(&self.pool)
            .await?;
        Ok(result.rows_affected())
    }

    pub async fn delete_token(&self, id: &str) -> Result<Option<String>, DbError> {
        let row: Option<(String,)> =
            sqlx::query_as("SELECT delete_token FROM shared_reports WHERE id = $1")
                .bind(id)
                .fetch_optional(&self.pool)
                .await?;
        Ok(row.map(|(token,)| token))
    }

    pub async fn delete(&self, id: &str) -> Result<(), DbError> {
        sqlx::query("DELETE FROM shared_reports WHERE id = $1")
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }
}

static SHARED_REPORT_REPOSITORY: OnceLock<Arc<SharedReportRepository>> = OnceLock::new();

pub fn init_shared_report_repository(pool: SqlitePool) {
    let repo = SharedReportRepository::new(pool);
    let _ = SHARED_REPORT_REPOSITORY.set(Arc::new(repo));
    log::info!("Shared report repository initialized");
}

pub fn get_shared_report_repository() -> Option<Arc<SharedReportRepository>> {
    SHARED_REPORT_REPOSITORY.get().cloned()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::create_test_pool;

    fn record(id: &str, created_at: &str, expires_at: &str) -> SharedReportRecord {
        SharedReportRecord {
            report: SharedReport {
                id: id.to_string(),
                url: format!("https://gameroute.test/r/{id}"),
                game_name: "VALORANT".to_string(),
                recipient: "isp".to_string(),
                created_at: created_at.to_string(),
                expires_at: expires_at.to_string(),
            },
            delete_token: format!("token-{id}"),
        }
    }

    async fn repo() -> SharedReportRepository {
        SharedReportRepository::new(create_test_pool().await)
    }

    #[tokio::test]
    async fn lists_the_latest_report_first_without_its_token() {
        let repo = repo().await;
        repo.insert(&record(
            "a",
            "2026-10-01T10:00:00.000Z",
            "2026-12-30T10:00:00.000Z",
        ))
        .await
        .unwrap();
        repo.insert(&record(
            "b",
            "2026-10-02T10:00:00.000Z",
            "2026-12-31T10:00:00.000Z",
        ))
        .await
        .unwrap();

        let reports = repo.list().await.unwrap();

        assert_eq!(
            reports.iter().map(|r| r.id.as_str()).collect::<Vec<_>>(),
            vec!["b", "a"]
        );
        assert_eq!(
            reports[0],
            record("b", "2026-10-02T10:00:00.000Z", "2026-12-31T10:00:00.000Z").report
        );
    }

    #[tokio::test]
    async fn keeps_the_delete_token_for_its_report_only() {
        let repo = repo().await;
        repo.insert(&record(
            "a",
            "2026-10-01T10:00:00.000Z",
            "2026-12-30T10:00:00.000Z",
        ))
        .await
        .unwrap();

        assert_eq!(
            repo.delete_token("a").await.unwrap().as_deref(),
            Some("token-a")
        );
        assert_eq!(repo.delete_token("missing").await.unwrap(), None);
    }

    #[tokio::test]
    async fn drops_only_the_expired_reports() {
        let repo = repo().await;
        repo.insert(&record(
            "old",
            "2026-07-01T10:00:00.000Z",
            "2026-09-29T10:00:00.000Z",
        ))
        .await
        .unwrap();
        repo.insert(&record(
            "now",
            "2026-07-13T10:00:00.000Z",
            "2026-10-11T10:00:00.000Z",
        ))
        .await
        .unwrap();
        repo.insert(&record(
            "live",
            "2026-10-01T10:00:00.000Z",
            "2026-12-30T10:00:00.000Z",
        ))
        .await
        .unwrap();

        let removed = repo
            .delete_expired("2026-10-11T10:00:00.000Z")
            .await
            .unwrap();

        assert_eq!(removed, 2);
        let ids: Vec<String> = repo
            .list()
            .await
            .unwrap()
            .into_iter()
            .map(|r| r.id)
            .collect();
        assert_eq!(ids, vec!["live"]);
    }

    #[tokio::test]
    async fn deletes_one_report() {
        let repo = repo().await;
        repo.insert(&record(
            "a",
            "2026-10-01T10:00:00.000Z",
            "2026-12-30T10:00:00.000Z",
        ))
        .await
        .unwrap();
        repo.insert(&record(
            "b",
            "2026-10-02T10:00:00.000Z",
            "2026-12-31T10:00:00.000Z",
        ))
        .await
        .unwrap();

        repo.delete("a").await.unwrap();

        let ids: Vec<String> = repo
            .list()
            .await
            .unwrap()
            .into_iter()
            .map(|r| r.id)
            .collect();
        assert_eq!(ids, vec!["b"]);
        assert_eq!(repo.delete_token("a").await.unwrap(), None);
    }

    #[tokio::test]
    async fn refuses_a_second_report_with_the_same_id() {
        let repo = repo().await;
        let first = record("a", "2026-10-01T10:00:00.000Z", "2026-12-30T10:00:00.000Z");
        repo.insert(&first).await.unwrap();

        assert!(repo.insert(&first).await.is_err());
    }
}

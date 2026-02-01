use crate::db::DbError;
use crate::models::ip_period::{IpPeriod, IpPeriodData, IpPeriodSummary};
use sqlx::sqlite::SqlitePool;
use std::net::IpAddr;
use std::sync::{Arc, OnceLock};

const ACTIVITY_PERIOD_THRESHOLD_SECS: i64 = 10;

pub struct IpPeriodRepository {
    pool: SqlitePool,
}

#[allow(dead_code)]
impl IpPeriodRepository {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }

    pub async fn insert_period(&self, data: &IpPeriodData) -> Result<i64, DbError> {
        let result = sqlx::query(
            "INSERT INTO ip_periods (session_id, ip, started_at, ended_at, packet_count)
             VALUES ($1, $2, $3, $4, $5)",
        )
        .bind(data.session_id)
        .bind(&data.ip)
        .bind(&data.started_at)
        .bind(&data.ended_at)
        .bind(data.packet_count)
        .execute(&self.pool)
        .await?;

        Ok(result.last_insert_rowid())
    }

    pub async fn update_period(
        &self,
        id: i64,
        ended_at: &str,
        packet_count: i32,
    ) -> Result<(), DbError> {
        sqlx::query("UPDATE ip_periods SET ended_at = $1, packet_count = $2 WHERE id = $3")
            .bind(ended_at)
            .bind(packet_count)
            .bind(id)
            .execute(&self.pool)
            .await?;

        Ok(())
    }

    pub async fn get_latest_period_for_ip(
        &self,
        session_id: i64,
        ip: &str,
    ) -> Result<Option<IpPeriod>, DbError> {
        sqlx::query_as::<_, IpPeriod>(
            "SELECT id, session_id, ip, started_at, ended_at, packet_count
             FROM ip_periods
             WHERE session_id = $1 AND ip = $2
             ORDER BY ended_at DESC
             LIMIT 1",
        )
        .bind(session_id)
        .bind(ip)
        .fetch_optional(&self.pool)
        .await
        .map_err(Into::into)
    }

    pub async fn upsert_ip_activity(
        &self,
        session_id: i64,
        ip: &str,
        timestamp: &str,
    ) -> Result<(i64, bool), DbError> {
        if ip.parse::<IpAddr>().is_err() {
            return Err(DbError::Validation(format!("Invalid IP address: {}", ip)));
        }

        let latest = self.get_latest_period_for_ip(session_id, ip).await?;

        if let Some(period) = latest {
            if let (Ok(ended), Ok(now)) = (
                chrono::DateTime::parse_from_rfc3339(&period.ended_at),
                chrono::DateTime::parse_from_rfc3339(timestamp),
            ) {
                let elapsed = (now - ended).num_seconds();
                if elapsed < ACTIVITY_PERIOD_THRESHOLD_SECS {
                    let new_count = period.packet_count + 1;
                    self.update_period(period.id, timestamp, new_count).await?;
                    log::debug!(
                        "Extended IP period {} for {} ({}s elapsed, {} packets)",
                        period.id,
                        ip,
                        elapsed,
                        new_count
                    );
                    return Ok((period.id, false));
                }
            }
        }

        let data = IpPeriodData::new(session_id, ip.to_string(), timestamp.to_string());
        let period_id = self.insert_period(&data).await?;
        log::debug!("Created new IP period {} for {}", period_id, ip);
        Ok((period_id, true))
    }

    pub async fn get_periods_for_session(&self, session_id: i64) -> Result<Vec<IpPeriod>, DbError> {
        sqlx::query_as::<_, IpPeriod>(
            "SELECT id, session_id, ip, started_at, ended_at, packet_count
             FROM ip_periods
             WHERE session_id = $1
             ORDER BY started_at ASC",
        )
        .bind(session_id)
        .fetch_all(&self.pool)
        .await
        .map_err(Into::into)
    }

    pub async fn get_ip_summaries_for_session(
        &self,
        session_id: i64,
    ) -> Result<Vec<IpPeriodSummary>, DbError> {
        sqlx::query_as::<_, IpPeriodSummary>(
            "SELECT
                ip,
                SUM(CAST((julianday(ended_at) - julianday(started_at)) * 86400 AS INTEGER)) as total_duration_secs,
                SUM(packet_count) as total_packet_count,
                COUNT(*) as period_count,
                MIN(started_at) as first_seen_at,
                MAX(ended_at) as last_seen_at
             FROM ip_periods
             WHERE session_id = $1
             GROUP BY ip
             ORDER BY first_seen_at ASC",
        )
        .bind(session_id)
        .fetch_all(&self.pool)
        .await
        .map_err(Into::into)
    }

    pub async fn get_unique_ips_for_session(
        &self,
        session_id: i64,
    ) -> Result<Vec<String>, DbError> {
        let rows: Vec<(String,)> = sqlx::query_as(
            "SELECT ip FROM ip_periods
             WHERE session_id = $1
             GROUP BY ip
             ORDER BY MIN(started_at) ASC",
        )
        .bind(session_id)
        .fetch_all(&self.pool)
        .await?;

        Ok(rows.into_iter().map(|r| r.0).collect())
    }

    pub async fn get_unique_ip_count(&self, session_id: i64) -> Result<i32, DbError> {
        let row: (i32,) =
            sqlx::query_as("SELECT COUNT(DISTINCT ip) FROM ip_periods WHERE session_id = $1")
                .bind(session_id)
                .fetch_one(&self.pool)
                .await?;

        Ok(row.0)
    }
}

static IP_PERIOD_REPOSITORY: OnceLock<Arc<IpPeriodRepository>> = OnceLock::new();

pub fn init_ip_period_repository(pool: SqlitePool) {
    let repo = IpPeriodRepository::new(pool);
    let _ = IP_PERIOD_REPOSITORY.set(Arc::new(repo));
    log::info!("IP Period repository initialized");
}

pub fn get_ip_period_repository() -> Option<Arc<IpPeriodRepository>> {
    IP_PERIOD_REPOSITORY.get().cloned()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::create_test_pool;

    async fn create_test_repo() -> IpPeriodRepository {
        let pool = create_test_pool().await;

        sqlx::query(
            "INSERT INTO sessions (id, game_name, started_at) VALUES (1, 'Test', '2026-01-25T10:00:00Z')",
        )
        .execute(&pool)
        .await
        .unwrap();

        IpPeriodRepository::new(pool)
    }

    #[tokio::test]
    async fn test_insert_period() {
        let repo = create_test_repo().await;

        let data = IpPeriodData::new(1, "8.8.8.8".to_string(), "2026-01-25T10:00:00Z".to_string());
        let id = repo.insert_period(&data).await.expect("Failed to insert");

        assert!(id > 0);
    }

    #[tokio::test]
    async fn test_upsert_extends_recent_period() {
        let repo = create_test_repo().await;

        let (id1, is_new1) = repo
            .upsert_ip_activity(1, "8.8.8.8", "2026-01-25T10:00:00Z")
            .await
            .unwrap();
        assert!(is_new1);

        let (id2, is_new2) = repo
            .upsert_ip_activity(1, "8.8.8.8", "2026-01-25T10:00:03Z")
            .await
            .unwrap();
        assert!(!is_new2);
        assert_eq!(id1, id2);

        let period = repo
            .get_latest_period_for_ip(1, "8.8.8.8")
            .await
            .unwrap()
            .unwrap();
        assert_eq!(period.packet_count, 2);
    }

    #[tokio::test]
    async fn test_upsert_creates_new_period_after_gap() {
        let repo = create_test_repo().await;

        let (id1, is_new1) = repo
            .upsert_ip_activity(1, "8.8.8.8", "2026-01-25T10:00:00Z")
            .await
            .unwrap();
        assert!(is_new1);

        let (id2, is_new2) = repo
            .upsert_ip_activity(1, "8.8.8.8", "2026-01-25T10:00:10Z")
            .await
            .unwrap();
        assert!(is_new2);
        assert_ne!(id1, id2);
    }

    #[tokio::test]
    async fn test_get_periods_for_session() {
        let repo = create_test_repo().await;

        repo.upsert_ip_activity(1, "1.1.1.1", "2026-01-25T10:00:00Z")
            .await
            .unwrap();
        repo.upsert_ip_activity(1, "2.2.2.2", "2026-01-25T10:00:05Z")
            .await
            .unwrap();
        repo.upsert_ip_activity(1, "1.1.1.1", "2026-01-25T10:01:00Z")
            .await
            .unwrap();

        let periods = repo.get_periods_for_session(1).await.unwrap();
        assert_eq!(periods.len(), 3);
    }

    #[tokio::test]
    async fn test_get_unique_ips() {
        let repo = create_test_repo().await;

        repo.upsert_ip_activity(1, "1.1.1.1", "2026-01-25T10:00:00Z")
            .await
            .unwrap();
        repo.upsert_ip_activity(1, "2.2.2.2", "2026-01-25T10:00:05Z")
            .await
            .unwrap();
        repo.upsert_ip_activity(1, "1.1.1.1", "2026-01-25T10:01:00Z")
            .await
            .unwrap();

        let ips = repo.get_unique_ips_for_session(1).await.unwrap();
        assert_eq!(ips.len(), 2);

        let count = repo.get_unique_ip_count(1).await.unwrap();
        assert_eq!(count, 2);
    }

    #[tokio::test]
    async fn test_upsert_rejects_invalid_ip() {
        let repo = create_test_repo().await;

        let result = repo
            .upsert_ip_activity(1, "not-an-ip", "2026-01-25T10:00:00Z")
            .await;
        assert!(result.is_err());

        let result = repo.upsert_ip_activity(1, "", "2026-01-25T10:00:00Z").await;
        assert!(result.is_err());
    }
}

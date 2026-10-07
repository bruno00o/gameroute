use crate::config::{ACTIVITY_PERIOD_THRESHOLD_SECS, GAME_SERVER_MIN_DURATION_SECS};
use crate::db::DbError;
use crate::models::ip_period::{
    IpActivityUpsert, IpPeriod, IpPeriodData, IpPeriodSummary, TraceCandidate,
};
use sqlx::sqlite::SqlitePool;
use std::net::IpAddr;
use std::sync::{Arc, OnceLock};

pub struct IpPeriodRepository {
    pool: SqlitePool,
}

#[allow(dead_code)] // Methods used via Tauri commands (invisible to clippy)
impl IpPeriodRepository {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }

    pub async fn insert_period(&self, data: &IpPeriodData) -> Result<i64, DbError> {
        let result = sqlx::query(
            "INSERT INTO ip_periods (session_id, ip, protocol, port, started_at, ended_at, packet_count, is_game_server)
             VALUES ($1, $2, $3, $4, $5, $6, $7, 0)",
        )
        .bind(data.session_id)
        .bind(&data.ip)
        .bind(&data.protocol)
        .bind(data.port)
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
        is_game_server: bool,
    ) -> Result<(), DbError> {
        sqlx::query(
            "UPDATE ip_periods SET ended_at = $1, packet_count = $2, is_game_server = $3 WHERE id = $4",
        )
        .bind(ended_at)
        .bind(packet_count)
        .bind(is_game_server)
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
            "SELECT id, session_id, ip, protocol, port, started_at, ended_at, packet_count, is_game_server
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
        protocol: &str,
        port: i32,
        timestamp: &str,
    ) -> Result<IpActivityUpsert, DbError> {
        if ip.parse::<IpAddr>().is_err() {
            return Err(DbError::Validation(format!("Invalid IP address: {}", ip)));
        }

        let latest = self.get_latest_period_for_ip(session_id, ip).await?;

        if let Some(period) = latest {
            if let (Ok(started), Ok(ended), Ok(now)) = (
                chrono::DateTime::parse_from_rfc3339(&period.started_at),
                chrono::DateTime::parse_from_rfc3339(&period.ended_at),
                chrono::DateTime::parse_from_rfc3339(timestamp),
            ) {
                let elapsed = (now - ended).num_seconds();
                if elapsed < ACTIVITY_PERIOD_THRESHOLD_SECS {
                    let new_count = period.packet_count + 1;
                    let total_duration = (now - started).num_seconds();
                    let is_game_server = period.is_game_server
                        || (protocol == "UDP"
                            && total_duration >= GAME_SERVER_MIN_DURATION_SECS);
                    self.update_period(period.id, timestamp, new_count, is_game_server)
                        .await?;
                    log::debug!(
                        "Extended IP period {} for {} ({}s elapsed, {} packets, game_server={})",
                        period.id,
                        ip,
                        elapsed,
                        new_count,
                        is_game_server
                    );
                    return Ok(IpActivityUpsert {
                        period_id: period.id,
                        is_new: false,
                        became_game_server: is_game_server && !period.is_game_server,
                    });
                }
            }
        }

        let data = IpPeriodData::new(session_id, ip.to_string(), protocol.to_string(), port, timestamp.to_string());
        let period_id = self.insert_period(&data).await?;
        log::debug!("Created new IP period {} for {}", period_id, ip);
        Ok(IpActivityUpsert {
            period_id,
            is_new: true,
            became_game_server: false,
        })
    }

    pub async fn get_periods_for_session(&self, session_id: i64) -> Result<Vec<IpPeriod>, DbError> {
        sqlx::query_as::<_, IpPeriod>(
            "SELECT id, session_id, ip, protocol, port, started_at, ended_at, packet_count, is_game_server
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
                protocol,
                port,
                SUM(CAST((julianday(ended_at) - julianday(started_at)) * 86400 AS INTEGER)) as total_duration_secs,
                SUM(packet_count) as total_packet_count,
                COUNT(*) as period_count,
                MIN(started_at) as first_seen_at,
                MAX(ended_at) as last_seen_at,
                MAX(is_game_server) as is_game_server
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

    pub async fn get_trace_candidates(
        &self,
        session_id: i64,
    ) -> Result<Vec<TraceCandidate>, DbError> {
        sqlx::query_as::<_, TraceCandidate>(
            "WITH ranked AS (
                SELECT ip, protocol, port, started_at,
                       ROW_NUMBER() OVER (PARTITION BY ip ORDER BY is_game_server DESC, ended_at DESC) AS rn,
                       MAX(is_game_server) OVER (PARTITION BY ip) AS any_game_server,
                       SUM(CAST(ROUND((julianday(ended_at) - julianday(started_at)) * 86400) AS INTEGER)) OVER (PARTITION BY ip) AS total_secs,
                       MIN(started_at) OVER (PARTITION BY ip) AS first_seen
                FROM ip_periods
                WHERE session_id = $1
             )
             SELECT ip, protocol, port, any_game_server AS is_game_server, total_secs
             FROM ranked
             WHERE rn = 1
             ORDER BY first_seen ASC",
        )
        .bind(session_id)
        .fetch_all(&self.pool)
        .await
        .map_err(Into::into)
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

        let data = IpPeriodData::new(1, "8.8.8.8".to_string(), "TCP".to_string(), 443, "2026-01-25T10:00:00Z".to_string());
        let id = repo.insert_period(&data).await.expect("Failed to insert");

        assert!(id > 0);
    }

    #[tokio::test]
    async fn test_upsert_extends_recent_period() {
        let repo = create_test_repo().await;

        let first = repo
            .upsert_ip_activity(1, "8.8.8.8", "UDP", 27015, "2026-01-25T10:00:00Z")
            .await
            .unwrap();
        assert!(first.is_new);

        let second = repo
            .upsert_ip_activity(1, "8.8.8.8", "UDP", 27015, "2026-01-25T10:00:03Z")
            .await
            .unwrap();
        assert!(!second.is_new);
        assert_eq!(first.period_id, second.period_id);

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

        let first = repo
            .upsert_ip_activity(1, "8.8.8.8", "TCP", 443, "2026-01-25T10:00:00Z")
            .await
            .unwrap();
        assert!(first.is_new);

        let second = repo
            .upsert_ip_activity(1, "8.8.8.8", "TCP", 443, "2026-01-25T10:00:10Z")
            .await
            .unwrap();
        assert!(second.is_new);
        assert_ne!(first.period_id, second.period_id);
    }

    async fn feed_udp(repo: &IpPeriodRepository, ip: &str, port: i32, from_sec: u32, to_sec: u32) -> Vec<IpActivityUpsert> {
        let mut outcomes = Vec::new();
        let mut sec = from_sec;
        while sec <= to_sec {
            let ts = format!("2026-01-25T10:{:02}:{:02}Z", sec / 60, sec % 60);
            outcomes.push(repo.upsert_ip_activity(1, ip, "UDP", port, &ts).await.unwrap());
            sec += 5;
        }
        outcomes
    }

    #[tokio::test]
    async fn test_upsert_reports_game_server_transition_once() {
        let repo = create_test_repo().await;

        let outcomes = feed_udp(&repo, "162.249.72.5", 7032, 0, 60).await;
        let transitions: Vec<usize> = outcomes
            .iter()
            .enumerate()
            .filter(|(_, o)| o.became_game_server)
            .map(|(i, _)| i)
            .collect();

        assert_eq!(transitions, vec![6]);
    }

    #[tokio::test]
    async fn test_upsert_tcp_never_becomes_game_server() {
        let repo = create_test_repo().await;

        for sec in (0..=60).step_by(5) {
            let ts = format!("2026-01-25T10:{:02}:{:02}Z", sec / 60, sec % 60);
            let outcome = repo.upsert_ip_activity(1, "104.18.41.183", "TCP", 443, &ts).await.unwrap();
            assert!(!outcome.became_game_server);
        }
    }

    #[tokio::test]
    async fn test_trace_candidates_prefer_game_server_period() {
        let repo = create_test_repo().await;

        repo.upsert_ip_activity(1, "162.249.72.5", "UDP", 8181, "2026-01-25T10:00:00Z")
            .await
            .unwrap();
        feed_udp(&repo, "162.249.72.5", 7032, 30, 90).await;
        repo.upsert_ip_activity(1, "162.249.72.5", "UDP", 8181, "2026-01-25T10:05:00Z")
            .await
            .unwrap();
        repo.upsert_ip_activity(1, "104.18.41.183", "TCP", 443, "2026-01-25T10:00:01Z")
            .await
            .unwrap();

        let candidates = repo.get_trace_candidates(1).await.unwrap();
        assert_eq!(candidates.len(), 2);

        let riot = candidates.iter().find(|c| c.ip == "162.249.72.5").unwrap();
        assert!(riot.is_game_server);
        assert_eq!(riot.protocol, "UDP");
        assert_eq!(riot.port, 7032);
        assert_eq!(riot.total_secs, 60);

        let cdn = candidates.iter().find(|c| c.ip == "104.18.41.183").unwrap();
        assert!(!cdn.is_game_server);
    }

    #[tokio::test]
    async fn test_get_periods_for_session() {
        let repo = create_test_repo().await;

        repo.upsert_ip_activity(1, "1.1.1.1", "TCP", 80, "2026-01-25T10:00:00Z")
            .await
            .unwrap();
        repo.upsert_ip_activity(1, "2.2.2.2", "UDP", 27015, "2026-01-25T10:00:05Z")
            .await
            .unwrap();
        repo.upsert_ip_activity(1, "1.1.1.1", "TCP", 80, "2026-01-25T10:01:00Z")
            .await
            .unwrap();

        let periods = repo.get_periods_for_session(1).await.unwrap();
        assert_eq!(periods.len(), 3);
    }

    #[tokio::test]
    async fn test_get_unique_ips() {
        let repo = create_test_repo().await;

        repo.upsert_ip_activity(1, "1.1.1.1", "TCP", 80, "2026-01-25T10:00:00Z")
            .await
            .unwrap();
        repo.upsert_ip_activity(1, "2.2.2.2", "UDP", 27015, "2026-01-25T10:00:05Z")
            .await
            .unwrap();
        repo.upsert_ip_activity(1, "1.1.1.1", "TCP", 80, "2026-01-25T10:01:00Z")
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
            .upsert_ip_activity(1, "not-an-ip", "TCP", 80, "2026-01-25T10:00:00Z")
            .await;
        assert!(result.is_err());

        let result = repo.upsert_ip_activity(1, "", "TCP", 80, "2026-01-25T10:00:00Z").await;
        assert!(result.is_err());
    }
}

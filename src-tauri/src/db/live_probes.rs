use crate::db::DbError;
use crate::models::live_probe::LiveProbeSlice;
use sqlx::sqlite::SqlitePool;
use std::sync::{Arc, OnceLock};

pub struct LiveProbeRepository {
    pool: SqlitePool,
}

impl LiveProbeRepository {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }

    pub async fn insert_slices(&self, slices: &[LiveProbeSlice]) -> Result<u64, DbError> {
        let mut inserted = 0;
        let mut tx = self.pool.begin().await?;
        for slice in slices {
            let result = sqlx::query(
                "INSERT OR IGNORE INTO live_probe_slices
                    (session_id, source, started_at, address, host, ttl, server_ip, reply_ip, at_destination,
                     region, provider, sent, received, rtt_min, rtt_median, rtt_max, jitter_ms)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)",
            )
            .bind(slice.session_id)
            .bind(slice.source.as_str())
            .bind(&slice.started_at)
            .bind(&slice.address)
            .bind(&slice.host)
            .bind(slice.ttl)
            .bind(&slice.server_ip)
            .bind(&slice.reply_ip)
            .bind(slice.at_destination)
            .bind(&slice.region)
            .bind(&slice.provider)
            .bind(slice.sent)
            .bind(slice.received)
            .bind(slice.rtt_min)
            .bind(slice.rtt_median)
            .bind(slice.rtt_max)
            .bind(slice.jitter_ms)
            .execute(&mut *tx)
            .await?;
            inserted += result.rows_affected();
        }
        tx.commit().await?;
        Ok(inserted)
    }

    pub async fn get_slices_for_session(
        &self,
        session_id: i64,
    ) -> Result<Vec<LiveProbeSlice>, DbError> {
        sqlx::query_as::<_, LiveProbeSlice>(
            "SELECT session_id, source, started_at, address, host, ttl, server_ip, reply_ip, at_destination,
                    region, provider, sent, received, rtt_min, rtt_median, rtt_max, jitter_ms
             FROM live_probe_slices
             WHERE session_id = $1
             ORDER BY started_at ASC, id ASC",
        )
        .bind(session_id)
        .fetch_all(&self.pool)
        .await
        .map_err(Into::into)
    }
}

static LIVE_PROBE_REPOSITORY: OnceLock<Arc<LiveProbeRepository>> = OnceLock::new();

pub fn init_live_probe_repository(pool: SqlitePool) {
    let repo = LiveProbeRepository::new(pool);
    let _ = LIVE_PROBE_REPOSITORY.set(Arc::new(repo));
    log::info!("Live probe repository initialized");
}

pub fn get_live_probe_repository() -> Option<Arc<LiveProbeRepository>> {
    LIVE_PROBE_REPOSITORY.get().cloned()
}

#[cfg(test)]
pub mod fixtures {
    use super::*;
    use crate::models::insights::PingSource;

    pub fn floor_slice(
        session_id: i64,
        started_at: &str,
        median: f64,
        received: i64,
    ) -> LiveProbeSlice {
        LiveProbeSlice {
            session_id,
            source: PingSource::Floor,
            started_at: started_at.to_string(),
            address: "162.249.72.5".to_string(),
            host: None,
            ttl: Some(5),
            server_ip: Some("162.249.72.5".to_string()),
            reply_ip: Some("194.6.150.68".to_string()),
            at_destination: false,
            region: None,
            provider: None,
            sent: 10,
            received,
            rtt_min: Some(median - 0.5),
            rtt_median: Some(median),
            rtt_max: Some(median + 1.0),
            jitter_ms: Some(0.4),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::fixtures::floor_slice;
    use super::*;
    use crate::db::create_test_pool;
    use crate::db::sessions::SessionRepository;

    #[tokio::test]
    async fn slices_are_stored_once_and_go_away_with_their_session() {
        let pool = create_test_pool().await;
        let repo = LiveProbeRepository::new(pool.clone());
        let sessions = SessionRepository::new(pool);
        let id = sessions
            .insert_session("VALORANT", "2026-10-08T20:00:00Z")
            .await
            .unwrap();

        let first = floor_slice(id, "2026-10-08T20:05:00.000Z", 4.6, 10);
        let second = floor_slice(id, "2026-10-08T20:05:10.000Z", 4.8, 9);
        assert_eq!(
            repo.insert_slices(&[first.clone(), second.clone()])
                .await
                .unwrap(),
            2
        );
        assert_eq!(
            repo.insert_slices(std::slice::from_ref(&second))
                .await
                .unwrap(),
            0
        );
        assert_eq!(
            repo.get_slices_for_session(id).await.unwrap(),
            vec![first, second]
        );

        sessions.delete_session(id).await.unwrap();
        assert!(repo.get_slices_for_session(id).await.unwrap().is_empty());
    }
}

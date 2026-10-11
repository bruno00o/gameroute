use crate::db::DbError;
use crate::models::session::{DbHop, HopData};
use sqlx::sqlite::SqlitePool;
use sqlx::QueryBuilder;
use std::sync::{Arc, OnceLock};

pub struct HopRepository {
    pool: SqlitePool,
}

impl HopRepository {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }

    #[allow(dead_code)] // Used by tests; production uses insert_hops_batch
    pub async fn insert_hop(&self, traceroute_id: i64, hop: &HopData) -> Result<i64, DbError> {
        let result = sqlx::query(
            "INSERT INTO hops (traceroute_id, hop_number, ip, hostname, latency_min, latency_avg, latency_max, packet_loss, is_problem_hop, source)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)",
        )
        .bind(traceroute_id)
        .bind(hop.hop_number)
        .bind(&hop.ip)
        .bind(&hop.hostname)
        .bind(hop.latency_min)
        .bind(hop.latency_avg)
        .bind(hop.latency_max)
        .bind(hop.packet_loss)
        .bind(hop.is_problem_hop)
        .bind(&hop.source)
        .execute(&self.pool)
        .await?;

        Ok(result.last_insert_rowid())
    }

    pub async fn insert_hops_batch(
        &self,
        traceroute_id: i64,
        hops: &[HopData],
    ) -> Result<(), DbError> {
        if hops.is_empty() {
            return Ok(());
        }

        let mut query_builder: QueryBuilder<sqlx::Sqlite> = QueryBuilder::new(
            "INSERT INTO hops (traceroute_id, hop_number, ip, hostname, latency_min, latency_avg, latency_max, packet_loss, is_problem_hop, source) ",
        );

        query_builder.push_values(hops, |mut b, hop| {
            b.push_bind(traceroute_id)
                .push_bind(hop.hop_number)
                .push_bind(&hop.ip)
                .push_bind(&hop.hostname)
                .push_bind(hop.latency_min)
                .push_bind(hop.latency_avg)
                .push_bind(hop.latency_max)
                .push_bind(hop.packet_loss)
                .push_bind(hop.is_problem_hop)
                .push_bind(&hop.source);
        });

        query_builder.build().execute(&self.pool).await?;

        log::debug!(
            "Inserted {} hops for traceroute {}",
            hops.len(),
            traceroute_id
        );

        Ok(())
    }

    #[allow(dead_code)] // Used by tests; production queries hops via JOIN in TracerouteRepository
    pub async fn get_hops_for_traceroute(&self, traceroute_id: i64) -> Result<Vec<DbHop>, DbError> {
        sqlx::query_as::<_, DbHop>(
            "SELECT id, traceroute_id, hop_number, ip, hostname, latency_min, latency_avg, latency_max, packet_loss, is_problem_hop, source
             FROM hops
             WHERE traceroute_id = $1
             ORDER BY hop_number ASC",
        )
        .bind(traceroute_id)
        .fetch_all(&self.pool)
        .await
        .map_err(Into::into)
    }

    #[allow(dead_code)] // Used by tests; production checks problem_hop_index on traceroute
    pub async fn get_problem_hop(&self, traceroute_id: i64) -> Result<Option<DbHop>, DbError> {
        sqlx::query_as::<_, DbHop>(
            "SELECT id, traceroute_id, hop_number, ip, hostname, latency_min, latency_avg, latency_max, packet_loss, is_problem_hop, source
             FROM hops
             WHERE traceroute_id = $1 AND is_problem_hop = 1
             LIMIT 1",
        )
        .bind(traceroute_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(Into::into)
    }

    #[allow(dead_code)] // Used by tests; production relies on CASCADE delete
    pub async fn delete_hops_for_traceroute(&self, traceroute_id: i64) -> Result<u64, DbError> {
        let result = sqlx::query("DELETE FROM hops WHERE traceroute_id = $1")
            .bind(traceroute_id)
            .execute(&self.pool)
            .await?;

        Ok(result.rows_affected())
    }
}

static HOP_REPOSITORY: OnceLock<Arc<HopRepository>> = OnceLock::new();

pub fn init_hop_repository(pool: SqlitePool) {
    let repo = HopRepository::new(pool);
    let _ = HOP_REPOSITORY.set(Arc::new(repo));
    log::info!("Hop repository initialized");
}

pub fn get_hop_repository() -> Option<Arc<HopRepository>> {
    HOP_REPOSITORY.get().cloned()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::create_test_pool;

    async fn create_test_repo() -> (HopRepository, SqlitePool) {
        let pool = create_test_pool().await;

        sqlx::query(
            "INSERT INTO sessions (id, game_name, started_at) VALUES (1, 'Test', '2026-01-25T10:00:00Z')",
        )
        .execute(&pool)
        .await
        .unwrap();

        sqlx::query(
            "INSERT INTO traceroutes (id, session_id, target_ip, started_at) VALUES (1, 1, '8.8.8.8', '2026-01-25T10:00:00Z')",
        )
        .execute(&pool)
        .await
        .unwrap();

        let repo = HopRepository::new(pool.clone());
        (repo, pool)
    }

    #[tokio::test]
    async fn test_insert_hop() {
        let (repo, _pool) = create_test_repo().await;

        let hop = HopData {
            hop_number: 1,
            ip: Some("192.168.1.1".to_string()),
            hostname: Some("router.local".to_string()),
            latency_min: Some(1.0),
            latency_avg: Some(1.5),
            latency_max: Some(2.0),
            packet_loss: Some(0.0),
            is_problem_hop: false,
            source: Some("ICMP".to_string()),
        };

        let id = repo
            .insert_hop(1, &hop)
            .await
            .expect("Failed to insert hop");
        assert!(id > 0);

        let hops = repo.get_hops_for_traceroute(1).await.unwrap();
        assert_eq!(hops.len(), 1);
        assert_eq!(hops[0].hop_number, 1);
        assert_eq!(hops[0].ip, Some("192.168.1.1".to_string()));
        assert!(!hops[0].is_problem_hop);
    }

    #[tokio::test]
    async fn test_insert_hops_batch() {
        let (repo, _pool) = create_test_repo().await;

        let hops = vec![
            HopData {
                hop_number: 1,
                ip: Some("192.168.1.1".to_string()),
                hostname: Some("router".to_string()),
                latency_min: Some(1.0),
                latency_avg: Some(1.5),
                latency_max: Some(2.0),
                packet_loss: Some(0.0),
                is_problem_hop: false,
                source: None,
            },
            HopData {
                hop_number: 2,
                ip: Some("10.0.0.1".to_string()),
                hostname: Some("isp".to_string()),
                latency_min: Some(10.0),
                latency_avg: Some(15.0),
                latency_max: Some(20.0),
                packet_loss: Some(2.5),
                is_problem_hop: true,
                source: None,
            },
            HopData {
                hop_number: 3,
                ip: Some("8.8.8.8".to_string()),
                hostname: Some("dns.google".to_string()),
                latency_min: Some(25.0),
                latency_avg: Some(30.0),
                latency_max: Some(35.0),
                packet_loss: Some(0.0),
                is_problem_hop: false,
                source: None,
            },
        ];

        repo.insert_hops_batch(1, &hops)
            .await
            .expect("Failed to insert hops batch");

        let retrieved = repo.get_hops_for_traceroute(1).await.unwrap();
        assert_eq!(retrieved.len(), 3);

        assert_eq!(retrieved[0].hop_number, 1);
        assert_eq!(retrieved[1].hop_number, 2);
        assert_eq!(retrieved[2].hop_number, 3);

        assert!(!retrieved[0].is_problem_hop);
        assert!(retrieved[1].is_problem_hop);
        assert!(!retrieved[2].is_problem_hop);
    }

    #[tokio::test]
    async fn test_get_problem_hop() {
        let (repo, _pool) = create_test_repo().await;

        let hops = vec![
            HopData {
                hop_number: 1,
                ip: Some("192.168.1.1".to_string()),
                hostname: None,
                latency_min: None,
                latency_avg: Some(1.0),
                latency_max: None,
                packet_loss: Some(0.0),
                is_problem_hop: false,
                source: None,
            },
            HopData {
                hop_number: 2,
                ip: Some("10.0.0.1".to_string()),
                hostname: None,
                latency_min: None,
                latency_avg: Some(100.0),
                latency_max: None,
                packet_loss: Some(10.0),
                is_problem_hop: true,
                source: None,
            },
        ];

        repo.insert_hops_batch(1, &hops).await.unwrap();

        let problem = repo.get_problem_hop(1).await.unwrap().unwrap();
        assert_eq!(problem.hop_number, 2);
        assert!(problem.is_problem_hop);
        assert_eq!(problem.ip, Some("10.0.0.1".to_string()));
    }

    #[tokio::test]
    async fn test_get_problem_hop_none() {
        let (repo, _pool) = create_test_repo().await;

        let hops = vec![HopData {
            hop_number: 1,
            ip: Some("8.8.8.8".to_string()),
            hostname: None,
            latency_min: None,
            latency_avg: Some(20.0),
            latency_max: None,
            packet_loss: Some(0.0),
            is_problem_hop: false,
            source: None,
        }];

        repo.insert_hops_batch(1, &hops).await.unwrap();

        let problem = repo.get_problem_hop(1).await.unwrap();
        assert!(problem.is_none());
    }

    #[tokio::test]
    async fn test_delete_hops_for_traceroute() {
        let (repo, _pool) = create_test_repo().await;

        let hops = vec![
            HopData {
                hop_number: 1,
                ip: Some("1.1.1.1".to_string()),
                hostname: None,
                latency_min: None,
                latency_avg: Some(10.0),
                latency_max: None,
                packet_loss: None,
                is_problem_hop: false,
                source: None,
            },
            HopData {
                hop_number: 2,
                ip: Some("2.2.2.2".to_string()),
                hostname: None,
                latency_min: None,
                latency_avg: Some(20.0),
                latency_max: None,
                packet_loss: None,
                is_problem_hop: false,
                source: None,
            },
        ];

        repo.insert_hops_batch(1, &hops).await.unwrap();

        assert_eq!(repo.get_hops_for_traceroute(1).await.unwrap().len(), 2);

        let deleted = repo.delete_hops_for_traceroute(1).await.unwrap();
        assert_eq!(deleted, 2);

        assert_eq!(repo.get_hops_for_traceroute(1).await.unwrap().len(), 0);
    }

    #[tokio::test]
    async fn test_cascade_delete_on_session() {
        let pool = create_test_pool().await;

        sqlx::query(
            "INSERT INTO sessions (id, game_name, started_at) VALUES (1, 'Test', '2026-01-25T10:00:00Z')",
        )
        .execute(&pool)
        .await
        .unwrap();

        sqlx::query(
            "INSERT INTO traceroutes (id, session_id, target_ip, started_at) VALUES (1, 1, '8.8.8.8', '2026-01-25T10:00:00Z')",
        )
        .execute(&pool)
        .await
        .unwrap();

        sqlx::query(
            "INSERT INTO hops (traceroute_id, hop_number, ip, is_problem_hop) VALUES (1, 1, '1.1.1.1', 0)",
        )
        .execute(&pool)
        .await
        .unwrap();

        let hop_count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM hops")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(hop_count.0, 1);

        sqlx::query("DELETE FROM sessions WHERE id = 1")
            .execute(&pool)
            .await
            .unwrap();

        let hop_count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM hops")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(hop_count.0, 0);

        let tr_count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM traceroutes")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(tr_count.0, 0);
    }
}

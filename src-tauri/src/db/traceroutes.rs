use crate::db::DbError;
use crate::models::flow_kind::FlowKind;
use crate::models::session::DbHop;
use crate::models::severity::Severity;
use crate::models::traceroute_record::{TracerouteData, TracerouteRecord, TracerouteWithHops};
use sqlx::sqlite::SqlitePool;
use std::collections::HashMap;
use std::sync::{Arc, OnceLock};

pub struct TracerouteRepository {
    pool: SqlitePool,
}

#[allow(dead_code)] // Methods used via Tauri commands (invisible to clippy)
impl TracerouteRepository {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }

    pub async fn insert_traceroute(&self, data: &TracerouteData) -> Result<i64, DbError> {
        let result = sqlx::query(
            "INSERT INTO traceroutes (session_id, target_ip, started_at, traceroute_method)
             VALUES ($1, $2, $3, $4)",
        )
        .bind(data.session_id)
        .bind(&data.target_ip)
        .bind(&data.started_at)
        .bind(&data.traceroute_method)
        .execute(&self.pool)
        .await?;

        Ok(result.last_insert_rowid())
    }

    pub async fn update_traceroute_completed(
        &self,
        id: i64,
        completed_at: &str,
        problem_hop_index: Option<i32>,
        traceroute_method: Option<&str>,
    ) -> Result<(), DbError> {
        sqlx::query(
            "UPDATE traceroutes SET completed_at = $1, problem_hop_index = $2, traceroute_method = COALESCE($3, traceroute_method) WHERE id = $4",
        )
        .bind(completed_at)
        .bind(problem_hop_index)
        .bind(traceroute_method)
        .bind(id)
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    pub async fn get_traceroute(&self, id: i64) -> Result<Option<TracerouteRecord>, DbError> {
        sqlx::query_as::<_, TracerouteRecord>(
            "SELECT id, session_id, target_ip, started_at, completed_at, problem_hop_index, traceroute_method
             FROM traceroutes WHERE id = $1",
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await
        .map_err(Into::into)
    }

    pub async fn get_traceroutes_for_session(
        &self,
        session_id: i64,
    ) -> Result<Vec<TracerouteRecord>, DbError> {
        sqlx::query_as::<_, TracerouteRecord>(
            "SELECT id, session_id, target_ip, started_at, completed_at, problem_hop_index, traceroute_method
             FROM traceroutes
             WHERE session_id = $1
             ORDER BY started_at ASC",
        )
        .bind(session_id)
        .fetch_all(&self.pool)
        .await
        .map_err(Into::into)
    }

    pub async fn get_traceroute_with_hops(
        &self,
        traceroute_id: i64,
    ) -> Result<Option<TracerouteWithHops>, DbError> {
        let traceroute = match self.get_traceroute(traceroute_id).await? {
            Some(tr) => tr,
            None => return Ok(None),
        };

        let hops = sqlx::query_as::<_, DbHop>(
            "SELECT id, traceroute_id, hop_number, ip, hostname, latency_min, latency_avg, latency_max, packet_loss, is_problem_hop
             FROM hops WHERE traceroute_id = $1 ORDER BY hop_number ASC",
        )
        .bind(traceroute_id)
        .fetch_all(&self.pool)
        .await?;

        Ok(Some(TracerouteWithHops {
            id: traceroute.id,
            session_id: traceroute.session_id,
            target_ip: traceroute.target_ip,
            started_at: traceroute.started_at,
            completed_at: traceroute.completed_at,
            problem_hop_index: traceroute.problem_hop_index,
            traceroute_method: traceroute.traceroute_method,
            hops,
            status: Severity::default(),
            route: None,
        }))
    }

    /// Fix N+1: single JOIN query instead of N+1 separate queries
    pub async fn get_traceroutes_with_hops_for_session(
        &self,
        session_id: i64,
    ) -> Result<Vec<TracerouteWithHops>, DbError> {
        // Single query with JOIN to fetch all traceroutes and hops at once
        let rows = sqlx::query_as::<_, JoinedTracerouteHopRow>(
            "SELECT
                t.id as traceroute_id,
                t.session_id,
                t.target_ip,
                t.started_at as traceroute_started_at,
                t.completed_at,
                t.problem_hop_index,
                t.traceroute_method,
                h.id as hop_id,
                h.hop_number,
                h.ip as hop_ip,
                h.hostname,
                h.latency_min,
                h.latency_avg,
                h.latency_max,
                h.packet_loss,
                h.is_problem_hop,
                h.source as hop_source
             FROM traceroutes t
             LEFT JOIN hops h ON h.traceroute_id = t.id
             WHERE t.session_id = $1
             ORDER BY t.started_at ASC, h.hop_number ASC",
        )
        .bind(session_id)
        .fetch_all(&self.pool)
        .await?;

        Ok(group_traceroute_rows(rows))
    }

    pub async fn get_flow_traceroutes_for_sessions(
        &self,
        session_ids: &[i64],
    ) -> Result<Vec<TracerouteWithHops>, DbError> {
        let rows = sqlx::query_as::<_, JoinedTracerouteHopRow>(
            "SELECT
                t.id as traceroute_id,
                t.session_id,
                t.target_ip,
                t.started_at as traceroute_started_at,
                t.completed_at,
                t.problem_hop_index,
                t.traceroute_method,
                h.id as hop_id,
                h.hop_number,
                h.ip as hop_ip,
                h.hostname,
                h.latency_min,
                h.latency_avg,
                h.latency_max,
                h.packet_loss,
                h.is_problem_hop,
                h.source as hop_source
             FROM traceroutes t
             LEFT JOIN hops h ON h.traceroute_id = t.id
             WHERE t.session_id IN (SELECT value FROM json_each($1))
               AND EXISTS (
                   SELECT 1 FROM ip_periods p
                   WHERE p.session_id = t.session_id
                     AND p.ip = t.target_ip
                     AND (p.is_game_server = 1 OR p.flow_kind = $2)
               )
             ORDER BY t.session_id ASC, t.started_at ASC, t.id ASC, h.hop_number ASC",
        )
        .bind(serde_json::to_string(session_ids).unwrap_or_default())
        .bind(FlowKind::Voice.as_str())
        .fetch_all(&self.pool)
        .await?;

        Ok(group_traceroute_rows(rows))
    }

    pub async fn get_traced_ips(&self, session_id: i64) -> Result<Vec<String>, DbError> {
        let rows: Vec<(String,)> =
            sqlx::query_as("SELECT target_ip FROM traceroutes WHERE session_id = $1")
                .bind(session_id)
                .fetch_all(&self.pool)
                .await?;

        Ok(rows.into_iter().map(|r| r.0).collect())
    }

    pub async fn get_traceroute_count(&self, session_id: i64) -> Result<i32, DbError> {
        let row: (i32,) = sqlx::query_as("SELECT COUNT(*) FROM traceroutes WHERE session_id = $1")
            .bind(session_id)
            .fetch_one(&self.pool)
            .await?;

        Ok(row.0)
    }

    pub async fn delete_traceroute(&self, id: i64) -> Result<(), DbError> {
        sqlx::query("DELETE FROM traceroutes WHERE id = $1")
            .bind(id)
            .execute(&self.pool)
            .await?;

        Ok(())
    }

    pub async fn get_flagged_traceroutes(&self) -> Result<Vec<(i64, String, i32)>, DbError> {
        sqlx::query_as(
            "SELECT id, target_ip, problem_hop_index FROM traceroutes WHERE problem_hop_index IS NOT NULL",
        )
        .fetch_all(&self.pool)
        .await
        .map_err(Into::into)
    }

    pub async fn set_problem_hop(&self, id: i64, problem_hop: Option<i32>) -> Result<(), DbError> {
        let mut tx = self.pool.begin().await?;
        sqlx::query("UPDATE traceroutes SET problem_hop_index = $1 WHERE id = $2")
            .bind(problem_hop)
            .bind(id)
            .execute(&mut *tx)
            .await?;
        sqlx::query(
            "UPDATE hops SET is_problem_hop = COALESCE(hop_number = $1, 0) WHERE traceroute_id = $2",
        )
        .bind(problem_hop)
        .bind(id)
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
        Ok(())
    }

    pub async fn delete_traceroutes_for_session(&self, session_id: i64) -> Result<(), DbError> {
        sqlx::query("DELETE FROM traceroutes WHERE session_id = $1")
            .bind(session_id)
            .execute(&self.pool)
            .await?;

        Ok(())
    }
}

fn group_traceroute_rows(rows: Vec<JoinedTracerouteHopRow>) -> Vec<TracerouteWithHops> {
    let mut traceroute_map: HashMap<i64, TracerouteWithHops> = HashMap::new();
    let mut order: Vec<i64> = Vec::new();

    for row in rows {
        let entry = traceroute_map.entry(row.traceroute_id).or_insert_with(|| {
            order.push(row.traceroute_id);
            TracerouteWithHops {
                id: row.traceroute_id,
                session_id: row.session_id,
                target_ip: row.target_ip.clone(),
                started_at: row.traceroute_started_at.clone(),
                completed_at: row.completed_at.clone(),
                problem_hop_index: row.problem_hop_index,
                traceroute_method: row.traceroute_method.clone(),
                hops: Vec::new(),
                status: Severity::default(),
                route: None,
            }
        });

        // LEFT JOIN may produce NULL hop_id when traceroute has no hops
        if let Some(hop_id) = row.hop_id {
            entry.hops.push(DbHop {
                id: hop_id,
                traceroute_id: row.traceroute_id,
                hop_number: row.hop_number.unwrap_or(0),
                ip: row.hop_ip,
                hostname: row.hostname,
                latency_min: row.latency_min,
                latency_avg: row.latency_avg,
                latency_max: row.latency_max,
                packet_loss: row.packet_loss,
                is_problem_hop: row.is_problem_hop.unwrap_or(false),
                source: row.hop_source,
                loss_status: None,
            });
        }
    }

    order
        .into_iter()
        .filter_map(|id| traceroute_map.remove(&id))
        .collect()
}

#[derive(Debug, sqlx::FromRow)]
struct JoinedTracerouteHopRow {
    traceroute_id: i64,
    session_id: i64,
    target_ip: String,
    traceroute_started_at: String,
    completed_at: Option<String>,
    problem_hop_index: Option<i32>,
    traceroute_method: Option<String>,
    hop_id: Option<i64>,
    hop_number: Option<i32>,
    hop_ip: Option<String>,
    hostname: Option<String>,
    latency_min: Option<f64>,
    latency_avg: Option<f64>,
    latency_max: Option<f64>,
    packet_loss: Option<f64>,
    is_problem_hop: Option<bool>,
    hop_source: Option<String>,
}

static TRACEROUTE_REPOSITORY: OnceLock<Arc<TracerouteRepository>> = OnceLock::new();

pub fn init_traceroute_repository(pool: SqlitePool) {
    let repo = TracerouteRepository::new(pool);
    let _ = TRACEROUTE_REPOSITORY.set(Arc::new(repo));
    log::info!("Traceroute repository initialized");
}

pub fn get_traceroute_repository() -> Option<Arc<TracerouteRepository>> {
    TRACEROUTE_REPOSITORY.get().cloned()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::create_test_pool;

    async fn create_test_repo() -> TracerouteRepository {
        let pool = create_test_pool().await;

        sqlx::query(
            "INSERT INTO sessions (id, game_name, started_at) VALUES (1, 'Test', '2026-01-25T10:00:00Z')",
        )
        .execute(&pool)
        .await
        .unwrap();

        TracerouteRepository::new(pool)
    }

    #[tokio::test]
    async fn test_insert_traceroute() {
        let repo = create_test_repo().await;

        let data =
            TracerouteData::new(1, "8.8.8.8".to_string(), "2026-01-25T10:00:00Z".to_string());
        let id = repo
            .insert_traceroute(&data)
            .await
            .expect("Failed to insert");

        assert!(id > 0);

        let tr = repo.get_traceroute(id).await.unwrap().unwrap();
        assert_eq!(tr.target_ip, "8.8.8.8");
        assert!(tr.completed_at.is_none());
    }

    #[tokio::test]
    async fn test_update_traceroute_completed() {
        let repo = create_test_repo().await;

        let data =
            TracerouteData::new(1, "8.8.8.8".to_string(), "2026-01-25T10:00:00Z".to_string());
        let id = repo.insert_traceroute(&data).await.unwrap();

        repo.update_traceroute_completed(id, "2026-01-25T10:00:25Z", Some(5), Some("ICMP (tracert)"))
            .await
            .unwrap();

        let tr = repo.get_traceroute(id).await.unwrap().unwrap();
        assert_eq!(tr.completed_at, Some("2026-01-25T10:00:25Z".to_string()));
        assert_eq!(tr.problem_hop_index, Some(5));
    }

    #[tokio::test]
    async fn clearing_a_problem_hop_updates_the_trace_and_its_hops() {
        let repo = create_test_repo().await;
        let data =
            TracerouteData::new(1, "20.47.65.125".to_string(), "2026-01-25T10:00:00Z".to_string());
        let id = repo.insert_traceroute(&data).await.unwrap();
        repo.update_traceroute_completed(id, "2026-01-25T10:00:25Z", Some(2), None)
            .await
            .unwrap();
        for (hop, flagged) in [(1, false), (2, true)] {
            sqlx::query("INSERT INTO hops (traceroute_id, hop_number, is_problem_hop) VALUES ($1, $2, $3)")
                .bind(id)
                .bind(hop)
                .bind(flagged)
                .execute(&repo.pool)
                .await
                .unwrap();
        }

        assert_eq!(
            repo.get_flagged_traceroutes().await.unwrap(),
            vec![(id, "20.47.65.125".to_string(), 2)]
        );
        repo.set_problem_hop(id, None).await.unwrap();

        assert!(repo.get_flagged_traceroutes().await.unwrap().is_empty());
        let flagged: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM hops WHERE is_problem_hop = 1")
            .fetch_one(&repo.pool)
            .await
            .unwrap();
        assert_eq!(flagged.0, 0);
    }

    #[tokio::test]
    async fn test_get_traceroutes_for_session() {
        let repo = create_test_repo().await;

        let data1 =
            TracerouteData::new(1, "8.8.8.8".to_string(), "2026-01-25T10:00:00Z".to_string());
        let data2 =
            TracerouteData::new(1, "1.1.1.1".to_string(), "2026-01-25T10:01:00Z".to_string());

        repo.insert_traceroute(&data1).await.unwrap();
        repo.insert_traceroute(&data2).await.unwrap();

        let traceroutes = repo.get_traceroutes_for_session(1).await.unwrap();
        assert_eq!(traceroutes.len(), 2);
        assert_eq!(traceroutes[0].target_ip, "8.8.8.8");
        assert_eq!(traceroutes[1].target_ip, "1.1.1.1");
    }

    #[tokio::test]
    async fn test_get_traced_ips() {
        let repo = create_test_repo().await;

        assert!(repo.get_traced_ips(1).await.unwrap().is_empty());

        repo.insert_traceroute(&TracerouteData::new(1, "162.249.72.5".to_string(), "2026-01-25T10:00:00Z".to_string()))
            .await
            .unwrap();

        assert_eq!(repo.get_traced_ips(1).await.unwrap(), vec!["162.249.72.5".to_string()]);
    }

    #[tokio::test]
    async fn test_traceroute_count() {
        let repo = create_test_repo().await;

        assert_eq!(repo.get_traceroute_count(1).await.unwrap(), 0);

        let data1 =
            TracerouteData::new(1, "8.8.8.8".to_string(), "2026-01-25T10:00:00Z".to_string());
        let data2 =
            TracerouteData::new(1, "1.1.1.1".to_string(), "2026-01-25T10:00:01Z".to_string());
        repo.insert_traceroute(&data1).await.unwrap();
        repo.insert_traceroute(&data2).await.unwrap();

        assert_eq!(repo.get_traceroute_count(1).await.unwrap(), 2);
    }
}

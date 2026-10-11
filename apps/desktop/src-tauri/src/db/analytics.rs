use crate::db::DbError;
use crate::models::insights::ServerStability;
use crate::models::network::{NetworkMapEntry, NetworkOverviewStats, RecurringProblemHop};
use crate::models::severity::Severity;
use sqlx::sqlite::SqlitePool;
use std::sync::{Arc, OnceLock};

const TRACEROUTE_PINGS: &str = "traceroute_pings AS (
    SELECT traceroute_id, latency_avg AS ping_ms
    FROM (
        SELECT traceroute_id, latency_avg,
               ROW_NUMBER() OVER (PARTITION BY traceroute_id ORDER BY hop_number DESC) AS rn
        FROM hops
        WHERE latency_avg IS NOT NULL
    )
    WHERE rn = 1
)";

pub struct AnalyticsRepository {
    pool: SqlitePool,
}

impl AnalyticsRepository {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }

    // ===== Network commands =====

    pub async fn get_network_map_data(&self) -> Result<Vec<NetworkMapEntry>, DbError> {
        sqlx::query_as::<_, NetworkMapEntry>(
            "SELECT
                ip.ip,
                m.country,
                m.city,
                m.lat,
                m.lon,
                m.asn,
                m.isp,
                COUNT(DISTINCT ip.session_id) as session_count,
                COALESCE(SUM(
                    (julianday(ip.ended_at) - julianday(ip.started_at)) * 86400
                ), 0.0) as total_duration_secs,
                COALESCE(SUM(ip.packet_count), 0) as total_packets,
                MAX(ip.is_game_server) as is_game_server
             FROM ip_periods ip
             LEFT JOIN ip_metadata m ON m.ip = ip.ip
             GROUP BY ip.ip
             ORDER BY session_count DESC",
        )
        .fetch_all(&self.pool)
        .await
        .map_err(Into::into)
    }

    pub async fn get_recurring_problem_hops(&self) -> Result<Vec<RecurringProblemHop>, DbError> {
        sqlx::query_as::<_, RecurringProblemHop>(
            "SELECT
                h.ip,
                m.asn,
                m.isp,
                COUNT(DISTINCT t.session_id) as occurrence_count,
                AVG(h.latency_avg) as avg_latency,
                AVG(h.packet_loss) as avg_packet_loss,
                COALESCE(MAX(gs.is_game_server), 0) as is_game_server_route
             FROM hops h
             JOIN traceroutes t ON t.id = h.traceroute_id
             LEFT JOIN ip_metadata m ON m.ip = h.ip
             LEFT JOIN (
                 SELECT ip, MAX(is_game_server) as is_game_server
                 FROM ip_periods GROUP BY ip
             ) gs ON gs.ip = t.target_ip
             WHERE h.is_problem_hop = 1 AND h.ip IS NOT NULL
             GROUP BY h.ip
             ORDER BY is_game_server_route DESC, occurrence_count DESC",
        )
        .fetch_all(&self.pool)
        .await
        .map_err(Into::into)
    }

    pub async fn get_network_overview_stats(&self) -> Result<NetworkOverviewStats, DbError> {
        let unique_server_ips: (i64,) =
            sqlx::query_as("SELECT COUNT(DISTINCT ip) FROM ip_periods WHERE is_game_server = 1")
                .fetch_one(&self.pool)
                .await?;

        let total_traceroutes: (i64,) = sqlx::query_as(
            "SELECT COUNT(*) FROM traceroutes t
             JOIN (SELECT DISTINCT ip FROM ip_periods WHERE is_game_server = 1) gs ON gs.ip = t.target_ip",
        )
        .fetch_one(&self.pool)
        .await?;

        // Count unique IPs flagged as problem hops across game server routes.
        // A router that appears as a problem in 70 traceroutes counts once, not 70.
        let total_problem_hops: (i64,) = sqlx::query_as(
            "SELECT COUNT(DISTINCT h.ip) FROM hops h
             JOIN traceroutes t ON t.id = h.traceroute_id
             JOIN (SELECT DISTINCT ip FROM ip_periods WHERE is_game_server = 1) gs ON gs.ip = t.target_ip
             WHERE h.is_problem_hop = 1 AND h.ip IS NOT NULL",
        )
        .fetch_one(&self.pool)
        .await?;

        let avg_latency: (Option<f64>,) = sqlx::query_as(&format!(
            "WITH {TRACEROUTE_PINGS}
             SELECT AVG(p.ping_ms)
             FROM traceroute_pings p
             JOIN traceroutes t ON t.id = p.traceroute_id
             JOIN (SELECT DISTINCT ip FROM ip_periods WHERE is_game_server = 1) gs ON gs.ip = t.target_ip"
        ))
        .fetch_one(&self.pool)
        .await?;

        Ok(NetworkOverviewStats {
            unique_server_ips: unique_server_ips.0,
            total_traceroutes: total_traceroutes.0,
            total_problem_hops: total_problem_hops.0,
            avg_latency: avg_latency.0,
            status: Severity::default(),
        })
    }

    // ===== Insights commands =====

    pub async fn get_game_sessions(&self) -> Result<Vec<(i64, String)>, DbError> {
        sqlx::query_as(
            "SELECT s.id, s.game_name FROM sessions s
             WHERE EXISTS (SELECT 1 FROM ip_periods p WHERE p.session_id = s.id AND p.is_game_server = 1)
             ORDER BY s.started_at ASC",
        )
        .fetch_all(&self.pool)
        .await
        .map_err(Into::into)
    }

    pub async fn get_server_stability(&self) -> Result<Vec<ServerStability>, DbError> {
        sqlx::query_as::<_, ServerStability>(&format!(
            "WITH {TRACEROUTE_PINGS},
             target_pings AS (
                 SELECT t.target_ip, AVG(p.ping_ms) as avg_latency
                 FROM traceroute_pings p
                 JOIN traceroutes t ON t.id = p.traceroute_id
                 GROUP BY t.target_ip
             )
             SELECT
                t.target_ip as ip,
                m.asn,
                m.isp,
                m.country,
                m.lat,
                m.lon,
                MAX(tp.avg_latency) as avg_latency,
                AVG(h.packet_loss) as avg_packet_loss,
                COUNT(DISTINCT t.id) as traceroute_count,
                CASE WHEN COUNT(h.id) > 0
                    THEN CAST(SUM(CASE WHEN h.is_problem_hop = 1 THEN 1 ELSE 0 END) AS REAL) / COUNT(h.id)
                    ELSE 0.0
                END as problem_hop_ratio,
                COALESCE(gs.is_game_server, 0) as is_game_server
             FROM traceroutes t
             LEFT JOIN target_pings tp ON tp.target_ip = t.target_ip
             LEFT JOIN hops h ON h.traceroute_id = t.id
             LEFT JOIN ip_metadata m ON m.ip = t.target_ip
             LEFT JOIN (
                 SELECT ip, MAX(is_game_server) as is_game_server
                 FROM ip_periods GROUP BY ip
             ) gs ON gs.ip = t.target_ip
             GROUP BY t.target_ip
             ORDER BY problem_hop_ratio ASC, avg_latency ASC"
        ))
        .fetch_all(&self.pool)
        .await
        .map_err(Into::into)
    }
}

static ANALYTICS_REPOSITORY: OnceLock<Arc<AnalyticsRepository>> = OnceLock::new();

pub fn init_analytics_repository(pool: SqlitePool) {
    let repo = AnalyticsRepository::new(pool);
    let _ = ANALYTICS_REPOSITORY.set(Arc::new(repo));
    log::info!("Analytics repository initialized");
}

pub fn get_analytics_repository() -> Option<Arc<AnalyticsRepository>> {
    ANALYTICS_REPOSITORY.get().cloned()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::create_test_pool;

    const GAME: &str = "162.249.72.5";
    const VOICE: &str = "20.47.65.180";

    async fn trace(pool: &SqlitePool, id: i64, session: i64, target: &str, rtts: &[Option<f64>]) {
        sqlx::query("INSERT INTO traceroutes (id, session_id, target_ip, started_at) VALUES ($1, $2, $3, '2026-10-08T14:00:00Z')")
            .bind(id)
            .bind(session)
            .bind(target)
            .execute(pool)
            .await
            .unwrap();
        for (i, rtt) in rtts.iter().enumerate() {
            sqlx::query(
                "INSERT INTO hops (traceroute_id, hop_number, latency_avg) VALUES ($1, $2, $3)",
            )
            .bind(id)
            .bind(i as i32 + 1)
            .bind(rtt)
            .execute(pool)
            .await
            .unwrap();
        }
    }

    async fn repo_with_pings() -> AnalyticsRepository {
        let pool = create_test_pool().await;
        sqlx::query(
            "INSERT INTO sessions (id, game_name, started_at) VALUES
                (1, 'VALORANT', '2026-10-08T14:00:00Z'),
                (2, 'VALORANT', '2026-10-08T20:00:00Z')",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO ip_periods (session_id, ip, protocol, port, started_at, ended_at, is_game_server)
             VALUES (1, $1, 'UDP', 7036, '2026-10-08T14:00:00Z', '2026-10-08T14:30:00Z', 1)",
        )
        .bind(GAME)
        .execute(&pool)
        .await
        .unwrap();
        trace(&pool, 1, 1, GAME, &[Some(1.0), Some(10.0), None]).await;
        trace(&pool, 2, 1, VOICE, &[Some(1.0), Some(5.0), Some(30.0)]).await;
        trace(&pool, 3, 2, GAME, &[Some(2.0), Some(40.0)]).await;
        AnalyticsRepository::new(pool)
    }

    #[tokio::test]
    async fn every_ping_is_read_at_the_last_responding_hop() {
        let repo = repo_with_pings().await;

        let servers = repo.get_server_stability().await.unwrap();
        let ping = |ip: &str| servers.iter().find(|s| s.ip == ip).unwrap().avg_latency;
        assert_eq!(ping(GAME), Some(25.0));
        assert_eq!(ping(VOICE), Some(30.0));

        let overview = repo.get_network_overview_stats().await.unwrap();
        assert_eq!(overview.avg_latency, Some(25.0));
    }
}

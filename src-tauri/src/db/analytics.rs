use crate::db::DbError;
use crate::models::insights::{HourlyQuality, ServerStability, SessionQualityPoint};
use crate::models::network::{NetworkMapEntry, NetworkOverviewStats, RecurringProblemHop};
use crate::models::severity::Severity;
use sqlx::sqlite::SqlitePool;
use std::sync::{Arc, OnceLock};

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

        // Use destination hop latency (last responding hop per traceroute)
        // rather than average of all hops, which inflates the value.
        let avg_latency: (Option<f64>,) = sqlx::query_as(
            "SELECT AVG(dest.latency_avg) FROM (
                SELECT h.latency_avg
                FROM hops h
                JOIN traceroutes t ON t.id = h.traceroute_id
                JOIN (SELECT DISTINCT ip FROM ip_periods WHERE is_game_server = 1) gs ON gs.ip = t.target_ip
                WHERE h.latency_avg IS NOT NULL
                  AND h.hop_number = (
                    SELECT MAX(h2.hop_number) FROM hops h2
                    WHERE h2.traceroute_id = t.id AND h2.latency_avg IS NOT NULL
                  )
             ) dest",
        )
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

    pub async fn get_network_quality_over_time(
        &self,
    ) -> Result<Vec<SessionQualityPoint>, DbError> {
        sqlx::query_as::<_, SessionQualityPoint>(
            "SELECT
                s.id as session_id,
                s.game_name,
                s.started_at,
                AVG(h.latency_avg) as avg_latency,
                CASE WHEN COUNT(h.id) > 0
                    THEN CAST(SUM(CASE WHEN h.is_problem_hop = 1 THEN 1 ELSE 0 END) AS REAL) / COUNT(h.id)
                    ELSE 0.0
                END as problem_hop_ratio,
                COALESCE(ip_counts.ip_count, 0) as ip_count
             FROM sessions s
             LEFT JOIN traceroutes t ON t.session_id = s.id
             LEFT JOIN hops h ON h.traceroute_id = t.id
             LEFT JOIN (
                 SELECT session_id, COUNT(DISTINCT ip) as ip_count
                 FROM ip_periods
                 GROUP BY session_id
             ) ip_counts ON ip_counts.session_id = s.id
             GROUP BY s.id
             ORDER BY s.started_at ASC",
        )
        .fetch_all(&self.pool)
        .await
        .map_err(Into::into)
    }

    pub async fn get_server_stability(&self) -> Result<Vec<ServerStability>, DbError> {
        sqlx::query_as::<_, ServerStability>(
            "SELECT
                t.target_ip as ip,
                m.asn,
                m.isp,
                m.country,
                m.lat,
                m.lon,
                AVG(h.latency_avg) as avg_latency,
                AVG(h.packet_loss) as avg_packet_loss,
                COUNT(DISTINCT t.id) as traceroute_count,
                CASE WHEN COUNT(h.id) > 0
                    THEN CAST(SUM(CASE WHEN h.is_problem_hop = 1 THEN 1 ELSE 0 END) AS REAL) / COUNT(h.id)
                    ELSE 0.0
                END as problem_hop_ratio,
                COALESCE(gs.is_game_server, 0) as is_game_server
             FROM traceroutes t
             LEFT JOIN hops h ON h.traceroute_id = t.id
             LEFT JOIN ip_metadata m ON m.ip = t.target_ip
             LEFT JOIN (
                 SELECT ip, MAX(is_game_server) as is_game_server
                 FROM ip_periods GROUP BY ip
             ) gs ON gs.ip = t.target_ip
             GROUP BY t.target_ip
             ORDER BY problem_hop_ratio ASC, avg_latency ASC",
        )
        .fetch_all(&self.pool)
        .await
        .map_err(Into::into)
    }

    pub async fn get_hourly_quality(&self) -> Result<Vec<HourlyQuality>, DbError> {
        sqlx::query_as::<_, HourlyQuality>(
            "SELECT
                CAST(strftime('%H', s.started_at) AS INTEGER) as hour,
                COUNT(DISTINCT s.id) as session_count,
                AVG(h.latency_avg) as avg_latency,
                CASE WHEN COUNT(h.id) > 0
                    THEN CAST(SUM(CASE WHEN h.is_problem_hop = 1 THEN 1 ELSE 0 END) AS REAL) / COUNT(h.id)
                    ELSE 0.0
                END as problem_hop_ratio
             FROM sessions s
             LEFT JOIN traceroutes t ON t.session_id = s.id
             LEFT JOIN hops h ON h.traceroute_id = t.id
             GROUP BY hour
             ORDER BY hour ASC",
        )
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

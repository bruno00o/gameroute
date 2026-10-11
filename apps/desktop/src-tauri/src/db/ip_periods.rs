use crate::config::{
    ACTIVITY_PERIOD_THRESHOLD_SECS, GAME_SERVER_MIN_DURATION_SECS, MATCH_GAP_GRACE_SECS,
    MATCH_MERGE_BACKUP_SUFFIX,
};
use crate::db::DbError;
use crate::models::flow_kind::FlowKind;
use crate::models::ip_period::{
    FlowPeriod, IpActivityUpsert, IpPeriod, IpPeriodData, IpPeriodSummary, MatchPeriodBackfill,
    TraceCandidate,
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
        packet_count: i64,
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
            "SELECT id, session_id, ip, protocol, port, started_at, ended_at, packet_count, is_game_server, flow_kind
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
        packet_count: Option<u32>,
    ) -> Result<IpActivityUpsert, DbError> {
        if ip.parse::<IpAddr>().is_err() {
            return Err(DbError::Validation(format!("Invalid IP address: {}", ip)));
        }

        let packets = packet_count.map_or(1, i64::from);
        let latest = self.get_latest_period_for_ip(session_id, ip).await?;

        if let Some(period) = latest {
            if let (Ok(started), Ok(ended), Ok(now)) = (
                chrono::DateTime::parse_from_rfc3339(&period.started_at),
                chrono::DateTime::parse_from_rfc3339(&period.ended_at),
                chrono::DateTime::parse_from_rfc3339(timestamp),
            ) {
                let elapsed = (now - ended).num_seconds();
                let same_flow = period.protocol == protocol && period.port == port;
                let window = if period.is_game_server && same_flow {
                    MATCH_GAP_GRACE_SECS
                } else {
                    ACTIVITY_PERIOD_THRESHOLD_SECS
                };
                if elapsed < window {
                    let new_count = period.packet_count + packets;
                    let total_duration = (now - started).num_seconds();
                    let is_voice = period.flow_kind.as_deref() == Some(FlowKind::Voice.as_str());
                    let is_game_server = !is_voice
                        && (period.is_game_server
                            || (protocol == "UDP"
                                && total_duration >= GAME_SERVER_MIN_DURATION_SECS));
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

        let data = IpPeriodData::new(session_id, ip.to_string(), protocol.to_string(), port, timestamp.to_string(), packets);
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
            "SELECT id, session_id, ip, protocol, port, started_at, ended_at, packet_count, is_game_server, flow_kind
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
                MAX(is_game_server) as is_game_server,
                MAX(flow_kind) as flow_kind
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
                       ROW_NUMBER() OVER (PARTITION BY ip ORDER BY is_game_server DESC, flow_kind = $2 DESC, ended_at DESC) AS rn,
                       MAX(is_game_server) OVER (PARTITION BY ip) AS any_game_server,
                       MAX(COALESCE(flow_kind = $2, 0)) OVER (PARTITION BY ip) AS any_voice,
                       SUM(CAST(ROUND((julianday(ended_at) - julianday(started_at)) * 86400) AS INTEGER)) OVER (PARTITION BY ip) AS total_secs,
                       MIN(started_at) OVER (PARTITION BY ip) AS first_seen
                FROM ip_periods
                WHERE session_id = $1
             )
             SELECT ip, protocol, port, any_game_server AS is_game_server, any_voice AS is_voice, total_secs
             FROM ranked
             WHERE rn = 1
             ORDER BY first_seen ASC",
        )
        .bind(session_id)
        .bind(FlowKind::Voice.as_str())
        .fetch_all(&self.pool)
        .await
        .map_err(Into::into)
    }

    pub async fn get_flow_periods(&self, session_id: i64) -> Result<Vec<FlowPeriod>, DbError> {
        self.get_flow_periods_for_sessions(&[session_id]).await
    }

    pub async fn get_flow_periods_for_sessions(
        &self,
        session_ids: &[i64],
    ) -> Result<Vec<FlowPeriod>, DbError> {
        sqlx::query_as::<_, FlowPeriod>(
            "SELECT p.id, p.session_id, p.ip, p.protocol, p.port, p.started_at, p.ended_at, p.packet_count, p.is_game_server, p.flow_kind,
                    m.asn, COALESCE(m.org, m.isp) AS operator_name, m.city, m.country
             FROM ip_periods p
             LEFT JOIN ip_metadata m ON m.ip = p.ip
             WHERE p.session_id IN (SELECT value FROM json_each($1))
               AND (p.is_game_server = 1 OR p.flow_kind = $2)
             ORDER BY p.session_id ASC, p.started_at ASC, p.id ASC",
        )
        .bind(serde_json::to_string(session_ids).unwrap_or_default())
        .bind(FlowKind::Voice.as_str())
        .fetch_all(&self.pool)
        .await
        .map_err(Into::into)
    }

    pub async fn set_flow_kind(&self, period_id: i64, kind: FlowKind) -> Result<(), DbError> {
        sqlx::query(
            "UPDATE ip_periods
             SET flow_kind = $1, is_game_server = CASE WHEN $1 = $2 THEN 0 WHEN $1 = $3 THEN 1 ELSE is_game_server END
             WHERE id = $4",
        )
        .bind(kind.as_str())
        .bind(FlowKind::Voice.as_str())
        .bind(FlowKind::Game.as_str())
        .bind(period_id)
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    pub async fn get_unclassified_game_server_flows(&self) -> Result<Vec<(String, String, i32)>, DbError> {
        sqlx::query_as(
            "SELECT DISTINCT ip, protocol, port FROM ip_periods WHERE is_game_server = 1 AND flow_kind IS NULL",
        )
        .fetch_all(&self.pool)
        .await
        .map_err(Into::into)
    }

    pub async fn classify_flow(&self, ip: &str, protocol: &str, port: i32, kind: FlowKind) -> Result<(), DbError> {
        sqlx::query(
            "UPDATE ip_periods
             SET flow_kind = $4, is_game_server = CASE WHEN $4 = $5 THEN 0 ELSE is_game_server END
             WHERE ip = $1 AND protocol = $2 AND port = $3 AND is_game_server = 1 AND flow_kind IS NULL",
        )
        .bind(ip)
        .bind(protocol)
        .bind(port)
        .bind(kind.as_str())
        .bind(FlowKind::Voice.as_str())
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    pub async fn merge_closed_match_periods(
        &self,
        is_known_game_server: impl Fn(&str, &str, u16) -> bool,
    ) -> Result<MatchPeriodBackfill, DbError> {
        let periods = sqlx::query_as::<_, IpPeriod>(
            "SELECT p.id, p.session_id, p.ip, p.protocol, p.port, p.started_at, p.ended_at, p.packet_count, p.is_game_server, p.flow_kind
             FROM ip_periods p
             JOIN sessions s ON s.id = p.session_id
             WHERE s.ended_at IS NOT NULL
               AND EXISTS (
                   SELECT 1 FROM ip_periods u
                   WHERE u.session_id = p.session_id AND u.ip = p.ip AND u.protocol = 'UDP'
               )
             ORDER BY p.session_id, p.ip, p.started_at, p.id",
        )
        .fetch_all(&self.pool)
        .await?;

        let plan = plan_match_periods(periods, is_known_game_server);
        let mut outcome = MatchPeriodBackfill::default();
        if plan.is_empty() {
            return Ok(outcome);
        }
        if plan.iter().any(|planned| !planned.absorbed.is_empty()) {
            self.back_up_once(MATCH_MERGE_BACKUP_SUFFIX).await?;
        }

        let mut tx = self.pool.begin().await?;
        for planned in &plan {
            let period = &planned.period;
            sqlx::query(
                "UPDATE ip_periods SET ended_at = $1, packet_count = $2, is_game_server = $3, flow_kind = $4 WHERE id = $5",
            )
            .bind(&period.ended_at)
            .bind(period.packet_count)
            .bind(period.is_game_server)
            .bind(&period.flow_kind)
            .bind(period.id)
            .execute(&mut *tx)
            .await?;

            for id in &planned.absorbed {
                sqlx::query("DELETE FROM ip_periods WHERE id = $1")
                    .bind(id)
                    .execute(&mut *tx)
                    .await?;
            }

            outcome.recognised += usize::from(planned.recognised);
            outcome.absorbed += planned.absorbed.len();
        }
        tx.commit().await?;

        Ok(outcome)
    }

    async fn back_up_once(&self, suffix: &str) -> Result<(), DbError> {
        let (file,): (String,) =
            sqlx::query_as("SELECT file FROM pragma_database_list WHERE name = 'main'")
                .fetch_one(&self.pool)
                .await?;
        if file.is_empty() {
            return Ok(());
        }
        let backup = format!("{file}.{suffix}");
        if std::path::Path::new(&backup).exists() {
            return Ok(());
        }
        sqlx::query("VACUUM INTO $1")
            .bind(&backup)
            .execute(&self.pool)
            .await?;
        log::info!("Database backed up to {}", backup);
        Ok(())
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

struct PlannedPeriod {
    period: IpPeriod,
    absorbed: Vec<i64>,
    recognised: bool,
}

fn seconds_between(from: &str, to: &str) -> Option<i64> {
    let from = chrono::DateTime::parse_from_rfc3339(from).ok()?;
    let to = chrono::DateTime::parse_from_rfc3339(to).ok()?;
    Some((to - from).num_seconds())
}

fn plan_match_periods(
    periods: Vec<IpPeriod>,
    is_known_game_server: impl Fn(&str, &str, u16) -> bool,
) -> Vec<PlannedPeriod> {
    let mut plan = Vec::new();
    let mut open: Option<PlannedPeriod> = None;

    for mut period in periods {
        if let Some(current) = open.as_mut() {
            let kept = &mut current.period;
            let continues_match = kept.is_game_server
                && kept.session_id == period.session_id
                && kept.ip == period.ip
                && kept.protocol == period.protocol
                && kept.port == period.port
                && seconds_between(&kept.ended_at, &period.started_at)
                    .is_some_and(|gap| gap < MATCH_GAP_GRACE_SECS);
            if continues_match {
                if seconds_between(&kept.ended_at, &period.ended_at).is_some_and(|later| later > 0) {
                    kept.ended_at = period.ended_at;
                }
                kept.packet_count += period.packet_count;
                current.absorbed.push(period.id);
                continue;
            }
        }

        plan.extend(open.take().filter(|p| p.recognised || !p.absorbed.is_empty()));

        let port = u16::try_from(period.port).unwrap_or(0);
        let recognised = is_known_game_server(&period.ip, &period.protocol, port)
            && !(period.is_game_server && period.flow_kind.as_deref() == Some(FlowKind::Game.as_str()));
        if recognised {
            period.is_game_server = true;
            period.flow_kind = Some(FlowKind::Game.as_str().to_string());
        }
        open = Some(PlannedPeriod { period, absorbed: Vec::new(), recognised });
    }

    plan.extend(open.filter(|p| p.recognised || !p.absorbed.is_empty()));
    plan
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

        let data = IpPeriodData::new(1, "8.8.8.8".to_string(), "TCP".to_string(), 443, "2026-01-25T10:00:00Z".to_string(), 1);
        let id = repo.insert_period(&data).await.expect("Failed to insert");

        assert!(id > 0);
    }

    #[tokio::test]
    async fn test_upsert_extends_recent_period() {
        let repo = create_test_repo().await;

        let first = repo
            .upsert_ip_activity(1, "8.8.8.8", "UDP", 27015, "2026-01-25T10:00:00Z", None)
            .await
            .unwrap();
        assert!(first.is_new);

        let second = repo
            .upsert_ip_activity(1, "8.8.8.8", "UDP", 27015, "2026-01-25T10:00:03Z", None)
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
            .upsert_ip_activity(1, "8.8.8.8", "TCP", 443, "2026-01-25T10:00:00Z", None)
            .await
            .unwrap();
        assert!(first.is_new);

        let second = repo
            .upsert_ip_activity(1, "8.8.8.8", "TCP", 443, "2026-01-25T10:00:10Z", None)
            .await
            .unwrap();
        assert!(second.is_new);
        assert_ne!(first.period_id, second.period_id);
    }

    #[tokio::test]
    async fn test_upsert_accumulates_real_packet_counts() {
        let repo = create_test_repo().await;

        for (ts, packets) in [
            ("2026-01-25T10:00:00Z", 384),
            ("2026-01-25T10:00:05Z", 391),
            ("2026-01-25T10:00:10Z", 12),
        ] {
            repo.upsert_ip_activity(1, "162.249.72.5", "UDP", 7032, ts, Some(packets))
                .await
                .unwrap();
        }

        let period = repo.get_latest_period_for_ip(1, "162.249.72.5").await.unwrap().unwrap();
        assert_eq!(period.packet_count, 787);

        let summaries = repo.get_ip_summaries_for_session(1).await.unwrap();
        assert_eq!(summaries[0].total_packet_count, 787);
    }

    #[tokio::test]
    async fn test_upsert_counts_one_per_reading_without_packet_count() {
        let repo = create_test_repo().await;

        repo.upsert_ip_activity(1, "104.18.41.183", "TCP", 443, "2026-01-25T10:00:00Z", None)
            .await
            .unwrap();
        repo.upsert_ip_activity(1, "104.18.41.183", "TCP", 443, "2026-01-25T10:00:05Z", None)
            .await
            .unwrap();
        repo.upsert_ip_activity(1, "104.18.41.183", "TCP", 443, "2026-01-25T10:00:10Z", Some(40))
            .await
            .unwrap();

        let period = repo.get_latest_period_for_ip(1, "104.18.41.183").await.unwrap().unwrap();
        assert_eq!(period.packet_count, 42);
    }

    #[tokio::test]
    async fn test_packet_volume_does_not_make_a_game_server() {
        let repo = create_test_repo().await;

        for sec in (0..=25).step_by(5) {
            let ts = format!("2026-01-25T10:00:{:02}Z", sec);
            let outcome = repo
                .upsert_ip_activity(1, "162.249.72.5", "UDP", 7032, &ts, Some(50_000))
                .await
                .unwrap();
            assert!(!outcome.became_game_server);
        }
    }

    async fn feed_udp(repo: &IpPeriodRepository, ip: &str, port: i32, from_sec: u32, to_sec: u32) -> Vec<IpActivityUpsert> {
        let mut outcomes = Vec::new();
        let mut sec = from_sec;
        while sec <= to_sec {
            let ts = format!("2026-01-25T10:{:02}:{:02}Z", sec / 60, sec % 60);
            outcomes.push(repo.upsert_ip_activity(1, ip, "UDP", port, &ts, Some(380)).await.unwrap());
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
            let outcome = repo.upsert_ip_activity(1, "104.18.41.183", "TCP", 443, &ts, None).await.unwrap();
            assert!(!outcome.became_game_server);
        }
    }

    #[tokio::test]
    async fn test_voice_flow_is_never_flagged_as_game_server() {
        let repo = create_test_repo().await;

        let outcomes = feed_udp(&repo, "20.157.94.82", 27020, 0, 30).await;
        let period_id = outcomes.last().unwrap().period_id;
        assert!(outcomes.last().unwrap().became_game_server);

        repo.set_flow_kind(period_id, FlowKind::Voice).await.unwrap();

        let later = feed_udp(&repo, "20.157.94.82", 27020, 35, 120).await;
        assert!(later.iter().all(|o| !o.became_game_server && o.period_id == period_id));

        let period = repo.get_latest_period_for_ip(1, "20.157.94.82").await.unwrap().unwrap();
        assert!(!period.is_game_server);
        assert_eq!(period.flow_kind.as_deref(), Some("voice"));
    }

    #[tokio::test]
    async fn test_game_server_period_bridges_gaps_within_the_grace_window() {
        let repo = create_test_repo().await;

        let first = feed_udp(&repo, "162.249.72.5", 7036, 0, 60).await;
        let after_gap = feed_udp(&repo, "162.249.72.5", 7036, 95, 120).await;

        assert!(after_gap
            .iter()
            .all(|o| !o.is_new && !o.became_game_server && o.period_id == first[0].period_id));
        let periods = repo.get_periods_for_session(1).await.unwrap();
        assert_eq!(periods.len(), 1);
        assert_eq!(periods[0].ended_at, "2026-01-25T10:02:00Z");
    }

    #[tokio::test]
    async fn test_game_server_period_closes_after_the_grace_window() {
        let repo = create_test_repo().await;

        let first = feed_udp(&repo, "162.249.72.5", 7036, 0, 60).await;
        let next = feed_udp(&repo, "162.249.72.5", 7036, 105, 105).await;

        assert!(next[0].is_new);
        assert_ne!(next[0].period_id, first[0].period_id);
    }

    #[tokio::test]
    async fn test_new_port_after_a_gap_starts_a_new_match() {
        let repo = create_test_repo().await;

        let first = feed_udp(&repo, "162.249.72.5", 7036, 0, 60).await;
        let next = feed_udp(&repo, "162.249.72.5", 7108, 80, 80).await;

        assert!(next[0].is_new);
        assert_ne!(next[0].period_id, first[0].period_id);
    }

    #[tokio::test]
    async fn test_recognised_game_server_bridges_gaps_from_the_first_reading() {
        let repo = create_test_repo().await;

        let start = repo
            .upsert_ip_activity(1, "162.249.72.5", "UDP", 7036, "2026-01-25T10:00:00Z", Some(380))
            .await
            .unwrap();
        repo.set_flow_kind(start.period_id, FlowKind::Game).await.unwrap();
        let after_gap = feed_udp(&repo, "162.249.72.5", 7036, 20, 20).await;

        assert!(!after_gap[0].is_new && !after_gap[0].became_game_server);
        assert_eq!(after_gap[0].period_id, start.period_id);
    }

    #[tokio::test]
    async fn test_short_gaps_still_split_flows_that_are_not_game_servers() {
        let repo = create_test_repo().await;

        let ping = feed_udp(&repo, "162.249.75.1", 8181, 0, 0).await;
        let ping_again = feed_udp(&repo, "162.249.75.1", 8181, 20, 20).await;
        assert!(ping_again[0].is_new);
        assert_ne!(ping_again[0].period_id, ping[0].period_id);

        let voice = feed_udp(&repo, "20.157.94.82", 27020, 0, 60).await;
        repo.set_flow_kind(voice[0].period_id, FlowKind::Voice).await.unwrap();
        let voice_again = feed_udp(&repo, "20.157.94.82", 27020, 80, 80).await;
        assert!(voice_again[0].is_new);
        assert!(!voice_again[0].became_game_server);
    }

    #[tokio::test]
    async fn test_match_with_silent_rounds_is_one_trace_candidate() {
        let repo = create_test_repo().await;

        let start = repo
            .upsert_ip_activity(1, "162.249.72.5", "UDP", 7036, "2026-01-25T10:00:00Z", Some(380))
            .await
            .unwrap();
        repo.set_flow_kind(start.period_id, FlowKind::Game).await.unwrap();
        let mut outcomes = Vec::new();
        for (from, to) in [(15, 20), (40, 300), (335, 600)] {
            outcomes.extend(feed_udp(&repo, "162.249.72.5", 7036, from, to).await);
        }

        assert!(outcomes.iter().all(|o| !o.is_new && !o.became_game_server));
        assert_eq!(repo.get_periods_for_session(1).await.unwrap().len(), 1);
        let candidates = repo.get_trace_candidates(1).await.unwrap();
        assert_eq!(candidates.len(), 1);
        assert!(candidates[0].is_game_server);
        assert_eq!(candidates[0].total_secs, 600);
    }

    async fn stored_period(
        repo: &IpPeriodRepository,
        ip: &str,
        port: i32,
        (from_sec, to_sec): (u32, u32),
        flow_kind: Option<FlowKind>,
    ) -> i64 {
        let ts = |sec: u32| format!("2026-01-25T10:{:02}:{:02}Z", sec / 60, sec % 60);
        let mut data = IpPeriodData::new(1, ip.to_string(), "UDP".to_string(), port, ts(from_sec), 100);
        data.ended_at = ts(to_sec);
        let id = repo.insert_period(&data).await.unwrap();
        let is_game_server = flow_kind == Some(FlowKind::Game);
        repo.update_period(id, &data.ended_at, 100, is_game_server).await.unwrap();
        if let Some(kind) = flow_kind {
            repo.set_flow_kind(id, kind).await.unwrap();
        }
        id
    }

    async fn close_session(repo: &IpPeriodRepository) {
        sqlx::query("UPDATE sessions SET ended_at = '2026-01-25T12:00:00Z' WHERE id = 1")
            .execute(&repo.pool)
            .await
            .unwrap();
    }

    fn riot_signature(_: &str, protocol: &str, port: u16) -> bool {
        protocol == "UDP" && (7000..=7999).contains(&port)
    }

    #[tokio::test]
    async fn test_backfill_backs_up_the_database_once_before_merging() {
        let dir = tempfile::tempdir().unwrap();
        let pool = crate::db::init_database(dir.path()).await.unwrap();
        sqlx::query(
            "INSERT INTO sessions (id, game_name, started_at) VALUES (1, 'Test', '2026-01-25T10:00:00Z')",
        )
        .execute(&pool)
        .await
        .unwrap();
        let repo = IpPeriodRepository::new(pool);
        stored_period(&repo, "162.249.72.5", 7036, (0, 20), None).await;
        stored_period(&repo, "162.249.72.5", 7036, (30, 200), Some(FlowKind::Game)).await;
        close_session(&repo).await;

        repo.merge_closed_match_periods(riot_signature).await.unwrap();

        let backup = dir.path().join(format!("gameroute.db.{MATCH_MERGE_BACKUP_SUFFIX}"));
        let backed_up = SqlitePool::connect(&format!("sqlite:{}?mode=ro", backup.display()))
            .await
            .unwrap();
        let (count,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM ip_periods")
            .fetch_one(&backed_up)
            .await
            .unwrap();
        assert_eq!(count, 2);
        assert_eq!(repo.get_periods_for_session(1).await.unwrap().len(), 1);
    }

    #[tokio::test]
    async fn test_backfill_merges_the_fragments_of_a_known_match() {
        let repo = create_test_repo().await;
        let first = stored_period(&repo, "162.249.72.5", 7036, (0, 20), None).await;
        stored_period(&repo, "162.249.72.5", 7036, (30, 200), Some(FlowKind::Game)).await;
        stored_period(&repo, "162.249.72.5", 7036, (215, 220), None).await;
        stored_period(&repo, "162.249.72.5", 7036, (255, 600), Some(FlowKind::Game)).await;
        let ping = stored_period(&repo, "162.249.72.5", 8181, (610, 611), None).await;
        close_session(&repo).await;

        let outcome = repo.merge_closed_match_periods(riot_signature).await.unwrap();

        assert_eq!(outcome, MatchPeriodBackfill { recognised: 1, absorbed: 3 });
        let periods = repo.get_periods_for_session(1).await.unwrap();
        let ids: Vec<i64> = periods.iter().map(|p| p.id).collect();
        assert_eq!(ids, vec![first, ping]);
        assert_eq!(periods[0].started_at, "2026-01-25T10:00:00Z");
        assert_eq!(periods[0].ended_at, "2026-01-25T10:10:00Z");
        assert_eq!(periods[0].packet_count, 400);
        assert!(periods[0].is_game_server);
        assert_eq!(periods[0].flow_kind.as_deref(), Some("game"));
        assert!(!periods[1].is_game_server);
    }

    #[tokio::test]
    async fn test_backfill_keeps_matches_voice_and_unknown_fragments_apart() {
        let repo = create_test_repo().await;
        stored_period(&repo, "162.249.72.5", 7036, (0, 600), Some(FlowKind::Game)).await;
        stored_period(&repo, "162.249.72.5", 7108, (630, 1200), Some(FlowKind::Game)).await;
        stored_period(&repo, "162.249.72.5", 7108, (1245, 1300), Some(FlowKind::Game)).await;
        stored_period(&repo, "20.157.94.82", 27020, (0, 100), Some(FlowKind::Voice)).await;
        stored_period(&repo, "20.157.94.82", 27020, (120, 130), None).await;
        stored_period(&repo, "155.133.226.70", 27015, (0, 20), None).await;
        stored_period(&repo, "155.133.226.70", 27015, (30, 45), None).await;
        close_session(&repo).await;

        let outcome = repo.merge_closed_match_periods(riot_signature).await.unwrap();

        assert_eq!(outcome, MatchPeriodBackfill::default());
        assert_eq!(repo.get_periods_for_session(1).await.unwrap().len(), 7);
    }

    #[tokio::test]
    async fn test_backfill_merges_unknown_game_servers_after_thirty_seconds() {
        let repo = create_test_repo().await;
        let id = stored_period(&repo, "155.133.226.70", 27015, (0, 200), Some(FlowKind::Game)).await;
        stored_period(&repo, "155.133.226.70", 27015, (220, 225), None).await;
        close_session(&repo).await;

        let outcome = repo.merge_closed_match_periods(riot_signature).await.unwrap();

        assert_eq!(outcome, MatchPeriodBackfill { recognised: 0, absorbed: 1 });
        let periods = repo.get_periods_for_session(1).await.unwrap();
        assert_eq!(periods.len(), 1);
        assert_eq!(periods[0].id, id);
        assert_eq!(periods[0].ended_at, "2026-01-25T10:03:45Z");
    }

    #[tokio::test]
    async fn test_backfill_skips_open_sessions_and_runs_once() {
        let repo = create_test_repo().await;
        stored_period(&repo, "162.249.72.5", 7036, (0, 20), None).await;
        stored_period(&repo, "162.249.72.5", 7036, (30, 200), Some(FlowKind::Game)).await;

        let open = repo.merge_closed_match_periods(riot_signature).await.unwrap();
        assert_eq!(open, MatchPeriodBackfill::default());
        assert_eq!(repo.get_periods_for_session(1).await.unwrap().len(), 2);

        close_session(&repo).await;
        let first = repo.merge_closed_match_periods(riot_signature).await.unwrap();
        let second = repo.merge_closed_match_periods(riot_signature).await.unwrap();

        assert_eq!(first, MatchPeriodBackfill { recognised: 1, absorbed: 1 });
        assert_eq!(second, MatchPeriodBackfill::default());
        assert_eq!(repo.get_periods_for_session(1).await.unwrap().len(), 1);
    }

    #[tokio::test]
    async fn test_classify_flow_backfills_unclassified_game_servers() {
        let repo = create_test_repo().await;
        feed_udp(&repo, "20.157.94.82", 27020, 0, 60).await;
        feed_udp(&repo, "162.249.72.5", 7032, 0, 60).await;

        let flows = repo.get_unclassified_game_server_flows().await.unwrap();
        assert_eq!(flows.len(), 2);

        repo.classify_flow("20.157.94.82", "UDP", 27020, FlowKind::Voice).await.unwrap();
        repo.classify_flow("162.249.72.5", "UDP", 7032, FlowKind::Game).await.unwrap();

        assert!(repo.get_unclassified_game_server_flows().await.unwrap().is_empty());

        let summaries = repo.get_ip_summaries_for_session(1).await.unwrap();
        let voice = summaries.iter().find(|s| s.ip == "20.157.94.82").unwrap();
        assert!(!voice.is_game_server);
        assert_eq!(voice.flow_kind.as_deref(), Some("voice"));
        let game = summaries.iter().find(|s| s.ip == "162.249.72.5").unwrap();
        assert!(game.is_game_server);
        assert_eq!(game.flow_kind.as_deref(), Some("game"));

        let candidates = repo.get_trace_candidates(1).await.unwrap();
        let voice = candidates.iter().find(|c| c.ip == "20.157.94.82").unwrap();
        assert!(voice.is_voice && !voice.is_game_server);
        let game = candidates.iter().find(|c| c.ip == "162.249.72.5").unwrap();
        assert!(game.is_game_server && !game.is_voice);
    }

    #[tokio::test]
    async fn test_trace_candidates_prefer_game_server_period() {
        let repo = create_test_repo().await;

        repo.upsert_ip_activity(1, "162.249.72.5", "UDP", 8181, "2026-01-25T10:00:00Z", None)
            .await
            .unwrap();
        feed_udp(&repo, "162.249.72.5", 7032, 30, 90).await;
        repo.upsert_ip_activity(1, "162.249.72.5", "UDP", 8181, "2026-01-25T10:05:00Z", None)
            .await
            .unwrap();
        repo.upsert_ip_activity(1, "104.18.41.183", "TCP", 443, "2026-01-25T10:00:01Z", None)
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

        repo.upsert_ip_activity(1, "1.1.1.1", "TCP", 80, "2026-01-25T10:00:00Z", None)
            .await
            .unwrap();
        repo.upsert_ip_activity(1, "2.2.2.2", "UDP", 27015, "2026-01-25T10:00:05Z", None)
            .await
            .unwrap();
        repo.upsert_ip_activity(1, "1.1.1.1", "TCP", 80, "2026-01-25T10:01:00Z", None)
            .await
            .unwrap();

        let periods = repo.get_periods_for_session(1).await.unwrap();
        assert_eq!(periods.len(), 3);
    }

    #[tokio::test]
    async fn test_get_unique_ips() {
        let repo = create_test_repo().await;

        repo.upsert_ip_activity(1, "1.1.1.1", "TCP", 80, "2026-01-25T10:00:00Z", None)
            .await
            .unwrap();
        repo.upsert_ip_activity(1, "2.2.2.2", "UDP", 27015, "2026-01-25T10:00:05Z", None)
            .await
            .unwrap();
        repo.upsert_ip_activity(1, "1.1.1.1", "TCP", 80, "2026-01-25T10:01:00Z", None)
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
            .upsert_ip_activity(1, "not-an-ip", "TCP", 80, "2026-01-25T10:00:00Z", None)
            .await;
        assert!(result.is_err());

        let result = repo.upsert_ip_activity(1, "", "TCP", 80, "2026-01-25T10:00:00Z", None).await;
        assert!(result.is_err());
    }
}

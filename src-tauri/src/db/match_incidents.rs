use crate::db::DbError;
use crate::models::insights::{IncidentCause, PingBasis, PingSource};
use crate::models::live_status::{FaultZone, MatchIncident};
use crate::models::severity::Severity;
use sqlx::sqlite::SqlitePool;
use std::sync::{Arc, OnceLock};

const CAUSES: [IncidentCause; 3] = [
    IncidentCause::Latency,
    IncidentCause::Loss,
    IncidentCause::Jitter,
];

const ZONES: [FaultZone; 7] = [
    FaultZone::Home,
    FaultZone::Isp,
    FaultZone::Transit,
    FaultZone::Service,
    FaultZone::AfterIsp,
    FaultZone::NotHome,
    FaultZone::Unlocated,
];

#[derive(sqlx::FromRow)]
struct IncidentRow {
    id: i64,
    session_id: i64,
    server_ip: String,
    server_port: i32,
    match_started_at: String,
    started_at: String,
    ended_at: Option<String>,
    status: String,
    cause: Option<String>,
    source: String,
    at_destination: bool,
    measured_hop: Option<i32>,
    measured_asn: Option<i64>,
    basis_server_ip: Option<String>,
    ping_ms: Option<f64>,
    usual_ms: Option<f64>,
    loss_pct: Option<f64>,
    jitter_ms: Option<f64>,
    zone: Option<String>,
    after_hop: Option<i32>,
    at_hop: Option<i32>,
    asn: Option<i64>,
    operator: Option<String>,
}

fn severity_token(status: Severity) -> String {
    serde_json::to_value(status)
        .ok()
        .and_then(|value| value.as_str().map(str::to_string))
        .unwrap_or_default()
}

impl TryFrom<IncidentRow> for MatchIncident {
    type Error = DbError;

    fn try_from(row: IncidentRow) -> Result<Self, Self::Error> {
        let invalid = |what: &str| DbError::Validation(format!("unknown incident {what}"));
        let status: Severity = serde_json::from_value(serde_json::Value::String(row.status))
            .map_err(|_| invalid("status"))?;
        let cause = match row.cause {
            Some(cause) => Some(
                CAUSES
                    .into_iter()
                    .find(|c| c.as_str() == cause)
                    .ok_or_else(|| invalid("cause"))?,
            ),
            None => None,
        };
        let zone = match row.zone {
            Some(zone) => Some(
                ZONES
                    .into_iter()
                    .find(|z| z.as_str() == zone)
                    .ok_or_else(|| invalid("zone"))?,
            ),
            None => None,
        };
        let source = PingSource::try_from(row.source).map_err(DbError::Validation)?;
        Ok(MatchIncident {
            id: row.id,
            session_id: row.session_id,
            server_ip: row.server_ip,
            server_port: row.server_port,
            match_started_at: row.match_started_at,
            started_at: row.started_at,
            ended_at: row.ended_at,
            status,
            cause,
            basis: PingBasis {
                source,
                at_destination: row.at_destination,
                measured_hop: row.measured_hop,
                measured_asn: row.measured_asn.and_then(|asn| u32::try_from(asn).ok()),
                server_ip: row.basis_server_ip,
            },
            at_least: !row.at_destination,
            ping_ms: row.ping_ms,
            usual_ms: row.usual_ms,
            loss_pct: row.loss_pct,
            jitter_ms: row.jitter_ms,
            zone,
            after_hop: row.after_hop,
            at_hop: row.at_hop,
            asn: row.asn.and_then(|asn| u32::try_from(asn).ok()),
            operator: row.operator,
        })
    }
}

pub struct MatchIncidentRepository {
    pool: SqlitePool,
}

impl MatchIncidentRepository {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }

    pub async fn insert(&self, incident: &MatchIncident) -> Result<i64, DbError> {
        let result = sqlx::query(
            "INSERT INTO match_incidents
                (session_id, server_ip, server_port, match_started_at, started_at, ended_at, status,
                 cause, source, at_destination, measured_hop, measured_asn, basis_server_ip, ping_ms,
                 usual_ms, loss_pct, jitter_ms, zone, after_hop, at_hop, asn, operator)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17,
                     $18, $19, $20, $21, $22)",
        )
        .bind(incident.session_id)
        .bind(&incident.server_ip)
        .bind(incident.server_port)
        .bind(&incident.match_started_at)
        .bind(&incident.started_at)
        .bind(&incident.ended_at)
        .bind(severity_token(incident.status))
        .bind(incident.cause.map(IncidentCause::as_str))
        .bind(incident.basis.source.as_str())
        .bind(incident.basis.at_destination)
        .bind(incident.basis.measured_hop)
        .bind(incident.basis.measured_asn.map(i64::from))
        .bind(&incident.basis.server_ip)
        .bind(incident.ping_ms)
        .bind(incident.usual_ms)
        .bind(incident.loss_pct)
        .bind(incident.jitter_ms)
        .bind(incident.zone.map(FaultZone::as_str))
        .bind(incident.after_hop)
        .bind(incident.at_hop)
        .bind(incident.asn.map(i64::from))
        .bind(&incident.operator)
        .execute(&self.pool)
        .await?;
        Ok(result.last_insert_rowid())
    }

    pub async fn update(&self, incident: &MatchIncident) -> Result<(), DbError> {
        sqlx::query(
            "UPDATE match_incidents
             SET ended_at = $2, status = $3, cause = $4, source = $5, at_destination = $6,
                 measured_hop = $7, measured_asn = $8, basis_server_ip = $9, ping_ms = $10,
                 usual_ms = $11, loss_pct = $12, jitter_ms = $13, zone = $14, after_hop = $15,
                 at_hop = $16, asn = $17, operator = $18
             WHERE id = $1",
        )
        .bind(incident.id)
        .bind(&incident.ended_at)
        .bind(severity_token(incident.status))
        .bind(incident.cause.map(IncidentCause::as_str))
        .bind(incident.basis.source.as_str())
        .bind(incident.basis.at_destination)
        .bind(incident.basis.measured_hop)
        .bind(incident.basis.measured_asn.map(i64::from))
        .bind(&incident.basis.server_ip)
        .bind(incident.ping_ms)
        .bind(incident.usual_ms)
        .bind(incident.loss_pct)
        .bind(incident.jitter_ms)
        .bind(incident.zone.map(FaultZone::as_str))
        .bind(incident.after_hop)
        .bind(incident.at_hop)
        .bind(incident.asn.map(i64::from))
        .bind(&incident.operator)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn get_for_session(&self, session_id: i64) -> Result<Vec<MatchIncident>, DbError> {
        let rows = sqlx::query_as::<_, IncidentRow>(
            "SELECT id, session_id, server_ip, server_port, match_started_at, started_at, ended_at,
                    status, cause, source, at_destination, measured_hop, measured_asn,
                    basis_server_ip, ping_ms, usual_ms, loss_pct, jitter_ms, zone, after_hop,
                    at_hop, asn, operator
             FROM match_incidents
             WHERE session_id = $1
             ORDER BY started_at ASC, id ASC",
        )
        .bind(session_id)
        .fetch_all(&self.pool)
        .await?;
        rows.into_iter().map(MatchIncident::try_from).collect()
    }
}

static MATCH_INCIDENT_REPOSITORY: OnceLock<Arc<MatchIncidentRepository>> = OnceLock::new();

pub fn init_match_incident_repository(pool: SqlitePool) {
    let repo = MatchIncidentRepository::new(pool);
    let _ = MATCH_INCIDENT_REPOSITORY.set(Arc::new(repo));
    log::info!("Match incident repository initialized");
}

pub fn get_match_incident_repository() -> Option<Arc<MatchIncidentRepository>> {
    MATCH_INCIDENT_REPOSITORY.get().cloned()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::create_test_pool;
    use crate::db::sessions::SessionRepository;

    fn incident(session_id: i64) -> MatchIncident {
        MatchIncident {
            id: 0,
            session_id,
            server_ip: "162.249.72.5".to_string(),
            server_port: 7220,
            match_started_at: "2026-10-08T20:00:00.000Z".to_string(),
            started_at: "2026-10-08T20:25:20.000Z".to_string(),
            ended_at: None,
            status: Severity::Watch,
            cause: Some(IncidentCause::Loss),
            basis: PingBasis {
                source: PingSource::Floor,
                at_destination: false,
                measured_hop: Some(7),
                measured_asn: Some(9002),
                server_ip: None,
            },
            at_least: true,
            ping_ms: Some(38.0),
            usual_ms: Some(31.0),
            loss_pct: Some(4.17),
            jitter_ms: Some(6.8),
            zone: None,
            after_hop: None,
            at_hop: Some(7),
            asn: None,
            operator: None,
        }
    }

    #[tokio::test]
    async fn incidents_are_opened_raised_closed_and_go_away_with_their_session() {
        let pool = create_test_pool().await;
        let repo = MatchIncidentRepository::new(pool.clone());
        let sessions = SessionRepository::new(pool);
        let id = sessions
            .insert_session("League of Legends", "2026-10-08T20:00:00Z")
            .await
            .unwrap();

        let mut open = incident(id);
        open.id = repo.insert(&open).await.unwrap();
        assert_eq!(repo.get_for_session(id).await.unwrap(), vec![open.clone()]);

        let closed = MatchIncident {
            status: Severity::Degraded,
            zone: Some(FaultZone::Transit),
            after_hop: Some(4),
            asn: Some(9002),
            operator: Some("RETN Limited".to_string()),
            ended_at: Some("2026-10-08T20:31:10.000Z".to_string()),
            ..open.clone()
        };
        repo.update(&closed).await.unwrap();
        assert_eq!(repo.get_for_session(id).await.unwrap(), vec![closed]);

        sessions.delete_session(id).await.unwrap();
        assert!(repo.get_for_session(id).await.unwrap().is_empty());
    }
}

use crate::commands::monitoring::{trace_session_targets, AppMonitoringState};
use crate::commands::{validate_pagination, CommandError};
use crate::db::ip_metadata::IpMetadataRepository;
use crate::db::traceroutes::TracerouteRepository;
use crate::db::{
    get_ip_metadata_repository, get_ip_period_repository, get_session_repository,
    get_traceroute_repository, DbError,
};
use crate::models::session::{SessionDetail, SessionListItem, SessionMatch};
use crate::models::traceroute_record::TracerouteWithHops;
use crate::services::trace_targets::select_session_targets;
use crate::services::{matches, route_model, severity};
use tauri::{AppHandle, State};

async fn session_traceroutes(
    traceroute_repo: &TracerouteRepository,
    metadata_repo: Option<&IpMetadataRepository>,
    session_id: i64,
) -> Result<Vec<TracerouteWithHops>, DbError> {
    let mut traceroutes = traceroute_repo
        .get_traceroutes_with_hops_for_session(session_id)
        .await?;
    traceroutes.iter_mut().for_each(severity::assess_traceroute);
    route_model::attach_routes(&mut traceroutes, metadata_repo).await;
    Ok(traceroutes)
}

#[tauri::command]
pub async fn get_sessions(limit: i32, offset: i32) -> Result<Vec<SessionListItem>, CommandError> {
    let (limit, offset) = validate_pagination(limit, offset);

    let repo = get_session_repository().ok_or_else(|| CommandError::repo_not_initialized("Session"))?;

    repo.get_sessions_with_counts(limit, offset)
        .await
        .map_err(|e| CommandError::internal(e.to_string()))
}

#[tauri::command]
pub async fn get_session_detail(id: i64) -> Result<Option<SessionDetail>, CommandError> {
    if id <= 0 {
        return Err(CommandError::validation("Invalid session ID"));
    }

    let session_repo =
        get_session_repository().ok_or_else(|| CommandError::repo_not_initialized("Session"))?;

    let session = match session_repo
        .get_session(id)
        .await
        .map_err(|e| CommandError::internal(e.to_string()))?
    {
        Some(s) => s,
        None => return Ok(None),
    };

    let ip_periods = if let Some(ip_period_repo) = get_ip_period_repository() {
        ip_period_repo
            .get_periods_for_session(id)
            .await
            .unwrap_or_else(|e| {
                log::error!("Failed to get IP periods for session {}: {}", id, e);
                Vec::new()
            })
    } else {
        Vec::new()
    };

    let ip_summaries = if let Some(ip_period_repo) = get_ip_period_repository() {
        ip_period_repo
            .get_ip_summaries_for_session(id)
            .await
            .unwrap_or_else(|e| {
                log::error!("Failed to get IP summaries for session {}: {}", id, e);
                Vec::new()
            })
    } else {
        Vec::new()
    };

    let traceroutes = if let Some(traceroute_repo) = get_traceroute_repository() {
        let metadata_repo = get_ip_metadata_repository();
        session_traceroutes(&traceroute_repo, metadata_repo.as_deref(), id)
            .await
            .unwrap_or_else(|e| {
                log::error!("Failed to get traceroutes for session {}: {}", id, e);
                Vec::new()
            })
    } else {
        Vec::new()
    };

    log::debug!(
        "Session {} detail: {} IP periods, {} summaries, {} traceroutes",
        id,
        ip_periods.len(),
        ip_summaries.len(),
        traceroutes.len()
    );

    Ok(Some(SessionDetail {
        id: session.id,
        game_name: session.game_name,
        started_at: session.started_at,
        ended_at: session.ended_at,
        ip_periods,
        ip_summaries,
        traceroutes,
    }))
}

#[tauri::command]
pub async fn get_session_matches(id: i64) -> Result<Vec<SessionMatch>, CommandError> {
    if id <= 0 {
        return Err(CommandError::validation("Invalid session ID"));
    }

    let periods = get_ip_period_repository()
        .ok_or_else(|| CommandError::repo_not_initialized("IpPeriod"))?;
    let traceroutes = get_traceroute_repository()
        .ok_or_else(|| CommandError::repo_not_initialized("Traceroute"))?;

    matches::session_matches(&periods, &traceroutes, id)
        .await
        .map_err(|e| CommandError::internal(e.to_string()))
}

#[tauri::command]
pub async fn search_sessions(
    query: String,
    limit: i32,
    offset: i32,
) -> Result<Vec<SessionListItem>, CommandError> {
    let (limit, offset) = validate_pagination(limit, offset);
    let repo =
        get_session_repository().ok_or_else(|| CommandError::repo_not_initialized("Session"))?;
    repo.search_sessions(&query, limit, offset)
        .await
        .map_err(|e| CommandError::internal(e.to_string()))
}

#[tauri::command]
pub async fn search_session_count(query: String) -> Result<i64, CommandError> {
    let repo =
        get_session_repository().ok_or_else(|| CommandError::repo_not_initialized("Session"))?;
    repo.search_session_count(&query)
        .await
        .map_err(|e| CommandError::internal(e.to_string()))
}

#[tauri::command]
pub async fn get_previous_session_id(
    game_name: String,
    before_started_at: String,
) -> Result<Option<i64>, CommandError> {
    let repo =
        get_session_repository().ok_or_else(|| CommandError::repo_not_initialized("Session"))?;

    repo.get_previous_session_id(&game_name, &before_started_at)
        .await
        .map_err(|e| CommandError::internal(e.to_string()))
}

#[tauri::command]
pub async fn delete_session(id: i64) -> Result<(), CommandError> {
    if id <= 0 {
        return Err(CommandError::validation("Invalid session ID"));
    }

    let repo = get_session_repository().ok_or_else(|| CommandError::repo_not_initialized("Session"))?;

    repo.delete_session(id)
        .await
        .map_err(|e| CommandError::internal(e.to_string()))
}

#[tauri::command]
pub async fn get_session_count() -> Result<i64, CommandError> {
    let repo = get_session_repository().ok_or_else(|| CommandError::repo_not_initialized("Session"))?;

    repo.get_session_count()
        .await
        .map_err(|e| CommandError::internal(e.to_string()))
}

#[tauri::command]
pub async fn retry_traceroutes(
    app: AppHandle,
    state: State<'_, AppMonitoringState>,
    session_id: i64,
) -> Result<(), CommandError> {
    if session_id <= 0 {
        return Err(CommandError::validation("Invalid session ID"));
    }

    if state.traceroute_service.is_running().await {
        return Err(CommandError {
            code: "TRACEROUTE_RUNNING".to_string(),
            message: "A traceroute is already running".to_string(),
        });
    }

    let ip_period_repo = get_ip_period_repository()
        .ok_or_else(|| CommandError::repo_not_initialized("IpPeriod"))?;

    let candidates = ip_period_repo
        .get_trace_candidates(session_id)
        .await
        .map_err(|e| CommandError::internal(e.to_string()))?;

    if select_session_targets(&candidates).is_empty() {
        return Err(CommandError::validation("No IPs found for this session"));
    }

    let traceroute_repo = get_traceroute_repository()
        .ok_or_else(|| CommandError::repo_not_initialized("Traceroute"))?;

    traceroute_repo
        .delete_traceroutes_for_session(session_id)
        .await
        .map_err(|e| CommandError::internal(e.to_string()))?;

    let traceroute_service = state.traceroute_service.clone();
    tokio::spawn(async move {
        trace_session_targets(app, traceroute_service, session_id).await;
    });

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::create_test_pool;
    use crate::db::hops::HopRepository;
    use crate::models::ip_metadata::IpMetadataData;
    use crate::models::session::HopData;
    use crate::models::severity::Severity;
    use crate::models::traceroute::RouteZone;
    use crate::models::TracerouteData;

    const SFR: &str = "Societe Francaise Du Radiotelephone - SFR SA";

    fn hop(hop_number: i32, ip: &str, rtt: f64, packet_loss: f64) -> HopData {
        HopData {
            hop_number,
            ip: Some(ip.to_string()),
            hostname: None,
            latency_min: Some(rtt),
            latency_avg: Some(rtt),
            latency_max: Some(rtt),
            packet_loss: Some(packet_loss),
            is_problem_hop: false,
            source: Some("ICMP".to_string()),
        }
    }

    fn operator(ip: &str, asn: &str, org: &str) -> IpMetadataData {
        IpMetadataData {
            ip: ip.to_string(),
            asn: Some(asn.to_string()),
            isp: Some(org.to_string()),
            org: Some(org.to_string()),
            country: None,
            city: None,
            lat: None,
            lon: None,
            resolved_at: "2026-10-08T20:00:00Z".to_string(),
        }
    }

    #[tokio::test]
    async fn session_traceroutes_carry_their_route_by_operator() {
        let pool = create_test_pool().await;
        sqlx::query(
            "INSERT INTO sessions (id, game_name, started_at) VALUES (1, 'VALORANT', '2026-10-08T20:00:00Z')",
        )
        .execute(&pool)
        .await
        .unwrap();
        let traceroutes = TracerouteRepository::new(pool.clone());
        let metadata = IpMetadataRepository::new(pool.clone());

        let traced = traceroutes
            .insert_traceroute(&TracerouteData::new(
                1,
                "162.249.75.1".into(),
                "2026-10-08T20:00:01Z".into(),
            ))
            .await
            .unwrap();
        traceroutes
            .insert_traceroute(&TracerouteData::new(
                1,
                "162.249.72.1".into(),
                "2026-10-08T20:00:02Z".into(),
            ))
            .await
            .unwrap();
        HopRepository::new(pool.clone())
            .insert_hops_batch(
                traced,
                &[
                    hop(1, "10.0.10.1", 0.5, 66.7),
                    hop(2, "192.168.1.1", 0.7, 0.0),
                    hop(3, "10.153.10.245", 3.7, 0.0),
                    hop(4, "77.128.4.142", 4.3, 0.0),
                    hop(5, "194.6.147.220", 3.7, 0.0),
                    hop(6, "87.245.246.246", 5.3, 0.0),
                    hop(7, "87.245.233.46", 31.0, 0.0),
                ],
            )
            .await
            .unwrap();
        metadata
            .upsert_metadata_batch(&[
                operator("77.128.4.142", "AS15557", SFR),
                operator("87.245.246.246", "AS9002", "RETN Limited"),
                operator("87.245.233.46", "AS9002", "RETN Limited"),
                operator("162.249.75.1", "AS6507", "Riot Games, Inc"),
            ])
            .await
            .unwrap();

        let result = session_traceroutes(&traceroutes, Some(&metadata), 1)
            .await
            .unwrap();

        assert_eq!(result.len(), 2);
        assert_eq!(result[0].status, Severity::Ok);
        let route = result[0].route.as_ref().unwrap();
        let segments: Vec<(RouteZone, Option<&str>, u32)> = route
            .segments
            .iter()
            .map(|s| (s.zone, s.name.as_deref(), s.hops))
            .collect();
        assert_eq!(
            segments,
            vec![
                (RouteZone::Home, None, 2),
                (RouteZone::Isp, Some(SFR), 3),
                (RouteZone::Transit, Some("RETN Limited"), 2),
            ]
        );
        assert!(route.destination_silent);
        assert_eq!(route.total_ms, 31.0);
        assert_eq!(route.destination_name.as_deref(), Some("Riot Games, Inc"));
        assert!(result[1].route.is_none());
    }
}

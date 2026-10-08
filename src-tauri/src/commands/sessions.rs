use crate::commands::monitoring::{trace_session_targets, AppMonitoringState};
use crate::commands::{validate_pagination, CommandError};
use crate::db::ip_metadata::IpMetadataRepository;
use crate::db::sessions::SessionRepository;
use crate::db::traceroutes::TracerouteRepository;
use crate::db::{
    get_analytics_repository, get_game_ping_repository, get_ip_metadata_repository,
    get_ip_period_repository, get_session_repository, get_traceroute_repository, DbError,
};
use crate::models::session::{SessionDetail, SessionListFilter, SessionListPage, SessionMatch};
use crate::models::traceroute_record::TracerouteWithHops;
use crate::services::trace_targets::select_session_targets;
use crate::services::usual::{match_history, MatchHistory};
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

async fn session_list_page(
    sessions: &SessionRepository,
    history: &MatchHistory,
    filter: &SessionListFilter,
    limit: usize,
    offset: usize,
) -> Result<SessionListPage, DbError> {
    let summary = |id: i64| {
        history
            .sessions
            .get(&id)
            .map(|session| matches::summarize(&session.matches))
            .unwrap_or_default()
    };
    let mut items = sessions.list_sessions(filter).await?;

    if filter.to_review {
        items.retain(|item| summary(item.id).needs_review());
    }
    let total = items.len() as i64;
    let items = items
        .into_iter()
        .skip(offset)
        .take(limit)
        .map(|mut item| {
            item.matches = summary(item.id);
            item
        })
        .collect();

    Ok(SessionListPage {
        items,
        total,
        recorded: sessions.get_session_count().await?,
        first_started_at: sessions.get_first_started_at().await?,
        games: sessions.get_session_games().await?,
    })
}

async fn rated_history() -> Result<MatchHistory, CommandError> {
    let analytics = get_analytics_repository()
        .ok_or_else(|| CommandError::repo_not_initialized("Analytics"))?;
    let periods =
        get_ip_period_repository().ok_or_else(|| CommandError::repo_not_initialized("IpPeriod"))?;
    let traceroutes = get_traceroute_repository()
        .ok_or_else(|| CommandError::repo_not_initialized("Traceroute"))?;
    let metadata = get_ip_metadata_repository();
    let game_pings = get_game_ping_repository();

    match_history(
        &analytics,
        &periods,
        &traceroutes,
        game_pings.as_deref(),
        metadata.as_deref(),
    )
    .await
        .map_err(|e| CommandError::internal(e.to_string()))
}

#[tauri::command]
pub async fn get_session_list(
    filter: SessionListFilter,
    limit: i32,
    offset: i32,
) -> Result<SessionListPage, CommandError> {
    let (limit, offset) = validate_pagination(limit, offset);

    let sessions =
        get_session_repository().ok_or_else(|| CommandError::repo_not_initialized("Session"))?;
    let history = rated_history().await?;

    session_list_page(
        &sessions,
        &history,
        &filter,
        limit as usize,
        offset as usize,
    )
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

    Ok(rated_history()
        .await?
        .sessions
        .remove(&id)
        .map(|session| session.matches)
        .unwrap_or_default())
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
    use crate::db::analytics::AnalyticsRepository;
    use crate::db::create_test_pool;
    use crate::db::hops::HopRepository;
    use crate::db::ip_periods::IpPeriodRepository;
    use crate::models::flow_kind::FlowKind;
    use crate::models::ip_metadata::IpMetadataData;
    use crate::models::ip_period::IpPeriodData;
    use crate::models::session::HopData;
    use crate::models::severity::Severity;
    use crate::models::traceroute::RouteZone;
    use crate::models::TracerouteData;
    use crate::services::server_summary::server_summary;
    use crate::services::usual::fixtures::behind_isp;
    use chrono::{TimeZone, Utc};

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

    struct Listing {
        sessions: SessionRepository,
        periods: IpPeriodRepository,
        traceroutes: TracerouteRepository,
        pool: sqlx::SqlitePool,
    }

    impl Listing {
        async fn new() -> Self {
            let pool = create_test_pool().await;
            Self {
                sessions: SessionRepository::new(pool.clone()),
                periods: IpPeriodRepository::new(pool.clone()),
                traceroutes: TracerouteRepository::new(pool.clone()),
                pool,
            }
        }

        async fn session(&self, game: &str, day: u32, server: Option<(&str, f64, f64)>) -> i64 {
            let started = format!("2026-09-{day:02}T20:00:00Z");
            let id = self.sessions.insert_session(game, &started).await.unwrap();
            let Some((ip, rtt, loss)) = server else {
                return id;
            };
            let mut period = IpPeriodData::new(
                id,
                ip.to_string(),
                "UDP".to_string(),
                7000,
                format!("2026-09-{day:02}T20:01:00Z"),
                500,
            );
            period.ended_at = format!("2026-09-{day:02}T20:40:00Z");
            let period_id = self.periods.insert_period(&period).await.unwrap();
            self.periods
                .set_flow_kind(period_id, FlowKind::Game)
                .await
                .unwrap();
            let trace = self
                .traceroutes
                .insert_traceroute(&TracerouteData::new(
                    id,
                    ip.to_string(),
                    format!("2026-09-{day:02}T20:02:00Z"),
                ))
                .await
                .unwrap();
            HopRepository::new(self.pool.clone())
                .insert_hops_batch(
                    trace,
                    &[hop(1, "192.168.1.254", 0.6, 0.0), hop(2, ip, rtt, loss)],
                )
                .await
                .unwrap();
            id
        }

        async fn history(&self) -> MatchHistory {
            match_history(
                &AnalyticsRepository::new(self.pool.clone()),
                &self.periods,
                &self.traceroutes,
                None,
                None,
            )
            .await
            .unwrap()
        }

        async fn page(
            &self,
            filter: SessionListFilter,
            limit: usize,
            offset: usize,
        ) -> SessionListPage {
            let history = self.history().await;
            session_list_page(&self.sessions, &history, &filter, limit, offset)
                .await
                .unwrap()
        }
    }

    fn rows(page: &SessionListPage) -> Vec<(i64, u32, Option<f64>, Option<Severity>)> {
        page.items
            .iter()
            .map(|item| {
                (
                    item.id,
                    item.matches.match_count,
                    item.matches.median_ping_ms,
                    item.matches.status,
                )
            })
            .collect()
    }

    #[tokio::test]
    async fn session_list_pages_carry_network_status_and_totals() {
        let list = Listing::new().await;
        let lagging = list
            .session("VALORANT", 13, Some(("162.249.72.5", 18.0, 33.3)))
            .await;
        let smooth = list
            .session("League of Legends", 12, Some(("162.249.75.1", 31.0, 0.0)))
            .await;
        let unmeasured = list.session("VALORANT", 10, None).await;

        let first = list.page(SessionListFilter::default(), 2, 0).await;
        assert_eq!(
            rows(&first),
            vec![
                (lagging, 1, Some(18.0), Some(Severity::Critical)),
                (smooth, 1, Some(31.0), Some(Severity::Ok)),
            ]
        );
        assert_eq!(first.total, 3);
        assert_eq!(first.recorded, 3);
        assert_eq!(first.games, vec!["VALORANT", "League of Legends"]);
        assert_eq!(
            first.first_started_at.as_deref(),
            Some("2026-09-10T20:00:00Z")
        );

        let second = list.page(SessionListFilter::default(), 2, 2).await;
        assert_eq!(rows(&second), vec![(unmeasured, 0, None, None)]);
        assert_eq!(second.total, 3);
    }

    #[tokio::test]
    async fn session_list_keeps_only_sessions_to_review() {
        let list = Listing::new().await;
        let lagging = list
            .session("VALORANT", 13, Some(("162.249.72.5", 18.0, 33.3)))
            .await;
        list.session("League of Legends", 12, Some(("162.249.75.1", 31.0, 0.0)))
            .await;
        list.session("VALORANT", 10, None).await;
        let slow = list
            .session("League of Legends", 9, Some(("162.249.75.1", 75.0, 0.0)))
            .await;

        let review = |game: Option<&str>| SessionListFilter {
            search: None,
            game: game.map(str::to_string),
            to_review: true,
        };

        let page = list.page(review(None), 1, 0).await;
        assert_eq!(
            rows(&page),
            vec![(lagging, 1, Some(18.0), Some(Severity::Critical))]
        );
        assert_eq!(page.total, 2);
        assert_eq!(page.recorded, 4);

        let page = list.page(review(None), 1, 1).await;
        assert_eq!(
            rows(&page),
            vec![(slow, 1, Some(75.0), Some(Severity::Watch))]
        );

        let page = list.page(review(Some("League of Legends")), 20, 0).await;
        assert_eq!(
            rows(&page),
            vec![(slow, 1, Some(75.0), Some(Severity::Watch))]
        );

        let page = list
            .page(
                SessionListFilter {
                    search: Some("riot".to_string()),
                    ..review(None)
                },
                20,
                0,
            )
            .await;
        assert!(page.items.is_empty());
        assert_eq!(page.total, 0);
        assert_eq!(page.recorded, 4);
    }

    #[tokio::test]
    async fn list_matches_and_server_summary_agree_against_the_usual() {
        let list = Listing::new().await;
        for id in 1..=6 {
            behind_isp(&list.pool, id, id - 7, 5.0).await;
        }
        behind_isp(&list.pool, 7, 0, 44.0).await;

        let history = list.history().await;
        let page = list.page(SessionListFilter::default(), 20, 0).await;
        let summary = server_summary(
            &AnalyticsRepository::new(list.pool.clone()),
            &list.periods,
            &list.traceroutes,
            None,
            None,
            Utc.with_ymd_and_hms(2026, 9, 21, 0, 0, 0).unwrap(),
        )
        .await
        .unwrap();

        let spike = &history.sessions[&7].matches[0];
        let incident = summary.servers[0].last_incident.as_ref().unwrap();
        assert_eq!(spike.flow.status, Severity::Watch);
        assert_eq!(
            (incident.session_id, incident.match_number),
            (7, spike.number)
        );
        assert_eq!(incident.status, spike.flow.status);
        assert_eq!(
            Some(&incident.usual),
            spike.flow.trace.as_ref().unwrap().usual.as_ref()
        );
        assert_eq!(summary.servers[0].status, Some(Severity::Watch));
        for item in &page.items {
            let matched = &history.sessions[&item.id].matches[0];
            assert_eq!(
                item.matches.status,
                Some(matched.flow.status),
                "session {}",
                item.id
            );
        }
        assert_eq!(rows(&page)[0], (7, 1, Some(44.0), Some(Severity::Watch)));
    }
}

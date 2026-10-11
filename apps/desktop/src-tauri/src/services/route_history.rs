use crate::db::analytics::AnalyticsRepository;
use crate::db::game_pings::GamePingRepository;
use crate::db::ip_metadata::IpMetadataRepository;
use crate::db::ip_periods::IpPeriodRepository;
use crate::db::traceroutes::TracerouteRepository;
use crate::db::DbError;
use crate::models::game_ping::GamePingSample;
use crate::models::hop::ProbedHop;
use crate::models::ip_period::IpPeriod;
use crate::models::route_history::{
    LatestRouteTrace, RouteChange, RouteGamePing, RouteOperator, UsualRoute,
};
use crate::models::severity::Severity;
use crate::models::traceroute::{OperatorRoute, RouteSegment, RouteZone};
use crate::models::traceroute_record::TracerouteWithHops;
use crate::services::matches::{median, reported_at_server};
use crate::services::route_model::attach_routes;
use crate::services::usual::{match_history, MatchHistory, PingSample, SampleId};
use chrono::{DateTime, FixedOffset, Utc};
use std::cmp::Reverse;
use std::collections::HashMap;

pub struct RouteTrace<'a> {
    pub game_name: &'a str,
    pub sample: &'a PingSample,
    pub trace: &'a TracerouteWithHops,
    pub game_ping_ms: Option<f64>,
}

impl RouteTrace<'_> {
    fn route(&self) -> Option<&OperatorRoute> {
        self.trace.route.as_ref()
    }

    fn signature(&self) -> Vec<String> {
        self.route().map_or_else(Vec::new, |route| {
            operators(route).into_iter().map(|(key, _)| key).collect()
        })
    }

    fn persistent_loss(&self) -> Option<f64> {
        let route = self.route()?;
        route.segments.iter().any(|s| s.status.is_some()).then(|| {
            self.trace
                .hops
                .iter()
                .rev()
                .find(|hop| hop.responded())
                .map_or(0.0, |hop| hop.loss_pct())
        })
    }
}

pub struct RouteHistory {
    pub usual: Vec<UsualRoute>,
    pub changes: Vec<RouteChange>,
}

fn operator_key(segment: &RouteSegment) -> Option<String> {
    match (segment.asn, segment.name.as_deref()) {
        (Some(asn), _) => Some(format!("AS{asn}")),
        (None, Some(name)) => Some(name.to_lowercase()),
        (None, None) => None,
    }
}

fn operators(route: &OperatorRoute) -> Vec<(String, RouteOperator)> {
    let mut found: Vec<(String, RouteOperator)> = Vec::new();
    for segment in &route.segments {
        if matches!(segment.zone, RouteZone::Home | RouteZone::Service) {
            continue;
        }
        let Some(key) = operator_key(segment) else {
            continue;
        };
        if found.last().is_some_and(|(last, _)| *last == key) {
            continue;
        }
        let operator = RouteOperator {
            asn: segment.asn,
            name: segment.name.clone(),
        };
        found.push((key, operator));
    }
    found
}

fn slot_keys(route: &OperatorRoute) -> Vec<String> {
    let mut seen: HashMap<String, usize> = HashMap::new();
    route
        .segments
        .iter()
        .map(|segment| {
            let base = format!(
                "{:?}|{}",
                segment.zone,
                operator_key(segment).unwrap_or_default()
            );
            let count = seen.entry(base.clone()).or_default();
            *count += 1;
            format!("{base}|{count}")
        })
        .collect()
}

fn rounded_median(values: Vec<f64>) -> Option<f64> {
    median(values).map(f64::round)
}

fn majority_status(segments: &[&RouteSegment]) -> Option<Severity> {
    let mut best: Option<(Severity, usize)> = None;
    for status in [Severity::Critical, Severity::Degraded, Severity::Watch] {
        let count = segments.iter().filter(|s| s.status == Some(status)).count();
        if count > 0 && best.is_none_or(|(_, top)| count > top) {
            best = Some((status, count));
        }
    }
    best.filter(|&(_, count)| count * 2 > segments.len())
        .map(|(status, _)| status)
}

fn aggregate(representative: &OperatorRoute, routes: &[&OperatorRoute]) -> OperatorRoute {
    let slots: Vec<HashMap<String, &RouteSegment>> = routes
        .iter()
        .map(|route| slot_keys(route).into_iter().zip(&route.segments).collect())
        .collect();

    let segments = representative
        .segments
        .iter()
        .zip(slot_keys(representative))
        .map(|(segment, slot)| {
            let found: Vec<&RouteSegment> = slots
                .iter()
                .filter_map(|route| route.get(&slot).copied())
                .collect();
            let count = |value: fn(&RouteSegment) -> f64, fallback: f64| {
                rounded_median(found.iter().map(|s| value(s)).collect()).unwrap_or(fallback)
            };
            RouteSegment {
                added_ms: median(found.iter().map(|s| s.added_ms).collect())
                    .unwrap_or(segment.added_ms),
                hops: count(|s| f64::from(s.hops), f64::from(segment.hops)) as u32,
                silent_hops: count(|s| f64::from(s.silent_hops), f64::from(segment.silent_hops))
                    as u32,
                status: majority_status(&found),
                ..segment.clone()
            }
        })
        .collect();

    let silent = routes
        .iter()
        .filter(|route| route.destination_silent)
        .count();
    OperatorRoute {
        segments,
        last_responding_hop: rounded_median(
            routes
                .iter()
                .map(|route| f64::from(route.last_responding_hop))
                .collect(),
        )
        .map_or(representative.last_responding_hop, |hop| hop as i32),
        total_ms: median(routes.iter().map(|route| route.total_ms).collect())
            .unwrap_or(representative.total_ms),
        destination_silent: silent * 2 > routes.len(),
        destination_asn: representative.destination_asn,
        destination_name: representative.destination_name.clone(),
    }
}

fn usual_signature(traces: &[&RouteTrace]) -> Vec<String> {
    let mut groups: HashMap<Vec<String>, (usize, DateTime<FixedOffset>)> = HashMap::new();
    for trace in traces {
        let entry = groups
            .entry(trace.signature())
            .or_insert((0, trace.sample.measured_at));
        entry.0 += 1;
        entry.1 = entry.1.max(trace.sample.measured_at);
    }
    groups
        .into_iter()
        .max_by(|(a_sig, (a_count, a_at)), (b_sig, (b_count, b_at))| {
            a_count
                .cmp(b_count)
                .then(a_sig.len().cmp(&b_sig.len()))
                .then(a_at.cmp(b_at))
                .then(a_sig.cmp(b_sig))
        })
        .map(|(signature, _)| signature)
        .unwrap_or_default()
}

fn game_ping(pings: &[f64], usual: &[&RouteTrace], route: &OperatorRoute) -> Option<RouteGamePing> {
    let match_count = pings.len() as u32;
    let median_ms = median(pings.to_vec())?;
    let overlaps = usual.iter().any(|trace| trace.game_ping_ms.is_some());
    let deduced_ms = (overlaps && route.destination_silent).then_some(median_ms - route.total_ms);
    Some(RouteGamePing {
        median_ms,
        match_count,
        deduced_ms: deduced_ms.filter(|ms| *ms >= 0.0),
    })
}

fn usual_route(
    game_name: &str,
    traces: &[&RouteTrace],
    signature: &[String],
    game_pings: &[f64],
) -> Option<UsualRoute> {
    let usual: Vec<&RouteTrace> = traces
        .iter()
        .copied()
        .filter(|trace| trace.signature() == signature)
        .collect();
    let latest = usual.last()?;
    let routes: Vec<&OperatorRoute> = usual.iter().filter_map(|trace| trace.route()).collect();
    let route = aggregate(latest.route()?, &routes);

    let losses: Vec<f64> = usual
        .iter()
        .filter_map(|trace| trace.persistent_loss())
        .collect();
    let persistent_loss = route
        .segments
        .iter()
        .any(|segment| segment.status.is_some())
        .then(|| median(losses))
        .flatten();

    Some(UsualRoute {
        game_name: game_name.to_string(),
        game_ping: game_ping(game_pings, &usual, &route),
        route,
        trace_count: usual.len() as u32,
        total_traces: traces.len() as u32,
        persistent_loss,
        latest: LatestRouteTrace {
            traceroute_id: latest.trace.id,
            session_id: latest.sample.session_id,
            match_number: latest.sample.match_number,
            started_at: latest.trace.started_at.clone(),
            target_ip: latest.trace.target_ip.clone(),
            hops: latest.trace.hops.clone(),
        },
    })
}

struct Run<'a, 'b> {
    signature: Vec<String>,
    traces: Vec<&'a RouteTrace<'b>>,
}

fn close(run: Run, usual: &OperatorRoute, returned: bool) -> Option<RouteChange> {
    let first = run.traces.first()?;
    let last = run.traces.last()?;
    let route = first.route()?;
    let path = operators(route);
    let usual_operators = operators(usual);
    let missing = |from: &[(String, RouteOperator)], other: &[(String, RouteOperator)]| {
        from.iter()
            .filter(|(key, _)| !other.iter().any(|(other_key, _)| other_key == key))
            .map(|(_, operator)| operator.clone())
            .collect::<Vec<_>>()
    };

    Some(RouteChange {
        game_name: first.game_name.to_string(),
        started_at: first.sample.measured_at.to_rfc3339(),
        ended_at: last.sample.measured_at.to_rfc3339(),
        session_id: first.sample.session_id,
        match_number: first.sample.match_number,
        trace_count: run.traces.len() as u32,
        via: missing(&path, &usual_operators),
        instead_of: missing(&usual_operators, &path),
        path: path.into_iter().map(|(_, operator)| operator).collect(),
        total_ms: median(
            run.traces
                .iter()
                .filter_map(|trace| trace.route().map(|route| route.total_ms))
                .collect(),
        )?,
        usual_total_ms: usual.total_ms,
        loss_pct: run
            .traces
            .iter()
            .filter_map(|trace| trace.persistent_loss())
            .fold(0.0, f64::max),
        returned,
    })
}

fn route_changes(
    traces: &[&RouteTrace],
    signature: &[String],
    usual: &OperatorRoute,
) -> Vec<RouteChange> {
    let mut changes = Vec::new();
    let mut current: Option<Run> = None;

    for &trace in traces {
        let found = trace.signature();
        if found == signature {
            if let Some(change) = current.take().and_then(|run| close(run, usual, true)) {
                changes.push(change);
            }
            continue;
        }
        if signature.starts_with(&found) {
            continue;
        }
        match current.as_mut() {
            Some(run) if run.signature == found => run.traces.push(trace),
            _ => {
                if let Some(change) = current.take().and_then(|run| close(run, usual, false)) {
                    changes.push(change);
                }
                current = Some(Run {
                    signature: found,
                    traces: vec![trace],
                });
            }
        }
    }
    if let Some(change) = current.and_then(|run| close(run, usual, false)) {
        changes.push(change);
    }
    changes
}

pub fn build(traces: &[RouteTrace], game_pings: &HashMap<String, Vec<f64>>) -> RouteHistory {
    let mut by_game: HashMap<&str, Vec<&RouteTrace>> = HashMap::new();
    for trace in traces.iter().filter(|trace| trace.route().is_some()) {
        by_game.entry(trace.game_name).or_default().push(trace);
    }

    let mut games: Vec<(&str, Vec<&RouteTrace>)> = by_game.into_iter().collect();
    for (_, game_traces) in &mut games {
        game_traces.sort_by_key(|trace| trace.sample.measured_at);
    }
    games.sort_by_key(|(name, game_traces)| {
        (
            Reverse(game_traces.last().map(|trace| trace.sample.measured_at)),
            *name,
        )
    });

    let mut usual = Vec::new();
    let mut changes = Vec::new();
    for (name, game_traces) in &games {
        let signature = usual_signature(game_traces);
        let pings = game_pings.get(*name).map(Vec::as_slice).unwrap_or_default();
        let Some(route) = usual_route(name, game_traces, &signature, pings) else {
            continue;
        };
        changes.extend(route_changes(game_traces, &signature, &route.route));
        usual.push(route);
    }
    changes.sort_by_key(|change| Reverse(DateTime::parse_from_rfc3339(&change.started_at).ok()));

    RouteHistory { usual, changes }
}

async fn game_pings_by_match(
    history: &MatchHistory,
    session_ids: &[i64],
    game_pings: Option<&GamePingRepository>,
) -> Result<HashMap<(i64, u32), f64>, DbError> {
    let mut found = HashMap::new();
    let Some(game_pings) = game_pings.filter(|_| !session_ids.is_empty()) else {
        return Ok(found);
    };
    let mut pings: HashMap<i64, Vec<GamePingSample>> = HashMap::new();
    for sample in game_pings.get_samples_for_sessions(session_ids).await? {
        pings.entry(sample.session_id).or_default().push(sample);
    }
    for (&session_id, samples) in &pings {
        let Some(session) = history.sessions.get(&session_id) else {
            continue;
        };
        for game in &session.matches {
            let flow = &game.flow;
            let period = IpPeriod {
                id: flow.period_id,
                session_id,
                ip: flow.ip.clone(),
                protocol: flow.protocol.clone(),
                port: flow.port,
                started_at: flow.started_at.clone(),
                ended_at: flow.ended_at.clone(),
                packet_count: flow.packet_count,
                is_game_server: true,
                flow_kind: None,
            };
            if let Some(measure) = reported_at_server(&period, samples) {
                found.insert((session_id, game.number), measure.ping_ms);
            }
        }
    }
    Ok(found)
}

pub async fn route_history(
    analytics: &AnalyticsRepository,
    periods: &IpPeriodRepository,
    traceroutes: &TracerouteRepository,
    game_pings: Option<&GamePingRepository>,
    metadata: Option<&IpMetadataRepository>,
    since: DateTime<Utc>,
) -> Result<RouteHistory, DbError> {
    let history = match_history(analytics, periods, traceroutes, None, metadata).await?;
    let since = since.fixed_offset();

    let samples: HashMap<i64, (&str, &PingSample)> = history
        .matches
        .iter()
        .filter_map(|game| {
            let sample = game.sample.as_ref()?;
            let SampleId::Trace(traceroute_id) = sample.id else {
                return None;
            };
            (sample.measured_at >= since).then_some((traceroute_id, (game.game_name.as_str(), sample)))
        })
        .collect();

    let mut traces: Vec<TracerouteWithHops> = history
        .sessions
        .values()
        .flat_map(|session| &session.traces)
        .filter(|trace| samples.contains_key(&trace.id))
        .cloned()
        .collect();
    attach_routes(&mut traces, metadata).await;

    let played: Vec<(i64, String)> = analytics
        .get_game_sessions()
        .await?
        .into_iter()
        .filter(|(id, _)| {
            history.sessions.get(id).is_some_and(|session| {
                session.matches.iter().any(|game| {
                    DateTime::parse_from_rfc3339(&game.flow.started_at).is_ok_and(|at| at >= since)
                })
            })
        })
        .collect();
    let session_ids: Vec<i64> = played.iter().map(|(id, _)| *id).collect();
    let game_ping_ms = game_pings_by_match(&history, &session_ids, game_pings).await?;
    let mut by_game: HashMap<String, Vec<f64>> = HashMap::new();
    for (id, game_name) in &played {
        for game in &history.sessions[id].matches {
            let started = DateTime::parse_from_rfc3339(&game.flow.started_at);
            if let (Some(ping_ms), true) = (
                game_ping_ms.get(&(*id, game.number)),
                started.is_ok_and(|at| at >= since),
            ) {
                by_game.entry(game_name.clone()).or_default().push(*ping_ms);
            }
        }
    }

    let route_traces: Vec<RouteTrace> = traces
        .iter()
        .filter_map(|trace| {
            let &(game_name, sample) = samples.get(&trace.id)?;
            Some(RouteTrace {
                game_name,
                sample,
                trace,
                game_ping_ms: game_ping_ms
                    .get(&(sample.session_id, sample.match_number))
                    .copied(),
            })
        })
        .collect();
    Ok(build(&route_traces, &by_game))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::create_test_pool;
    use crate::models::session::DbHop;
    use crate::services::usual::fixtures::*;
    use chrono::TimeZone;

    fn segment(zone: RouteZone, asn: Option<u32>, name: &str, added_ms: f64) -> RouteSegment {
        RouteSegment {
            zone,
            asn,
            name: (!name.is_empty()).then(|| name.to_string()),
            first_hop: 1,
            last_hop: 2,
            hops: 2,
            silent_hops: 0,
            added_ms,
            status: None,
        }
    }

    fn route(segments: Vec<RouteSegment>, total_ms: f64, silent: bool) -> OperatorRoute {
        OperatorRoute {
            segments,
            last_responding_hop: 8,
            total_ms,
            destination_silent: silent,
            destination_asn: Some(6507),
            destination_name: Some("Riot Games, Inc".to_string()),
        }
    }

    fn via_retn(retn_ms: f64) -> OperatorRoute {
        route(
            vec![
                segment(RouteZone::Home, None, "", 0.6),
                segment(RouteZone::Isp, Some(15557), "SFR", 3.7),
                segment(RouteZone::Transit, Some(9002), "RETN", retn_ms),
            ],
            4.3 + retn_ms,
            true,
        )
    }

    fn via_cogent() -> OperatorRoute {
        route(
            vec![
                segment(RouteZone::Home, None, "", 0.6),
                segment(RouteZone::Isp, Some(15557), "SFR", 3.7),
                segment(RouteZone::Transit, Some(174), "Cogent", 16.0),
            ],
            20.3,
            true,
        )
    }

    fn truncated() -> OperatorRoute {
        route(
            vec![
                segment(RouteZone::Home, None, "", 0.6),
                segment(RouteZone::Isp, Some(15557), "SFR", 3.7),
            ],
            4.3,
            true,
        )
    }

    struct Fixture {
        samples: Vec<PingSample>,
        traces: Vec<TracerouteWithHops>,
        games: Vec<&'static str>,
    }

    fn fixture(entries: Vec<(&'static str, u32, OperatorRoute)>) -> Fixture {
        let mut samples = Vec::new();
        let mut traces = Vec::new();
        let mut games = Vec::new();
        for (index, (game, hour, route)) in entries.into_iter().enumerate() {
            let mut ping = sample(day(21, hour), lower_bound(5), 10.0);
            let traceroute_id = index as i64 + 1;
            ping.id = SampleId::Trace(traceroute_id);
            ping.match_number = index as u32 + 1;
            traces.push(TracerouteWithHops {
                id: traceroute_id,
                session_id: ping.session_id,
                target_ip: RIOT.to_string(),
                started_at: ping.measured_at.to_rfc3339(),
                completed_at: None,
                problem_hop_index: None,
                traceroute_method: None,
                hops: Vec::<DbHop>::new(),
                status: Severity::Ok,
                route: Some(route),
            });
            samples.push(ping);
            games.push(game);
        }
        Fixture {
            samples,
            traces,
            games,
        }
    }

    fn history_of(fixture: &Fixture) -> RouteHistory {
        history_with_game_pings(fixture, &[], &[])
    }

    fn history_with_game_pings(
        fixture: &Fixture,
        pings: &[Option<f64>],
        unpaired: &[f64],
    ) -> RouteHistory {
        let traces: Vec<RouteTrace> = fixture
            .traces
            .iter()
            .zip(&fixture.samples)
            .zip(&fixture.games)
            .enumerate()
            .map(|(i, ((trace, sample), game_name))| RouteTrace {
                game_name,
                sample,
                trace,
                game_ping_ms: pings.get(i).copied().flatten(),
            })
            .collect();
        let mut by_game: HashMap<String, Vec<f64>> = HashMap::new();
        for trace in &traces {
            let all = by_game.entry(trace.game_name.to_string()).or_default();
            all.extend(trace.game_ping_ms);
        }
        for ping_ms in unpaired {
            by_game
                .entry(fixture.games[0].to_string())
                .or_default()
                .push(*ping_ms);
        }
        build(&traces, &by_game)
    }

    #[test]
    fn the_last_segment_is_deduced_from_the_ping_measured_by_the_game() {
        let league = || {
            fixture(vec![
                ("League of Legends", 1, via_retn(12.0)),
                ("League of Legends", 2, via_retn(12.0)),
                ("League of Legends", 3, via_retn(12.0)),
                ("League of Legends", 4, via_cogent()),
            ])
        };

        let measured = history_with_game_pings(
            &league(),
            &[Some(25.0), Some(27.0), Some(26.0), Some(28.0)],
            &[24.0],
        );
        let game_ping = measured.usual[0].game_ping.clone().unwrap();
        assert_eq!((game_ping.median_ms, game_ping.match_count), (26.0, 5));
        assert!((game_ping.deduced_ms.unwrap() - 9.7).abs() < 1e-9);

        let below = history_with_game_pings(&league(), &[Some(10.0), Some(11.0), Some(12.0)], &[]);
        let game_ping = below.usual[0].game_ping.clone().unwrap();
        assert_eq!(game_ping.median_ms, 11.0);
        assert_eq!(game_ping.deduced_ms, None);

        let partial = history_with_game_pings(&league(), &[None, Some(20.0)], &[]);
        let game_ping = partial.usual[0].game_ping.clone().unwrap();
        assert_eq!(game_ping.match_count, 1);
        assert!((game_ping.deduced_ms.unwrap() - 3.7).abs() < 1e-9);

        let elsewhere = history_with_game_pings(&league(), &[], &[13.0]);
        let game_ping = elsewhere.usual[0].game_ping.clone().unwrap();
        assert_eq!((game_ping.median_ms, game_ping.deduced_ms), (13.0, None));

        assert_eq!(history_of(&league()).usual[0].game_ping, None);
    }

    #[tokio::test]
    async fn the_usual_route_carries_the_ping_measured_by_the_game() {
        let pool = create_test_pool().await;
        for (id, ping_ms) in [(1, 12.0), (2, 13.0), (3, 14.0)] {
            reported_by_league(&pool, id, id - 3, ping_ms).await;
        }
        let load = |game_pings: Option<GamePingRepository>| {
            let pool = pool.clone();
            async move {
                route_history(
                    &AnalyticsRepository::new(pool.clone()),
                    &IpPeriodRepository::new(pool.clone()),
                    &TracerouteRepository::new(pool.clone()),
                    game_pings.as_ref(),
                    None,
                    Utc.with_ymd_and_hms(2026, 9, 1, 0, 0, 0).unwrap(),
                )
                .await
                .unwrap()
            }
        };

        let history = load(Some(GamePingRepository::new(pool.clone()))).await;
        let usual = &history.usual[0];
        assert_eq!(usual.game_name, "League of Legends");
        assert_eq!(usual.route.total_ms, 5.0);
        assert_eq!(
            usual.game_ping,
            Some(RouteGamePing {
                median_ms: 13.0,
                match_count: 3,
                deduced_ms: Some(8.0),
            })
        );

        assert_eq!(load(None).await.usual[0].game_ping, None);
    }

    fn names(operators: &[RouteOperator]) -> Vec<Option<&str>> {
        operators.iter().map(|op| op.name.as_deref()).collect()
    }

    #[test]
    fn usual_route_takes_the_median_added_by_each_operator() {
        let history = history_of(&fixture(vec![
            ("VALORANT", 1, via_retn(12.0)),
            ("VALORANT", 2, via_retn(14.0)),
            ("VALORANT", 3, via_retn(13.0)),
            ("VALORANT", 4, via_cogent()),
        ]));

        assert_eq!(history.usual.len(), 1);
        let usual = &history.usual[0];
        assert_eq!(usual.game_name, "VALORANT");
        assert_eq!((usual.trace_count, usual.total_traces), (3, 4));
        let added: Vec<f64> = usual.route.segments.iter().map(|s| s.added_ms).collect();
        assert_eq!(added, vec![0.6, 3.7, 13.0]);
        assert!((usual.route.total_ms - 17.3).abs() < 1e-9);
        assert!(usual.route.destination_silent);
        assert_eq!(usual.persistent_loss, None);
        assert_eq!(usual.latest.match_number, 3);
        assert_eq!(usual.latest.target_ip, RIOT);
    }

    #[test]
    fn another_operator_is_a_change_and_the_usual_route_comes_back() {
        let history = history_of(&fixture(vec![
            ("VALORANT", 1, via_retn(12.0)),
            ("VALORANT", 2, via_retn(12.0)),
            ("VALORANT", 3, via_cogent()),
            ("VALORANT", 4, via_cogent()),
            ("VALORANT", 5, via_retn(12.0)),
            ("VALORANT", 6, via_retn(12.0)),
            ("VALORANT", 7, via_cogent()),
        ]));

        assert_eq!(history.changes.len(), 2);
        let latest = &history.changes[0];
        assert_eq!(latest.started_at, day(21, 7).to_rfc3339());
        assert!(!latest.returned);
        let first = &history.changes[1];
        assert_eq!(first.started_at, day(21, 3).to_rfc3339());
        assert_eq!(first.ended_at, day(21, 4).to_rfc3339());
        assert_eq!(first.trace_count, 2);
        assert_eq!(first.match_number, 3);
        assert!(first.returned);
        assert_eq!(names(&first.via), vec![Some("Cogent")]);
        assert_eq!(names(&first.instead_of), vec![Some("RETN")]);
        assert_eq!(names(&first.path), vec![Some("SFR"), Some("Cogent")]);
        assert!((first.total_ms - 20.3).abs() < 1e-9);
        assert!((first.usual_total_ms - 16.3).abs() < 1e-9);
        assert_eq!(first.loss_pct, 0.0);
    }

    #[test]
    fn a_trace_that_stops_early_is_not_a_route_change() {
        let history = history_of(&fixture(vec![
            ("VALORANT", 1, via_retn(12.0)),
            ("VALORANT", 2, truncated()),
            ("VALORANT", 3, via_retn(12.0)),
        ]));

        assert!(history.changes.is_empty());
        assert_eq!(history.usual[0].trace_count, 2);
        assert_eq!(history.usual[0].total_traces, 3);
    }

    #[test]
    fn the_service_hop_does_not_change_the_route() {
        let mut with_riot = via_retn(12.0);
        with_riot
            .segments
            .push(segment(RouteZone::Service, Some(6507), "Riot Games", 0.5));
        with_riot.destination_silent = false;

        let history = history_of(&fixture(vec![
            ("VALORANT", 1, via_retn(12.0)),
            ("VALORANT", 2, with_riot),
            ("VALORANT", 3, via_retn(12.0)),
        ]));

        assert!(history.changes.is_empty());
        assert_eq!(history.usual[0].trace_count, 3);
    }

    #[test]
    fn a_persistent_problem_colours_the_segment_only_when_most_traces_have_it() {
        let lossy = || {
            let mut route = via_retn(12.0);
            route.segments[2].status = Some(Severity::Degraded);
            route
        };

        let rare = history_of(&fixture(vec![
            ("VALORANT", 1, via_retn(12.0)),
            ("VALORANT", 2, via_retn(12.0)),
            ("VALORANT", 3, lossy()),
        ]));
        assert!(rare.usual[0]
            .route
            .segments
            .iter()
            .all(|s| s.status.is_none()));

        let history = history_of(&fixture(vec![
            ("VALORANT", 1, lossy()),
            ("VALORANT", 2, lossy()),
            ("VALORANT", 3, via_retn(12.0)),
        ]));
        let statuses: Vec<Option<Severity>> = history.usual[0]
            .route
            .segments
            .iter()
            .map(|s| s.status)
            .collect();
        assert_eq!(statuses, vec![None, None, Some(Severity::Degraded)]);
        assert_eq!(history.usual[0].persistent_loss, Some(0.0));
    }

    #[test]
    fn games_are_separate_and_the_latest_played_comes_first() {
        let history = history_of(&fixture(vec![
            ("VALORANT", 1, via_retn(12.0)),
            ("League of Legends", 5, via_cogent()),
            ("VALORANT", 3, via_retn(12.0)),
        ]));

        let games: Vec<&str> = history
            .usual
            .iter()
            .map(|usual| usual.game_name.as_str())
            .collect();
        assert_eq!(games, vec!["League of Legends", "VALORANT"]);
        assert!(history.changes.is_empty());
    }

    #[tokio::test]
    async fn history_is_read_from_the_traces_of_each_match() {
        let pool = create_test_pool().await;
        let hops = |transit: &str| {
            vec![
                hop(1, "192.168.1.254", 0.6),
                hop(2, "77.136.10.6", 3.6),
                hop(3, transit, 17.0),
                silent(4),
            ]
        };
        for (id, day_offset, transit) in [
            (1, 0, "87.245.233.46"),
            (2, 1, "87.245.233.46"),
            (3, 2, "130.117.1.1"),
            (4, 3, "87.245.233.46"),
        ] {
            let start = day_offset * 86_400;
            session(&pool, id, "VALORANT", start).await;
            period(&pool, id, RIOT, 7036, (start, start + 1800)).await;
            trace(&pool, id, RIOT, start + 40, &hops(transit)).await;
        }
        operator(&pool, RIOT, "AS6507", "Riot Games, Inc", None).await;
        operator(&pool, "87.245.233.46", "AS9002", "RETN Limited", None).await;
        operator(&pool, "130.117.1.1", "AS174", "Cogent Communications", None).await;
        operator(&pool, "77.136.10.6", "AS15557", "SFR SA", None).await;

        let history = route_history(
            &AnalyticsRepository::new(pool.clone()),
            &IpPeriodRepository::new(pool.clone()),
            &TracerouteRepository::new(pool.clone()),
            None,
            Some(&IpMetadataRepository::new(pool.clone())),
            Utc.with_ymd_and_hms(2026, 9, 20, 0, 0, 0).unwrap(),
        )
        .await
        .unwrap();

        assert_eq!(history.usual.len(), 1);
        let usual = &history.usual[0];
        assert_eq!((usual.trace_count, usual.total_traces), (3, 4));
        let operators: Vec<Option<u32>> = usual.route.segments.iter().map(|s| s.asn).collect();
        assert_eq!(operators, vec![None, Some(15557), Some(9002)]);
        assert_eq!(history.changes.len(), 1);
        assert_eq!(
            names(&history.changes[0].via),
            vec![Some("Cogent Communications")]
        );
        assert_eq!(
            names(&history.changes[0].instead_of),
            vec![Some("RETN Limited")]
        );
        assert!(history.changes[0].returned);

        let recent_only = route_history(
            &AnalyticsRepository::new(pool.clone()),
            &IpPeriodRepository::new(pool.clone()),
            &TracerouteRepository::new(pool.clone()),
            None,
            Some(&IpMetadataRepository::new(pool.clone())),
            Utc.with_ymd_and_hms(2026, 9, 24, 0, 0, 0).unwrap(),
        )
        .await
        .unwrap();
        assert_eq!(recent_only.usual[0].total_traces, 1);
        assert!(recent_only.changes.is_empty());
    }
}

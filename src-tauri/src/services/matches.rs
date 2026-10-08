use crate::db::ip_periods::IpPeriodRepository;
use crate::db::traceroutes::TracerouteRepository;
use crate::db::DbError;
use crate::models::flow_kind::FlowKind;
use crate::models::hop::ProbedHop;
use crate::models::ip_period::FlowPeriod;
use crate::models::session::{
    FlowOperator, MatchSummary, MeasuredFlow, SessionMatch, TraceMeasure,
};
use crate::models::severity::Severity;
use crate::models::traceroute_record::TracerouteWithHops;
use crate::services::severity::{measured_hop, route_status};
use crate::services::trace_targets::is_traceable_game_server;
use crate::services::traceroute::persistent_loss_onset;
use chrono::{DateTime, FixedOffset};
use std::collections::HashMap;

pub async fn session_matches(
    periods: &IpPeriodRepository,
    traceroutes: &TracerouteRepository,
    session_id: i64,
) -> Result<Vec<SessionMatch>, DbError> {
    let flows = periods.get_flow_periods(session_id).await?;
    let traces = traceroutes
        .get_traceroutes_with_hops_for_session(session_id)
        .await?;
    Ok(build_matches(flows, &traces))
}

pub struct MatchedSession {
    pub matches: Vec<SessionMatch>,
    pub traces: Vec<TracerouteWithHops>,
}

pub async fn matched_sessions(
    periods: &IpPeriodRepository,
    traceroutes: &TracerouteRepository,
    session_ids: &[i64],
) -> Result<HashMap<i64, MatchedSession>, DbError> {
    if session_ids.is_empty() {
        return Ok(HashMap::new());
    }

    let mut flows: HashMap<i64, Vec<FlowPeriod>> = HashMap::new();
    for flow in periods.get_flow_periods_for_sessions(session_ids).await? {
        flows.entry(flow.period.session_id).or_default().push(flow);
    }
    let mut traces: HashMap<i64, Vec<TracerouteWithHops>> = HashMap::new();
    for trace in traceroutes
        .get_flow_traceroutes_for_sessions(session_ids)
        .await?
    {
        traces.entry(trace.session_id).or_default().push(trace);
    }

    Ok(session_ids
        .iter()
        .map(|&id| {
            let traces = traces.remove(&id).unwrap_or_default();
            let matches = build_matches(flows.remove(&id).unwrap_or_default(), &traces);
            (id, MatchedSession { matches, traces })
        })
        .collect())
}

pub async fn session_summaries(
    periods: &IpPeriodRepository,
    traceroutes: &TracerouteRepository,
    session_ids: &[i64],
) -> Result<HashMap<i64, MatchSummary>, DbError> {
    Ok(matched_sessions(periods, traceroutes, session_ids)
        .await?
        .into_iter()
        .map(|(id, session)| (id, summarize(&session.matches)))
        .collect())
}

pub fn summarize(matches: &[SessionMatch]) -> MatchSummary {
    let measured: Vec<&TraceMeasure> = matches
        .iter()
        .filter_map(|game| game.flow.trace.as_ref())
        .filter(|trace| trace.ping_ms.is_some())
        .collect();
    let pings: Vec<f64> = measured.iter().filter_map(|trace| trace.ping_ms).collect();

    MatchSummary {
        match_count: matches.len() as u32,
        median_ping_ms: median(pings),
        median_ping_at_least: measured.iter().any(|trace| !trace.at_destination),
        status: matches
            .iter()
            .map(|game| game.flow.status)
            .max_by_key(|status| weight(*status)),
    }
}

fn weight(status: Severity) -> u8 {
    match status {
        Severity::Unmeasured => 0,
        Severity::Ok => 1,
        Severity::Watch => 2,
        Severity::Degraded => 3,
        Severity::Critical => 4,
    }
}

pub fn median(mut values: Vec<f64>) -> Option<f64> {
    if values.is_empty() {
        return None;
    }
    values.sort_by(f64::total_cmp);
    let mid = values.len() / 2;
    Some(if values.len().is_multiple_of(2) {
        (values[mid - 1] + values[mid]) / 2.0
    } else {
        values[mid]
    })
}

fn build_matches(flows: Vec<FlowPeriod>, traces: &[TracerouteWithHops]) -> Vec<SessionMatch> {
    let (voice, games): (Vec<FlowPeriod>, Vec<FlowPeriod>) = flows
        .into_iter()
        .partition(|flow| flow.period.flow_kind.as_deref() == Some(FlowKind::Voice.as_str()));
    let voice: Vec<MeasuredFlow> = voice
        .into_iter()
        .map(|flow| measure(flow, traces))
        .collect();

    games
        .into_iter()
        .filter(is_match)
        .map(|flow| measure(flow, traces))
        .zip(1u32..)
        .map(|(flow, number)| SessionMatch {
            number,
            voice: linked_voice(&flow, &voice),
            flow,
        })
        .collect()
}

fn asn_number(flow: &FlowPeriod) -> Option<u32> {
    flow.asn.as_deref()?.strip_prefix("AS")?.parse().ok()
}

fn is_match(flow: &FlowPeriod) -> bool {
    let period = &flow.period;
    period.is_game_server
        && period
            .flow_kind
            .as_deref()
            .is_none_or(|kind| kind == FlowKind::Game.as_str())
        && is_traceable_game_server(asn_number(flow), &period.protocol, period.port)
}

fn operator(flow: &FlowPeriod) -> Option<FlowOperator> {
    let operator = FlowOperator {
        asn: asn_number(flow),
        name: flow.operator_name.clone(),
        city: flow.city.clone(),
        country: flow.country.clone(),
    };
    (operator != FlowOperator::default()).then_some(operator)
}

fn parse(timestamp: &str) -> Option<DateTime<FixedOffset>> {
    DateTime::parse_from_rfc3339(timestamp).ok()
}

fn seconds_between(from: &str, to: &str) -> i64 {
    parse(from)
        .zip(parse(to))
        .map_or(0, |(from, to)| (to - from).num_seconds())
}

fn measure(flow: FlowPeriod, traces: &[TracerouteWithHops]) -> MeasuredFlow {
    let operator = operator(&flow);
    let period = flow.period;
    let trace = traces.iter().find(|trace| trace.target_ip == period.ip);

    MeasuredFlow {
        period_id: period.id,
        duration_secs: seconds_between(&period.started_at, &period.ended_at),
        trace: trace.map(|trace| trace_measure(trace, &period.started_at)),
        status: trace.map_or(Severity::Unmeasured, |trace| {
            route_status(&trace.hops, &trace.target_ip)
        }),
        ip: period.ip,
        protocol: period.protocol,
        port: period.port,
        started_at: period.started_at,
        ended_at: period.ended_at,
        packet_count: period.packet_count,
        operator,
    }
}

fn trace_measure(trace: &TracerouteWithHops, flow_started_at: &str) -> TraceMeasure {
    let hop = measured_hop(&trace.hops);
    let loss_persists = persistent_loss_onset(&trace.hops, &trace.target_ip).is_some();

    TraceMeasure {
        traceroute_id: trace.id,
        started_at: trace.started_at.clone(),
        completed_at: trace.completed_at.clone(),
        offset_secs: seconds_between(flow_started_at, &trace.started_at),
        measured_hop: hop.map(|hop| hop.hop_number),
        at_destination: hop.is_some_and(|hop| hop.ip() == Some(trace.target_ip.as_str())),
        ping_ms: hop.and_then(ProbedHop::rtt_avg),
        loss_pct: hop.map(|hop| if loss_persists { hop.loss_pct() } else { 0.0 }),
        jitter_ms: hop
            .and_then(ProbedHop::rtt_range)
            .map(|(min, max)| max - min),
    }
}

fn overlap_ratio(a: &MeasuredFlow, b: &MeasuredFlow) -> f64 {
    let span = |flow: &MeasuredFlow| parse(&flow.started_at).zip(parse(&flow.ended_at));
    let Some(((a_start, a_end), (b_start, b_end))) = span(a).zip(span(b)) else {
        return 0.0;
    };
    let shared = (a_end.min(b_end) - a_start.max(b_start)).num_milliseconds();
    let covered = (a_end.max(b_end) - a_start.min(b_start)).num_milliseconds();
    if shared <= 0 || covered <= 0 {
        return 0.0;
    }
    shared as f64 / covered as f64
}

fn linked_voice(game: &MeasuredFlow, voice: &[MeasuredFlow]) -> Option<MeasuredFlow> {
    voice
        .iter()
        .map(|flow| (overlap_ratio(game, flow), flow))
        .filter(|(ratio, _)| *ratio > 0.0)
        .max_by(|a, b| a.0.total_cmp(&b.0))
        .map(|(_, flow)| flow.clone())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::create_test_pool;
    use crate::db::hops::HopRepository;
    use crate::db::ip_metadata::IpMetadataRepository;
    use crate::models::ip_metadata::IpMetadataData;
    use crate::models::ip_period::IpPeriodData;
    use crate::models::session::HopData;
    use crate::models::TracerouteData;
    use crate::services::route_model::attach_routes;
    use crate::services::severity::assess_traceroute;
    use chrono::{SecondsFormat, TimeZone, Utc};
    use sqlx::SqlitePool;

    const RIOT: &str = "162.249.72.5";
    const RIOT_PARIS: &str = "185.40.64.1";
    const TEAM_VOICE: &str = "20.47.65.180";
    const PARTY_VOICE: &str = "20.157.75.86";

    struct Session {
        pool: SqlitePool,
        periods: IpPeriodRepository,
        traces: TracerouteRepository,
    }

    impl Session {
        async fn new() -> Self {
            let pool = create_test_pool().await;
            sqlx::query(
                "INSERT INTO sessions (id, game_name, started_at) VALUES (1, 'VALORANT', '2026-09-13T14:00:00Z')",
            )
            .execute(&pool)
            .await
            .unwrap();
            Self {
                periods: IpPeriodRepository::new(pool.clone()),
                traces: TracerouteRepository::new(pool.clone()),
                pool,
            }
        }

        async fn period(&self, ip: &str, port: i32, (from, to): (i64, i64), kind: FlowKind) -> i64 {
            let mut data =
                IpPeriodData::new(1, ip.to_string(), "UDP".to_string(), port, at(from), 100);
            data.ended_at = at(to);
            let id = self.periods.insert_period(&data).await.unwrap();
            self.periods.set_flow_kind(id, kind).await.unwrap();
            id
        }

        async fn feed(&self, ip: &str, protocol: &str, port: i32, (from, to): (i64, i64)) {
            for sec in (from..=to).step_by(5) {
                self.periods
                    .upsert_ip_activity(1, ip, protocol, port, &at(sec), Some(380))
                    .await
                    .unwrap();
            }
        }

        async fn trace(&self, ip: &str, started: i64, hops: &[HopData]) -> i64 {
            let id = self
                .traces
                .insert_traceroute(&TracerouteData::new(1, ip.to_string(), at(started)))
                .await
                .unwrap();
            self.traces
                .update_traceroute_completed(id, &at(started + 30), None, Some("ICMP (tracert)"))
                .await
                .unwrap();
            HopRepository::new(self.pool.clone())
                .insert_hops_batch(id, hops)
                .await
                .unwrap();
            id
        }

        async fn operator(&self, ip: &str, asn: &str, name: &str) {
            IpMetadataRepository::new(self.pool.clone())
                .upsert_metadata(&IpMetadataData {
                    ip: ip.to_string(),
                    asn: Some(asn.to_string()),
                    isp: Some(name.to_string()),
                    org: Some(name.to_string()),
                    country: Some("France".to_string()),
                    city: None,
                    lat: None,
                    lon: None,
                    resolved_at: at(0),
                })
                .await
                .unwrap();
        }

        async fn matches(&self) -> Vec<SessionMatch> {
            session_matches(&self.periods, &self.traces, 1)
                .await
                .unwrap()
        }
    }

    fn at(sec: i64) -> String {
        (Utc.with_ymd_and_hms(2026, 9, 13, 14, 0, 0).unwrap() + chrono::Duration::seconds(sec))
            .to_rfc3339_opts(SecondsFormat::Secs, true)
    }

    fn hop(n: i32, ip: &str, (min, avg, max): (f64, f64, f64), loss: f64) -> HopData {
        HopData {
            hop_number: n,
            ip: Some(ip.to_string()),
            hostname: None,
            latency_min: Some(min),
            latency_avg: Some(avg),
            latency_max: Some(max),
            packet_loss: Some(loss),
            is_problem_hop: false,
            source: Some("ICMP".to_string()),
        }
    }

    fn silent(n: i32) -> HopData {
        HopData {
            hop_number: n,
            ip: None,
            hostname: None,
            latency_min: None,
            latency_avg: None,
            latency_max: None,
            packet_loss: Some(100.0),
            is_problem_hop: false,
            source: Some("ICMP".to_string()),
        }
    }

    fn route_to_silent_riot() -> Vec<HopData> {
        vec![
            hop(1, "192.168.1.254", (0.4, 0.6, 0.9), 0.0),
            hop(2, "77.136.10.6", (3.1, 3.6, 4.2), 0.0),
            hop(3, "87.245.233.46", (17.0, 17.6, 18.0), 0.0),
            silent(4),
        ]
    }

    fn route_to(ip: &str, rtt: f64, loss: f64) -> Vec<HopData> {
        vec![
            hop(1, "192.168.1.254", (0.4, 0.6, 0.9), 0.0),
            hop(2, "77.136.10.6", (3.1, 3.6, 4.2), loss),
            hop(3, ip, (rtt - 0.5, rtt, rtt + 0.5), loss),
        ]
    }

    #[tokio::test]
    async fn empty_session_has_no_matches() {
        let session = Session::new().await;

        assert!(session.matches().await.is_empty());
        assert!(session_matches(&session.periods, &session.traces, 42)
            .await
            .unwrap()
            .is_empty());
    }

    #[tokio::test]
    async fn one_match_carries_the_numbers_of_its_trace() {
        let session = Session::new().await;
        let period_id = session.period(RIOT, 7220, (0, 2556), FlowKind::Game).await;
        let trace_id = session.trace(RIOT, 41, &route_to_silent_riot()).await;
        session.operator(RIOT, "AS6507", "Riot Games, Inc").await;

        let matches = session.matches().await;

        assert_eq!(matches.len(), 1);
        let game = &matches[0];
        assert_eq!(game.number, 1);
        assert_eq!(game.flow.period_id, period_id);
        assert_eq!(game.flow.port, 7220);
        assert_eq!(game.flow.duration_secs, 2556);
        assert_eq!(
            game.flow.operator,
            Some(FlowOperator {
                asn: Some(6507),
                name: Some("Riot Games, Inc".to_string()),
                city: None,
                country: Some("France".to_string()),
            })
        );
        assert_eq!(
            game.flow.trace,
            Some(TraceMeasure {
                traceroute_id: trace_id,
                started_at: at(41),
                completed_at: Some(at(71)),
                offset_secs: 41,
                measured_hop: Some(3),
                at_destination: false,
                ping_ms: Some(17.6),
                loss_pct: Some(0.0),
                jitter_ms: Some(1.0),
            })
        );
        assert_eq!(game.flow.status, Severity::Ok);
        assert!(game.voice.is_none());

        let mut shown = session
            .traces
            .get_traceroutes_with_hops_for_session(1)
            .await
            .unwrap();
        shown.iter_mut().for_each(assess_traceroute);
        let metadata = IpMetadataRepository::new(session.pool.clone());
        attach_routes(&mut shown, Some(&metadata)).await;
        let route = shown[0].route.as_ref().unwrap();
        let measure = game.flow.trace.as_ref().unwrap();
        assert_eq!(measure.ping_ms, Some(route.total_ms));
        assert_eq!(measure.measured_hop, Some(route.last_responding_hop));
        assert_eq!(measure.at_destination, !route.destination_silent);
        assert_eq!(game.flow.status, shown[0].status);
    }

    #[tokio::test]
    async fn several_matches_are_numbered_in_order_and_share_a_server_trace() {
        let session = Session::new().await;
        session
            .period(RIOT_PARIS, 7300, (3800, 5600), FlowKind::Game)
            .await;
        session.period(RIOT, 7036, (0, 1800), FlowKind::Game).await;
        session
            .period(RIOT, 7108, (1900, 3700), FlowKind::Game)
            .await;
        let riot_trace = session.trace(RIOT, 40, &route_to_silent_riot()).await;
        session
            .trace(RIOT_PARIS, 3830, &[silent(1), silent(2), silent(3)])
            .await;

        let matches = session.matches().await;

        let rows: Vec<(u32, &str, i32)> = matches
            .iter()
            .map(|m| (m.number, m.flow.ip.as_str(), m.flow.port))
            .collect();
        assert_eq!(
            rows,
            vec![(1, RIOT, 7036), (2, RIOT, 7108), (3, RIOT_PARIS, 7300)]
        );

        let second = matches[1].flow.trace.as_ref().unwrap();
        assert_eq!(second.traceroute_id, riot_trace);
        assert_eq!(second.offset_secs, -1860);
        assert_eq!(second.ping_ms, Some(17.6));

        let third = &matches[2].flow;
        let silent_trace = third.trace.as_ref().unwrap();
        assert_eq!(silent_trace.ping_ms, None);
        assert_eq!(silent_trace.loss_pct, None);
        assert_eq!(silent_trace.measured_hop, None);
        assert_eq!(third.status, Severity::Unmeasured);
    }

    #[tokio::test]
    async fn voice_is_linked_to_its_match_and_never_listed() {
        let session = Session::new().await;
        session
            .period(PARTY_VOICE, 27022, (0, 3800), FlowKind::Voice)
            .await;
        let team = session
            .period(TEAM_VOICE, 27020, (50, 1850), FlowKind::Voice)
            .await;
        session.period(RIOT, 7036, (60, 1860), FlowKind::Game).await;
        session
            .period(RIOT, 7108, (1950, 3750), FlowKind::Game)
            .await;
        session
            .trace(TEAM_VOICE, 100, &route_to(TEAM_VOICE, 14.0, 0.0))
            .await;

        let matches = session.matches().await;

        assert_eq!(matches.len(), 2);
        assert!(matches.iter().all(|m| m.flow.ip == RIOT));

        let first = matches[0].voice.as_ref().unwrap();
        assert_eq!(first.period_id, team);
        let measure = first.trace.as_ref().unwrap();
        assert!(measure.at_destination);
        assert_eq!(measure.ping_ms, Some(14.0));
        assert_eq!(first.status, Severity::Ok);

        let second = matches[1].voice.as_ref().unwrap();
        assert_eq!(second.ip, PARTY_VOICE);
        assert!(second.trace.is_none());
        assert_eq!(second.status, Severity::Unmeasured);
    }

    #[tokio::test]
    async fn unknown_game_counts_once_it_lasts_thirty_seconds() {
        let session = Session::new().await;
        session.feed("155.133.226.70", "UDP", 27015, (0, 60)).await;
        session
            .feed("155.133.226.71", "UDP", 27016, (100, 120))
            .await;
        session.feed("51.89.1.1", "TCP", 443, (0, 60)).await;
        session.feed("142.250.1.1", "UDP", 443, (0, 60)).await;
        session.feed("104.18.0.1", "UDP", 7000, (0, 60)).await;
        session
            .operator("104.18.0.1", "AS13335", "Cloudflare, Inc.")
            .await;

        let matches = session.matches().await;

        assert_eq!(matches.len(), 1);
        let game = &matches[0].flow;
        assert_eq!((game.ip.as_str(), game.port), ("155.133.226.70", 27015));
        assert_eq!(game.duration_secs, 60);
        assert_eq!(game.packet_count, 13 * 380);
        assert!(game.operator.is_none());
        assert!(game.trace.is_none());
        assert_eq!(game.status, Severity::Unmeasured);
    }

    #[tokio::test]
    async fn summary_takes_the_median_ping_and_the_worst_status() {
        let session = Session::new().await;
        session.period(RIOT, 7036, (0, 1800), FlowKind::Game).await;
        session
            .period(RIOT_PARIS, 7108, (1900, 3700), FlowKind::Game)
            .await;
        session
            .period("155.133.226.70", 27015, (3800, 5600), FlowKind::Game)
            .await;
        session.trace(RIOT, 30, &route_to_silent_riot()).await;
        session
            .trace(RIOT_PARIS, 1930, &route_to(RIOT_PARIS, 18.0, 33.3))
            .await;

        let summary = summarize(&session.matches().await);

        assert_eq!(
            summary,
            MatchSummary {
                match_count: 3,
                median_ping_ms: Some(17.8),
                median_ping_at_least: true,
                status: Some(Severity::Critical),
            }
        );
        assert!(summary.needs_review());
    }

    #[tokio::test]
    async fn summary_is_exact_when_every_match_reaches_its_server() {
        let session = Session::new().await;
        for (n, port) in [7036, 7108, 7220].into_iter().enumerate() {
            let from = n as i64 * 1900;
            session
                .period(RIOT, port, (from, from + 1800), FlowKind::Game)
                .await;
        }
        session
            .period(RIOT_PARIS, 7300, (6000, 7800), FlowKind::Game)
            .await;
        session.trace(RIOT, 30, &route_to(RIOT, 31.0, 0.0)).await;
        session
            .trace(RIOT_PARIS, 6030, &route_to(RIOT_PARIS, 18.0, 0.0))
            .await;

        let summary = summarize(&session.matches().await);

        assert_eq!(summary.match_count, 4);
        assert_eq!(summary.median_ping_ms, Some(31.0));
        assert!(!summary.median_ping_at_least);
        assert_eq!(summary.status, Some(Severity::Ok));
        assert!(!summary.needs_review());
    }

    #[tokio::test]
    async fn summary_of_matches_without_trace_is_unmeasured_never_zero() {
        let session = Session::new().await;
        session.period(RIOT, 7036, (0, 1800), FlowKind::Game).await;

        let summary = summarize(&session.matches().await);

        assert_eq!(summary.match_count, 1);
        assert_eq!(summary.median_ping_ms, None);
        assert!(!summary.median_ping_at_least);
        assert_eq!(summary.status, Some(Severity::Unmeasured));
        assert_eq!(summarize(&[]), MatchSummary::default());
    }

    #[test]
    fn median_of_even_and_odd_counts() {
        assert_eq!(median(vec![]), None);
        assert_eq!(median(vec![31.0]), Some(31.0));
        assert_eq!(median(vec![40.0, 17.0, 31.0]), Some(31.0));
        assert_eq!(median(vec![40.0, 17.0, 31.0, 18.0]), Some(24.5));
    }

    #[tokio::test]
    async fn summaries_load_every_session_at_once_with_the_same_numbers() {
        let session = Session::new().await;
        session.period(RIOT, 7036, (0, 1800), FlowKind::Game).await;
        session
            .period(TEAM_VOICE, 27020, (0, 1800), FlowKind::Voice)
            .await;
        session.trace(RIOT, 30, &route_to_silent_riot()).await;
        session
            .trace("8.8.8.8", 40, &route_to("8.8.8.8", 300.0, 50.0))
            .await;
        session
            .trace(TEAM_VOICE, 50, &route_to(TEAM_VOICE, 14.0, 0.0))
            .await;

        sqlx::query(
            "INSERT INTO sessions (id, game_name, started_at) VALUES (2, 'VALORANT', '2026-09-14T14:00:00Z')",
        )
        .execute(&session.pool)
        .await
        .unwrap();
        let mut data = IpPeriodData::new(
            2,
            RIOT_PARIS.to_string(),
            "UDP".to_string(),
            7300,
            at(0),
            100,
        );
        data.ended_at = at(1800);
        let id = session.periods.insert_period(&data).await.unwrap();
        session
            .periods
            .set_flow_kind(id, FlowKind::Game)
            .await
            .unwrap();
        let trace = session
            .traces
            .insert_traceroute(&TracerouteData::new(2, RIOT_PARIS.to_string(), at(30)))
            .await
            .unwrap();
        HopRepository::new(session.pool.clone())
            .insert_hops_batch(trace, &route_to(RIOT_PARIS, 18.0, 0.0))
            .await
            .unwrap();

        let summaries = session_summaries(&session.periods, &session.traces, &[1, 2, 3])
            .await
            .unwrap();

        for id in [1, 2] {
            let one_by_one = session_matches(&session.periods, &session.traces, id)
                .await
                .unwrap();
            assert_eq!(summaries[&id], summarize(&one_by_one), "session {id}");
        }
        assert_eq!(summaries[&1].median_ping_ms, Some(17.6));
        assert_eq!(summaries[&1].status, Some(Severity::Ok));
        assert_eq!(summaries[&2].median_ping_ms, Some(18.0));
        assert_eq!(summaries[&3], MatchSummary::default());
        assert!(session_summaries(&session.periods, &session.traces, &[])
            .await
            .unwrap()
            .is_empty());
    }

    #[tokio::test]
    async fn loss_counts_only_when_it_persists_to_the_measured_hop() {
        let session = Session::new().await;
        session.period(RIOT, 7036, (0, 1800), FlowKind::Game).await;
        session
            .period(RIOT_PARIS, 7108, (1900, 3700), FlowKind::Game)
            .await;
        let mut rate_limited = route_to(RIOT, 30.0, 0.0);
        rate_limited[1].packet_loss = Some(66.7);
        session.trace(RIOT, 30, &rate_limited).await;
        session
            .trace(RIOT_PARIS, 1930, &route_to(RIOT_PARIS, 18.0, 33.3))
            .await;

        let matches = session.matches().await;

        let first = &matches[0].flow;
        assert_eq!(first.trace.as_ref().unwrap().loss_pct, Some(0.0));
        assert_eq!(first.status, Severity::Ok);
        let second = &matches[1].flow;
        assert_eq!(second.trace.as_ref().unwrap().loss_pct, Some(33.3));
        assert_eq!(second.status, Severity::Critical);
    }
}

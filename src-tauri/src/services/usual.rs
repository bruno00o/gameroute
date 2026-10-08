use crate::config::{USUAL_PING_MIN_SAMPLES, USUAL_PING_SAMPLES};
use crate::db::analytics::AnalyticsRepository;
use crate::db::game_pings::GamePingRepository;
use crate::db::ip_metadata::IpMetadataRepository;
use crate::db::ip_periods::IpPeriodRepository;
use crate::db::traceroutes::TracerouteRepository;
use crate::db::DbError;
use crate::models::hop::ProbedHop;
use crate::models::insights::{IncidentCause, PingBasis, PingSource, UsualPing};
use crate::models::ip_metadata::IpMetadataData;
use crate::models::session::{GameMeasure, MeasuredFlow, SessionMatch, TraceMeasure};
use crate::models::severity::Severity;
use crate::models::traceroute_record::TracerouteWithHops;
use crate::services::asn_resolver::lookup_metadata;
use crate::services::matches::{matched_sessions, median, MatchedSession};
use crate::services::severity::{loss_status, severity, Measurement};
use chrono::{DateTime, FixedOffset};
use std::collections::HashMap;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum SampleId {
    Trace(i64),
    Match(i64),
}

pub fn sample_id(flow: &MeasuredFlow) -> Option<SampleId> {
    match (&flow.game, &flow.trace) {
        (Some(_), _) => Some(SampleId::Match(flow.period_id)),
        (None, Some(trace)) => Some(SampleId::Trace(trace.traceroute_id)),
        (None, None) => None,
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct PingSample {
    pub id: SampleId,
    pub measured_at: DateTime<FixedOffset>,
    pub cutoff: DateTime<FixedOffset>,
    pub basis: PingBasis,
    pub ping_ms: f64,
    pub loss_pct: f64,
    pub session_id: i64,
    pub match_number: u32,
    pub match_started_at: String,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct Server {
    pub ip: String,
    pub asn: Option<u32>,
    pub operator: Option<String>,
    pub city: Option<String>,
}

impl Server {
    pub fn operator_key(&self) -> (Option<u32>, Option<&str>) {
        (self.asn, self.asn.is_none().then_some(self.ip.as_str()))
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct ServerMatch {
    pub game_name: String,
    pub server: Server,
    pub started_at: String,
    pub sample: Option<PingSample>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Assessment {
    pub status: Severity,
    pub cause: Option<IncidentCause>,
    pub usual: UsualPing,
}

pub struct MatchHistory {
    pub sessions: HashMap<i64, MatchedSession>,
    pub matches: Vec<ServerMatch>,
}

type PoolKey<'a> = (&'a str, Option<u32>, Option<&'a str>);

pub fn parse(timestamp: &str) -> Option<DateTime<FixedOffset>> {
    DateTime::parse_from_rfc3339(timestamp).ok()
}

pub fn usual_ping<'a>(
    samples: impl IntoIterator<Item = &'a PingSample>,
    basis: &PingBasis,
    before: DateTime<FixedOffset>,
) -> UsualPing {
    let mut previous: Vec<&PingSample> = samples
        .into_iter()
        .filter(|sample| &sample.basis == basis && sample.measured_at < before)
        .collect();
    previous.sort_by_key(|sample| sample.measured_at);
    let window = &previous[previous.len().saturating_sub(USUAL_PING_SAMPLES)..];

    UsualPing {
        median_ms: (window.len() >= USUAL_PING_MIN_SAMPLES)
            .then(|| median(window.iter().map(|sample| sample.ping_ms).collect()))
            .flatten(),
        sample_count: window.len() as u32,
    }
}

pub fn assess(
    ping_ms: f64,
    usual_ms: Option<f64>,
    loss_pct: f64,
) -> (Severity, Option<IncidentCause>) {
    let status = severity(&Measurement {
        rtt_ms: Some(ping_ms),
        baseline_ms: usual_ms,
        loss_pct: Some(loss_pct),
        jitter_ms: None,
    });
    let cause = match status {
        Severity::Ok | Severity::Unmeasured => None,
        _ if loss_status(loss_pct) == Some(status) => Some(IncidentCause::Loss),
        _ => Some(IncidentCause::Latency),
    };
    (status, cause)
}

pub fn pools(matches: &[ServerMatch]) -> HashMap<PoolKey<'_>, Vec<&PingSample>> {
    let mut pools: HashMap<PoolKey, Vec<&PingSample>> = HashMap::new();
    for game in matches {
        if let Some(sample) = &game.sample {
            let (asn, ip) = game.server.operator_key();
            pools
                .entry((game.game_name.as_str(), asn, ip))
                .or_default()
                .push(sample);
        }
    }
    pools
}

pub fn assessments(matches: &[ServerMatch]) -> HashMap<SampleId, Assessment> {
    pools(matches)
        .values()
        .flat_map(|pool| {
            pool.iter().map(move |sample| {
                let usual = usual_ping(pool.iter().copied(), &sample.basis, sample.cutoff);
                let (status, cause) = assess(sample.ping_ms, usual.median_ms, sample.loss_pct);
                let assessment = Assessment {
                    status,
                    cause,
                    usual,
                };
                (sample.id, assessment)
            })
        })
        .collect()
}

fn asn_number(data: &IpMetadataData) -> Option<u32> {
    data.asn.as_deref()?.strip_prefix("AS")?.parse().ok()
}

fn last_router(trace: &TracerouteWithHops) -> Option<&str> {
    trace
        .hops
        .iter()
        .rev()
        .filter(|hop| hop.responded())
        .filter_map(|hop| hop.ip())
        .find(|ip| *ip != trace.target_ip)
}

fn ping_basis(
    measure: &TraceMeasure,
    server_ip: &str,
    trace: Option<&TracerouteWithHops>,
    places: &HashMap<String, IpMetadataData>,
) -> PingBasis {
    if measure.at_destination {
        return PingBasis {
            source: PingSource::Trace,
            at_destination: true,
            measured_hop: None,
            measured_asn: None,
            server_ip: Some(server_ip.to_string()),
            region: None,
        };
    }
    let hop_ip = trace
        .and_then(|trace| {
            trace
                .hops
                .iter()
                .find(|hop| Some(hop.hop_number) == measure.measured_hop)
        })
        .and_then(|hop| hop.ip());
    PingBasis {
        source: PingSource::Trace,
        at_destination: false,
        measured_hop: measure.measured_hop,
        measured_asn: hop_ip.and_then(|ip| places.get(ip)).and_then(asn_number),
        server_ip: None,
        region: None,
    }
}

fn game_basis(measure: &GameMeasure, server_ip: &str) -> PingBasis {
    PingBasis {
        source: measure.source,
        at_destination: true,
        measured_hop: None,
        measured_asn: None,
        server_ip: (measure.source == PingSource::Game).then(|| server_ip.to_string()),
        region: measure.region.clone(),
    }
}

async fn server_matches(
    sessions: &[(i64, String)],
    matched: &HashMap<i64, MatchedSession>,
    metadata: Option<&IpMetadataRepository>,
) -> Vec<ServerMatch> {
    let played: Vec<(i64, &str, &[SessionMatch])> = sessions
        .iter()
        .filter_map(|(id, game)| Some((*id, game.as_str(), matched.get(id)?.matches.as_slice())))
        .collect();
    let traces: HashMap<i64, &TracerouteWithHops> = matched
        .values()
        .flat_map(|session| &session.traces)
        .map(|trace| (trace.id, trace))
        .collect();

    let mut ips: Vec<String> = played
        .iter()
        .flat_map(|(_, _, matches)| matches.iter().map(|game| game.flow.ip.clone()))
        .chain(
            traces
                .values()
                .flat_map(|trace| trace.hops.iter().filter_map(|hop| hop.ip.clone())),
        )
        .collect();
    ips.sort();
    ips.dedup();
    let places = lookup_metadata(&ips, metadata).await;

    let mut cities: HashMap<&str, (DateTime<FixedOffset>, &str)> = HashMap::new();
    for trace in traces.values() {
        let city = last_router(trace)
            .and_then(|ip| places.get(ip))
            .and_then(|place| place.city.as_deref());
        if let Some((city, at)) = city.zip(parse(&trace.started_at)) {
            let latest = cities.entry(trace.target_ip.as_str()).or_insert((at, city));
            if at > latest.0 {
                *latest = (at, city);
            }
        }
    }

    let mut owners: HashMap<i64, (i64, u32, i64)> = HashMap::new();
    let mut first_starts: HashMap<i64, DateTime<FixedOffset>> = HashMap::new();
    for (session_id, _, matches) in &played {
        for game in matches.iter().filter(|game| game.flow.game.is_none()) {
            let Some(measure) = &game.flow.trace else {
                continue;
            };
            let distance = measure.offset_secs.abs();
            if owners
                .get(&measure.traceroute_id)
                .is_none_or(|&(_, _, best)| distance < best)
            {
                owners.insert(measure.traceroute_id, (*session_id, game.number, distance));
            }
            if let Some(started) = parse(&game.flow.started_at) {
                let first = first_starts.entry(measure.traceroute_id).or_insert(started);
                *first = (*first).min(started);
            }
        }
    }

    let sample = |session_id: i64, game: &SessionMatch| -> Option<PingSample> {
        if let Some(reported) = &game.flow.game {
            let started = parse(&game.flow.started_at)?;
            return Some(PingSample {
                id: SampleId::Match(game.flow.period_id),
                measured_at: started,
                cutoff: started,
                basis: game_basis(reported, &game.flow.ip),
                ping_ms: reported.ping_ms,
                loss_pct: game.flow.loss_pct().unwrap_or(0.0),
                session_id,
                match_number: game.number,
                match_started_at: game.flow.started_at.clone(),
            });
        }
        let measure = game.flow.trace.as_ref()?;
        let &(owner, number, _) = owners.get(&measure.traceroute_id)?;
        if (owner, number) != (session_id, game.number) {
            return None;
        }
        let measured_at = parse(&measure.started_at)?;
        Some(PingSample {
            id: SampleId::Trace(measure.traceroute_id),
            measured_at,
            cutoff: first_starts
                .get(&measure.traceroute_id)
                .map_or(measured_at, |first| measured_at.min(*first)),
            basis: ping_basis(
                measure,
                &game.flow.ip,
                traces.get(&measure.traceroute_id).copied(),
                &places,
            ),
            ping_ms: measure.ping_ms?,
            loss_pct: measure.loss_pct.unwrap_or(0.0),
            session_id,
            match_number: game.number,
            match_started_at: game.flow.started_at.clone(),
        })
    };

    played
        .iter()
        .flat_map(|(session_id, game_name, matches)| {
            matches.iter().map(|game| {
                let place = places.get(&game.flow.ip);
                ServerMatch {
                    game_name: game_name.to_string(),
                    server: Server {
                        ip: game.flow.ip.clone(),
                        asn: place.and_then(asn_number),
                        operator: place
                            .and_then(|place| place.org.clone().or_else(|| place.isp.clone())),
                        city: cities
                            .get(game.flow.ip.as_str())
                            .map(|(_, city)| city.to_string()),
                    },
                    started_at: game.flow.started_at.clone(),
                    sample: sample(*session_id, game),
                }
            })
        })
        .collect()
}

pub async fn match_history(
    analytics: &AnalyticsRepository,
    periods: &IpPeriodRepository,
    traceroutes: &TracerouteRepository,
    game_pings: Option<&GamePingRepository>,
    metadata: Option<&IpMetadataRepository>,
) -> Result<MatchHistory, DbError> {
    let sessions = analytics.get_game_sessions().await?;
    let ids: Vec<i64> = sessions.iter().map(|(id, _)| *id).collect();
    let mut matched = matched_sessions(periods, traceroutes, game_pings, &ids).await?;
    let matches = server_matches(&sessions, &matched, metadata).await;

    let assessed = assessments(&matches);
    for session in matched.values_mut() {
        for game in &mut session.matches {
            let Some(assessment) = sample_id(&game.flow).and_then(|id| assessed.get(&id)) else {
                continue;
            };
            game.flow.status = assessment.status;
            let usual = Some(assessment.usual.clone());
            match (game.flow.game.as_mut(), game.flow.trace.as_mut()) {
                (Some(reported), _) => reported.usual = usual,
                (None, Some(measure)) => measure.usual = usual,
                (None, None) => {}
            }
        }
    }

    Ok(MatchHistory {
        sessions: matched,
        matches,
    })
}

#[cfg(test)]
pub mod fixtures {
    use super::*;
    use crate::db::hops::HopRepository;
    use crate::models::flow_kind::FlowKind;
    use crate::models::game_ping::GamePingSample;
    use crate::models::ip_period::IpPeriodData;
    use crate::models::session::HopData;
    use crate::models::TracerouteData;
    use chrono::{Duration, SecondsFormat, TimeZone, Utc};
    use sqlx::SqlitePool;

    pub const RIOT: &str = "162.249.72.5";
    pub const RIOT_PARIS: &str = "185.40.64.1";

    pub fn day(day: u32, hour: u32) -> DateTime<FixedOffset> {
        Utc.with_ymd_and_hms(2026, 9, day, hour, 0, 0)
            .unwrap()
            .fixed_offset()
    }

    pub fn since() -> DateTime<FixedOffset> {
        day(20, 0)
    }

    pub fn lower_bound(hop: i32) -> PingBasis {
        PingBasis {
            source: PingSource::Trace,
            at_destination: false,
            measured_hop: Some(hop),
            measured_asn: Some(15557),
            server_ip: None,
            region: None,
        }
    }

    pub fn exact() -> PingBasis {
        PingBasis {
            source: PingSource::Trace,
            at_destination: true,
            measured_hop: None,
            measured_asn: None,
            server_ip: Some(RIOT_PARIS.to_string()),
            region: None,
        }
    }

    pub fn sample(at: DateTime<FixedOffset>, basis: PingBasis, ping_ms: f64) -> PingSample {
        PingSample {
            id: SampleId::Trace(at.timestamp()),
            measured_at: at,
            cutoff: at,
            basis,
            ping_ms,
            loss_pct: 0.0,
            session_id: at.timestamp() / 3600,
            match_number: 1,
            match_started_at: at.to_rfc3339(),
        }
    }

    pub fn riot(ip: &str, city: Option<&str>) -> Server {
        Server {
            ip: ip.to_string(),
            asn: Some(6507),
            operator: Some("Riot Games, Inc".to_string()),
            city: city.map(str::to_string),
        }
    }

    pub fn played(game: &str, server: Server, at: DateTime<FixedOffset>) -> ServerMatch {
        ServerMatch {
            game_name: game.to_string(),
            server,
            started_at: at.to_rfc3339(),
            sample: None,
        }
    }

    pub fn measured_sample(sample: PingSample) -> ServerMatch {
        ServerMatch {
            started_at: sample.match_started_at.clone(),
            sample: Some(sample.clone()),
            ..played("VALORANT", riot(RIOT_PARIS, None), sample.measured_at)
        }
    }

    pub fn measured(at: DateTime<FixedOffset>, basis: PingBasis, ping_ms: f64) -> ServerMatch {
        measured_sample(sample(at, basis, ping_ms))
    }

    pub fn history(count: u32, basis: PingBasis, ping_ms: f64) -> Vec<ServerMatch> {
        (1..=count)
            .map(|n| measured(day(10, n), basis.clone(), ping_ms))
            .collect()
    }

    pub fn at(sec: i64) -> String {
        (Utc.with_ymd_and_hms(2026, 9, 21, 20, 0, 0).unwrap() + Duration::seconds(sec))
            .to_rfc3339_opts(SecondsFormat::Secs, true)
    }

    pub fn hop(n: i32, ip: &str, rtt: f64) -> HopData {
        HopData {
            hop_number: n,
            ip: Some(ip.to_string()),
            hostname: None,
            latency_min: Some(rtt - 0.5),
            latency_avg: Some(rtt),
            latency_max: Some(rtt + 0.5),
            packet_loss: Some(0.0),
            is_problem_hop: false,
            source: Some("ICMP".to_string()),
        }
    }

    pub fn silent(n: i32) -> HopData {
        HopData {
            ip: None,
            latency_min: None,
            latency_avg: None,
            latency_max: None,
            packet_loss: Some(100.0),
            ..hop(n, "", 0.0)
        }
    }

    pub async fn session(pool: &SqlitePool, id: i64, game: &str, started: i64) {
        sqlx::query("INSERT INTO sessions (id, game_name, started_at) VALUES ($1, $2, $3)")
            .bind(id)
            .bind(game)
            .bind(at(started))
            .execute(pool)
            .await
            .unwrap();
    }

    pub async fn period(
        pool: &SqlitePool,
        session: i64,
        ip: &str,
        port: i32,
        (from, to): (i64, i64),
    ) {
        let periods = IpPeriodRepository::new(pool.clone());
        let mut data =
            IpPeriodData::new(session, ip.to_string(), "UDP".into(), port, at(from), 100);
        data.ended_at = at(to);
        let id = periods.insert_period(&data).await.unwrap();
        periods.set_flow_kind(id, FlowKind::Game).await.unwrap();
    }

    pub async fn trace(pool: &SqlitePool, session: i64, ip: &str, started: i64, hops: &[HopData]) {
        let id = TracerouteRepository::new(pool.clone())
            .insert_traceroute(&TracerouteData::new(session, ip.to_string(), at(started)))
            .await
            .unwrap();
        HopRepository::new(pool.clone())
            .insert_hops_batch(id, hops)
            .await
            .unwrap();
    }

    pub async fn operator(pool: &SqlitePool, ip: &str, asn: &str, name: &str, city: Option<&str>) {
        IpMetadataRepository::new(pool.clone())
            .upsert_metadata(&IpMetadataData {
                ip: ip.to_string(),
                asn: Some(asn.to_string()),
                isp: Some(name.to_string()),
                org: Some(name.to_string()),
                country: Some("France".to_string()),
                city: city.map(str::to_string),
                lat: None,
                lon: None,
                resolved_at: at(0),
            })
            .await
            .unwrap();
    }

    pub async fn behind_isp(pool: &SqlitePool, id: i64, day: i64, ping_ms: f64) {
        let start = day * 86_400;
        session(pool, id, "VALORANT", start).await;
        period(pool, id, RIOT, 7036, (start, start + 1800)).await;
        trace(
            pool,
            id,
            RIOT,
            start + 40,
            &[
                hop(1, "192.168.1.254", 0.6),
                hop(2, "77.136.10.6", ping_ms),
                silent(3),
            ],
        )
        .await;
    }

    pub fn game() -> PingBasis {
        PingBasis {
            source: PingSource::Game,
            at_destination: true,
            measured_hop: None,
            measured_asn: None,
            server_ip: Some(RIOT.to_string()),
            region: None,
        }
    }

    pub fn region(name: &str) -> PingBasis {
        PingBasis {
            source: PingSource::GameRegion,
            at_destination: true,
            measured_hop: None,
            measured_asn: None,
            server_ip: None,
            region: Some(name.to_string()),
        }
    }

    pub async fn reported_by_league(pool: &SqlitePool, id: i64, day: i64, ping_ms: f64) {
        let start = day * 86_400;
        session(pool, id, "League of Legends", start).await;
        let port = 7000 + id as i32;
        period(pool, id, RIOT, port, (start, start + 1800)).await;
        trace(
            pool,
            id,
            RIOT,
            start + 40,
            &[
                hop(1, "192.168.1.254", 0.6),
                hop(2, "77.136.10.6", 5.0),
                silent(3),
            ],
        )
        .await;
        let samples: Vec<GamePingSample> = (1..=3)
            .map(|n| {
                let at = parse(&at(start + n * 10)).unwrap().with_timezone(&Utc);
                let mut sample = GamePingSample::new(PingSource::Game, at);
                sample.session_id = id;
                sample.peer_ip = Some(RIOT.to_string());
                sample.peer_port = Some(port);
                sample.rtt_ms = Some(ping_ms);
                sample
            })
            .collect();
        GamePingRepository::new(pool.clone())
            .insert_samples(&samples)
            .await
            .unwrap();
    }
}

#[cfg(test)]
mod tests {
    use super::fixtures::*;
    use super::*;
    use crate::db::create_test_pool;
    use chrono::Duration;

    #[test]
    fn usual_is_the_median_of_the_twenty_previous_comparable_samples() {
        let samples: Vec<PingSample> = (1..=25)
            .map(|n| sample(day(1, 0) + Duration::hours(n), lower_bound(5), n as f64))
            .collect();

        assert_eq!(
            usual_ping(&samples, &lower_bound(5), since()),
            UsualPing {
                median_ms: Some(15.5),
                sample_count: 20,
            }
        );
        assert_eq!(
            usual_ping(&samples, &lower_bound(5), day(1, 21)).median_ms,
            Some(10.5)
        );
    }

    #[test]
    fn usual_needs_five_comparable_samples() {
        let samples: Vec<PingSample> = (1..=5)
            .map(|n| sample(day(1, n), lower_bound(5), 5.0 + n as f64))
            .collect();

        assert_eq!(
            usual_ping(&samples[..4], &lower_bound(5), since()),
            UsualPing {
                median_ms: None,
                sample_count: 4,
            }
        );
        assert_eq!(
            usual_ping(&samples, &lower_bound(5), since()),
            UsualPing {
                median_ms: Some(8.0),
                sample_count: 5,
            }
        );
        assert_eq!(
            usual_ping(&[], &lower_bound(5), since()),
            UsualPing::default()
        );
    }

    #[test]
    fn lower_bounds_and_exact_pings_never_mix() {
        let mut samples: Vec<PingSample> = (1..=10)
            .map(|n| sample(day(1, n), lower_bound(5), 5.0))
            .collect();
        samples.extend((1..=10).map(|n| sample(day(2, n), lower_bound(8), 17.0)));
        samples.extend((1..=3).map(|n| sample(day(3, n), exact(), 31.0)));
        let other_operator = PingBasis {
            measured_asn: Some(9002),
            ..lower_bound(5)
        };
        let other_server = PingBasis {
            server_ip: Some(RIOT.to_string()),
            ..exact()
        };

        assert_eq!(
            usual_ping(&samples, &lower_bound(5), since()).median_ms,
            Some(5.0)
        );
        assert_eq!(
            usual_ping(&samples, &lower_bound(8), since()).median_ms,
            Some(17.0)
        );
        assert_eq!(
            usual_ping(&samples, &exact(), since()),
            UsualPing {
                median_ms: None,
                sample_count: 3,
            }
        );
        assert_eq!(
            usual_ping(&samples, &other_operator, since()).sample_count,
            0
        );
        assert_eq!(usual_ping(&samples, &other_server, since()).sample_count, 0);
    }

    #[test]
    fn assess_compares_with_the_usual_or_falls_back_to_fixed_thresholds() {
        assert_eq!(assess(18.0, Some(17.0), 0.0), (Severity::Ok, None));
        assert_eq!(
            assess(40.0, Some(17.0), 0.0),
            (Severity::Watch, Some(IncidentCause::Latency))
        );
        assert_eq!(assess(40.0, None, 0.0), (Severity::Ok, None));
        assert_eq!(
            assess(75.0, None, 0.0),
            (Severity::Watch, Some(IncidentCause::Latency))
        );
        assert_eq!(
            assess(18.0, Some(17.0), 33.3),
            (Severity::Critical, Some(IncidentCause::Loss))
        );
        assert_eq!(
            assess(140.0, Some(17.0), 1.0),
            (Severity::Critical, Some(IncidentCause::Latency))
        );
    }

    #[test]
    fn match_status_never_looks_ahead() {
        let spike = day(12, 20);
        let mut matches = history(6, lower_bound(5), 5.0);
        matches.push(measured(spike, lower_bound(5), 44.0));
        let before = assessments(&matches)[&SampleId::Trace(spike.timestamp())].clone();

        matches.extend((1..=12).map(|n| measured(day(13, n), lower_bound(5), 44.0)));
        matches.push(measured(day(14, 20), lower_bound(5), 150.0));
        let after = assessments(&matches)[&SampleId::Trace(spike.timestamp())].clone();

        assert_eq!(
            before,
            Assessment {
                status: Severity::Watch,
                cause: Some(IncidentCause::Latency),
                usual: UsualPing {
                    median_ms: Some(5.0),
                    sample_count: 6,
                },
            }
        );
        assert_eq!(after, before);
    }

    #[test]
    fn measurements_after_the_match_started_stay_out_of_its_usual() {
        let late = |started: DateTime<FixedOffset>, minutes: i64, ping_ms: f64| {
            measured_sample(PingSample {
                match_started_at: started.to_rfc3339(),
                cutoff: started,
                ..sample(
                    day(12, 15) + Duration::minutes(minutes),
                    lower_bound(5),
                    ping_ms,
                )
            })
        };
        let mut matches = history(6, lower_bound(5), 5.0);
        matches.push(late(day(12, 13), 38, 44.0));
        matches.push(late(day(12, 14), 37, 4.3));

        let assessed = assessments(&matches);
        let spike = &assessed[&SampleId::Trace((day(12, 15) + Duration::minutes(38)).timestamp())];
        let quiet = &assessed[&SampleId::Trace((day(12, 15) + Duration::minutes(37)).timestamp())];

        assert_eq!(spike.usual.sample_count, 6);
        assert_eq!(spike.status, Severity::Watch);
        assert_eq!(quiet.usual.sample_count, 6);
        assert_eq!(quiet.status, Severity::Ok);
    }

    #[test]
    fn games_and_operators_keep_separate_usuals() {
        let mut matches = history(6, lower_bound(5), 5.0);
        let mut lol = measured(day(12, 20), lower_bound(5), 44.0);
        lol.game_name = "League of Legends".to_string();
        let mut elsewhere = measured(day(12, 21), lower_bound(5), 44.0);
        elsewhere.server.asn = Some(13335);
        matches.extend([lol, elsewhere]);

        let assessed = assessments(&matches);
        for at in [day(12, 20), day(12, 21)] {
            assert_eq!(
                assessed[&SampleId::Trace(at.timestamp())],
                Assessment {
                    status: Severity::Ok,
                    cause: None,
                    usual: UsualPing::default(),
                }
            );
        }
    }

    #[tokio::test]
    async fn match_history_rates_matches_against_their_usual() {
        let pool = create_test_pool().await;
        for id in 1..=6 {
            behind_isp(&pool, id, id - 7, 5.0).await;
        }
        behind_isp(&pool, 7, 0, 44.0).await;
        let periods = IpPeriodRepository::new(pool.clone());
        let traceroutes = TracerouteRepository::new(pool.clone());

        let fixed = matched_sessions(&periods, &traceroutes, None, &[7])
            .await
            .unwrap();
        let history = match_history(
            &AnalyticsRepository::new(pool.clone()),
            &periods,
            &traceroutes,
            None,
            None,
        )
        .await
        .unwrap();
        let rated = |id: i64| history.sessions[&id].matches[0].flow.clone();

        assert_eq!(fixed[&7].matches[0].flow.status, Severity::Ok);
        assert_eq!(rated(7).status, Severity::Watch);
        assert_eq!(
            rated(7).trace.unwrap().usual,
            Some(UsualPing {
                median_ms: Some(5.0),
                sample_count: 6,
            })
        );
        assert_eq!(rated(1).status, Severity::Ok);
        assert_eq!(rated(1).trace.unwrap().usual, Some(UsualPing::default()));
        assert_eq!(history.matches.len(), 7);
    }

    #[tokio::test]
    async fn a_shared_trace_is_rated_from_the_first_match_using_it() {
        let pool = create_test_pool().await;
        session(&pool, 1, "VALORANT", 0).await;
        period(&pool, 1, RIOT, 7036, (0, 1800)).await;
        period(&pool, 1, RIOT, 7108, (1900, 3700)).await;
        trace(
            &pool,
            1,
            RIOT,
            1940,
            &[
                hop(1, "192.168.1.254", 0.6),
                hop(2, "77.136.10.6", 5.0),
                silent(3),
            ],
        )
        .await;

        let history = match_history(
            &AnalyticsRepository::new(pool.clone()),
            &IpPeriodRepository::new(pool.clone()),
            &TracerouteRepository::new(pool.clone()),
            None,
            None,
        )
        .await
        .unwrap();

        let samples: Vec<&PingSample> = history
            .matches
            .iter()
            .filter_map(|game| game.sample.as_ref())
            .collect();
        assert_eq!(samples.len(), 1);
        assert_eq!(samples[0].match_number, 2);
        assert_eq!(Some(samples[0].cutoff), parse(&at(0)));
        let rated: Vec<(Severity, Option<UsualPing>)> = history.sessions[&1]
            .matches
            .iter()
            .map(|game| (game.flow.status, game.flow.trace.clone().unwrap().usual))
            .collect();
        assert_eq!(rated[0], rated[1]);
    }

    #[test]
    fn each_game_source_builds_its_own_usual_from_five_matches() {
        let mut matches = history(10, lower_bound(5), 5.0);
        matches.extend((1..=4).map(|n| measured(day(11, n), game(), 13.0)));
        matches.push(measured(day(11, 5), game(), 14.0));
        matches.push(measured(day(11, 6), game(), 40.0));
        matches.extend((1..=6).map(|n| measured(day(12, n), region("Paris"), 4.0)));

        let assessed = assessments(&matches);
        let rated = |at: DateTime<FixedOffset>| assessed[&SampleId::Trace(at.timestamp())].clone();

        assert_eq!(
            rated(day(11, 5)).usual,
            UsualPing {
                median_ms: None,
                sample_count: 4,
            }
        );
        assert_eq!(rated(day(11, 5)).status, Severity::Ok);
        assert_eq!(
            rated(day(11, 6)).usual,
            UsualPing {
                median_ms: Some(13.0),
                sample_count: 5,
            }
        );
        assert_eq!(rated(day(11, 6)).status, Severity::Watch);
        assert_eq!(rated(day(12, 6)).usual.median_ms, Some(4.0));
        assert_eq!(rated(day(10, 10)).usual.median_ms, Some(5.0));
        assert_eq!(
            usual_ping(
                matches.iter().filter_map(|m| m.sample.as_ref()),
                &region("London"),
                since()
            )
            .sample_count,
            0
        );
    }

    #[tokio::test]
    async fn matches_measured_by_the_game_are_rated_against_the_game_usual() {
        let pool = create_test_pool().await;
        for id in 1..=6 {
            reported_by_league(&pool, id, id - 7, 13.0).await;
        }
        reported_by_league(&pool, 7, 0, 40.0).await;
        behind_isp(&pool, 8, 1, 5.0).await;

        let history = match_history(
            &AnalyticsRepository::new(pool.clone()),
            &IpPeriodRepository::new(pool.clone()),
            &TracerouteRepository::new(pool.clone()),
            Some(&GamePingRepository::new(pool.clone())),
            None,
        )
        .await
        .unwrap();
        let rated = |id: i64| history.sessions[&id].matches[0].flow.clone();

        let spike = rated(7);
        assert_eq!(spike.status, Severity::Watch);
        let reported = spike.game.unwrap();
        assert_eq!(reported.ping_ms, 40.0);
        assert_eq!(
            reported.usual,
            Some(UsualPing {
                median_ms: Some(13.0),
                sample_count: 6,
            })
        );
        assert_eq!(spike.trace.unwrap().usual, None);
        assert_eq!(rated(1).game.unwrap().usual, Some(UsualPing::default()));
        let isp = rated(8);
        assert!(isp.game.is_none());
        assert_eq!(isp.trace.unwrap().usual, Some(UsualPing::default()));

        let sample = history
            .matches
            .iter()
            .find_map(|game| game.sample.as_ref().filter(|s| s.session_id == 7))
            .unwrap();
        assert_eq!(sample.basis, game());
        assert_eq!(sample.id, SampleId::Match(spike.period_id));
    }
}

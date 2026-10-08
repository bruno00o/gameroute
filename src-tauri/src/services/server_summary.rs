use crate::config::{USUAL_PING_MIN_SAMPLES, USUAL_PING_SAMPLES};
use crate::db::analytics::AnalyticsRepository;
use crate::db::ip_metadata::IpMetadataRepository;
use crate::db::ip_periods::IpPeriodRepository;
use crate::db::traceroutes::TracerouteRepository;
use crate::db::DbError;
use crate::models::hop::ProbedHop;
use crate::models::insights::{
    IncidentCause, PingBasis, PingSource, RecentPing, ServerIncident, ServerSummary,
    ServerSummaryItem, UsualPing,
};
use crate::models::ip_metadata::IpMetadataData;
use crate::models::session::{SessionMatch, TraceMeasure};
use crate::models::severity::Severity;
use crate::models::traceroute_record::TracerouteWithHops;
use crate::services::asn_resolver::lookup_metadata;
use crate::services::matches::{matched_sessions, median};
use crate::services::severity::{loss_status, severity, Measurement};
use chrono::{DateTime, FixedOffset, SecondsFormat, Utc};
use std::cmp::Reverse;
use std::collections::{BTreeMap, HashMap};

#[derive(Debug, Clone, PartialEq)]
pub struct PingSample {
    pub measured_at: DateTime<FixedOffset>,
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

#[derive(Debug, Clone, PartialEq)]
pub struct ServerMatch {
    pub game_name: String,
    pub server: Server,
    pub started_at: String,
    pub sample: Option<PingSample>,
}

type ServerKey = (String, Option<u32>, Option<String>, Option<String>);

fn parse(timestamp: &str) -> Option<DateTime<FixedOffset>> {
    DateTime::parse_from_rfc3339(timestamp).ok()
}

pub fn usual_ping(
    samples: &[PingSample],
    basis: &PingBasis,
    before: DateTime<FixedOffset>,
) -> UsualPing {
    let mut previous: Vec<&PingSample> = samples
        .iter()
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

fn dominant_basis(samples: &[&PingSample]) -> Option<PingBasis> {
    let mut counts: HashMap<&PingBasis, usize> = HashMap::new();
    for sample in samples {
        *counts.entry(&sample.basis).or_default() += 1;
    }
    samples
        .iter()
        .max_by(|a, b| {
            counts[&a.basis]
                .cmp(&counts[&b.basis])
                .then(a.measured_at.cmp(&b.measured_at))
        })
        .map(|sample| sample.basis.clone())
}

fn last_incident(samples: &[PingSample]) -> Option<ServerIncident> {
    samples.iter().rev().find_map(|sample| {
        let usual = usual_ping(samples, &sample.basis, sample.measured_at);
        let (status, cause) = assess(sample.ping_ms, usual.median_ms, sample.loss_pct);
        let cause = cause?;
        Some(ServerIncident {
            session_id: sample.session_id,
            match_number: sample.match_number,
            started_at: sample.match_started_at.clone(),
            measured_at: sample.measured_at.to_rfc3339(),
            status,
            cause,
            basis: sample.basis.clone(),
            ping_ms: sample.ping_ms,
            usual_ms: usual.median_ms,
            loss_pct: sample.loss_pct,
        })
    })
}

fn summarize_server(
    matches: &[ServerMatch],
    since: DateTime<FixedOffset>,
) -> Option<ServerSummaryItem> {
    let latest = matches.iter().max_by_key(|game| parse(&game.started_at))?;
    let mut samples: Vec<PingSample> = matches
        .iter()
        .filter_map(|game| game.sample.clone())
        .collect();
    samples.sort_by_key(|sample| sample.measured_at);

    let recent: Vec<&PingSample> = samples
        .iter()
        .filter(|sample| sample.measured_at >= since)
        .collect();
    let basis = if recent.is_empty() {
        let last: Vec<&PingSample> = samples.iter().rev().take(USUAL_PING_SAMPLES).collect();
        dominant_basis(&last)
    } else {
        dominant_basis(&recent)
    };
    let comparable: Vec<&PingSample> = recent
        .into_iter()
        .filter(|sample| Some(&sample.basis) == basis.as_ref())
        .collect();
    let recent =
        median(comparable.iter().map(|sample| sample.ping_ms).collect()).map(|median_ms| {
            RecentPing {
                median_ms,
                loss_pct: median(comparable.iter().map(|sample| sample.loss_pct).collect())
                    .unwrap_or(0.0),
                sample_count: comparable.len() as u32,
            }
        });
    let usual = basis.as_ref().map_or_else(UsualPing::default, |basis| {
        usual_ping(&samples, basis, since)
    });

    let match_count = matches
        .iter()
        .filter(|game| parse(&game.started_at).is_some_and(|at| at >= since))
        .count() as u32;
    let status = match &recent {
        Some(recent) => Some(assess(recent.median_ms, usual.median_ms, recent.loss_pct).0),
        None if match_count > 0 => Some(Severity::Unmeasured),
        None => None,
    };

    let mut ips: Vec<String> = matches.iter().map(|game| game.server.ip.clone()).collect();
    ips.sort();
    ips.dedup();

    Some(ServerSummaryItem {
        game_name: latest.game_name.clone(),
        asn: latest.server.asn,
        operator: latest.server.operator.clone(),
        city: latest.server.city.clone(),
        ips,
        match_count,
        last_played_at: latest.started_at.clone(),
        basis,
        recent,
        usual,
        status,
        last_incident: last_incident(&samples),
    })
}

pub fn summarize_servers(
    matches: Vec<ServerMatch>,
    since: DateTime<FixedOffset>,
) -> Vec<ServerSummaryItem> {
    let mut groups: BTreeMap<ServerKey, Vec<ServerMatch>> = BTreeMap::new();
    for game in matches {
        let server = &game.server;
        let key = (
            game.game_name.clone(),
            server.asn,
            server.asn.is_none().then(|| server.ip.clone()),
            server.city.clone(),
        );
        groups.entry(key).or_default().push(game);
    }

    let mut servers: Vec<ServerSummaryItem> = groups
        .values()
        .filter_map(|group| summarize_server(group, since))
        .collect();
    servers.sort_by_key(|server| Reverse(parse(&server.last_played_at)));
    servers
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
    trace: Option<&TracerouteWithHops>,
    places: &HashMap<String, IpMetadataData>,
) -> PingBasis {
    if measure.at_destination {
        return PingBasis {
            source: PingSource::Trace,
            at_destination: true,
            measured_hop: None,
            measured_asn: None,
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
    }
}

pub async fn server_matches(
    analytics: &AnalyticsRepository,
    periods: &IpPeriodRepository,
    traceroutes: &TracerouteRepository,
    metadata: Option<&IpMetadataRepository>,
) -> Result<Vec<ServerMatch>, DbError> {
    let sessions = analytics.get_game_sessions().await?;
    let ids: Vec<i64> = sessions.iter().map(|(id, _)| *id).collect();
    let matched = matched_sessions(periods, traceroutes, &ids).await?;
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
    for (session_id, _, matches) in &played {
        for game in matches.iter() {
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
        }
    }

    let sample = |session_id: i64, game: &SessionMatch| -> Option<PingSample> {
        let measure = game.flow.trace.as_ref()?;
        let &(owner, number, _) = owners.get(&measure.traceroute_id)?;
        if (owner, number) != (session_id, game.number) {
            return None;
        }
        Some(PingSample {
            measured_at: parse(&measure.started_at)?,
            basis: ping_basis(
                measure,
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

    Ok(played
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
        .collect())
}

pub async fn server_summary(
    analytics: &AnalyticsRepository,
    periods: &IpPeriodRepository,
    traceroutes: &TracerouteRepository,
    metadata: Option<&IpMetadataRepository>,
    since: DateTime<Utc>,
) -> Result<ServerSummary, DbError> {
    let matches = server_matches(analytics, periods, traceroutes, metadata).await?;
    Ok(ServerSummary {
        since: since.to_rfc3339_opts(SecondsFormat::Secs, true),
        usual_max_samples: USUAL_PING_SAMPLES as u32,
        usual_min_samples: USUAL_PING_MIN_SAMPLES as u32,
        servers: summarize_servers(matches, since.fixed_offset()),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::create_test_pool;
    use crate::db::hops::HopRepository;
    use crate::models::flow_kind::FlowKind;
    use crate::models::ip_period::IpPeriodData;
    use crate::models::session::HopData;
    use crate::models::TracerouteData;
    use chrono::{Duration, TimeZone};
    use sqlx::SqlitePool;

    const RIOT: &str = "162.249.72.5";
    const RIOT_PARIS: &str = "185.40.64.1";

    fn day(day: u32, hour: u32) -> DateTime<FixedOffset> {
        Utc.with_ymd_and_hms(2026, 9, day, hour, 0, 0)
            .unwrap()
            .fixed_offset()
    }

    fn since() -> DateTime<FixedOffset> {
        day(20, 0)
    }

    fn lower_bound(hop: i32) -> PingBasis {
        PingBasis {
            source: PingSource::Trace,
            at_destination: false,
            measured_hop: Some(hop),
            measured_asn: Some(15557),
        }
    }

    fn exact() -> PingBasis {
        PingBasis {
            source: PingSource::Trace,
            at_destination: true,
            measured_hop: None,
            measured_asn: None,
        }
    }

    fn sample(at: DateTime<FixedOffset>, basis: PingBasis, ping_ms: f64) -> PingSample {
        PingSample {
            measured_at: at,
            basis,
            ping_ms,
            loss_pct: 0.0,
            session_id: at.timestamp() / 3600,
            match_number: 1,
            match_started_at: at.to_rfc3339(),
        }
    }

    fn riot(ip: &str, city: Option<&str>) -> Server {
        Server {
            ip: ip.to_string(),
            asn: Some(6507),
            operator: Some("Riot Games, Inc".to_string()),
            city: city.map(str::to_string),
        }
    }

    fn played(game: &str, server: Server, at: DateTime<FixedOffset>) -> ServerMatch {
        ServerMatch {
            game_name: game.to_string(),
            server,
            started_at: at.to_rfc3339(),
            sample: None,
        }
    }

    fn measured_sample(sample: PingSample) -> ServerMatch {
        ServerMatch {
            sample: Some(sample.clone()),
            ..played("VALORANT", riot(RIOT_PARIS, None), sample.measured_at)
        }
    }

    fn measured(at: DateTime<FixedOffset>, basis: PingBasis, ping_ms: f64) -> ServerMatch {
        measured_sample(sample(at, basis, ping_ms))
    }

    fn history(count: u32, basis: PingBasis, ping_ms: f64) -> Vec<ServerMatch> {
        (1..=count)
            .map(|n| measured(day(10, n), basis.clone(), ping_ms))
            .collect()
    }

    fn only(matches: Vec<ServerMatch>) -> ServerSummaryItem {
        let mut servers = summarize_servers(matches, since());
        assert_eq!(servers.len(), 1);
        servers.remove(0)
    }

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
    fn server_without_history_uses_fixed_thresholds() {
        let server = only(vec![
            measured(day(21, 20), lower_bound(5), 5.0),
            measured(day(22, 20), lower_bound(5), 6.0),
            measured(day(23, 20), lower_bound(5), 4.0),
        ]);

        assert_eq!(server.match_count, 3);
        assert_eq!(server.basis, Some(lower_bound(5)));
        assert_eq!(
            server.recent,
            Some(RecentPing {
                median_ms: 5.0,
                loss_pct: 0.0,
                sample_count: 3,
            })
        );
        assert_eq!(server.usual, UsualPing::default());
        assert_eq!(server.status, Some(Severity::Ok));
        assert_eq!(server.last_incident, None);

        let slow = only(vec![
            measured(day(21, 20), exact(), 72.0),
            measured(day(22, 20), exact(), 75.0),
        ]);
        assert_eq!(slow.status, Some(Severity::Watch));
        let incident = slow.last_incident.unwrap();
        assert_eq!(incident.ping_ms, 75.0);
        assert_eq!(incident.usual_ms, None);
        assert_eq!(incident.cause, IncidentCause::Latency);
    }

    #[test]
    fn recent_median_is_compared_with_the_usual() {
        let mut matches = history(8, lower_bound(5), 17.0);
        matches.extend([
            measured(day(21, 20), lower_bound(5), 39.0),
            measured(day(22, 20), lower_bound(5), 41.0),
            measured(day(23, 20), lower_bound(5), 40.0),
        ]);

        let server = only(matches);

        assert_eq!(server.recent.as_ref().map(|r| r.median_ms), Some(40.0));
        assert_eq!(
            server.usual,
            UsualPing {
                median_ms: Some(17.0),
                sample_count: 8,
            }
        );
        assert_eq!(server.status, Some(Severity::Watch));
    }

    #[test]
    fn row_follows_the_most_common_basis_of_the_window() {
        let mut matches = history(6, lower_bound(5), 5.0);
        matches.extend([
            measured(day(21, 20), lower_bound(5), 5.0),
            measured(day(22, 20), exact(), 31.0),
            measured(day(23, 20), lower_bound(5), 6.0),
        ]);

        let server = only(matches);

        assert_eq!(server.match_count, 3);
        assert_eq!(server.basis, Some(lower_bound(5)));
        assert_eq!(
            server.recent,
            Some(RecentPing {
                median_ms: 5.5,
                loss_pct: 0.0,
                sample_count: 2,
            })
        );
        assert_eq!(server.usual.median_ms, Some(5.0));
        assert_eq!(server.status, Some(Severity::Ok));
    }

    #[test]
    fn exact_pings_are_never_compared_with_a_lower_bound_usual() {
        let mut matches = history(10, lower_bound(5), 5.0);
        matches.extend((0..3).map(|i| measured(day(21 + i, 20), exact(), 31.0)));

        let server = only(matches);

        assert_eq!(server.basis, Some(exact()));
        assert_eq!(server.recent.as_ref().map(|r| r.median_ms), Some(31.0));
        assert_eq!(server.usual, UsualPing::default());
        assert_eq!(server.status, Some(Severity::Ok));
        assert_eq!(server.last_incident, None);
    }

    #[test]
    fn last_incident_is_the_latest_measurement_past_a_threshold() {
        let mut lossy = sample(day(12, 20), lower_bound(5), 5.0);
        lossy.loss_pct = 33.3;
        let mut matches = history(6, lower_bound(5), 5.0);
        matches.extend([
            measured_sample(lossy.clone()),
            measured(day(14, 20), lower_bound(5), 31.0),
            measured(day(15, 20), lower_bound(5), 5.0),
        ]);

        let incident = only(matches.clone()).last_incident.unwrap();
        assert_eq!(
            incident,
            ServerIncident {
                session_id: day(14, 20).timestamp() / 3600,
                match_number: 1,
                started_at: day(14, 20).to_rfc3339(),
                measured_at: day(14, 20).to_rfc3339(),
                status: Severity::Watch,
                cause: IncidentCause::Latency,
                basis: lower_bound(5),
                ping_ms: 31.0,
                usual_ms: Some(5.0),
                loss_pct: 0.0,
            }
        );

        matches.retain(|game| game.started_at != day(14, 20).to_rfc3339());
        let incident = only(matches).last_incident.unwrap();
        assert_eq!(incident.started_at, lossy.match_started_at);
        assert_eq!(incident.status, Severity::Critical);
        assert_eq!(incident.cause, IncidentCause::Loss);
        assert_eq!(incident.loss_pct, 33.3);
    }

    #[test]
    fn server_not_played_recently_keeps_its_usual() {
        let server = only(history(6, lower_bound(5), 5.0));

        assert_eq!(server.match_count, 0);
        assert_eq!(server.recent, None);
        assert_eq!(server.status, None);
        assert_eq!(server.basis, Some(lower_bound(5)));
        assert_eq!(
            server.usual,
            UsualPing {
                median_ms: Some(5.0),
                sample_count: 6,
            }
        );
        assert_eq!(server.last_played_at, day(10, 6).to_rfc3339());
    }

    #[test]
    fn servers_are_grouped_by_game_operator_and_last_router_city() {
        let unknown = |ip: &str| Server {
            ip: ip.to_string(),
            ..Server::default()
        };
        let servers = summarize_servers(
            vec![
                played("VALORANT", riot(RIOT_PARIS, Some("Paris")), day(21, 20)),
                played("VALORANT", riot("162.249.72.1", Some("Paris")), day(22, 20)),
                played(
                    "VALORANT",
                    riot("162.249.72.9", Some("Frankfurt")),
                    day(18, 20),
                ),
                played("League of Legends", riot(RIOT, Some("Paris")), day(23, 20)),
                played("Counter-Strike 2", unknown("155.133.226.70"), day(19, 20)),
                played("Counter-Strike 2", unknown("155.133.226.71"), day(19, 21)),
            ],
            since(),
        );

        type Row<'a> = (
            &'a str,
            Option<u32>,
            Option<&'a str>,
            Vec<&'a str>,
            u32,
            Option<Severity>,
        );
        let rows: Vec<Row> = servers
            .iter()
            .map(|s| {
                (
                    s.game_name.as_str(),
                    s.asn,
                    s.city.as_deref(),
                    s.ips.iter().map(String::as_str).collect(),
                    s.match_count,
                    s.status,
                )
            })
            .collect();
        assert_eq!(
            rows,
            vec![
                (
                    "League of Legends",
                    Some(6507),
                    Some("Paris"),
                    vec![RIOT],
                    1,
                    Some(Severity::Unmeasured)
                ),
                (
                    "VALORANT",
                    Some(6507),
                    Some("Paris"),
                    vec!["162.249.72.1", RIOT_PARIS],
                    2,
                    Some(Severity::Unmeasured)
                ),
                (
                    "Counter-Strike 2",
                    None,
                    None,
                    vec!["155.133.226.71"],
                    0,
                    None
                ),
                (
                    "Counter-Strike 2",
                    None,
                    None,
                    vec!["155.133.226.70"],
                    0,
                    None
                ),
                (
                    "VALORANT",
                    Some(6507),
                    Some("Frankfurt"),
                    vec!["162.249.72.9"],
                    0,
                    None
                ),
            ]
        );
        assert!(servers
            .iter()
            .all(|s| s.basis.is_none() && s.recent.is_none()));
    }

    fn at(sec: i64) -> String {
        (Utc.with_ymd_and_hms(2026, 9, 21, 20, 0, 0).unwrap() + Duration::seconds(sec))
            .to_rfc3339_opts(SecondsFormat::Secs, true)
    }

    fn hop(n: i32, ip: &str, rtt: f64) -> HopData {
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

    fn silent(n: i32) -> HopData {
        HopData {
            ip: None,
            latency_min: None,
            latency_avg: None,
            latency_max: None,
            packet_loss: Some(100.0),
            ..hop(n, "", 0.0)
        }
    }

    async fn session(pool: &SqlitePool, id: i64, game: &str, started: i64) {
        sqlx::query("INSERT INTO sessions (id, game_name, started_at) VALUES ($1, $2, $3)")
            .bind(id)
            .bind(game)
            .bind(at(started))
            .execute(pool)
            .await
            .unwrap();
    }

    async fn period(pool: &SqlitePool, session: i64, ip: &str, port: i32, (from, to): (i64, i64)) {
        let periods = IpPeriodRepository::new(pool.clone());
        let mut data =
            IpPeriodData::new(session, ip.to_string(), "UDP".into(), port, at(from), 100);
        data.ended_at = at(to);
        let id = periods.insert_period(&data).await.unwrap();
        periods.set_flow_kind(id, FlowKind::Game).await.unwrap();
    }

    async fn trace(pool: &SqlitePool, session: i64, ip: &str, started: i64, hops: &[HopData]) {
        let id = TracerouteRepository::new(pool.clone())
            .insert_traceroute(&TracerouteData::new(session, ip.to_string(), at(started)))
            .await
            .unwrap();
        HopRepository::new(pool.clone())
            .insert_hops_batch(id, hops)
            .await
            .unwrap();
    }

    async fn operator(pool: &SqlitePool, ip: &str, asn: &str, name: &str, city: Option<&str>) {
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

    #[tokio::test]
    async fn summary_counts_each_trace_once_and_names_the_last_router() {
        let pool = create_test_pool().await;
        session(&pool, 1, "VALORANT", 0).await;
        for (n, port) in [7036, 7108, 7220].into_iter().enumerate() {
            let from = n as i64 * 1900;
            period(&pool, 1, RIOT, port, (from, from + 1800)).await;
        }
        trace(
            &pool,
            1,
            RIOT,
            40,
            &[
                hop(1, "192.168.1.254", 0.6),
                hop(2, "77.136.10.6", 3.6),
                hop(3, "87.245.233.46", 75.0),
                silent(4),
            ],
        )
        .await;
        session(&pool, 2, "VALORANT", -86_400 * 5).await;
        period(
            &pool,
            2,
            RIOT_PARIS,
            7300,
            (-86_400 * 5, -86_400 * 5 + 1800),
        )
        .await;
        trace(
            &pool,
            2,
            RIOT_PARIS,
            -86_400 * 5 + 30,
            &[
                hop(1, "192.168.1.254", 0.6),
                hop(2, "77.136.10.6", 3.6),
                hop(3, "87.245.233.46", 17.0),
                hop(4, RIOT_PARIS, 18.0),
            ],
        )
        .await;
        operator(&pool, RIOT, "AS6507", "Riot Games, Inc", None).await;
        operator(
            &pool,
            RIOT_PARIS,
            "AS6507",
            "Riot Games, Inc",
            Some("Dublin"),
        )
        .await;
        operator(
            &pool,
            "87.245.233.46",
            "AS9002",
            "RETN Limited",
            Some("Paris"),
        )
        .await;
        operator(&pool, "77.136.10.6", "AS15557", "SFR SA", None).await;

        let summary = server_summary(
            &AnalyticsRepository::new(pool.clone()),
            &IpPeriodRepository::new(pool.clone()),
            &TracerouteRepository::new(pool.clone()),
            Some(&IpMetadataRepository::new(pool.clone())),
            Utc.with_ymd_and_hms(2026, 9, 20, 0, 0, 0).unwrap(),
        )
        .await
        .unwrap();

        assert_eq!(summary.since, "2026-09-20T00:00:00Z");
        assert_eq!(
            (summary.usual_max_samples, summary.usual_min_samples),
            (20, 5)
        );
        assert_eq!(summary.servers.len(), 1);
        let server = &summary.servers[0];
        assert_eq!(server.game_name, "VALORANT");
        assert_eq!(server.asn, Some(6507));
        assert_eq!(server.operator.as_deref(), Some("Riot Games, Inc"));
        assert_eq!(server.city.as_deref(), Some("Paris"));
        assert_eq!(server.ips, vec![RIOT.to_string(), RIOT_PARIS.to_string()]);
        assert_eq!(server.match_count, 3);
        assert_eq!(server.last_played_at, at(3800));
        assert_eq!(
            server.basis,
            Some(PingBasis {
                source: PingSource::Trace,
                at_destination: false,
                measured_hop: Some(3),
                measured_asn: Some(9002),
            })
        );
        assert_eq!(
            server.recent,
            Some(RecentPing {
                median_ms: 75.0,
                loss_pct: 0.0,
                sample_count: 1,
            })
        );
        assert_eq!(server.usual, UsualPing::default());
        assert_eq!(server.status, Some(Severity::Watch));
        let incident = server.last_incident.as_ref().unwrap();
        assert_eq!((incident.session_id, incident.match_number), (1, 1));
        assert_eq!(incident.started_at, at(0));
        assert_eq!(parse(&incident.measured_at), parse(&at(40)));
        assert_eq!(incident.basis, server.basis.clone().unwrap());
        assert_eq!(incident.usual_ms, None);
        assert_eq!(incident.cause, IncidentCause::Latency);
    }

    #[tokio::test]
    async fn summary_without_sessions_is_empty() {
        let pool = create_test_pool().await;

        let summary = server_summary(
            &AnalyticsRepository::new(pool.clone()),
            &IpPeriodRepository::new(pool.clone()),
            &TracerouteRepository::new(pool.clone()),
            None,
            Utc.with_ymd_and_hms(2026, 9, 20, 0, 0, 0).unwrap(),
        )
        .await
        .unwrap();

        assert!(summary.servers.is_empty());
    }
}

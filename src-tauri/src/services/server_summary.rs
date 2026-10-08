use crate::config::{USUAL_PING_MIN_SAMPLES, USUAL_PING_SAMPLES};
use crate::db::analytics::AnalyticsRepository;
use crate::db::game_pings::GamePingRepository;
use crate::db::ip_metadata::IpMetadataRepository;
use crate::db::ip_periods::IpPeriodRepository;
use crate::db::traceroutes::TracerouteRepository;
use crate::db::DbError;
use crate::models::insights::{
    PingBasis, RecentPing, ServerIncident, ServerSummary, ServerSummaryItem, UsualPing,
};
use crate::models::severity::Severity;
use crate::services::matches::median;
use crate::services::usual::{
    assess, assessments, match_history, parse, pools, usual_ping, Assessment, PingSample, SampleId,
    ServerMatch,
};
use chrono::{DateTime, FixedOffset, SecondsFormat, Utc};
use std::cmp::Reverse;
use std::collections::{BTreeMap, HashMap};

type ServerKey<'a> = (&'a str, Option<u32>, Option<&'a str>, Option<&'a str>);

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

fn last_incident(
    samples: &[&PingSample],
    assessed: &HashMap<SampleId, Assessment>,
) -> Option<ServerIncident> {
    samples.iter().rev().find_map(|sample| {
        let assessment = assessed.get(&sample.id)?;
        Some(ServerIncident {
            session_id: sample.session_id,
            match_number: sample.match_number,
            started_at: sample.match_started_at.clone(),
            measured_at: sample.measured_at.to_rfc3339(),
            status: assessment.status,
            cause: assessment.cause?,
            basis: sample.basis.clone(),
            ping_ms: sample.ping_ms,
            usual: assessment.usual.clone(),
            loss_pct: sample.loss_pct,
        })
    })
}

fn summarize_server(
    matches: &[&ServerMatch],
    pool: &[&PingSample],
    assessed: &HashMap<SampleId, Assessment>,
    since: DateTime<FixedOffset>,
) -> Option<ServerSummaryItem> {
    let latest = matches.iter().max_by_key(|game| parse(&game.started_at))?;
    let mut samples: Vec<&PingSample> = matches
        .iter()
        .filter_map(|game| game.sample.as_ref())
        .collect();
    samples.sort_by_key(|sample| sample.measured_at);

    let recent: Vec<&PingSample> = samples
        .iter()
        .copied()
        .filter(|sample| sample.measured_at >= since)
        .collect();
    let basis = if recent.is_empty() {
        let last: Vec<&PingSample> = samples
            .iter()
            .rev()
            .take(USUAL_PING_SAMPLES)
            .copied()
            .collect();
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
        usual_ping(pool.iter().copied(), basis, since)
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
        last_incident: last_incident(&samples, assessed),
    })
}

pub fn summarize_servers(
    matches: &[ServerMatch],
    since: DateTime<FixedOffset>,
) -> Vec<ServerSummaryItem> {
    let assessed = assessments(matches);
    let pools = pools(matches);
    let mut groups: BTreeMap<ServerKey, Vec<&ServerMatch>> = BTreeMap::new();
    for game in matches {
        let (asn, ip) = game.server.operator_key();
        let key = (
            game.game_name.as_str(),
            asn,
            ip,
            game.server.city.as_deref(),
        );
        groups.entry(key).or_default().push(game);
    }

    let mut servers: Vec<ServerSummaryItem> = groups
        .iter()
        .filter_map(|(&(game, asn, ip, _), group)| {
            let pool = pools
                .get(&(game, asn, ip))
                .map(Vec::as_slice)
                .unwrap_or_default();
            summarize_server(group, pool, &assessed, since)
        })
        .collect();
    servers.sort_by_key(|server| Reverse(parse(&server.last_played_at)));
    servers
}

pub async fn server_summary(
    analytics: &AnalyticsRepository,
    periods: &IpPeriodRepository,
    traceroutes: &TracerouteRepository,
    game_pings: Option<&GamePingRepository>,
    metadata: Option<&IpMetadataRepository>,
    since: DateTime<Utc>,
) -> Result<ServerSummary, DbError> {
    let history = match_history(analytics, periods, traceroutes, game_pings, metadata).await?;
    Ok(ServerSummary {
        since: since.to_rfc3339_opts(SecondsFormat::Secs, true),
        usual_max_samples: USUAL_PING_SAMPLES as u32,
        usual_min_samples: USUAL_PING_MIN_SAMPLES as u32,
        servers: summarize_servers(&history.matches, since.fixed_offset()),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::create_test_pool;
    use crate::models::insights::{IncidentCause, PingSource};
    use crate::services::usual::fixtures::*;
    use crate::services::usual::Server;
    use chrono::TimeZone;

    fn only(matches: Vec<ServerMatch>) -> ServerSummaryItem {
        let mut servers = summarize_servers(&matches, since());
        assert_eq!(servers.len(), 1);
        servers.remove(0)
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
        assert_eq!(
            incident.usual,
            UsualPing {
                median_ms: None,
                sample_count: 1,
            }
        );
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
    fn pings_reported_by_the_game_start_their_own_usual() {
        let mut matches = history(10, lower_bound(5), 5.0);
        matches.extend((0..3).map(|i| measured(day(21 + i, 20), game(), 13.0 + f64::from(i))));

        let server = only(matches);

        assert_eq!(server.basis, Some(game()));
        assert_eq!(
            server.recent,
            Some(RecentPing {
                median_ms: 14.0,
                loss_pct: 0.0,
                sample_count: 3,
            })
        );
        assert_eq!(server.usual, UsualPing::default());
        assert_eq!(server.status, Some(Severity::Ok));
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
                usual: UsualPing {
                    median_ms: Some(5.0),
                    sample_count: 7,
                },
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
    fn incidents_carry_the_status_of_their_match() {
        let mut matches = history(6, lower_bound(5), 5.0);
        matches.extend([
            measured(day(14, 20), lower_bound(5), 44.0),
            measured(day(21, 20), lower_bound(5), 5.0),
        ]);

        let assessed = assessments(&matches);
        let incident = only(matches).last_incident.unwrap();
        let assessment = &assessed[&SampleId::Trace(day(14, 20).timestamp())];

        assert_eq!(incident.status, assessment.status);
        assert_eq!(incident.usual, assessment.usual);
        assert_eq!(incident.status, Severity::Watch);
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
            &[
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
            None,
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
                server_ip: None,
                region: None,
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
        assert_eq!(incident.usual, UsualPing::default());
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
            None,
            Utc.with_ymd_and_hms(2026, 9, 20, 0, 0, 0).unwrap(),
        )
        .await
        .unwrap();

        assert!(summary.servers.is_empty());
    }
}

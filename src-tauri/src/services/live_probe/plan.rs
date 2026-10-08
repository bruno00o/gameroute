use super::beacons::{choose_beacon, RegionContext};
use crate::config::{LIVE_PROBE_MATCH_IDLE_SECS, LIVE_PROBE_PROTECTED_ASNS};
use crate::models::game_ping::GamePingSample;
use crate::models::hop::ProbedHop;
use crate::models::insights::PingSource;
use crate::models::ip_period::FlowPeriod;
use crate::models::live_probe::{LiveProbeConfig, ProbeProtocol, ProbeTarget};
use crate::models::traceroute_record::TracerouteWithHops;
use crate::services::matches::{asn_number, is_match};
use chrono::{DateTime, Duration, Utc};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FloorChoice {
    pub ttl: Option<u8>,
    pub hop_number: i32,
    pub hop_ip: String,
    pub at_destination: bool,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct PlanDraft {
    pub floor: Option<ProbeTarget>,
    pub region: Option<ProbeTarget>,
}

pub fn is_protected(asn: Option<u32>) -> bool {
    asn.is_some_and(|asn| LIVE_PROBE_PROTECTED_ASNS.contains(&asn))
}

fn utc(timestamp: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(timestamp)
        .ok()
        .map(|at| at.with_timezone(&Utc))
}

pub fn active_match(flows: &[FlowPeriod], now: DateTime<Utc>) -> Option<&FlowPeriod> {
    let idle = Duration::seconds(LIVE_PROBE_MATCH_IDLE_SECS);
    flows
        .iter()
        .filter(|flow| is_match(flow))
        .filter_map(|flow| Some((utc(&flow.period.ended_at)?, flow)))
        .filter(|(ended, _)| now - *ended <= idle && *ended <= now + idle)
        .max_by_key(|(ended, _)| *ended)
        .map(|(_, flow)| flow)
}

pub fn latest_trace<'a>(
    traces: &'a [TracerouteWithHops],
    server_ip: &str,
) -> Option<&'a TracerouteWithHops> {
    traces
        .iter()
        .filter(|trace| trace.target_ip == server_ip && trace.completed_at.is_some())
        .max_by(|a, b| a.started_at.cmp(&b.started_at).then(a.id.cmp(&b.id)))
}

pub fn select_floor(
    trace: &TracerouteWithHops,
    server_asn: Option<u32>,
    asn_of: impl Fn(&str) -> Option<u32>,
) -> Option<FloorChoice> {
    let protected = is_protected(server_asn);
    trace
        .hops
        .iter()
        .rev()
        .filter(|hop| hop.responded())
        .find_map(|hop| {
            let ip = hop.ip()?;
            let ttl = u8::try_from(hop.hop_number).ok().filter(|ttl| *ttl > 0)?;
            if ip == trace.target_ip {
                return (!protected).then(|| FloorChoice {
                    ttl: None,
                    hop_number: hop.hop_number,
                    hop_ip: ip.to_string(),
                    at_destination: true,
                });
            }
            if protected && is_protected(asn_of(ip)) {
                return None;
            }
            Some(FloorChoice {
                ttl: Some(ttl),
                hop_number: hop.hop_number,
                hop_ip: ip.to_string(),
                at_destination: false,
            })
        })
}

pub fn game_regions(pings: &[GamePingSample]) -> Vec<String> {
    let regions: Vec<&GamePingSample> = pings
        .iter()
        .filter(|sample| sample.source == PingSource::GameRegion && sample.rtt_ms.is_some())
        .collect();
    let Some(latest) = regions.iter().filter_map(|sample| sample.at()).max() else {
        return Vec::new();
    };
    let mut snapshot: Vec<(&str, f64)> = regions
        .iter()
        .filter(|sample| sample.at() == Some(latest))
        .filter_map(|sample| Some((sample.region.as_deref()?, sample.rtt_ms?)))
        .collect();
    snapshot.sort_by(|a, b| a.1.total_cmp(&b.1));
    snapshot
        .into_iter()
        .map(|(region, _)| region.to_string())
        .collect()
}

pub struct PlanInput<'a> {
    pub config: &'a LiveProbeConfig,
    pub game_name: &'a str,
    pub flows: &'a [FlowPeriod],
    pub traces: &'a [TracerouteWithHops],
    pub pings: &'a [GamePingSample],
    pub now: DateTime<Utc>,
}

pub fn draft_plan(input: &PlanInput, asn_of: impl Fn(&str) -> Option<u32>) -> PlanDraft {
    if !input.config.enabled {
        return PlanDraft::default();
    }
    let Some(flow) = active_match(input.flows, input.now) else {
        return PlanDraft::default();
    };
    let server_ip = flow.period.ip.clone();
    let server_asn = asn_number(flow);

    let floor = input
        .config
        .floor
        .then(|| latest_trace(input.traces, &server_ip))
        .flatten()
        .and_then(|trace| select_floor(trace, server_asn, &asn_of))
        .map(|choice| ProbeTarget {
            source: PingSource::Floor,
            address: server_ip.clone(),
            host: None,
            protocol: ProbeProtocol::Icmp,
            port: None,
            ttl: choice.ttl,
            server_ip: Some(server_ip.clone()),
            hop_ip: Some(choice.hop_ip),
            region: None,
            provider: None,
        });

    let region = input
        .config
        .region
        .then(|| {
            let context = RegionContext {
                game_name: input.game_name,
                server_asn,
                server_city: flow.city.as_deref(),
                server_country: flow.country.as_deref(),
                game_regions: game_regions(input.pings),
            };
            choose_beacon(&input.config.beacons, &context)
        })
        .flatten()
        .map(|beacon| ProbeTarget {
            source: PingSource::Region,
            address: beacon.host.clone(),
            host: Some(beacon.host.clone()),
            protocol: beacon.protocol,
            port: beacon.port,
            ttl: None,
            server_ip: Some(server_ip.clone()),
            hop_ip: None,
            region: Some(beacon.region.clone()),
            provider: Some(beacon.provider),
        });

    PlanDraft { floor, region }
}

#[cfg(test)]
pub mod fixtures {
    use crate::models::ip_period::{FlowPeriod, IpPeriod};
    use crate::models::session::DbHop;
    use crate::models::traceroute_record::TracerouteWithHops;

    pub const RIOT: &str = "162.249.72.5";

    pub fn flow(ip: &str, asn: &str, ended_at: &str) -> FlowPeriod {
        FlowPeriod {
            period: IpPeriod {
                id: 1,
                session_id: 1,
                ip: ip.to_string(),
                protocol: "UDP".to_string(),
                port: 7220,
                started_at: "2026-10-08T20:00:00Z".to_string(),
                ended_at: ended_at.to_string(),
                packet_count: 5000,
                is_game_server: true,
                flow_kind: Some("game".to_string()),
            },
            asn: Some(asn.to_string()),
            operator_name: None,
            city: Some("Amsterdam".to_string()),
            country: Some("Netherlands".to_string()),
        }
    }

    pub fn hop(number: i32, ip: Option<&str>, rtt: Option<f64>) -> DbHop {
        DbHop {
            id: number as i64,
            traceroute_id: 1,
            hop_number: number,
            ip: ip.map(str::to_string),
            hostname: None,
            latency_min: rtt,
            latency_avg: rtt,
            latency_max: rtt,
            packet_loss: Some(if rtt.is_some() { 0.0 } else { 100.0 }),
            is_problem_hop: false,
            source: None,
            loss_status: None,
        }
    }

    pub fn trace(id: i64, target: &str, started_at: &str, hops: Vec<DbHop>) -> TracerouteWithHops {
        TracerouteWithHops {
            id,
            session_id: 1,
            target_ip: target.to_string(),
            started_at: started_at.to_string(),
            completed_at: Some(started_at.to_string()),
            problem_hop_index: None,
            traceroute_method: None,
            hops,
            status: Default::default(),
            route: None,
        }
    }

    pub fn riot_route() -> Vec<DbHop> {
        vec![
            hop(1, Some("192.168.1.254"), Some(0.6)),
            hop(2, Some("80.10.1.1"), Some(2.4)),
            hop(3, None, None),
            hop(4, Some("194.6.150.66"), Some(4.1)),
            hop(5, Some("194.6.150.68"), Some(4.6)),
            hop(6, Some("104.160.141.1"), Some(9.0)),
            hop(7, None, None),
        ]
    }
}

#[cfg(test)]
mod tests {
    use super::fixtures::*;
    use super::*;
    use crate::services::game_profiles::RIOT_ASN;
    use crate::services::live_probe::beacons::VALVE_ASN;
    use chrono::TimeZone;

    fn now() -> DateTime<Utc> {
        Utc.with_ymd_and_hms(2026, 10, 8, 20, 10, 0).unwrap()
    }

    fn riot_asn(ip: &str) -> Option<u32> {
        if ip.starts_with("104.160.") || ip.starts_with("162.249.") {
            Some(RIOT_ASN)
        } else if ip.starts_with("194.6.") || ip.starts_with("80.10.") {
            Some(15557)
        } else {
            None
        }
    }

    #[test]
    fn floor_stops_before_the_riot_network() {
        let trace = trace(1, RIOT, "2026-10-08T20:01:00Z", riot_route());
        let choice = select_floor(&trace, Some(RIOT_ASN), riot_asn).unwrap();
        assert_eq!(
            choice,
            FloorChoice {
                ttl: Some(5),
                hop_number: 5,
                hop_ip: "194.6.150.68".to_string(),
                at_destination: false,
            }
        );
    }

    #[test]
    fn riot_server_is_never_probed_even_when_it_answered() {
        let mut hops = riot_route();
        hops.push(hop(8, Some(RIOT), Some(13.0)));
        let trace = trace(1, RIOT, "2026-10-08T20:01:00Z", hops);
        let choice = select_floor(&trace, Some(RIOT_ASN), riot_asn).unwrap();
        assert_eq!(choice.ttl, Some(5));
    }

    #[test]
    fn floor_is_the_last_answering_hop_for_other_operators() {
        let relay = "155.133.226.70";
        let mut hops = riot_route();
        hops[5] = hop(6, Some("80.249.208.1"), Some(9.0));
        hops.push(hop(8, Some(relay), Some(14.0)));
        let reached = trace(2, relay, "2026-10-08T20:01:00Z", hops.clone());
        let choice = select_floor(&reached, Some(VALVE_ASN), |_| None).unwrap();
        assert!(choice.at_destination);
        assert_eq!(choice.ttl, None);

        hops.pop();
        let stopped = trace(3, relay, "2026-10-08T20:01:00Z", hops);
        let choice = select_floor(&stopped, Some(VALVE_ASN), |_| Some(VALVE_ASN)).unwrap();
        assert_eq!((choice.ttl, choice.at_destination), (Some(6), false));

        let silent = trace(4, relay, "2026-10-08T20:01:00Z", vec![hop(1, None, None)]);
        assert_eq!(select_floor(&silent, Some(VALVE_ASN), |_| None), None);
    }

    #[test]
    fn probes_run_only_while_the_match_flow_is_active() {
        let flows = vec![flow(RIOT, "AS6507", "2026-10-08T20:09:50Z")];
        assert!(active_match(&flows, now()).is_some());
        assert!(active_match(&flows, now() + Duration::seconds(30)).is_none());

        let mut voice = flow("20.47.65.180", "AS8075", "2026-10-08T20:09:58Z");
        voice.period.is_game_server = false;
        voice.period.flow_kind = Some("voice".to_string());
        assert!(active_match(&[voice], now()).is_none());
    }

    #[test]
    fn plan_uses_the_latest_trace_and_the_game_regions() {
        let config = LiveProbeConfig::default();
        let flows = vec![flow(RIOT, "AS6507", "2026-10-08T20:09:55Z")];
        let mut short = riot_route();
        short.truncate(2);
        let traces = vec![
            trace(1, RIOT, "2026-10-08T19:00:00Z", short),
            trace(2, RIOT, "2026-10-08T20:01:00Z", riot_route()),
            trace(3, "1.1.1.1", "2026-10-08T20:05:00Z", riot_route()),
        ];
        let mut paris = GamePingSample::new(PingSource::GameRegion, now() - Duration::minutes(12));
        paris.region = Some("Paris".to_string());
        paris.rtt_ms = Some(4.0);
        let mut london = paris.clone();
        london.region = Some("London".to_string());
        london.rtt_ms = Some(14.0);

        let pings = [london, paris];
        let input = PlanInput {
            config: &config,
            game_name: "VALORANT",
            flows: &flows,
            traces: &traces,
            pings: &pings,
            now: now(),
        };
        let plan = draft_plan(&input, riot_asn);

        let floor = plan.floor.unwrap();
        assert_eq!(floor.address, RIOT);
        assert_eq!(floor.ttl, Some(5));
        assert_eq!(floor.hop_ip.as_deref(), Some("194.6.150.68"));
        let region = plan.region.unwrap();
        assert_eq!(region.region.as_deref(), Some("Paris"));
        assert_eq!(region.address, "gamelift-ping.eu-west-3.api.aws");
        assert_eq!(region.port, Some(7770));
        assert_eq!(region.protocol, ProbeProtocol::Udp);

        let lobby = PlanInput {
            now: now() + Duration::minutes(5),
            ..input
        };
        assert_eq!(draft_plan(&lobby, riot_asn), PlanDraft::default());
    }

    #[test]
    fn each_probe_can_be_switched_off() {
        let flows = vec![flow(RIOT, "AS6507", "2026-10-08T20:09:55Z")];
        let traces = vec![trace(2, RIOT, "2026-10-08T20:01:00Z", riot_route())];
        let mut paris = GamePingSample::new(PingSource::GameRegion, now());
        paris.region = Some("Paris".to_string());
        paris.rtt_ms = Some(4.0);
        let pings = [paris];
        let plan = |config: LiveProbeConfig| {
            draft_plan(
                &PlanInput {
                    config: &config,
                    game_name: "VALORANT",
                    flows: &flows,
                    traces: &traces,
                    pings: &pings,
                    now: now(),
                },
                riot_asn,
            )
        };

        let both = plan(LiveProbeConfig::default());
        assert!(both.floor.is_some() && both.region.is_some());
        let no_region = plan(LiveProbeConfig {
            region: false,
            ..LiveProbeConfig::default()
        });
        assert!(no_region.floor.is_some() && no_region.region.is_none());
        let no_floor = plan(LiveProbeConfig {
            floor: false,
            ..LiveProbeConfig::default()
        });
        assert!(no_floor.floor.is_none() && no_floor.region.is_some());
        let off = plan(LiveProbeConfig {
            enabled: false,
            ..LiveProbeConfig::default()
        });
        assert_eq!(off, PlanDraft::default());
    }
}

use crate::db::ip_metadata::IpMetadataRepository;
use crate::models::hop::ProbedHop;
use crate::models::ip_metadata::IpMetadataData;
use crate::models::session::DbHop;
use crate::models::traceroute::{OperatorRoute, RouteSegment, RouteZone};
use crate::models::traceroute_record::TracerouteWithHops;
use crate::services::asn_resolver::lookup_metadata;
use crate::services::network_capture::is_private_or_special_ip;
use crate::services::severity::loss_status;
use crate::services::traceroute::persistent_loss_onset;
use std::collections::{HashMap, HashSet};
use std::net::IpAddr;
use std::ops::Range;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Operator {
    pub asn: u32,
    pub name: Option<String>,
}

impl Operator {
    fn from_metadata(metadata: IpMetadataData) -> Option<Self> {
        let asn = metadata.asn.as_deref()?.strip_prefix("AS")?.parse().ok()?;
        Some(Self {
            asn,
            name: metadata.org.or(metadata.isp),
        })
    }

    fn key(&self) -> String {
        self.name
            .as_deref()
            .map_or_else(|| format!("AS{}", self.asn), str::to_lowercase)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum Owner {
    Home,
    Operator(String),
    Unknown,
}

fn is_carrier_nat(addr: &IpAddr) -> bool {
    matches!(addr, IpAddr::V4(v4) if v4.octets()[0] == 100 && (64..128).contains(&v4.octets()[1]))
}

fn is_lan(addr: &IpAddr) -> bool {
    match addr {
        IpAddr::V4(v4) => {
            let [a, b, ..] = v4.octets();
            (a == 192 && b == 168) || (a == 172 && (16..32).contains(&b))
        }
        IpAddr::V6(v6) => {
            let first = v6.segments()[0];
            first & 0xffc0 == 0xfe80 || first & 0xfe00 == 0xfc00
        }
    }
}

fn is_public(ip: &str) -> bool {
    !is_private_or_special_ip(ip) && !ip.parse().is_ok_and(|addr| is_carrier_nat(&addr))
}

fn public_ip(hop: &DbHop) -> Option<&str> {
    hop.ip().filter(|ip| hop.responded() && is_public(ip))
}

fn home_len(hops: &[DbHop]) -> usize {
    let first_public = hops
        .iter()
        .position(|hop| public_ip(hop).is_some())
        .unwrap_or(hops.len());
    let private: Vec<(usize, IpAddr)> = hops[..first_public]
        .iter()
        .enumerate()
        .filter(|(_, hop)| hop.responded())
        .filter_map(|(i, hop)| Some((i, hop.ip()?.parse().ok()?)))
        .collect();

    private
        .iter()
        .rev()
        .find(|(_, addr)| is_lan(addr))
        .or_else(|| private.iter().find(|(_, addr)| !is_carrier_nat(addr)))
        .map_or(0, |&(i, _)| i + 1)
}

fn owners(hops: &[DbHop], home: usize, operators: &HashMap<String, Operator>) -> Vec<Owner> {
    let known: Vec<Option<String>> = hops[home..]
        .iter()
        .map(|hop| {
            public_ip(hop)
                .and_then(|ip| operators.get(ip))
                .map(Operator::key)
        })
        .collect();
    let mut current = known.iter().flatten().next().cloned();

    let rest = known.into_iter().map(|key| {
        if key.is_some() {
            current = key;
        }
        current.clone().map_or(Owner::Unknown, Owner::Operator)
    });
    std::iter::repeat_n(Owner::Home, home).chain(rest).collect()
}

fn spans(owners: Vec<Owner>, hops: &[DbHop]) -> Vec<(Owner, Range<usize>)> {
    let mut spans: Vec<(Owner, Range<usize>)> = Vec::new();
    for (i, owner) in owners.into_iter().enumerate() {
        match spans.last_mut() {
            Some((last, range)) if *last == owner => range.end = i + 1,
            _ => spans.push((owner, i..i + 1)),
        }
    }

    let mut merged: Vec<(Owner, Range<usize>)> = Vec::new();
    for (owner, range) in spans {
        let answers = hops[range.clone()].iter().any(ProbedHop::responded);
        match merged.last_mut() {
            Some((_, previous)) if !answers => previous.end = range.end,
            _ => merged.push((owner, range)),
        }
    }
    merged
}

fn latency_floors(hops: &[DbHop]) -> Vec<Option<f64>> {
    let mut floor = f64::INFINITY;
    let mut floors: Vec<Option<f64>> = hops
        .iter()
        .rev()
        .map(|hop| {
            hop.rtt_avg().map(|rtt| {
                floor = floor.min(rtt);
                floor
            })
        })
        .collect();
    floors.reverse();
    floors
}

pub fn build_route(
    hops: &[DbHop],
    target_ip: &str,
    operators: &HashMap<String, Operator>,
) -> Option<OperatorRoute> {
    let last = hops.iter().rposition(ProbedHop::responded)?;
    let floors = latency_floors(hops);
    let home = home_len(hops);
    let owners = owners(hops, home, operators);
    let destination = operators.get(target_ip);
    let onset = persistent_loss_onset(hops, target_ip);
    let onset_status = loss_status(hops[last].loss_pct());
    let isp_index = usize::from(home > 0);

    let mut reached = 0.0;
    let segments = spans(owners, hops)
        .into_iter()
        .enumerate()
        .map(|(index, (owner, range))| {
            let span = &hops[range.clone()];
            let floor = range
                .clone()
                .rev()
                .find_map(|i| floors[i])
                .unwrap_or(reached);
            let added_ms = floor - reached;
            reached = floor;

            let operator = match owner {
                Owner::Operator(_) => span
                    .iter()
                    .filter_map(public_ip)
                    .find_map(|ip| operators.get(ip)),
                _ => None,
            };
            let zone = match owner {
                Owner::Home => RouteZone::Home,
                _ if index == isp_index => RouteZone::Isp,
                Owner::Operator(key) if destination.is_some_and(|d| d.key() == key) => {
                    RouteZone::Service
                }
                _ => RouteZone::Transit,
            };

            RouteSegment {
                zone,
                asn: operator.map(|op| op.asn),
                name: operator.and_then(|op| op.name.clone()),
                first_hop: span[0].hop_number,
                last_hop: span[span.len() - 1].hop_number,
                hops: span.len() as u32,
                silent_hops: span.iter().filter(|hop| !hop.responded()).count() as u32,
                added_ms,
                status: onset.filter(|i| range.contains(i)).and(onset_status),
            }
        })
        .collect();

    Some(OperatorRoute {
        segments,
        last_responding_hop: hops[last].hop_number,
        total_ms: reached,
        destination_silent: hops[last].ip() != Some(target_ip),
        destination_asn: destination.map(|op| op.asn),
        destination_name: destination.and_then(|op| op.name.clone()),
    })
}

async fn load_operators(
    traceroutes: &[TracerouteWithHops],
    metadata: Option<&IpMetadataRepository>,
) -> HashMap<String, Operator> {
    let ips: Vec<String> = traceroutes
        .iter()
        .flat_map(|traceroute| {
            traceroute
                .hops
                .iter()
                .filter_map(|hop| hop.ip.as_deref())
                .chain([traceroute.target_ip.as_str()])
        })
        .filter(|ip| is_public(ip))
        .collect::<HashSet<_>>()
        .into_iter()
        .map(str::to_string)
        .collect();

    lookup_metadata(&ips, metadata)
        .await
        .into_iter()
        .filter_map(|(ip, data)| Some((ip, Operator::from_metadata(data)?)))
        .collect()
}

pub async fn attach_routes(
    traceroutes: &mut [TracerouteWithHops],
    metadata: Option<&IpMetadataRepository>,
) {
    let operators = load_operators(traceroutes, metadata).await;
    for traceroute in traceroutes.iter_mut() {
        traceroute.route = build_route(&traceroute.hops, &traceroute.target_ip, &operators);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::severity::Severity;

    const SFR: (u32, &str) = (15557, "Societe Francaise Du Radiotelephone - SFR SA");
    const RETN: (u32, &str) = (9002, "RETN Limited");
    const RIOT: (u32, &str) = (6507, "Riot Games, Inc");
    const ARELION: (u32, &str) = (1299, "Arelion Sweden AB");
    const MICROSOFT: (u32, &str) = (8075, "Microsoft Corporation");
    const MICROSOFT_CLOUD: (u32, &str) = (8069, "Microsoft Corporation");
    const CLOUDFLARE: (u32, &str) = (13335, "Cloudflare, Inc.");

    fn hop(n: i32, ip: &str, rtt: f64, loss: f64) -> DbHop {
        DbHop {
            id: n as i64,
            traceroute_id: 1,
            hop_number: n,
            ip: Some(ip.to_string()),
            hostname: None,
            latency_min: Some(rtt),
            latency_avg: Some(rtt),
            latency_max: Some(rtt),
            packet_loss: Some(loss),
            is_problem_hop: false,
            source: None,
            loss_status: None,
        }
    }

    fn silent(n: i32) -> DbHop {
        DbHop {
            ip: None,
            latency_min: None,
            latency_avg: None,
            latency_max: None,
            packet_loss: Some(100.0),
            ..hop(n, "", 0.0, 0.0)
        }
    }

    fn operators(entries: &[(&str, (u32, &str))]) -> HashMap<String, Operator> {
        entries
            .iter()
            .map(|&(ip, (asn, name))| {
                let operator = Operator {
                    asn,
                    name: Some(name.to_string()),
                };
                (ip.to_string(), operator)
            })
            .collect()
    }

    fn shape(route: &OperatorRoute) -> Vec<(RouteZone, Option<u32>, i32, i32)> {
        route
            .segments
            .iter()
            .map(|s| (s.zone, s.asn, s.first_hop, s.last_hop))
            .collect()
    }

    fn added(route: &OperatorRoute) -> Vec<f64> {
        route
            .segments
            .iter()
            .map(|s| (s.added_ms * 10.0).round() / 10.0)
            .collect()
    }

    fn statuses(route: &OperatorRoute) -> Vec<Option<Severity>> {
        route.segments.iter().map(|s| s.status).collect()
    }

    const RIOT_QOS: &str = "162.249.75.1";

    fn sfr_retn_riot() -> Vec<DbHop> {
        vec![
            hop(1, "10.0.10.1", 0.5, 66.7),
            hop(2, "192.168.1.1", 0.7, 0.0),
            hop(3, "10.153.10.245", 3.7, 0.0),
            hop(4, "77.128.4.142", 4.3, 0.0),
            hop(5, "194.6.147.220", 3.7, 0.0),
            hop(6, "87.245.246.246", 5.3, 0.0),
            hop(7, "87.245.233.46", 31.0, 0.0),
        ]
    }

    fn sfr_retn_riot_operators() -> HashMap<String, Operator> {
        operators(&[
            ("77.128.4.142", SFR),
            ("87.245.246.246", RETN),
            ("87.245.233.46", RETN),
            (RIOT_QOS, RIOT),
        ])
    }

    #[test]
    fn sfr_retn_riot_with_a_silent_destination() {
        let route = build_route(&sfr_retn_riot(), RIOT_QOS, &sfr_retn_riot_operators()).unwrap();

        assert_eq!(
            shape(&route),
            vec![
                (RouteZone::Home, None, 1, 2),
                (RouteZone::Isp, Some(15557), 3, 5),
                (RouteZone::Transit, Some(9002), 6, 7),
            ]
        );
        assert_eq!(route.segments[1].name.as_deref(), Some(SFR.1));
        assert_eq!(route.segments[2].hops, 2);
        assert_eq!(added(&route), vec![0.7, 3.0, 27.3]);
        assert_eq!(statuses(&route), vec![None, None, None]);
        assert!(route.destination_silent);
        assert_eq!(route.last_responding_hop, 7);
        assert_eq!(route.total_ms, 31.0);
        assert_eq!(route.destination_asn, Some(6507));
        assert_eq!(route.destination_name.as_deref(), Some(RIOT.1));
    }

    #[test]
    fn silent_hops_stay_inside_the_operator_around_them() {
        let target = "20.157.94.48";
        let hops = vec![
            hop(1, "10.0.10.1", 1.0, 0.0),
            hop(2, "192.168.1.1", 0.7, 0.0),
            hop(3, "10.153.10.245", 3.3, 0.0),
            hop(4, "86.69.254.18", 3.7, 0.0),
            hop(5, "194.6.145.208", 4.7, 0.0),
            hop(6, "62.115.154.22", 4.7, 0.0),
            hop(7, "62.115.118.58", 29.7, 0.0),
            hop(8, "62.115.123.12", 29.3, 0.0),
            hop(9, "62.115.124.117", 15.7, 0.0),
            hop(10, "62.115.56.149", 13.0, 0.0),
            hop(11, "51.10.8.250", 13.3, 0.0),
            silent(12),
            silent(13),
            hop(14, "51.10.9.124", 13.3, 0.0),
        ];
        let operators = operators(&[
            ("86.69.254.18", SFR),
            ("62.115.154.22", ARELION),
            ("62.115.118.58", ARELION),
            ("62.115.123.12", ARELION),
            ("62.115.124.117", ARELION),
            ("62.115.56.149", ARELION),
            ("51.10.8.250", MICROSOFT),
            ("51.10.9.124", MICROSOFT),
            (target, MICROSOFT_CLOUD),
        ]);

        let route = build_route(&hops, target, &operators).unwrap();

        assert_eq!(
            shape(&route),
            vec![
                (RouteZone::Home, None, 1, 2),
                (RouteZone::Isp, Some(15557), 3, 5),
                (RouteZone::Transit, Some(1299), 6, 10),
                (RouteZone::Service, Some(8075), 11, 14),
            ]
        );
        assert_eq!(route.segments[3].hops, 4);
        assert_eq!(route.segments[3].silent_hops, 2);
        assert_eq!(added(&route), vec![0.7, 4.0, 8.3, 0.3]);
        assert!(route.segments.iter().all(|s| s.added_ms >= 0.0));
        let sum: f64 = route.segments.iter().map(|s| s.added_ms).sum();
        assert!((sum - route.total_ms).abs() < 1e-9);
        assert!(route.destination_silent);
        assert_eq!(route.total_ms, 13.3);
    }

    #[test]
    fn unknown_operators_are_attached_to_their_neighbours() {
        let hops = vec![
            hop(1, "192.168.1.1", 0.6, 0.0),
            hop(2, "194.6.145.208", 3.9, 0.0),
            hop(3, "86.69.254.18", 4.0, 0.0),
            hop(4, "194.6.150.68", 4.4, 0.0),
            hop(5, "77.128.4.142", 4.5, 0.0),
            hop(6, "194.6.147.220", 4.6, 0.0),
            hop(7, "87.245.246.246", 5.3, 0.0),
        ];
        let operators = operators(&[
            ("86.69.254.18", SFR),
            ("77.128.4.142", SFR),
            ("87.245.246.246", RETN),
        ]);

        let route = build_route(&hops, RIOT_QOS, &operators).unwrap();

        assert_eq!(
            shape(&route),
            vec![
                (RouteZone::Home, None, 1, 1),
                (RouteZone::Isp, Some(15557), 2, 6),
                (RouteZone::Transit, Some(9002), 7, 7),
            ]
        );
        assert_eq!(route.destination_asn, None);
    }

    #[test]
    fn private_hops_after_the_box_belong_to_the_isp() {
        let route = build_route(&sfr_retn_riot(), RIOT_QOS, &sfr_retn_riot_operators()).unwrap();
        assert_eq!(
            (route.segments[0].first_hop, route.segments[0].last_hop),
            (1, 2)
        );
        assert_eq!(route.segments[1].first_hop, 3);

        let carrier_nat = vec![
            hop(1, "192.168.1.254", 0.6, 0.0),
            hop(2, "100.72.0.1", 6.0, 0.0),
            hop(3, "86.69.254.18", 7.0, 0.0),
        ];
        let route = build_route(
            &carrier_nat,
            "86.69.254.18",
            &operators(&[("86.69.254.18", SFR)]),
        )
        .unwrap();
        assert_eq!(
            shape(&route),
            vec![
                (RouteZone::Home, None, 1, 1),
                (RouteZone::Isp, Some(15557), 2, 3)
            ]
        );

        let ten_slash_eight_box = vec![
            hop(1, "10.0.0.1", 0.6, 0.0),
            hop(2, "10.20.0.1", 5.0, 0.0),
            hop(3, "86.69.254.18", 7.0, 0.0),
        ];
        let route = build_route(
            &ten_slash_eight_box,
            "86.69.254.18",
            &operators(&[("86.69.254.18", SFR)]),
        )
        .unwrap();
        assert_eq!(
            shape(&route),
            vec![
                (RouteZone::Home, None, 1, 1),
                (RouteZone::Isp, Some(15557), 2, 3)
            ]
        );
    }

    #[test]
    fn route_without_known_operator_has_an_unnamed_isp() {
        let only_private = vec![
            hop(1, "10.0.10.1", 0.5, 66.7),
            hop(2, "192.168.1.1", 2.0, 0.0),
            hop(3, "10.153.10.245", 11.3, 0.0),
            silent(4),
        ];
        let route = build_route(&only_private, "172.64.146.73", &HashMap::new()).unwrap();
        assert_eq!(
            shape(&route),
            vec![(RouteZone::Home, None, 1, 2), (RouteZone::Isp, None, 3, 4)]
        );
        assert_eq!(route.segments[1].name, None);
        assert_eq!(route.total_ms, 11.3);

        let box_only = vec![
            hop(1, "10.0.10.1", 0.5, 33.3),
            hop(2, "192.168.1.1", 0.5, 0.0),
            silent(3),
        ];
        let route = build_route(&box_only, "104.18.40.25", &HashMap::new()).unwrap();
        assert_eq!(shape(&route), vec![(RouteZone::Home, None, 1, 3)]);
        assert_eq!(route.segments[0].silent_hops, 1);
        assert!(route.destination_silent);
    }

    #[test]
    fn destination_that_answers_closes_the_route_in_the_service_zone() {
        let target = "172.64.146.73";
        let hops = vec![
            hop(1, "10.0.10.1", 0.5, 0.0),
            hop(2, "192.168.1.1", 0.7, 0.0),
            hop(3, "10.153.10.245", 4.0, 0.0),
            hop(4, "86.69.254.18", 6.3, 0.0),
            hop(5, "194.6.150.68", 14.0, 0.0),
            hop(6, "141.101.67.48", 3.7, 0.0),
            hop(7, "141.101.67.142", 4.0, 0.0),
            hop(8, "141.101.67.163", 18.3, 0.0),
            hop(9, target, 5.7, 0.0),
        ];
        let operators = operators(&[
            ("86.69.254.18", SFR),
            ("141.101.67.48", CLOUDFLARE),
            ("141.101.67.142", CLOUDFLARE),
            ("141.101.67.163", CLOUDFLARE),
            (target, CLOUDFLARE),
        ]);

        let route = build_route(&hops, target, &operators).unwrap();

        assert_eq!(
            shape(&route),
            vec![
                (RouteZone::Home, None, 1, 2),
                (RouteZone::Isp, Some(15557), 3, 5),
                (RouteZone::Service, Some(13335), 6, 9),
            ]
        );
        assert_eq!(added(&route), vec![0.7, 3.0, 2.0]);
        assert!(!route.destination_silent);
        assert_eq!(route.total_ms, 5.7);
    }

    #[test]
    fn box_that_loses_packets_flags_the_home_zone_only_when_the_loss_persists() {
        let rate_limited =
            build_route(&sfr_retn_riot(), RIOT_QOS, &sfr_retn_riot_operators()).unwrap();
        assert_eq!(statuses(&rate_limited), vec![None, None, None]);

        let lossy: Vec<DbHop> = sfr_retn_riot()
            .into_iter()
            .map(|h| DbHop {
                packet_loss: Some(33.3),
                ..h
            })
            .collect();
        let route = build_route(&lossy, RIOT_QOS, &sfr_retn_riot_operators()).unwrap();
        assert_eq!(statuses(&route), vec![Some(Severity::Critical), None, None]);
    }

    #[test]
    fn persistent_loss_colours_the_segment_where_it_starts() {
        let mut hops = sfr_retn_riot();
        hops[5].packet_loss = Some(30.0);
        hops[6].packet_loss = Some(20.0);

        let route = build_route(&hops, RIOT_QOS, &sfr_retn_riot_operators()).unwrap();

        assert_eq!(statuses(&route), vec![None, None, Some(Severity::Critical)]);
    }

    #[test]
    fn route_without_any_answer_has_no_route() {
        assert!(build_route(&[], RIOT_QOS, &HashMap::new()).is_none());
        assert!(build_route(&[silent(1), silent(2)], RIOT_QOS, &HashMap::new()).is_none());
    }

    #[test]
    fn operator_comes_from_stored_metadata() {
        let metadata = |asn: Option<&str>| IpMetadataData {
            ip: "87.245.246.246".to_string(),
            asn: asn.map(str::to_string),
            isp: Some("RETN Limited".to_string()),
            org: Some("RETN Limited".to_string()),
            country: None,
            city: Some("Paris".to_string()),
            lat: None,
            lon: None,
            resolved_at: "2026-10-08T20:00:00Z".to_string(),
        };

        assert_eq!(
            Operator::from_metadata(metadata(Some("AS9002"))),
            Some(Operator {
                asn: 9002,
                name: Some("RETN Limited".to_string())
            })
        );
        assert_eq!(Operator::from_metadata(metadata(None)), None);
    }
}

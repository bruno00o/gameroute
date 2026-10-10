use super::window::WindowStats;
use crate::config::LIVE_STATUS_MIN_PROBES;
use crate::models::hop::ProbedHop;
use crate::models::insights::IncidentCause;
use crate::models::live_status::{
    FaultZone, LiveFault, LivePoint, LiveReading, ZoneEvidence, ZoneVerdict,
};
use crate::models::severity::Severity;
use crate::models::traceroute::{RouteSegment, RouteZone};
use crate::models::traceroute_record::TracerouteWithHops;
use crate::services::severity::{jitter_status, latency_status, loss_status, rank};

const ZONES: [RouteZone; 4] = [
    RouteZone::Home,
    RouteZone::Isp,
    RouteZone::Transit,
    RouteZone::Service,
];

#[derive(Debug, Clone, PartialEq)]
pub struct RouteHop {
    pub hop: i32,
    pub ip: String,
    pub zone: RouteZone,
    pub asn: Option<u32>,
    pub operator: Option<String>,
    pub rtt_ms: Option<f64>,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct MatchRoute {
    pub hops: Vec<RouteHop>,
    pub segments: Vec<RouteSegment>,
    pub destination_silent: bool,
}

impl MatchRoute {
    pub fn from_trace(trace: &TracerouteWithHops) -> Option<Self> {
        let route = trace.route.as_ref()?;
        let hops = trace
            .hops
            .iter()
            .filter(|hop| hop.responded())
            .filter_map(|hop| {
                let segment = route.segments.iter().find(|segment| {
                    (segment.first_hop..=segment.last_hop).contains(&hop.hop_number)
                })?;
                Some(RouteHop {
                    hop: hop.hop_number,
                    ip: hop.ip()?.to_string(),
                    zone: segment.zone,
                    asn: segment.asn,
                    operator: segment.name.clone(),
                    rtt_ms: hop.rtt_avg(),
                })
            })
            .collect();
        Some(Self {
            hops,
            segments: route.segments.clone(),
            destination_silent: route.destination_silent,
        })
    }

    pub fn hop_by_ip(&self, ip: &str) -> Option<&RouteHop> {
        self.hops.iter().find(|hop| hop.ip == ip)
    }

    pub fn hop(&self, number: i32) -> Option<&RouteHop> {
        self.hops.iter().find(|hop| hop.hop == number)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Verdict {
    Bad,
    Clean,
    Unknown,
}

fn verdict(reading: &LiveReading, cause: IncidentCause) -> Verdict {
    let judged = match cause {
        IncidentCause::Loss => {
            let enough = match reading.point {
                LivePoint::Game => reading.sent > 0,
                _ => reading.sent >= i64::from(LIVE_STATUS_MIN_PROBES),
            };
            enough
                .then_some(reading.loss_floor_pct)
                .flatten()
                .map(|loss| loss_status(loss).is_some())
        }
        IncidentCause::Jitter => reading
            .jitter_ms
            .map(|jitter| jitter_status(jitter).is_some()),
        IncidentCause::Latency => {
            let reference = reading.usual.median_ms.or(reading.trace_ms);
            reading
                .median_ms
                .zip(reference)
                .map(|(median, reference)| latency_status(median - reference).is_some())
        }
    };
    match judged {
        Some(true) => Verdict::Bad,
        Some(false) => Verdict::Clean,
        None => Verdict::Unknown,
    }
}

fn reaches_server(reading: &LiveReading) -> bool {
    reading.point == LivePoint::Game || reading.basis.at_destination
}

fn order(zone: RouteZone) -> usize {
    ZONES.iter().position(|z| *z == zone).unwrap_or(0)
}

fn bracket(
    route: &MatchRoute,
    from: Option<&LiveReading>,
    to: &LiveReading,
) -> (FaultZone, Vec<RouteZone>) {
    if to.point == LivePoint::Gateway {
        return (FaultZone::Home, vec![RouteZone::Home]);
    }
    if from.is_some_and(reaches_server) {
        return (FaultZone::Service, vec![RouteZone::Service]);
    }
    let from_hop = from.and_then(|reading| reading.hop);
    let to_hop = (!reaches_server(to)).then_some(to.hop).flatten();
    let mut zones: Vec<RouteZone> = route
        .hops
        .iter()
        .filter(|hop| from_hop.is_none_or(|from| hop.hop > from))
        .filter(|hop| to_hop.is_none_or(|to| hop.hop <= to))
        .map(|hop| hop.zone)
        .collect();
    if reaches_server(to) {
        zones.push(RouteZone::Service);
        match from.and_then(|reading| reading.zone) {
            Some(zone) if zone != RouteZone::Home => zones.push(zone),
            Some(_) => {}
            None => zones.push(RouteZone::Home),
        }
    } else if from.is_none() {
        zones.push(RouteZone::Home);
    }
    zones.sort_by_key(|zone| order(*zone));
    zones.dedup();

    let located = match zones.as_slice() {
        [RouteZone::Home] => FaultZone::Home,
        [RouteZone::Isp] => FaultZone::Isp,
        [RouteZone::Transit] => FaultZone::Transit,
        [RouteZone::Service] => FaultZone::Service,
        [] => FaultZone::Unlocated,
        _ if zones.contains(&RouteZone::Home) => FaultZone::Unlocated,
        _ if zones.contains(&RouteZone::Isp) => FaultZone::NotHome,
        _ => FaultZone::AfterIsp,
    };
    if zones.is_empty() {
        zones = ZONES.to_vec();
    }
    (located, zones)
}

pub fn router_only(floor: &WindowStats, beyond: &WindowStats) -> Vec<IncidentCause> {
    let mut cleared = Vec::new();
    if beyond.sample_count < LIVE_STATUS_MIN_PROBES {
        return cleared;
    }
    if beyond.jitter_ms.is_some_and(|j| jitter_status(j).is_none()) {
        cleared.push(IncidentCause::Jitter);
    }
    let enough = beyond.sent >= i64::from(LIVE_STATUS_MIN_PROBES) && beyond.sent * 2 >= floor.sent;
    let lossless = beyond
        .loss_floor_pct
        .is_some_and(|l| loss_status(l).is_none());
    if enough && lossless {
        cleared.push(IncidentCause::Loss);
    }
    cleared
}

pub fn confirmed(stats: &WindowStats, router_only: &[IncidentCause]) -> WindowStats {
    let mut stats = stats.clone();
    if router_only.contains(&IncidentCause::Jitter) {
        stats.jitter_ms = None;
    }
    if router_only.contains(&IncidentCause::Loss) {
        stats.loss_floor_pct = stats.loss_floor_pct.map(|_| 0.0);
    }
    stats
}

pub fn localise(
    readings: &[LiveReading],
    primary: LivePoint,
    cause: IncidentCause,
    route: &MatchRoute,
    router_only: &[IncidentCause],
) -> Option<LiveFault> {
    let mut path: Vec<&LiveReading> = readings
        .iter()
        .filter(|reading| reading.point <= primary)
        .collect();
    path.sort_by_key(|reading| reading.point);
    let verdicts: Vec<Verdict> = path
        .iter()
        .map(|reading| {
            if reading.point == primary {
                Verdict::Bad
            } else if reading.point == LivePoint::Floor && router_only.contains(&cause) {
                Verdict::Clean
            } else {
                verdict(reading, cause)
            }
        })
        .collect();

    let start = (0..path.len()).find(|&i| {
        verdicts[i] == Verdict::Bad && verdicts[i + 1..].iter().all(|v| *v != Verdict::Clean)
    })?;
    let clean = verdicts[..start].iter().rposition(|v| *v == Verdict::Clean);
    let from = clean.map(|i| path[i]);
    let to = path[start];

    let from_hop = from.and_then(|reading| reading.hop);
    let to_hop = (!reaches_server(to)).then_some(to.hop).flatten();
    let first_seen = route
        .hops
        .iter()
        .filter(|hop| from_hop.is_none_or(|from| hop.hop > from))
        .find(|hop| to_hop.is_none_or(|to| hop.hop <= to));
    let (asn, operator) = match first_seen {
        Some(hop) if !reaches_server(to) => (hop.asn, hop.operator.clone()),
        _ => (to.asn, to.operator.clone()),
    };

    let (zone, zones) = bracket(route, from, to);
    Some(LiveFault {
        zone,
        zones,
        cause,
        after_point: from.map(|reading| reading.point),
        after_hop: from_hop,
        at_point: to.point,
        at_hop: to_hop,
        asn,
        operator,
    })
}

pub fn zone_evidence(
    route: Option<&MatchRoute>,
    readings: &[LiveReading],
    status: Severity,
    fault: Option<&LiveFault>,
) -> Vec<ZoneEvidence> {
    let established = rank(status) >= rank(Severity::Ok);
    let fault = fault.filter(|_| rank(status) > rank(Severity::Ok));
    ZONES
        .iter()
        .map(|&zone| {
            let segments: Vec<&RouteSegment> = route
                .map(|route| route.segments.iter().filter(|s| s.zone == zone).collect())
                .unwrap_or_default();
            let point = readings
                .iter()
                .filter(|reading| reading.zone == Some(zone))
                .map(|reading| reading.point)
                .max();
            let silent = match zone {
                RouteZone::Service => {
                    point.is_none() && route.is_some_and(|r| r.destination_silent)
                }
                _ => !segments.is_empty() && segments.iter().all(|s| s.silent_hops == s.hops),
            };
            let measured = if point.is_some() {
                ZoneVerdict::Clear
            } else {
                ZoneVerdict::Unmeasured
            };
            let verdict = match fault {
                _ if !established => ZoneVerdict::Unmeasured,
                Some(fault) => {
                    let suspects = fault.zones.as_slice();
                    let last = suspects.iter().map(|z| order(*z)).max().unwrap_or(0);
                    if suspects.contains(&zone) {
                        if suspects.len() == 1 {
                            ZoneVerdict::Fault
                        } else {
                            ZoneVerdict::Suspect
                        }
                    } else if order(zone) > last {
                        ZoneVerdict::Masked
                    } else {
                        measured
                    }
                }
                None => measured,
            };
            ZoneEvidence {
                zone,
                verdict,
                status: match verdict {
                    ZoneVerdict::Clear => Severity::Ok,
                    ZoneVerdict::Fault | ZoneVerdict::Suspect => status,
                    _ => Severity::Unmeasured,
                },
                point,
                first_hop: segments.first().map(|s| s.first_hop),
                last_hop: segments.last().map(|s| s.last_hop),
                asn: segments.first().and_then(|s| s.asn),
                operator: segments.first().and_then(|s| s.name.clone()),
                silent,
            }
        })
        .collect()
}

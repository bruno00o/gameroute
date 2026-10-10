use super::fault::{localise, MatchRoute, RouteHop};
use super::history::{game_samples, path_samples, usual_for, Current, LiveHistory};
use super::machine::{IncidentChange, LiveMachine, MatchContext, Tick};
use super::{run_live_status, LiveStatusService};
use crate::db::live_probes::fixtures::floor_slice;
use crate::db::live_probes::GameSlice;
use crate::models::game_ping::GamePingSample;
use crate::models::insights::{IncidentCause, PingBasis, PingSource, UsualPing};
use crate::models::live_probe::{
    BeaconProvider, LiveProbeSample, LiveProbeSlice, ProbeProtocol, ProbeTarget,
};
use crate::models::live_status::{
    FaultZone, FrozenReason, LivePoint, LiveReading, LiveState, ZoneVerdict,
};
use crate::models::severity::Severity;
use crate::models::traceroute::{RouteSegment, RouteZone};
use crate::models::MonitoringState;
use crate::services::live_probe::stats::stamp;
use crate::services::severity::rank;
use crate::services::usual::fixtures::{measured, riot, RIOT_PARIS};
use crate::services::usual::{game_basis, ServerMatch};
use chrono::{DateTime, Duration, TimeZone, Utc};
use std::sync::{Arc, Mutex};
use tokio::sync::RwLock;

const RIOT: &str = "162.249.72.5";
const BOX: &str = "192.168.1.254";
const SFR_EDGE: &str = "80.10.1.9";
const RETN: &str = "87.245.1.7";

fn at(sec: i64) -> DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 10, 8, 20, 0, 0).unwrap() + Duration::seconds(sec)
}

fn context() -> MatchContext {
    MatchContext {
        session_id: 1,
        game_name: "VALORANT".to_string(),
        period_id: 1,
        server_ip: RIOT.to_string(),
        server_port: 7220,
        started_at: "2026-10-08T20:00:00.000Z".to_string(),
    }
}

fn route_hop(
    hop: i32,
    ip: &str,
    zone: RouteZone,
    operator: Option<(u32, &str)>,
    rtt: f64,
) -> RouteHop {
    RouteHop {
        hop,
        ip: ip.to_string(),
        zone,
        asn: operator.map(|(asn, _)| asn),
        operator: operator.map(|(_, name)| name.to_string()),
        rtt_ms: Some(rtt),
    }
}

fn segment(
    zone: RouteZone,
    operator: Option<(u32, &str)>,
    hops: (i32, i32),
    silent: u32,
) -> RouteSegment {
    RouteSegment {
        zone,
        asn: operator.map(|(asn, _)| asn),
        name: operator.map(|(_, name)| name.to_string()),
        first_hop: hops.0,
        last_hop: hops.1,
        hops: (hops.1 - hops.0 + 1) as u32,
        silent_hops: silent,
        added_ms: 0.0,
        status: None,
    }
}

const SFR: (u32, &str) = (15557, "SFR");
const RETN_OP: (u32, &str) = (9002, "RETN");
const RIOT_OP: (u32, &str) = (6507, "Riot Games");

fn route() -> MatchRoute {
    MatchRoute {
        hops: vec![
            route_hop(1, BOX, RouteZone::Home, None, 0.6),
            route_hop(2, "80.10.1.1", RouteZone::Isp, Some(SFR), 2.4),
            route_hop(4, SFR_EDGE, RouteZone::Isp, Some(SFR), 3.7),
            route_hop(6, "87.245.1.1", RouteZone::Transit, Some(RETN_OP), 5.6),
            route_hop(7, RETN, RouteZone::Transit, Some(RETN_OP), 17.0),
        ],
        segments: vec![
            segment(RouteZone::Home, None, (1, 1), 0),
            segment(RouteZone::Isp, Some(SFR), (2, 5), 2),
            segment(RouteZone::Transit, Some(RETN_OP), (6, 7), 0),
            segment(RouteZone::Service, Some(RIOT_OP), (8, 8), 1),
        ],
        destination_silent: true,
    }
}

fn target(source: PingSource, address: &str, ttl: Option<u8>, hop_ip: &str) -> ProbeTarget {
    ProbeTarget {
        source,
        address: address.to_string(),
        host: None,
        protocol: ProbeProtocol::Icmp,
        port: None,
        ttl,
        server_ip: Some(RIOT.to_string()),
        hop_ip: Some(hop_ip.to_string()),
        region: None,
        provider: None,
    }
}

fn gateway() -> ProbeTarget {
    target(PingSource::Gateway, BOX, None, BOX)
}

fn isp_edge() -> ProbeTarget {
    target(PingSource::IspEdge, RIOT, Some(4), SFR_EDGE)
}

fn floor() -> ProbeTarget {
    target(PingSource::Floor, RIOT, Some(7), RETN)
}

fn beacon() -> ProbeTarget {
    ProbeTarget {
        address: "gamelift-ping.eu-west-3.api.aws".to_string(),
        host: Some("gamelift-ping.eu-west-3.api.aws".to_string()),
        region: Some("Paris".to_string()),
        provider: Some(BeaconProvider::Gamelift),
        hop_ip: None,
        ttl: None,
        ..target(PingSource::Region, RIOT, None, RIOT)
    }
}

fn floor_basis() -> PingBasis {
    PingBasis {
        source: PingSource::Floor,
        at_destination: false,
        measured_hop: Some(7),
        measured_asn: Some(9002),
        server_ip: None,
    }
}

fn asn(target: &ProbeTarget) -> Option<u32> {
    match target.source {
        PingSource::Floor => Some(9002),
        PingSource::IspEdge => Some(15557),
        _ => None,
    }
}

fn sample(target: &ProbeTarget, sec: i64, rtt_ms: Option<f64>) -> LiveProbeSample {
    LiveProbeSample {
        session_id: 1,
        target: target.clone(),
        measured_at: stamp(at(sec)),
        rtt_ms,
        reply_ip: rtt_ms.and(target.hop_ip.clone()),
        at_destination: false,
        recent: Default::default(),
    }
}

fn game(sec: i64, rtt_ms: f64, lost: i64) -> GamePingSample {
    let mut sample = GamePingSample::new(PingSource::Game, at(sec));
    sample.session_id = 1;
    sample.peer_ip = Some(RIOT.to_string());
    sample.peer_port = Some(7220);
    sample.rtt_ms = Some(rtt_ms);
    sample.jitter_ms = Some(2.0);
    sample.packets_sent = Some(400);
    sample.packets_lost = Some(lost);
    sample
}

fn machine() -> LiveMachine {
    let mut machine = LiveMachine::new(context(), at(0));
    machine.set_route(Some(route()));
    machine
}

type Second = Vec<(ProbeTarget, Option<f64>)>;

fn run(
    machine: &mut LiveMachine,
    secs: std::ops::Range<i64>,
    each: impl Fn(i64) -> Second,
) -> Vec<Tick> {
    secs.map(|sec| {
        for (target, rtt) in each(sec) {
            machine.observe_probe(&sample(&target, sec, rtt), asn(&target), at(sec));
        }
        machine.tick(at(sec), false)
    })
    .collect()
}

fn steady(sec: i64) -> Second {
    let _ = sec;
    vec![
        (gateway(), Some(0.6)),
        (isp_edge(), Some(3.7)),
        (floor(), Some(17.0)),
    ]
}

fn changes(ticks: &[Tick]) -> Vec<&IncidentChange> {
    ticks
        .iter()
        .filter_map(|tick| tick.incident.as_ref())
        .collect()
}

fn zone(tick: &Tick, zone: RouteZone) -> ZoneVerdict {
    tick.status
        .zones
        .iter()
        .find(|evidence| evidence.zone == zone)
        .unwrap()
        .verdict
}

#[test]
fn status_is_measured_for_ten_seconds_before_it_is_shown() {
    let mut machine = machine();
    let ticks = run(&mut machine, 0..25, steady);

    assert_eq!(ticks[0].status.state, LiveState::Measuring);
    assert_eq!(ticks[18].status.state, LiveState::Measuring);
    assert_eq!(ticks[18].status.status, Severity::Unmeasured);
    let live = &ticks[19].status;
    assert_eq!(live.state, LiveState::Live);
    assert_eq!(live.status, Severity::Ok);
    assert_eq!(live.status_since.as_deref(), Some(stamp(at(9)).as_str()));
    assert_eq!(live.state_since, stamp(at(19)));

    let primary = live.primary.as_ref().unwrap();
    assert_eq!(primary.point, LivePoint::Floor);
    assert!(primary.at_least);
    assert_eq!(primary.median_ms, Some(17.0));
    assert_eq!(primary.hop, Some(7));
    assert_eq!(primary.operator.as_deref(), Some("RETN"));
    assert_eq!(live.points.len(), 3);
    assert_eq!(zone(&ticks[19], RouteZone::Home), ZoneVerdict::Clear);
    assert_eq!(zone(&ticks[19], RouteZone::Transit), ZoneVerdict::Clear);
    let service = live
        .zones
        .iter()
        .find(|z| z.zone == RouteZone::Service)
        .unwrap();
    assert_eq!(service.verdict, ZoneVerdict::Unmeasured);
    assert!(service.silent);
    assert!(changes(&ticks).is_empty());
}

#[test]
fn an_isolated_spike_creates_no_incident() {
    let mut machine = machine();
    machine.set_usual(
        floor_basis(),
        UsualPing {
            median_ms: Some(17.0),
            sample_count: 20,
        },
    );
    let ticks = run(&mut machine, 0..150, |sec| {
        let rtt = if (60..63).contains(&sec) { 140.0 } else { 17.0 };
        let mut second = steady(sec);
        second[2].1 = Some(rtt);
        second[0].1 = Some(if (60..63).contains(&sec) { 40.0 } else { 0.6 });
        second
    });
    assert!(ticks[19..]
        .iter()
        .all(|tick| tick.status.status == Severity::Ok));
    assert!(changes(&ticks).is_empty());

    let mut machine = machine_with_usual();
    let ticks = run(&mut machine, 0..150, |sec| {
        let mut second = steady(sec);
        if sec == 70 {
            second[2].1 = None;
        }
        second
    });
    assert!(ticks[19..]
        .iter()
        .all(|tick| tick.status.status == Severity::Ok));
    assert!(changes(&ticks).is_empty());
}

fn machine_with_usual() -> LiveMachine {
    let mut machine = machine();
    machine.set_usual(
        floor_basis(),
        UsualPing {
            median_ms: Some(17.0),
            sample_count: 20,
        },
    );
    machine
}

fn lossy(sec: i64, every: i64) -> bool {
    sec >= 30 && sec % every == 0
}

#[test]
fn persistent_transit_loss_is_degraded_in_the_transit_zone() {
    let mut machine = machine_with_usual();
    let ticks = run(&mut machine, 0..300, |sec| {
        let mut second = steady(sec);
        second[2].1 = (!lossy(sec, 25)).then_some(17.0);
        second
    });

    let last = &ticks[299].status;
    assert_eq!(last.status, Severity::Degraded);
    assert_eq!(last.cause, Some(IncidentCause::Loss));
    assert!(ticks
        .iter()
        .all(|tick| tick.status.status != Severity::Critical));
    let fault = last.fault.as_ref().unwrap();
    assert_eq!(fault.zone, FaultZone::Transit);
    assert_eq!(fault.after_point, Some(LivePoint::IspEdge));
    assert_eq!((fault.after_hop, fault.at_hop), (Some(4), Some(7)));
    assert_eq!(fault.operator.as_deref(), Some("RETN"));
    assert_eq!(zone(&ticks[299], RouteZone::Home), ZoneVerdict::Clear);
    assert_eq!(zone(&ticks[299], RouteZone::Isp), ZoneVerdict::Clear);
    assert_eq!(zone(&ticks[299], RouteZone::Transit), ZoneVerdict::Fault);
    assert_eq!(zone(&ticks[299], RouteZone::Service), ZoneVerdict::Masked);

    let changes = changes(&ticks);
    assert!(matches!(changes[0], IncidentChange::Open(open) if open.status == Severity::Watch));
    let IncidentChange::Update(raised) = changes.last().unwrap() else {
        panic!("the incident should still be open");
    };
    assert_eq!(raised.status, Severity::Degraded);
    assert_eq!(raised.zone, Some(FaultZone::Transit));
    assert!(raised.at_least);
    assert_eq!(raised.basis, floor_basis());
    assert!(changes
        .iter()
        .all(|change| !matches!(change, IncidentChange::Close(_))));

    let closed = machine.finish(at(300)).unwrap();
    let IncidentChange::Close(closed) = closed else {
        panic!("finishing the match closes the incident");
    };
    assert_eq!(closed.ended_at.as_deref(), Some(stamp(at(300)).as_str()));
    assert_eq!(closed.started_at, changes[0].clone().record().started_at);
}

trait Record {
    fn record(self) -> crate::models::live_status::MatchIncident;
}

impl Record for IncidentChange {
    fn record(self) -> crate::models::live_status::MatchIncident {
        match self {
            IncidentChange::Open(r) | IncidentChange::Update(r) | IncidentChange::Close(r) => r,
        }
    }
}

#[test]
fn loss_from_the_box_masks_the_rest_of_the_route() {
    let mut machine = machine_with_usual();
    let ticks = run(&mut machine, 0..200, |sec| {
        let dropped = lossy(sec, 10);
        vec![
            (gateway(), (!dropped).then_some(0.6)),
            (isp_edge(), (!dropped).then_some(3.7)),
            (floor(), (!dropped).then_some(17.0)),
        ]
    });
    let last = &ticks[199];
    assert!(rank(last.status.status) >= rank(Severity::Degraded));
    let fault = last.status.fault.as_ref().unwrap();
    assert_eq!(fault.zone, FaultZone::Home);
    assert_eq!(fault.at_point, LivePoint::Gateway);
    assert_eq!(fault.after_point, None);
    assert_eq!(zone(last, RouteZone::Home), ZoneVerdict::Fault);
    for masked in [RouteZone::Isp, RouteZone::Transit, RouteZone::Service] {
        assert_eq!(zone(last, masked), ZoneVerdict::Masked);
    }
}

#[test]
fn a_box_that_drops_pings_is_not_blamed_when_the_next_router_is_clean() {
    let mut machine = machine_with_usual();
    let ticks = run(&mut machine, 0..300, |sec| {
        let mut second = steady(sec);
        second[0].1 = (!lossy(sec, 10)).then_some(0.6);
        second[2].1 = (!lossy(sec, 25)).then_some(17.0);
        second
    });
    let fault = ticks[299].status.fault.as_ref().unwrap();
    assert_eq!(fault.zone, FaultZone::Transit);
    assert_eq!(fault.after_point, Some(LivePoint::IspEdge));

    let mut machine = machine_with_usual();
    let ticks = run(&mut machine, 0..300, |sec| {
        let mut second = steady(sec);
        second[0].1 = (!lossy(sec, 10)).then_some(0.6);
        second
    });
    assert!(ticks[19..]
        .iter()
        .all(|tick| tick.status.status == Severity::Ok));
}

#[test]
fn loss_inside_the_isp_is_located_at_the_isp() {
    let mut machine = machine_with_usual();
    let ticks = run(&mut machine, 0..300, |sec| {
        let dropped = lossy(sec, 25);
        vec![
            (gateway(), Some(0.6)),
            (isp_edge(), (!dropped).then_some(3.7)),
            (floor(), (!dropped).then_some(17.0)),
        ]
    });
    let fault = ticks[299].status.fault.as_ref().unwrap();
    assert_eq!(fault.zone, FaultZone::Isp);
    assert_eq!(fault.after_point, Some(LivePoint::Gateway));
    assert_eq!(fault.operator.as_deref(), Some("SFR"));
    assert_eq!(zone(&ticks[299], RouteZone::Home), ZoneVerdict::Clear);
    assert_eq!(zone(&ticks[299], RouteZone::Isp), ZoneVerdict::Fault);
    assert_eq!(zone(&ticks[299], RouteZone::Transit), ZoneVerdict::Masked);
}

#[test]
fn without_a_router_inside_the_isp_the_fault_is_only_not_at_home() {
    let mut machine = machine_with_usual();
    let ticks = run(&mut machine, 0..300, |sec| {
        vec![
            (gateway(), Some(0.6)),
            (floor(), (!lossy(sec, 25)).then_some(17.0)),
        ]
    });
    let last = &ticks[299];
    assert_eq!(last.status.fault.as_ref().unwrap().zone, FaultZone::NotHome);
    assert_eq!(zone(last, RouteZone::Home), ZoneVerdict::Clear);
    assert_eq!(zone(last, RouteZone::Isp), ZoneVerdict::Suspect);
    assert_eq!(zone(last, RouteZone::Transit), ZoneVerdict::Suspect);
    assert_eq!(zone(last, RouteZone::Service), ZoneVerdict::Masked);

    let mut machine = machine_with_usual();
    let ticks = run(&mut machine, 0..300, |sec| {
        vec![(floor(), (!lossy(sec, 25)).then_some(17.0))]
    });
    let last = &ticks[299];
    assert_eq!(last.status.status, Severity::Degraded);
    let fault = last.status.fault.as_ref().unwrap();
    assert_eq!(fault.zone, FaultZone::Unlocated);
    assert_eq!(
        fault.zones,
        vec![RouteZone::Home, RouteZone::Isp, RouteZone::Transit]
    );
    assert_eq!(zone(last, RouteZone::Home), ZoneVerdict::Suspect);
    assert_eq!(zone(last, RouteZone::Service), ZoneVerdict::Masked);
}

fn with_game(
    machine: &mut LiveMachine,
    secs: std::ops::Range<i64>,
    rtt: impl Fn(i64) -> Option<f64>,
) -> Vec<Tick> {
    secs.map(|sec| {
        for (target, value) in steady(sec) {
            machine.observe_probe(&sample(&target, sec, value), asn(&target), at(sec));
        }
        if sec % 10 == 0 {
            if let Some(rtt) = rtt(sec) {
                machine.observe_game(&game(sec, rtt, 0), at(sec));
            }
        }
        machine.tick(at(sec), false)
    })
    .collect()
}

#[test]
fn the_game_ping_wins_and_a_lower_bound_is_never_the_server_ping() {
    let mut machine = machine_with_usual();
    machine.set_usual(
        game_basis(RIOT),
        UsualPing {
            median_ms: Some(31.0),
            sample_count: 12,
        },
    );
    let ticks = with_game(&mut machine, 0..200, |sec| (sec < 100).then_some(31.0));

    let in_game = ticks[60].status.primary.as_ref().unwrap();
    assert_eq!(in_game.point, LivePoint::Game);
    assert!(!in_game.at_least);
    assert_eq!(in_game.basis, game_basis(RIOT));
    assert_eq!(in_game.usual.median_ms, Some(31.0));
    assert_eq!(in_game.zone, Some(RouteZone::Service));

    let fallback = ticks[150].status.primary.as_ref().unwrap();
    assert_eq!(fallback.point, LivePoint::Floor);
    assert!(fallback.at_least);
    assert_eq!(fallback.usual.median_ms, Some(17.0));
    assert_eq!(ticks[150].status.state, LiveState::Live);

    for tick in &ticks {
        if let Some(primary) = &tick.status.primary {
            assert_eq!(primary.at_least, !primary.basis.at_destination);
            assert_eq!(
                primary.point == LivePoint::Game,
                primary.basis.source == PingSource::Game
            );
            if primary.point != LivePoint::Game {
                assert!(primary.at_least);
            }
        }
    }
}

#[test]
fn a_slower_server_behind_a_clean_route_is_after_the_isp() {
    let mut machine = machine_with_usual();
    machine.set_usual(
        game_basis(RIOT),
        UsualPing {
            median_ms: Some(31.0),
            sample_count: 12,
        },
    );
    let ticks = with_game(&mut machine, 0..200, |sec| {
        Some(if sec < 60 { 31.0 } else { 95.0 })
    });
    let last = &ticks[199].status;
    assert_eq!(last.status, Severity::Degraded);
    assert_eq!(last.cause, Some(IncidentCause::Latency));
    let fault = last.fault.as_ref().unwrap();
    assert_eq!(fault.zone, FaultZone::AfterIsp);
    assert_eq!(fault.after_point, Some(LivePoint::Floor));
    assert_eq!(fault.at_point, LivePoint::Game);
    assert_eq!(zone(&ticks[199], RouteZone::Isp), ZoneVerdict::Clear);
    assert_eq!(zone(&ticks[199], RouteZone::Transit), ZoneVerdict::Suspect);
    assert_eq!(zone(&ticks[199], RouteZone::Service), ZoneVerdict::Suspect);
}

#[test]
fn the_region_estimate_is_context_only() {
    let mut machine = machine();
    let ticks = run(&mut machine, 0..60, |_| vec![(beacon(), Some(5.2))]);
    let last = &ticks[59].status;
    assert_eq!(last.state, LiveState::Measuring);
    assert_eq!(last.status, Severity::Unmeasured);
    assert!(last.primary.is_none() && last.points.is_empty());
    let region = last.region.as_ref().unwrap();
    assert_eq!(region.region.as_deref(), Some("Paris"));
    assert_eq!(region.median_ms, Some(5.2));
    assert_eq!(region.sent, 30);
}

#[test]
fn status_freezes_when_samples_stop_or_the_capture_service_is_down() {
    let mut machine = machine_with_usual();
    let ticks = run(&mut machine, 0..40, steady);
    assert_eq!(ticks[39].status.state, LiveState::Live);

    let ticks = run(&mut machine, 40..50, |_| Vec::new());
    assert_eq!(ticks[2].status.state, LiveState::Live);
    let frozen = &ticks[3].status;
    assert_eq!(frozen.state, LiveState::Frozen);
    assert_eq!(frozen.frozen_reason, Some(FrozenReason::NoSamples));
    assert_eq!(frozen.state_since, stamp(at(43)));
    assert_eq!(
        frozen.last_sample_at.as_deref(),
        Some(stamp(at(39)).as_str())
    );
    assert_eq!(frozen.status, Severity::Ok);
    assert_eq!(frozen.primary.as_ref().unwrap().median_ms, Some(17.0));
    assert_eq!(ticks[9].status.state_since, stamp(at(43)));

    let ticks = run(&mut machine, 50..52, steady);
    assert_eq!(ticks[0].status.state, LiveState::Live);

    machine.observe_probe(&sample(&floor(), 52, Some(17.0)), Some(9002), at(52));
    let down = machine.tick(at(52), true);
    assert_eq!(down.status.state, LiveState::Frozen);
    assert_eq!(
        down.status.frozen_reason,
        Some(FrozenReason::CaptureService)
    );
}

#[test]
fn status_never_flickers_and_falls_only_after_thirty_seconds() {
    let mut machine = machine_with_usual();
    machine.set_usual(
        game_basis(RIOT),
        UsualPing {
            median_ms: Some(31.0),
            sample_count: 12,
        },
    );
    let ticks = with_game(&mut machine, 0..300, |sec| {
        Some(if sec >= 30 && (sec / 10) % 2 == 1 {
            95.0
        } else {
            31.0
        })
    });
    assert!(ticks[10..]
        .iter()
        .all(|tick| tick.status.status == Severity::Ok));
    let flips = ticks
        .iter()
        .filter(|tick| {
            tick.status
                .primary
                .as_ref()
                .is_some_and(|p| p.status == Severity::Degraded)
        })
        .count();
    assert_eq!(flips, 130);
    assert!(changes(&ticks).is_empty());

    let mut machine = machine_with_usual();
    let ticks = run(&mut machine, 0..240, |sec| {
        let mut second = steady(sec);
        second[2].1 = Some(if (30..120).contains(&sec) { 80.0 } else { 17.0 });
        second
    });
    let statuses: Vec<Severity> = ticks.iter().map(|tick| tick.status.status).collect();
    let mut runs = statuses.clone();
    runs.dedup();
    assert_eq!(
        runs,
        vec![
            Severity::Unmeasured,
            Severity::Ok,
            Severity::Watch,
            Severity::Degraded,
            Severity::Ok
        ]
    );
    let degraded = statuses
        .iter()
        .position(|s| *s == Severity::Degraded)
        .unwrap();
    assert_eq!(degraded, 55);
    let last_bad = ticks
        .iter()
        .rposition(|tick| {
            tick.status
                .primary
                .as_ref()
                .is_some_and(|p| p.status == Severity::Degraded)
        })
        .unwrap();
    let recovered = statuses
        .iter()
        .rposition(|s| *s == Severity::Degraded)
        .unwrap()
        + 1;
    assert_eq!(recovered, last_bad + 31);

    let closed = changes(&ticks)
        .into_iter()
        .find_map(|change| match change {
            IncidentChange::Close(closed) => Some(closed.clone()),
            _ => None,
        })
        .unwrap();
    assert_eq!(closed.status, Severity::Degraded);
    assert_eq!(closed.cause, Some(IncidentCause::Latency));
    assert!(closed.ended_at.unwrap() < stamp(at(recovered as i64)));
}

#[test]
fn samples_from_another_match_or_session_are_ignored() {
    let mut machine = machine();
    let mut other = sample(&floor(), 0, Some(90.0));
    other.target.server_ip = Some("162.249.72.9".to_string());
    machine.observe_probe(&other, Some(9002), at(0));
    let mut stray = sample(&floor(), 0, Some(90.0));
    stray.session_id = 2;
    machine.observe_probe(&stray, Some(9002), at(0));
    let mut elsewhere = game(0, 90.0, 0);
    elsewhere.peer_ip = Some("162.249.72.9".to_string());
    machine.observe_game(&elsewhere, at(0));
    let mut region = game(0, 9.0, 0);
    region.source = PingSource::GameRegion;
    machine.observe_game(&region, at(0));

    let tick = machine.tick(at(1), false);
    assert!(tick.status.points.is_empty());
    assert_eq!(tick.status.last_sample_at, None);
}

#[tokio::test(start_paused = true)]
async fn the_runner_waits_for_a_match_and_signs_off_when_the_game_ends() {
    let service = Arc::new(LiveStatusService::default());
    let monitoring = Arc::new(RwLock::new(MonitoringState {
        is_monitoring: true,
        current_session_id: Some(5),
        ..MonitoringState::default()
    }));
    let seen: Arc<Mutex<Vec<Option<LiveState>>>> = Arc::default();
    service.begin(5, "VALORANT", Utc::now());
    let sink = seen.clone();
    let task = tokio::spawn(run_live_status(
        service.clone(),
        monitoring.clone(),
        5,
        "VALORANT".to_string(),
        move |status| sink.lock().unwrap().push(status.map(|status| status.state)),
    ));

    tokio::time::sleep(std::time::Duration::from_secs(3)).await;
    let waiting = service.snapshot().unwrap();
    assert_eq!(waiting.state, LiveState::Waiting);
    assert_eq!(waiting.game_name, "VALORANT");
    assert!(waiting.primary.is_none());

    monitoring.write().await.reset();
    task.await.unwrap();
    let seen = seen.lock().unwrap();
    assert!(seen.len() >= 2);
    assert_eq!(seen[0], Some(LiveState::Waiting));
    assert_eq!(seen.last(), Some(&None));
    assert!(service.snapshot().is_none());
}

fn reading(point: LivePoint, hop: Option<i32>, zone: Option<RouteZone>, loss: f64) -> LiveReading {
    LiveReading {
        point,
        basis: PingBasis {
            source: match point {
                LivePoint::Game => PingSource::Game,
                LivePoint::Floor => PingSource::Floor,
                LivePoint::IspEdge => PingSource::IspEdge,
                LivePoint::Gateway => PingSource::Gateway,
            },
            at_destination: point == LivePoint::Game,
            measured_hop: hop,
            measured_asn: None,
            server_ip: None,
        },
        at_least: point != LivePoint::Game,
        zone,
        hop,
        hop_ip: None,
        asn: None,
        operator: None,
        median_ms: Some(20.0),
        usual: UsualPing::default(),
        trace_ms: Some(20.0),
        jitter_ms: Some(1.0),
        loss_pct: Some(loss),
        loss_floor_pct: Some(loss),
        lost: 0,
        sent: 120,
        sample_count: 30,
        status: Severity::Ok,
        cause: None,
        last_sample_at: stamp(at(0)),
        fresh: true,
    }
}

#[test]
fn faults_are_located_only_as_far_as_the_evidence_goes() {
    let route = route();
    let floor = |loss| reading(LivePoint::Floor, Some(7), Some(RouteZone::Transit), loss);
    let gateway = |loss| reading(LivePoint::Gateway, Some(1), Some(RouteZone::Home), loss);
    let server = reading(LivePoint::Game, None, Some(RouteZone::Service), 3.0);

    let located = |readings: &[LiveReading], primary| {
        localise(readings, primary, IncidentCause::Loss, &route, &[])
            .unwrap()
            .zone
    };
    assert_eq!(
        located(&[gateway(0.0), floor(3.0)], LivePoint::Floor),
        FaultZone::NotHome
    );
    assert_eq!(
        located(&[floor(3.0)], LivePoint::Floor),
        FaultZone::Unlocated
    );
    assert_eq!(
        located(&[gateway(3.0), floor(3.0)], LivePoint::Floor),
        FaultZone::Home
    );
    assert_eq!(
        located(&[gateway(0.0), floor(0.0), server.clone()], LivePoint::Game),
        FaultZone::AfterIsp
    );
    assert_eq!(
        located(std::slice::from_ref(&server), LivePoint::Game),
        FaultZone::Unlocated
    );

    let mut at_server = floor(0.0);
    at_server.basis.at_destination = true;
    at_server.zone = Some(RouteZone::Service);
    assert_eq!(
        located(&[at_server, server.clone()], LivePoint::Game),
        FaultZone::Service
    );

    let empty = MatchRoute::default();
    let fault = localise(
        &[gateway(0.0), floor(3.0)],
        LivePoint::Floor,
        IncidentCause::Loss,
        &empty,
        &[],
    )
    .unwrap();
    assert_eq!(fault.zone, FaultZone::Unlocated);
    assert_eq!(fault.after_point, Some(LivePoint::Gateway));
}

fn path(
    session_id: i64,
    source: PingSource,
    ttl: Option<i32>,
    reply: &str,
    started_at: &str,
    median: f64,
) -> LiveProbeSlice {
    LiveProbeSlice {
        source,
        ttl,
        reply_ip: Some(reply.to_string()),
        ..floor_slice(session_id, started_at, median, 10)
    }
}

fn played(game_name: &str, slice: LiveProbeSlice) -> GameSlice {
    GameSlice {
        game_name: game_name.to_string(),
        slice,
    }
}

#[test]
fn usual_values_come_from_past_matches_on_the_same_basis() {
    let mut slices = Vec::new();
    for day in 1..=6 {
        let started = format!("2026-10-0{day}T20:05:00.000Z");
        slices.push(played(
            "VALORANT",
            path(
                day,
                PingSource::Floor,
                Some(7),
                RETN,
                &started,
                17.0 + day as f64,
            ),
        ));
        slices.push(played(
            "VALORANT",
            path(day, PingSource::Gateway, None, BOX, &started, 0.6),
        ));
        slices.push(played(
            "League of Legends",
            path(10 + day, PingSource::Floor, Some(7), RETN, &started, 60.0),
        ));
        slices.push(played(
            "League of Legends",
            path(10 + day, PingSource::Gateway, None, BOX, &started, 0.8),
        ));
    }
    slices.push(played(
        "VALORANT",
        path(
            1,
            PingSource::Floor,
            Some(6),
            "87.245.1.1",
            "2026-10-01T20:06:00.000Z",
            5.0,
        ),
    ));
    slices.push(played(
        "VALORANT",
        path(
            99,
            PingSource::Floor,
            Some(7),
            RETN,
            "2026-10-08T20:01:00.000Z",
            90.0,
        ),
    ));

    let current = Current {
        session_id: 99,
        game_name: "VALORANT",
        server_ip: RIOT,
        server_asn: Some(6507),
    };
    let asn_of = |ip: &str| match ip {
        RETN | "87.245.1.1" => Some(9002),
        RIOT => Some(6507),
        _ => None,
    };
    let history = LiveHistory {
        game: Vec::new(),
        path: path_samples(&slices, &current, asn_of),
    };
    let before = chrono::DateTime::parse_from_rfc3339("2026-10-08T20:00:00Z").unwrap();

    let floor = usual_for(&history, &floor_basis(), before);
    assert_eq!(
        floor,
        UsualPing {
            median_ms: Some(20.5),
            sample_count: 6
        }
    );
    let gateway = usual_for(&history, &super::machine::gateway_basis(), before);
    assert_eq!(
        gateway,
        UsualPing {
            median_ms: Some(0.7),
            sample_count: 12
        }
    );
    let other_hop = PingBasis {
        measured_hop: Some(6),
        ..floor_basis()
    };
    assert_eq!(usual_for(&history, &other_hop, before).sample_count, 1);
    assert_eq!(
        usual_for(&history, &game_basis(RIOT), before).sample_count,
        0
    );
}

#[test]
fn the_game_usual_only_uses_reported_pings_from_the_same_operator() {
    let paris = |day: u32, ping: f64| -> ServerMatch {
        let mut game = measured(
            crate::services::usual::fixtures::day(day, 20),
            game_basis(RIOT_PARIS),
            ping,
        );
        game.server = riot(RIOT_PARIS, None);
        game
    };
    let mut matches: Vec<ServerMatch> = (1..=6).map(|day| paris(day, 14.0)).collect();
    let mut lol = paris(7, 80.0);
    lol.game_name = "League of Legends".to_string();
    matches.push(lol);
    let current = Current {
        session_id: 0,
        game_name: "VALORANT",
        server_ip: RIOT_PARIS,
        server_asn: Some(6507),
    };
    let samples = game_samples(&matches, &current);
    assert_eq!(samples.len(), 6);
    let history = LiveHistory {
        game: samples,
        path: Vec::new(),
    };
    let before = chrono::DateTime::parse_from_rfc3339("2026-09-30T00:00:00Z").unwrap();
    assert_eq!(
        usual_for(&history, &game_basis(RIOT_PARIS), before).median_ms,
        Some(14.0)
    );
    assert_eq!(usual_for(&history, &floor_basis(), before).sample_count, 0);
}

fn isp_floor() -> ProbeTarget {
    target(PingSource::Floor, RIOT, Some(4), SFR_EDGE)
}

fn spiky(sec: i64, calm: f64) -> Option<f64> {
    let spike = (40..100).contains(&sec) && sec % 2 == 0;
    Some(if spike { calm + 55.0 } else { calm })
}

fn last_router(each: impl Fn(i64) -> Second) -> Vec<Tick> {
    run(&mut machine(), 0..150, each)
}

fn opened(ticks: &[Tick]) -> crate::models::live_status::MatchIncident {
    changes(ticks)
        .first()
        .map(|change| (*change).clone().record())
        .expect("an incident should open")
}

#[test]
fn spikes_only_the_last_visible_router_answers_are_ignored() {
    let ticks = last_router(|sec| {
        vec![
            (gateway(), Some(1.2)),
            (isp_floor(), spiky(sec, 6.5)),
            (beacon(), Some(4.5)),
        ]
    });
    assert!(changes(&ticks).is_empty());
    assert!(ticks[19..]
        .iter()
        .all(|tick| tick.status.status == Severity::Ok));
    let floor = ticks[80].status.primary.as_ref().unwrap();
    assert_eq!(floor.point, LivePoint::Floor);
    assert_eq!(floor.status, Severity::Ok);
    assert!(floor.jitter_ms.unwrap() >= 30.0);

    let ticks = last_router(|sec| {
        let lost = sec >= 30 && sec % 5 == 0;
        vec![
            (gateway(), Some(1.2)),
            (isp_floor(), (!lost).then_some(6.5)),
            (beacon(), Some(4.5)),
        ]
    });
    assert!(changes(&ticks).is_empty());
}

#[test]
fn spikes_the_region_beacon_also_sees_still_count() {
    let ticks = last_router(|sec| {
        vec![
            (gateway(), Some(1.2)),
            (isp_floor(), spiky(sec, 6.5)),
            (beacon(), spiky(sec, 4.5)),
        ]
    });
    let incident = opened(&ticks);
    assert_eq!(incident.cause, Some(IncidentCause::Jitter));
    assert_eq!(incident.zone, Some(FaultZone::Isp));
    assert_eq!(incident.at_hop, Some(4));

    let ticks = last_router(|sec| {
        vec![
            (gateway(), spiky(sec, 1.2)),
            (isp_floor(), spiky(sec, 6.5)),
            (beacon(), spiky(sec, 4.5)),
        ]
    });
    let incident = opened(&ticks);
    assert_eq!(incident.cause, Some(IncidentCause::Jitter));
    assert_eq!(incident.zone, Some(FaultZone::Home));
}

#[test]
fn without_a_clean_probe_beyond_the_router_its_spikes_count() {
    let alone = last_router(|sec| vec![(gateway(), Some(1.2)), (isp_floor(), spiky(sec, 6.5))]);
    let silent_beacon = last_router(|sec| {
        vec![
            (gateway(), Some(1.2)),
            (isp_floor(), spiky(sec, 6.5)),
            (beacon(), (sec < 50).then_some(4.5)),
        ]
    });
    let transit = last_router(|sec| {
        vec![
            (gateway(), Some(0.6)),
            (floor(), spiky(sec, 17.0)),
            (beacon(), Some(4.5)),
        ]
    });
    for ticks in [alone, silent_beacon, transit] {
        assert_eq!(opened(&ticks).cause, Some(IncidentCause::Jitter));
    }
}

#[test]
fn a_router_cleared_by_the_beacon_moves_a_game_fault_past_it() {
    let mut machine = machine();
    let ticks: Vec<Tick> = (0..150)
        .map(|sec| {
            for (target, rtt) in [
                (gateway(), Some(1.2)),
                (isp_floor(), spiky(sec, 6.5)),
                (beacon(), Some(4.5)),
            ] {
                machine.observe_probe(&sample(&target, sec, rtt), asn(&target), at(sec));
            }
            if sec % 5 == 0 {
                let mut sample = game(sec, 31.0, 0);
                sample.jitter_ms = Some(if sec >= 40 { 20.0 } else { 2.0 });
                machine.observe_game(&sample, at(sec));
            }
            machine.tick(at(sec), false)
        })
        .collect();
    let incident = opened(&ticks);
    assert_eq!(incident.cause, Some(IncidentCause::Jitter));
    assert!(!incident.at_least);
    let fault = ticks[90].status.fault.as_ref().unwrap();
    assert_eq!(fault.after_point, Some(LivePoint::Floor));
    assert_eq!(fault.zone, FaultZone::NotHome);
}

fn saturated(sec: i64) -> bool {
    sec >= 30 && sec % 10 == 0
}

fn loaded_pc(beacon_drops: bool, extra_floor_loss: impl Fn(i64) -> bool) -> Vec<Tick> {
    run(&mut machine_with_usual(), 0..300, |sec| {
        let dropped = saturated(sec);
        vec![
            (gateway(), (!dropped).then_some(0.6)),
            (isp_edge(), (!dropped).then_some(3.7)),
            (
                floor(),
                (!dropped && !extra_floor_loss(sec)).then_some(17.0),
            ),
            (beacon(), (!(beacon_drops && dropped)).then_some(4.5)),
        ]
    })
}

fn point(tick: &Tick, point: LivePoint) -> &LiveReading {
    tick.status
        .points
        .iter()
        .find(|reading| reading.point == point)
        .unwrap()
}

#[test]
fn probe_loss_the_region_beacon_did_not_see_is_not_rated() {
    let ticks = loaded_pc(false, |_| false);
    assert!(changes(&ticks).is_empty());
    assert!(ticks[19..]
        .iter()
        .all(|tick| tick.status.status == Severity::Ok));
    let gateway = point(&ticks[299], LivePoint::Gateway);
    assert_eq!(gateway.status, Severity::Ok);
    assert_eq!(gateway.loss_pct, Some(10.0));
    assert_eq!(gateway.loss_floor_pct, Some(0.0));
    let floor = point(&ticks[299], LivePoint::Floor);
    assert_eq!(floor.status, Severity::Ok);
    assert_eq!(floor.loss_pct, Some(10.0));
}

#[test]
fn probe_loss_the_region_beacon_also_sees_still_counts() {
    let ticks = loaded_pc(true, |_| false);
    let last = &ticks[299].status;
    assert!(rank(last.status) >= rank(Severity::Degraded));
    assert_eq!(last.cause, Some(IncidentCause::Loss));
    let fault = last.fault.as_ref().unwrap();
    assert_eq!(fault.zone, FaultZone::Home);
    assert_eq!(fault.at_point, LivePoint::Gateway);
}

#[test]
fn loss_beyond_the_isp_on_a_loaded_pc_is_located_past_home() {
    let ticks = loaded_pc(false, |sec| sec >= 30 && sec % 20 == 5);
    let last = &ticks[299].status;
    assert_eq!(last.cause, Some(IncidentCause::Loss));
    assert!(rank(last.status) < rank(Severity::Critical));
    let fault = last.fault.as_ref().unwrap();
    assert_eq!(fault.zone, FaultZone::Transit);
    assert_eq!(fault.after_point, Some(LivePoint::IspEdge));
    assert_eq!(zone(&ticks[299], RouteZone::Home), ZoneVerdict::Clear);
    let incident = opened(&ticks);
    assert_eq!(incident.cause, Some(IncidentCause::Loss));
    assert!(changes(&ticks)
        .iter()
        .all(|change| (*change).clone().record().zone != Some(FaultZone::Home)));
}

#[test]
fn probe_loss_the_game_did_not_see_is_not_rated() {
    let mut machine = machine_with_usual();
    let ticks: Vec<Tick> = (0..200)
        .map(|sec| {
            let dropped = saturated(sec);
            for (target, rtt) in [
                (gateway(), (!dropped).then_some(0.6)),
                (floor(), (!dropped).then_some(17.0)),
            ] {
                machine.observe_probe(&sample(&target, sec, rtt), asn(&target), at(sec));
            }
            if sec % 5 == 0 {
                machine.observe_game(&game(sec, 31.0, 0), at(sec));
            }
            machine.tick(at(sec), false)
        })
        .collect();
    assert!(changes(&ticks).is_empty());
    for probe in [LivePoint::Gateway, LivePoint::Floor] {
        let reading = point(&ticks[199], probe);
        assert_eq!(reading.status, Severity::Ok);
        assert!(reading.loss_pct.unwrap() >= 9.0);
    }

    let ticks = run(&mut machine_with_usual(), 0..200, |sec| {
        let dropped = saturated(sec);
        vec![
            (gateway(), (!dropped).then_some(0.6)),
            (floor(), (!dropped).then_some(17.0)),
        ]
    });
    assert_eq!(
        point(&ticks[199], LivePoint::Gateway).cause,
        Some(IncidentCause::Loss)
    );
    assert_eq!(opened(&ticks).zone, Some(FaultZone::Home));
}

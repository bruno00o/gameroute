use super::engine::{Engine, PlannedProbe, Probe, ProbePlan, ProbeReply};
use super::prober::Prober;
use super::store::LiveProbeService;
use super::{run_live_probes, LiveRun, Planner};
use crate::models::insights::PingSource;
use crate::models::live_probe::{BeaconProvider, LiveProbeSlice, ProbeProtocol, ProbeTarget};
use crate::models::MonitoringState;
use chrono::{DateTime, Duration, TimeZone, Utc};
use std::net::IpAddr;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use tokio::sync::RwLock;

const RIOT: &str = "162.249.72.5";
const SFR: &str = "194.6.150.68";

fn floor() -> PlannedProbe {
    PlannedProbe {
        target: ProbeTarget {
            source: PingSource::Floor,
            address: RIOT.to_string(),
            host: None,
            protocol: ProbeProtocol::Icmp,
            port: None,
            ttl: Some(5),
            server_ip: Some(RIOT.to_string()),
            hop_ip: Some(SFR.to_string()),
            region: None,
            provider: None,
        },
        ip: RIOT.parse().unwrap(),
    }
}

fn region() -> PlannedProbe {
    PlannedProbe {
        target: ProbeTarget {
            source: PingSource::Region,
            address: "gamelift-ping.eu-west-3.api.aws".to_string(),
            host: Some("gamelift-ping.eu-west-3.api.aws".to_string()),
            protocol: ProbeProtocol::Udp,
            port: Some(7770),
            ttl: None,
            server_ip: Some(RIOT.to_string()),
            hop_ip: None,
            region: Some("Paris".to_string()),
            provider: Some(BeaconProvider::Gamelift),
        },
        ip: "15.188.0.1".parse().unwrap(),
    }
}

fn both() -> ProbePlan {
    ProbePlan {
        floor: Some(floor()),
        region: Some(region()),
        ..ProbePlan::default()
    }
}

fn riot(ip: IpAddr) -> bool {
    ip.to_string().starts_with("162.249.") || ip.to_string().starts_with("104.160.")
}

fn at(sec: i64) -> DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 10, 8, 20, 0, 0).unwrap() + Duration::seconds(sec)
}

fn answer(rtt: f64, from: &str) -> ProbeReply {
    ProbeReply {
        rtt_ms: Some(rtt),
        from: Some(from.parse().unwrap()),
        at_destination: false,
    }
}

#[test]
fn engine_sends_at_most_one_probe_per_source_each_second() {
    let mut engine = Engine::new(1, 100, riot);
    assert!(engine.due().is_empty());
    engine.set_plan(both());
    let due = engine.due();
    assert_eq!(due.len(), 2);
    assert_eq!(due[0].ttl, Some(5));
    assert_eq!(due[1].port, Some(7770));
}

#[test]
fn packet_cap_is_hard() {
    let mut engine = Engine::new(1, 5, riot);
    engine.set_plan(both());
    let sent: usize = (0..10).map(|_| engine.due().len()).sum();
    assert_eq!(sent, 5);
    assert_eq!(engine.packets_sent(), 5);
    assert!(engine.due().is_empty());
}

#[test]
fn samples_carry_recent_stats_and_slices_flush_every_ten_seconds() {
    let mut engine = Engine::new(9, 1000, riot);
    engine.set_plan(ProbePlan {
        floor: Some(floor()),
        ..ProbePlan::default()
    });
    let mut slices: Vec<LiveProbeSlice> = Vec::new();
    let mut last = None;
    for sec in 0..25 {
        let probe = engine.due().remove(0);
        let reply = if sec % 5 == 4 {
            ProbeReply::default()
        } else {
            answer(4.0 + (sec % 2) as f64, SFR)
        };
        let (sample, flushed) = engine.record(&probe, reply, at(sec)).unwrap();
        slices.extend(flushed);
        last = Some(sample);
    }
    let last = last.unwrap();
    assert_eq!(last.session_id, 9);
    assert_eq!(last.rtt_ms, None);
    assert_eq!(last.recent.sent, 10);
    assert_eq!(last.recent.received, 8);
    assert_eq!(last.recent.loss_pct, 20.0);
    assert_eq!(last.recent.jitter_ms, Some(0.86));

    assert_eq!(slices.len(), 2);
    assert!(slices.iter().all(|s| s.sent == 10 && s.received == 8));
    slices.extend(engine.finish());
    assert_eq!(slices.len(), 3);
    assert_eq!(slices[2].started_at, "2026-10-08T20:00:20.000Z");
    assert_eq!((slices[2].sent, slices[2].received), (5, 4));
    assert!(engine.due().is_empty());

    let state = engine.snapshot();
    assert!(state.floor.is_none() && state.region.is_none());
}

#[test]
fn window_keeps_the_last_minute() {
    let mut engine = Engine::new(1, 1000, riot);
    engine.set_plan(both());
    for sec in 0..90 {
        for probe in engine.due() {
            engine.record(&probe, answer(5.0, SFR), at(sec)).unwrap();
        }
    }
    let state = engine.snapshot();
    assert_eq!(state.packets_sent, 180);
    let floor = state.floor.unwrap();
    assert_eq!(floor.samples.len(), 60);
    assert_eq!(floor.samples[0].measured_at, "2026-10-08T20:00:30.000Z");
    assert_eq!(floor.stats.sent, 10);
    assert_eq!(
        state.region.unwrap().target.region.as_deref(),
        Some("Paris")
    );
}

#[test]
fn floor_backs_off_when_a_reply_comes_from_the_game_operator() {
    let mut engine = Engine::new(1, 1000, riot);
    engine.set_plan(both());
    let probe = engine.due().remove(0);
    let (sample, _) = engine
        .record(&probe, answer(9.0, "104.160.141.1"), at(0))
        .unwrap();
    assert_eq!(sample.target.ttl, Some(5));
    assert_eq!(engine.due()[0].ttl, Some(4));

    engine.set_plan(both());
    assert_eq!(engine.due()[0].ttl, Some(4));

    let probe = engine.due().remove(0);
    engine
        .record(&probe, answer(4.1, "194.6.150.66"), at(2))
        .unwrap();
    assert_eq!(engine.due()[0].ttl, Some(4));
}

#[test]
fn sources_never_mix_between_tracks() {
    let mut engine = Engine::new(1, 1000, riot);
    engine.set_plan(both());
    let due = engine.due();
    let (floor_sample, _) = engine.record(&due[0], answer(4.6, SFR), at(0)).unwrap();
    let (region_sample, _) = engine
        .record(&due[1], answer(5.2, "15.188.0.1"), at(0))
        .unwrap();
    assert_eq!(floor_sample.target.source, PingSource::Floor);
    assert_eq!(region_sample.target.source, PingSource::Region);
    assert_eq!(floor_sample.recent.median_ms, Some(4.6));
    assert_eq!(region_sample.recent.median_ms, Some(5.2));

    let stray = Probe {
        source: PingSource::Trace,
        ..due[0].clone()
    };
    assert!(engine.record(&stray, answer(1.0, SFR), at(1)).is_none());
}

fn zone_probe(source: PingSource, address: &str, ttl: Option<u8>, hop_ip: &str) -> PlannedProbe {
    PlannedProbe {
        target: ProbeTarget {
            source,
            address: address.to_string(),
            ttl,
            hop_ip: Some(hop_ip.to_string()),
            ..floor().target
        },
        ip: address.parse().unwrap(),
    }
}

#[test]
fn zone_probes_get_their_own_tracks_ahead_of_the_region() {
    let mut engine = Engine::new(1, 1000, riot);
    engine.set_plan(ProbePlan {
        gateway: Some(zone_probe(
            PingSource::Gateway,
            "192.168.1.254",
            None,
            "192.168.1.254",
        )),
        isp_edge: Some(zone_probe(PingSource::IspEdge, RIOT, Some(3), "80.10.1.9")),
        ..both()
    });
    let due = engine.due();
    let sources: Vec<PingSource> = due.iter().map(|probe| probe.source).collect();
    assert_eq!(
        sources,
        vec![
            PingSource::Floor,
            PingSource::Gateway,
            PingSource::IspEdge,
            PingSource::Region
        ]
    );
    assert_eq!(due[1].ttl, None);
    assert_eq!(due[2].ttl, Some(3));

    let (gateway, _) = engine
        .record(&due[1], answer(0.6, "192.168.1.254"), at(0))
        .unwrap();
    let (isp_edge, _) = engine
        .record(&due[2], answer(3.1, "80.10.1.9"), at(0))
        .unwrap();
    assert_eq!(gateway.target.source, PingSource::Gateway);
    assert_eq!(isp_edge.recent.median_ms, Some(3.1));

    let state = engine.snapshot();
    assert_eq!(state.gateway.unwrap().stats.sent, 1);
    assert_eq!(state.isp_edge.unwrap().target.ttl, Some(3));
    assert_eq!(state.floor.unwrap().stats.sent, 0);
}

struct FixedPlanner(ProbePlan);

impl Planner for FixedPlanner {
    async fn plan(&mut self, _now: DateTime<Utc>) -> ProbePlan {
        self.0.clone()
    }
}

#[derive(Default)]
struct CountingProber {
    sent: AtomicU64,
}

impl Prober for CountingProber {
    fn probe(&self, probe: &Probe) -> ProbeReply {
        self.sent.fetch_add(1, Ordering::SeqCst);
        match probe.source {
            PingSource::Floor => answer(4.6, SFR),
            _ => answer(5.2, "15.188.0.1"),
        }
    }
}

async fn playing(session_id: i64) -> Arc<RwLock<MonitoringState>> {
    let state = MonitoringState {
        is_monitoring: true,
        current_session_id: Some(session_id),
        ..MonitoringState::default()
    };
    Arc::new(RwLock::new(state))
}

fn service() -> (tempfile::TempDir, Arc<LiveProbeService>) {
    let dir = tempfile::tempdir().unwrap();
    let service = Arc::new(LiveProbeService::load(dir.path().join("live_probe.json")));
    (dir, service)
}

#[tokio::test(start_paused = true)]
async fn probes_follow_the_session_and_stop_when_the_game_ends() {
    let monitoring = playing(3).await;
    let prober = Arc::new(CountingProber::default());
    let (_dir, service) = service();
    let stored: Arc<Mutex<Vec<LiveProbeSlice>>> = Arc::default();
    let events = Arc::new(AtomicU64::new(0));

    let run = LiveRun {
        session_id: 3,
        monitoring: monitoring.clone(),
        planner: FixedPlanner(both()),
        prober: prober.clone(),
        engine: Engine::new(3, 1000, riot),
        service: service.clone(),
    };
    let sink = stored.clone();
    let counter = events.clone();
    let task = tokio::spawn(run_live_probes(
        run,
        move |_| {
            counter.fetch_add(1, Ordering::SeqCst);
        },
        move |slices| {
            let sink = sink.clone();
            Box::pin(async move { sink.lock().unwrap().extend(slices) })
        },
    ));

    while prober.sent.load(Ordering::SeqCst) < 10 {
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
    }
    assert_eq!(service.state().session_id, Some(3));
    monitoring.write().await.reset();
    let sent = task.await.unwrap();

    assert_eq!(sent, prober.sent.load(Ordering::SeqCst));
    assert_eq!(sent, events.load(Ordering::SeqCst));
    assert_eq!(sent % 2, 0);
    let floor_sent: i64 = stored
        .lock()
        .unwrap()
        .iter()
        .filter(|s| s.source == PingSource::Floor)
        .map(|s| s.sent)
        .sum();
    assert_eq!(floor_sent as u64, sent / 2);
    assert_eq!(service.state(), Default::default());

    tokio::time::sleep(std::time::Duration::from_secs(5)).await;
    assert_eq!(prober.sent.load(Ordering::SeqCst), sent);
}

#[tokio::test(start_paused = true)]
async fn nothing_is_sent_outside_a_match_or_for_another_session() {
    let prober = Arc::new(CountingProber::default());
    let (_dir, service) = service();

    let lobby = playing(4).await;
    let run = LiveRun {
        session_id: 4,
        monitoring: lobby.clone(),
        planner: FixedPlanner(ProbePlan::default()),
        prober: prober.clone(),
        engine: Engine::new(4, 1000, riot),
        service: service.clone(),
    };
    let task = tokio::spawn(run_live_probes(run, |_| {}, |_| Box::pin(async {})));
    tokio::time::sleep(std::time::Duration::from_secs(10)).await;
    lobby.write().await.reset();
    assert_eq!(task.await.unwrap(), 0);

    let other = playing(5).await;
    let run = LiveRun {
        session_id: 6,
        monitoring: other,
        planner: FixedPlanner(both()),
        prober: prober.clone(),
        engine: Engine::new(6, 1000, riot),
        service,
    };
    assert_eq!(
        run_live_probes(run, |_| {}, |_| Box::pin(async {})).await,
        0
    );
    assert_eq!(prober.sent.load(Ordering::SeqCst), 0);
}

pub mod attach;
pub mod beacons;
pub mod engine;
pub mod plan;
pub mod prober;
pub mod stats;
pub mod store;

use crate::config::{LIVE_PROBE_INTERVAL_MS, LIVE_PROBE_PLAN_REFRESH_SECS};
use crate::db::{
    get_game_ping_repository, get_ip_period_repository, get_live_probe_repository,
    get_traceroute_repository,
};
use crate::models::live_probe::{LiveProbeSample, LiveProbeSlice, ProbeTarget};
use crate::models::MonitoringState;
use crate::services::asn_resolver::get_resolver;
use chrono::{DateTime, Utc};
use engine::{Engine, PlannedProbe, ProbePlan};
use futures::future::BoxFuture;
use plan::{draft_plan, is_protected, PlanInput};
use prober::{resolve, Prober, SystemProber};
use std::collections::HashMap;
use std::future::Future;
use std::net::IpAddr;
use std::sync::Arc;
use std::time::Duration;
use store::LiveProbeService;
use tokio::sync::RwLock;
use tokio::time::{Instant, MissedTickBehavior};

pub trait Planner: Send {
    fn plan(&mut self, now: DateTime<Utc>) -> impl Future<Output = ProbePlan> + Send;
}

pub fn session_is_live(state: &MonitoringState, session_id: i64) -> bool {
    state.is_monitoring && state.current_session_id == Some(session_id)
}

pub fn asn_of(ip: &str) -> Option<u32> {
    get_resolver()?.asn_number(ip.parse().ok()?)
}

fn protected_ip(ip: IpAddr) -> bool {
    is_protected(get_resolver().and_then(|resolver| resolver.asn_number(ip)))
}

pub struct SessionPlanner {
    session_id: i64,
    game_name: String,
    service: Arc<LiveProbeService>,
    addresses: HashMap<String, Option<IpAddr>>,
}

impl SessionPlanner {
    pub fn new(session_id: i64, game_name: &str, service: Arc<LiveProbeService>) -> Self {
        Self {
            session_id,
            game_name: game_name.to_string(),
            service,
            addresses: HashMap::new(),
        }
    }

    async fn locate(&mut self, target: Option<ProbeTarget>) -> Option<PlannedProbe> {
        let target = target?;
        let ip = match self.addresses.get(&target.address) {
            Some(ip) => *ip,
            None => {
                let address = target.address.clone();
                let ip = tokio::task::spawn_blocking(move || resolve(&address))
                    .await
                    .ok()
                    .flatten();
                if ip.is_none() {
                    log::warn!("Live probe target {} does not resolve", target.address);
                }
                self.addresses.insert(target.address.clone(), ip);
                ip
            }
        }?;
        Some(PlannedProbe { target, ip })
    }
}

impl Planner for SessionPlanner {
    async fn plan(&mut self, now: DateTime<Utc>) -> ProbePlan {
        let config = self.service.config();
        if !config.enabled {
            return ProbePlan::default();
        }
        let (Some(periods), Some(traceroutes)) =
            (get_ip_period_repository(), get_traceroute_repository())
        else {
            return ProbePlan::default();
        };
        let flows = match periods.get_flow_periods(self.session_id).await {
            Ok(flows) => flows,
            Err(e) => {
                log::warn!("Live probe could not read the match flows: {}", e);
                return ProbePlan::default();
            }
        };
        let traces = traceroutes
            .get_flow_traceroutes_for_sessions(&[self.session_id])
            .await
            .unwrap_or_default();
        let pings = match get_game_ping_repository() {
            Some(repo) => repo
                .get_samples_for_sessions(&[self.session_id])
                .await
                .unwrap_or_default(),
            None => Vec::new(),
        };
        let draft = draft_plan(
            &PlanInput {
                config: &config,
                game_name: &self.game_name,
                flows: &flows,
                traces: &traces,
                pings: &pings,
                now,
            },
            asn_of,
        );
        ProbePlan {
            floor: self.locate(draft.floor).await,
            region: self.locate(draft.region).await,
        }
    }
}

pub struct LiveRun<P: Prober, L: Planner> {
    pub session_id: i64,
    pub monitoring: Arc<RwLock<MonitoringState>>,
    pub planner: L,
    pub prober: Arc<P>,
    pub engine: Engine,
    pub service: Arc<LiveProbeService>,
}

pub async fn run_live_probes<P: Prober, L: Planner>(
    run: LiveRun<P, L>,
    on_sample: impl Fn(&LiveProbeSample) + Send,
    store: impl Fn(Vec<LiveProbeSlice>) -> BoxFuture<'static, ()> + Send,
) -> u64 {
    let LiveRun {
        session_id,
        monitoring,
        mut planner,
        prober,
        mut engine,
        service,
    } = run;
    let mut ticks = tokio::time::interval(Duration::from_millis(LIVE_PROBE_INTERVAL_MS));
    ticks.set_missed_tick_behavior(MissedTickBehavior::Delay);
    let refresh = Duration::from_secs(LIVE_PROBE_PLAN_REFRESH_SECS as u64);
    let mut next_plan = Instant::now();

    loop {
        ticks.tick().await;
        if !session_is_live(&*monitoring.read().await, session_id) {
            break;
        }
        let mut finished = Vec::new();
        if Instant::now() >= next_plan {
            finished.extend(engine.set_plan(planner.plan(Utc::now()).await));
            next_plan = Instant::now() + refresh;
        }

        let probes: Vec<_> = engine
            .due()
            .into_iter()
            .map(|probe| {
                let prober = prober.clone();
                tokio::task::spawn_blocking(move || {
                    let at = Utc::now();
                    let reply = prober.probe(&probe);
                    (probe, reply, at)
                })
            })
            .collect();
        for handle in probes {
            let Ok((probe, reply, at)) = handle.await else {
                continue;
            };
            if let Some((sample, slices)) = engine.record(&probe, reply, at) {
                on_sample(&sample);
                finished.extend(slices);
            }
        }
        if !finished.is_empty() {
            store(finished).await;
        }
        service.publish(engine.snapshot());
    }

    let finished = engine.finish();
    if !finished.is_empty() {
        store(finished).await;
    }
    service.clear(session_id);
    engine.packets_sent()
}

fn store_slices(slices: Vec<LiveProbeSlice>) -> BoxFuture<'static, ()> {
    Box::pin(async move {
        if let Some(repo) = get_live_probe_repository() {
            if let Err(e) = repo.insert_slices(&slices).await {
                log::error!("Failed to save live probe slices: {}", e);
            }
        }
    })
}

pub fn follow_live_probes(
    service: Arc<LiveProbeService>,
    monitoring: Arc<RwLock<MonitoringState>>,
    session_id: i64,
    game_name: &str,
    on_sample: impl Fn(&LiveProbeSample) + Send + 'static,
) {
    let run = LiveRun {
        session_id,
        planner: SessionPlanner::new(session_id, game_name, service.clone()),
        monitoring,
        prober: Arc::new(SystemProber::default()),
        engine: Engine::for_session(session_id, protected_ip),
        service,
    };
    tokio::spawn(async move {
        let sent = run_live_probes(run, on_sample, store_slices).await;
        log::info!(
            "Live probes for session {} stopped after {} packets",
            session_id,
            sent
        );
    });
}

#[cfg(test)]
mod tests;

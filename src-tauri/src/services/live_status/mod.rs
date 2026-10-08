pub mod fault;
pub mod history;
pub mod machine;
pub mod window;

use crate::config::{
    LIVE_PROBE_INTERVAL_MS, LIVE_STATUS_MATCH_REFRESH_SECS, LIVE_STATUS_USUAL_DAYS,
};
use crate::db::{
    get_analytics_repository, get_game_ping_repository, get_ip_metadata_repository,
    get_ip_period_repository, get_live_probe_repository, get_match_incident_repository,
    get_traceroute_repository,
};
use crate::models::game_ping::GamePingSample;
use crate::models::insights::PingBasis;
use crate::models::ip_period::FlowPeriod;
use crate::models::live_probe::LiveProbeSample;
use crate::models::live_status::LiveStatus;
use crate::models::MonitoringState;
use crate::services::capture_health;
use crate::services::live_probe::plan::{active_match, latest_trace};
use crate::services::live_probe::{asn_of, session_is_live};
use crate::services::route_model::attach_routes;
use crate::services::usual::{match_history, parse};
use chrono::{DateTime, Duration, Utc};
use fault::MatchRoute;
use history::{game_samples, path_samples, usual_for, Current, LiveHistory};
use machine::{waiting, IncidentChange, LiveMachine, MatchContext};
use std::sync::{Arc, Mutex, PoisonError};
use tokio::sync::RwLock;
use tokio::time::{Instant, MissedTickBehavior};

struct Tracked {
    session_id: i64,
    game_name: String,
    waiting_since: DateTime<Utc>,
    machine: Option<LiveMachine>,
    last: LiveStatus,
}

#[derive(Default)]
pub struct LiveStatusService {
    tracked: Mutex<Option<Tracked>>,
}

impl LiveStatusService {
    fn with<R>(&self, session_id: i64, f: impl FnOnce(&mut Tracked) -> R) -> Option<R> {
        let mut tracked = self.tracked.lock().unwrap_or_else(PoisonError::into_inner);
        tracked
            .as_mut()
            .filter(|tracked| tracked.session_id == session_id)
            .map(f)
    }

    pub fn snapshot(&self) -> Option<LiveStatus> {
        self.tracked
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .as_ref()
            .map(|tracked| tracked.last.clone())
    }

    pub fn begin(&self, session_id: i64, game_name: &str, now: DateTime<Utc>) {
        *self.tracked.lock().unwrap_or_else(PoisonError::into_inner) = Some(Tracked {
            session_id,
            game_name: game_name.to_string(),
            waiting_since: now,
            machine: None,
            last: waiting(session_id, game_name, now, now),
        });
    }

    pub fn end(&self, session_id: i64) {
        let mut tracked = self.tracked.lock().unwrap_or_else(PoisonError::into_inner);
        if tracked.as_ref().is_some_and(|t| t.session_id == session_id) {
            *tracked = None;
        }
    }

    pub fn observe_probe(&self, sample: &LiveProbeSample) {
        let asn = sample.target.hop_ip.as_deref().and_then(asn_of);
        self.with(sample.session_id, |tracked| {
            if let Some(machine) = tracked.machine.as_mut() {
                machine.observe_probe(sample, asn, Utc::now());
            }
        });
    }

    pub fn observe_game(&self, sample: &GamePingSample) {
        self.with(sample.session_id, |tracked| {
            if let Some(machine) = tracked.machine.as_mut() {
                machine.observe_game(sample, Utc::now());
            }
        });
    }

    fn current_period(&self, session_id: i64) -> Option<i64> {
        self.with(session_id, |tracked| {
            tracked.machine.as_ref().map(|m| m.ctx.period_id)
        })
        .flatten()
    }

    fn start_match(&self, ctx: MatchContext, now: DateTime<Utc>) {
        self.with(ctx.session_id, |tracked| {
            tracked.machine = Some(LiveMachine::new(ctx, now));
        });
    }

    fn finish_match(&self, session_id: i64, now: DateTime<Utc>) -> Option<IncidentChange> {
        self.with(session_id, |tracked| {
            let change = tracked.machine.as_mut().and_then(|m| m.finish(now));
            if tracked.machine.take().is_some() {
                tracked.waiting_since = now;
            }
            change
        })
        .flatten()
    }

    fn tick(&self, session_id: i64, now: DateTime<Utc>, capture_down: bool) -> Option<Ticked> {
        self.with(session_id, |tracked| {
            let ticked = match tracked.machine.as_mut() {
                Some(machine) => {
                    let tick = machine.tick(now, capture_down);
                    Ticked {
                        status: tick.status,
                        incident: tick.incident,
                        pending: machine.pending_usuals(),
                        context: Some(machine.ctx.clone()),
                    }
                }
                None => Ticked {
                    status: waiting(session_id, &tracked.game_name, tracked.waiting_since, now),
                    incident: None,
                    pending: Vec::new(),
                    context: None,
                },
            };
            tracked.last = ticked.status.clone();
            ticked
        })
    }

    fn with_machine(&self, session_id: i64, f: impl FnOnce(&mut LiveMachine)) {
        self.with(session_id, |tracked| {
            if let Some(machine) = tracked.machine.as_mut() {
                f(machine);
            }
        });
    }
}

struct Ticked {
    status: LiveStatus,
    incident: Option<IncidentChange>,
    pending: Vec<PingBasis>,
    context: Option<MatchContext>,
}

async fn active_flow(session_id: i64, now: DateTime<Utc>) -> Option<FlowPeriod> {
    let flows = get_ip_period_repository()?
        .get_flow_periods(session_id)
        .await
        .map_err(|e| log::warn!("Live status could not read the match flows: {}", e))
        .ok()?;
    active_match(&flows, now).cloned()
}

async fn load_route(
    session_id: i64,
    server_ip: &str,
    known: Option<i64>,
) -> Option<(i64, MatchRoute)> {
    let traces = get_traceroute_repository()?
        .get_flow_traceroutes_for_sessions(&[session_id])
        .await
        .ok()?;
    let mut trace = latest_trace(&traces, server_ip)
        .filter(|trace| Some(trace.id) != known)?
        .clone();
    let metadata = get_ip_metadata_repository();
    attach_routes(std::slice::from_mut(&mut trace), metadata.as_deref()).await;
    Some((trace.id, MatchRoute::from_trace(&trace)?))
}

async fn load_history(ctx: &MatchContext, now: DateTime<Utc>) -> LiveHistory {
    let current = Current {
        session_id: ctx.session_id,
        game_name: &ctx.game_name,
        server_ip: &ctx.server_ip,
        server_asn: asn_of(&ctx.server_ip),
    };
    let since = (now - Duration::days(LIVE_STATUS_USUAL_DAYS)).to_rfc3339();
    let path = match get_live_probe_repository() {
        Some(repo) => match repo.get_path_slices(&since, ctx.session_id).await {
            Ok(slices) => path_samples(&slices, &current, asn_of),
            Err(e) => {
                log::warn!("Live status could not read past probes: {}", e);
                Vec::new()
            }
        },
        None => Vec::new(),
    };
    let game = match (
        get_analytics_repository(),
        get_ip_period_repository(),
        get_traceroute_repository(),
    ) {
        (Some(analytics), Some(periods), Some(traceroutes)) => {
            let pings = get_game_ping_repository();
            let metadata = get_ip_metadata_repository();
            match match_history(
                &analytics,
                &periods,
                &traceroutes,
                pings.as_deref(),
                metadata.as_deref(),
            )
            .await
            {
                Ok(history) => game_samples(&history.matches, &current),
                Err(e) => {
                    log::warn!("Live status could not read past matches: {}", e);
                    Vec::new()
                }
            }
        }
        _ => Vec::new(),
    };
    LiveHistory { game, path }
}

async fn persist(service: &LiveStatusService, session_id: i64, change: IncidentChange) {
    let Some(repo) = get_match_incident_repository() else {
        return;
    };
    match change {
        IncidentChange::Open(incident) => match repo.insert(&incident).await {
            Ok(id) => service.with_machine(session_id, |machine| machine.set_incident_id(id)),
            Err(e) => log::error!("Failed to save a live incident: {}", e),
        },
        IncidentChange::Update(incident) | IncidentChange::Close(incident) => {
            if incident.id == 0 {
                return;
            }
            if let Err(e) = repo.update(&incident).await {
                log::error!("Failed to update a live incident: {}", e);
            }
        }
    }
}

fn context(session_id: i64, game_name: &str, flow: &FlowPeriod) -> MatchContext {
    MatchContext {
        session_id,
        game_name: game_name.to_string(),
        period_id: flow.period.id,
        server_ip: flow.period.ip.clone(),
        server_port: flow.period.port,
        started_at: flow.period.started_at.clone(),
    }
}

pub async fn run_live_status(
    service: Arc<LiveStatusService>,
    monitoring: Arc<RwLock<MonitoringState>>,
    session_id: i64,
    game_name: String,
    emit: impl Fn(Option<&LiveStatus>) + Send,
) {
    let mut ticks = tokio::time::interval(std::time::Duration::from_millis(LIVE_PROBE_INTERVAL_MS));
    ticks.set_missed_tick_behavior(MissedTickBehavior::Delay);
    let refresh = std::time::Duration::from_secs(LIVE_STATUS_MATCH_REFRESH_SECS as u64);
    let mut next_refresh = Instant::now();
    let mut route_trace: Option<i64> = None;
    let mut history: Option<(i64, LiveHistory)> = None;

    loop {
        ticks.tick().await;
        if !session_is_live(&*monitoring.read().await, session_id) {
            break;
        }
        let now = Utc::now();
        let capture_down = capture_health::is_down();

        if Instant::now() >= next_refresh {
            next_refresh = Instant::now() + refresh;
            match active_flow(session_id, now).await {
                Some(flow) => {
                    if service.current_period(session_id) != Some(flow.period.id) {
                        if let Some(change) = service.finish_match(session_id, now) {
                            persist(&service, session_id, change).await;
                        }
                        service.start_match(context(session_id, &game_name, &flow), now);
                        route_trace = None;
                    }
                    if let Some((trace_id, route)) =
                        load_route(session_id, &flow.period.ip, route_trace).await
                    {
                        route_trace = Some(trace_id);
                        service.with_machine(session_id, |machine| machine.set_route(Some(route)));
                    }
                }
                None if capture_down => {}
                None => {
                    if let Some(change) = service.finish_match(session_id, now) {
                        persist(&service, session_id, change).await;
                    }
                }
            }
        }

        let Some(ticked) = service.tick(session_id, now, capture_down) else {
            break;
        };
        if let Some(change) = ticked.incident {
            persist(&service, session_id, change).await;
        }
        if let (Some(ctx), false) = (&ticked.context, ticked.pending.is_empty()) {
            if history
                .as_ref()
                .is_none_or(|(period, _)| *period != ctx.period_id)
            {
                history = Some((ctx.period_id, load_history(ctx, now).await));
            }
            if let Some(((_, past), before)) = history.as_ref().zip(parse(&ctx.started_at)) {
                let usuals: Vec<_> = ticked
                    .pending
                    .into_iter()
                    .map(|basis| {
                        let usual = usual_for(past, &basis, before);
                        (basis, usual)
                    })
                    .collect();
                service.with_machine(session_id, |machine| {
                    for (basis, usual) in usuals {
                        machine.set_usual(basis, usual);
                    }
                });
            }
        }
        emit(Some(&ticked.status));
    }

    if let Some(change) = service.finish_match(session_id, Utc::now()) {
        persist(&service, session_id, change).await;
    }
    service.end(session_id);
    emit(None);
}

pub fn follow_live_status(
    service: Arc<LiveStatusService>,
    monitoring: Arc<RwLock<MonitoringState>>,
    session_id: i64,
    game_name: &str,
    emit: impl Fn(Option<&LiveStatus>) + Send + 'static,
) {
    service.begin(session_id, game_name, Utc::now());
    let game_name = game_name.to_string();
    tokio::spawn(async move {
        run_live_status(service, monitoring, session_id, game_name, emit).await;
        log::info!("Live status for session {} stopped", session_id);
    });
}

#[cfg(test)]
mod tests;

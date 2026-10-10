use super::fault::{
    beacon_lossless, confirmed, localise, router_only, zone_evidence, Confirmation, MatchRoute,
};
use super::window::{window_stats, Observation, PointWindow, WindowStats};
use crate::config::{
    LIVE_STATUS_FALL_SECS, LIVE_STATUS_LOSS_WINDOW_SECS, LIVE_STATUS_PROBE_STALE_SECS,
    LIVE_STATUS_RISE_SECS, LIVE_STATUS_WINDOW_SECS,
};
use crate::models::game_ping::GamePingSample;
use crate::models::insights::{IncidentCause, PingBasis, PingSource, UsualPing};
use crate::models::live_probe::{LiveProbeSample, ProbeTarget};
use crate::models::live_status::{
    FrozenReason, LiveFault, LivePoint, LiveReading, LiveRegion, LiveState, LiveStatus,
    MatchIncident, ZoneEvidence,
};
use crate::models::severity::Severity;
use crate::models::traceroute::RouteZone;
use crate::services::live_probe::stats::{round, stamp};
use crate::services::matches::median;
use crate::services::severity::{jitter_status, loss_status, rank};
use crate::services::usual::{assess, game_basis};
use chrono::{DateTime, Duration, Utc};
use std::collections::{BTreeMap, HashMap, VecDeque};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MatchContext {
    pub session_id: i64,
    pub game_name: String,
    pub period_id: i64,
    pub server_ip: String,
    pub server_port: i32,
    pub started_at: String,
}

#[derive(Debug, Clone, PartialEq)]
pub enum IncidentChange {
    Open(MatchIncident),
    Update(MatchIncident),
    Close(MatchIncident),
}

#[derive(Debug, Clone, PartialEq)]
pub struct Tick {
    pub status: LiveStatus,
    pub incident: Option<IncidentChange>,
}

#[derive(Debug, Clone, Copy, PartialEq)]
struct Candidate {
    at: DateTime<Utc>,
    status: Severity,
    cause: Option<IncidentCause>,
}

#[derive(Debug, Clone, Default, PartialEq)]
struct View {
    primary: Option<LiveReading>,
    points: Vec<LiveReading>,
    zones: Vec<ZoneEvidence>,
    region: Option<LiveRegion>,
}

pub fn rate(stats: &WindowStats, usual_ms: Option<f64>) -> (Severity, Option<IncidentCause>) {
    let Some(ping) = stats.median_ms else {
        return match stats.loss_floor_pct.and_then(loss_status) {
            Some(status) => (status, Some(IncidentCause::Loss)),
            None => (Severity::Unmeasured, None),
        };
    };
    let (status, cause) = assess(ping, usual_ms, stats.loss_floor_pct.unwrap_or(0.0));
    match stats.jitter_ms.and_then(jitter_status) {
        Some(jitter) if rank(jitter) > rank(status) => (jitter, Some(IncidentCause::Jitter)),
        _ => (status, cause),
    }
}

pub fn gateway_basis() -> PingBasis {
    PingBasis {
        source: PingSource::Gateway,
        at_destination: false,
        measured_hop: None,
        measured_asn: None,
        server_ip: None,
    }
}

fn probe_basis(target: &ProbeTarget, point: LivePoint, asn: Option<u32>) -> PingBasis {
    let hop = target.ttl.map(i32::from);
    match point {
        LivePoint::Gateway => gateway_basis(),
        LivePoint::Floor if hop.is_none() => PingBasis {
            source: PingSource::Floor,
            at_destination: true,
            measured_hop: None,
            measured_asn: None,
            server_ip: target.server_ip.clone(),
        },
        _ => PingBasis {
            source: target.source,
            at_destination: false,
            measured_hop: hop,
            measured_asn: asn,
            server_ip: None,
        },
    }
}

pub struct LiveMachine {
    pub ctx: MatchContext,
    route: Option<MatchRoute>,
    windows: BTreeMap<LivePoint, PointWindow>,
    region: Option<(ProbeTarget, VecDeque<Observation>)>,
    usuals: HashMap<PingBasis, UsualPing>,
    state: LiveState,
    state_since: DateTime<Utc>,
    frozen_reason: Option<FrozenReason>,
    last_sample_at: Option<DateTime<Utc>>,
    had_primary: bool,
    status: Severity,
    status_since: Option<DateTime<Utc>>,
    cause: Option<IncidentCause>,
    candidates: VecDeque<Candidate>,
    fault: Option<LiveFault>,
    pending_fault: Option<(LiveFault, DateTime<Utc>)>,
    incident: Option<MatchIncident>,
    view: View,
}

impl LiveMachine {
    pub fn new(ctx: MatchContext, now: DateTime<Utc>) -> Self {
        Self {
            ctx,
            route: None,
            windows: BTreeMap::new(),
            region: None,
            usuals: HashMap::new(),
            state: LiveState::Measuring,
            state_since: now,
            frozen_reason: None,
            last_sample_at: None,
            had_primary: false,
            status: Severity::Unmeasured,
            status_since: None,
            cause: None,
            candidates: VecDeque::new(),
            fault: None,
            pending_fault: None,
            incident: None,
            view: View::default(),
        }
    }

    pub fn set_route(&mut self, route: Option<MatchRoute>) {
        self.route = route;
    }

    pub fn pending_usuals(&self) -> Vec<PingBasis> {
        self.windows
            .values()
            .map(|window| window.basis.clone())
            .filter(|basis| !self.usuals.contains_key(basis))
            .collect()
    }

    pub fn set_usual(&mut self, basis: PingBasis, usual: UsualPing) {
        self.usuals.insert(basis, usual);
    }

    fn observe(
        &mut self,
        point: LivePoint,
        basis: PingBasis,
        hop_ip: Option<String>,
        observation: Observation,
    ) {
        let at = observation.at;
        let reset = self
            .windows
            .get(&point)
            .is_none_or(|window| window.basis != basis);
        if reset {
            self.windows
                .insert(point, PointWindow::new(point, basis, hop_ip, at));
        }
        if let Some(window) = self.windows.get_mut(&point) {
            window.push(observation);
        }
        self.last_sample_at = Some(self.last_sample_at.map_or(at, |last| last.max(at)));
        if matches!(point, LivePoint::Floor | LivePoint::Game) {
            self.had_primary = true;
        }
    }

    pub fn observe_probe(&mut self, sample: &LiveProbeSample, asn: Option<u32>, at: DateTime<Utc>) {
        if sample.session_id != self.ctx.session_id
            || sample.target.server_ip.as_deref() != Some(self.ctx.server_ip.as_str())
        {
            return;
        }
        if sample.target.source == PingSource::Region {
            let region = self
                .region
                .get_or_insert_with(|| (sample.target.clone(), VecDeque::new()));
            if region.0 != sample.target {
                *region = (sample.target.clone(), VecDeque::new());
            }
            region.1.push_back(Observation::probe(at, sample.rtt_ms));
            return;
        }
        let Some(point) = LivePoint::of(sample.target.source).filter(|p| *p != LivePoint::Game)
        else {
            return;
        };
        let basis = probe_basis(&sample.target, point, asn);
        self.observe(
            point,
            basis,
            sample.target.hop_ip.clone(),
            Observation::probe(at, sample.rtt_ms),
        );
    }

    pub fn observe_game(&mut self, sample: &GamePingSample, at: DateTime<Utc>) {
        if sample.session_id != self.ctx.session_id
            || sample.source != PingSource::Game
            || sample.peer_ip.as_deref() != Some(self.ctx.server_ip.as_str())
            || sample.rtt_ms.is_none()
        {
            return;
        }
        let sent = sample.packets_sent.unwrap_or(0).max(0);
        let observation = Observation {
            at,
            rtt_ms: sample.rtt_ms,
            sent,
            lost: if sent > 0 {
                sample.packets_lost.unwrap_or(0).max(0)
            } else {
                0
            },
            jitter_ms: sample.jitter_ms,
        };
        self.observe(
            LivePoint::Game,
            game_basis(&self.ctx.server_ip),
            Some(self.ctx.server_ip.clone()),
            observation,
        );
    }

    fn beacon(&self, now: DateTime<Utc>) -> Option<WindowStats> {
        let (_, observations) = self.region.as_ref()?;
        let fresh = observations
            .back()
            .is_some_and(|o| now - o.at <= Duration::seconds(LIVE_STATUS_PROBE_STALE_SECS));
        fresh.then(|| window_stats(observations, now, false))
    }

    fn confirmation(&self, now: DateTime<Utc>) -> Confirmation {
        let beacon = self.beacon(now);
        let stats = |point: LivePoint| self.windows.get(&point).map(|window| window.stats(now));
        let floor_zone = self.windows.get(&LivePoint::Floor).and_then(|floor| {
            let hop = floor
                .basis
                .measured_hop
                .filter(|_| !floor.basis.at_destination)?;
            self.route.as_ref()?.hop(hop).map(|hop| hop.zone)
        });
        let router_only = match (stats(LivePoint::Floor), &beacon) {
            (Some(floor), Some(beacon))
                if matches!(floor_zone, Some(RouteZone::Home | RouteZone::Isp)) =>
            {
                router_only(&floor, beacon)
            }
            _ => Vec::new(),
        };
        let local_loss = stats(LivePoint::Gateway)
            .zip(beacon.as_ref())
            .filter(|(gateway, beacon)| gateway.sent > 0 && beacon_lossless(gateway, beacon))
            .map(|(gateway, _)| gateway.lost as f64 / gateway.sent as f64);
        let game_lossless = self
            .windows
            .get(&LivePoint::Game)
            .filter(|window| window.is_fresh(now))
            .map(|window| window.stats(now))
            .is_some_and(|game| {
                game.sent > 0
                    && game
                        .loss_floor_pct
                        .is_some_and(|l| loss_status(l).is_none())
            });
        Confirmation {
            router_only,
            local_loss,
            game_lossless,
        }
    }

    fn reading(
        &self,
        window: &PointWindow,
        now: DateTime<Utc>,
        confirmation: &Confirmation,
    ) -> LiveReading {
        let stats = window.stats(now);
        let checked = confirmed(
            &stats,
            &confirmation.cleared(window.point),
            confirmation.explained_lost(window.point, stats.sent),
        );
        let basis = &window.basis;
        let route = self.route.as_ref();
        let route_hop = match window.point {
            LivePoint::Game => None,
            LivePoint::Gateway => window
                .hop_ip
                .as_deref()
                .and_then(|ip| route.and_then(|route| route.hop_by_ip(ip))),
            _ => basis
                .measured_hop
                .and_then(|hop| route.and_then(|route| route.hop(hop))),
        };
        let at_server = window.point == LivePoint::Game || basis.at_destination;
        let zone = if at_server {
            Some(RouteZone::Service)
        } else if window.point == LivePoint::Gateway {
            Some(route_hop.map_or(RouteZone::Home, |hop| hop.zone))
        } else {
            route_hop.map(|hop| hop.zone)
        };
        let usual = self.usuals.get(basis).cloned().unwrap_or_default();
        let (status, cause) = if window.evaluable(&stats) {
            rate(&checked, usual.median_ms)
        } else {
            (Severity::Unmeasured, None)
        };
        LiveReading {
            point: window.point,
            basis: basis.clone(),
            at_least: !basis.at_destination,
            zone,
            hop: route_hop.map(|hop| hop.hop).or(basis.measured_hop),
            hop_ip: window.hop_ip.clone(),
            asn: route_hop.and_then(|hop| hop.asn).or(basis.measured_asn),
            operator: route_hop.and_then(|hop| hop.operator.clone()),
            median_ms: stats.median_ms,
            usual,
            trace_ms: route_hop.and_then(|hop| hop.rtt_ms),
            jitter_ms: stats.jitter_ms,
            loss_pct: stats.loss_pct,
            loss_floor_pct: checked.loss_floor_pct,
            lost: stats.lost,
            sent: stats.sent,
            sample_count: stats.sample_count,
            status,
            cause,
            last_sample_at: stamp(window.last_at),
            fresh: window.is_fresh(now),
        }
    }

    fn region_view(&self, now: DateTime<Utc>) -> Option<LiveRegion> {
        let (target, observations) = self.region.as_ref()?;
        let since = now - Duration::seconds(LIVE_STATUS_WINDOW_SECS);
        let recent: Vec<&Observation> = observations.iter().filter(|o| o.at > since).collect();
        let rtts: Vec<f64> = recent.iter().filter_map(|o| o.rtt_ms).collect();
        Some(LiveRegion {
            region: target.region.clone(),
            provider: target.provider,
            host: target.host.clone(),
            median_ms: median(rtts.clone()).map(round),
            sent: recent.len() as i64,
            received: rtts.len() as i64,
        })
    }

    fn established(&self) -> bool {
        rank(self.status) >= rank(Severity::Ok)
    }

    fn run_start(&self, held: impl Fn(Severity) -> bool) -> Option<DateTime<Utc>> {
        let mut start = None;
        for candidate in self.candidates.iter().rev() {
            if !held(candidate.status) {
                break;
            }
            start = Some(candidate.at);
        }
        start
    }

    fn settle(&mut self, now: DateTime<Utc>) {
        let rise_from = now - Duration::seconds(LIVE_STATUS_RISE_SECS);
        let fall_from = now - Duration::seconds(LIVE_STATUS_FALL_SECS);
        let covered = |from: DateTime<Utc>| self.candidates.front().is_some_and(|c| c.at <= from);
        let held_since = |from: DateTime<Utc>| self.candidates.iter().filter(move |c| c.at >= from);

        let mut next = None;
        if covered(rise_from) {
            let up = held_since(rise_from)
                .map(|c| c.status)
                .min_by_key(|s| rank(*s));
            if let Some(up) = up.filter(|up| rank(*up) > rank(self.status)) {
                next = Some(up);
            }
        }
        if next.is_none() && self.established() && covered(fall_from) {
            let calm = held_since(fall_from).all(|c| rank(c.status) < rank(self.status));
            let recent = held_since(rise_from)
                .map(|c| c.status)
                .max_by_key(|s| rank(*s));
            if let Some(down) = recent.filter(|_| calm) {
                next = Some(down);
            }
        }
        let Some(next) = next else {
            return;
        };
        let rising = rank(next) > rank(self.status);
        let previous = self.status;
        let since = if rising {
            self.run_start(|s| rank(s) >= rank(next))
        } else {
            self.run_start(|s| rank(s) < rank(previous))
        };
        self.cause = if rank(next) > rank(Severity::Ok) {
            self.candidates
                .iter()
                .rev()
                .find(|c| c.status == next)
                .or(self.candidates.back())
                .and_then(|c| c.cause)
        } else {
            None
        };
        self.status = next;
        self.status_since = since.or(Some(now));
    }

    fn track_fault(&mut self, candidate: Option<LiveFault>, now: DateTime<Utc>) {
        if rank(self.status) <= rank(Severity::Ok) {
            self.fault = None;
            self.pending_fault = None;
            return;
        }
        let Some(candidate) = candidate else {
            return;
        };
        let same_place =
            |a: &LiveFault, b: &LiveFault| a.zone == b.zone && a.at_point == b.at_point;
        match &self.fault {
            None => self.fault = Some(candidate),
            Some(current) if same_place(current, &candidate) => {
                self.fault = Some(candidate);
                self.pending_fault = None;
            }
            Some(_) => match &self.pending_fault {
                Some((pending, since)) if same_place(pending, &candidate) => {
                    if now - *since >= Duration::seconds(LIVE_STATUS_RISE_SECS) {
                        self.fault = Some(candidate);
                        self.pending_fault = None;
                    }
                }
                _ => self.pending_fault = Some((candidate, now)),
            },
        }
    }

    fn record(&self, primary: Option<&LiveReading>, started_at: DateTime<Utc>) -> MatchIncident {
        let fault = self.fault.as_ref();
        let basis = primary
            .map(|reading| reading.basis.clone())
            .unwrap_or_else(|| game_basis(&self.ctx.server_ip));
        MatchIncident {
            id: 0,
            session_id: self.ctx.session_id,
            server_ip: self.ctx.server_ip.clone(),
            server_port: self.ctx.server_port,
            match_started_at: self.ctx.started_at.clone(),
            started_at: stamp(started_at),
            ended_at: None,
            status: self.status,
            cause: self.cause,
            at_least: !basis.at_destination,
            basis,
            ping_ms: primary.and_then(|reading| reading.median_ms),
            usual_ms: primary.and_then(|reading| reading.usual.median_ms),
            loss_pct: primary.and_then(|reading| reading.loss_pct),
            jitter_ms: primary.and_then(|reading| reading.jitter_ms),
            zone: fault.map(|fault| fault.zone),
            after_hop: fault.and_then(|fault| fault.after_hop),
            at_hop: fault.and_then(|fault| fault.at_hop),
            asn: fault.and_then(|fault| fault.asn),
            operator: fault.and_then(|fault| fault.operator.clone()),
        }
    }

    fn follow_incident(
        &mut self,
        primary: Option<&LiveReading>,
        now: DateTime<Utc>,
    ) -> Option<IncidentChange> {
        let since = self.status_since.unwrap_or(now);
        let bad = rank(self.status) > rank(Severity::Ok);
        match self.incident.clone() {
            None if bad => {
                let opened = self.record(primary, since);
                self.incident = Some(opened.clone());
                Some(IncidentChange::Open(opened))
            }
            None => None,
            Some(mut open) if !bad => {
                open.ended_at = Some(stamp(since));
                self.incident = None;
                Some(IncidentChange::Close(open))
            }
            Some(open) => {
                let worse = rank(self.status) > rank(open.status);
                let located = self.fault.as_ref().map(|fault| fault.zone) != open.zone
                    && self.status == open.status;
                if !worse && !located {
                    return None;
                }
                let mut raised = self.record(primary, now);
                raised.id = open.id;
                raised.started_at = open.started_at.clone();
                if !worse {
                    raised.status = open.status;
                    raised.cause = open.cause;
                    raised.basis = open.basis.clone();
                    raised.at_least = open.at_least;
                    raised.ping_ms = open.ping_ms;
                    raised.usual_ms = open.usual_ms;
                    raised.loss_pct = open.loss_pct;
                    raised.jitter_ms = open.jitter_ms;
                }
                self.incident = Some(raised.clone());
                Some(IncidentChange::Update(raised))
            }
        }
    }

    pub fn set_incident_id(&mut self, id: i64) {
        if let Some(incident) = self.incident.as_mut() {
            incident.id = id;
        }
    }

    pub fn tick(&mut self, now: DateTime<Utc>, capture_down: bool) -> Tick {
        for window in self.windows.values_mut() {
            window.prune(now);
        }
        if let Some((_, observations)) = self.region.as_mut() {
            let oldest = now - Duration::seconds(LIVE_STATUS_LOSS_WINDOW_SECS);
            while observations.front().is_some_and(|o| o.at <= oldest) {
                observations.pop_front();
            }
        }

        let confirmation = self.confirmation(now);
        let points: Vec<LiveReading> = self
            .windows
            .values()
            .map(|window| self.reading(window, now, &confirmation))
            .collect();
        let usable: Vec<LiveReading> = points
            .iter()
            .filter(|reading| reading.fresh && reading.status != Severity::Unmeasured)
            .cloned()
            .collect();
        let primary = usable
            .iter()
            .find(|reading| reading.point == LivePoint::Game)
            .or_else(|| {
                usable
                    .iter()
                    .find(|reading| reading.point == LivePoint::Floor)
            })
            .cloned();
        let fresh_primary = self.windows.values().any(|window| {
            matches!(window.point, LivePoint::Game | LivePoint::Floor) && window.is_fresh(now)
        });

        let (state, reason) = if capture_down {
            (LiveState::Frozen, Some(FrozenReason::CaptureService))
        } else if self.had_primary && !fresh_primary {
            (LiveState::Frozen, Some(FrozenReason::NoSamples))
        } else if self.established() {
            (LiveState::Live, None)
        } else {
            (LiveState::Measuring, None)
        };
        if state == LiveState::Frozen {
            self.candidates.clear();
            self.pending_fault = None;
        }

        let mut incident = None;
        if state != LiveState::Frozen {
            if let Some(reading) = &primary {
                self.candidates.push_back(Candidate {
                    at: now,
                    status: reading.status,
                    cause: reading.cause,
                });
            }
            let keep_from = now - Duration::seconds(LIVE_STATUS_FALL_SECS + LIVE_STATUS_RISE_SECS);
            while self.candidates.front().is_some_and(|c| c.at < keep_from) {
                self.candidates.pop_front();
            }
            self.settle(now);

            let located = primary
                .as_ref()
                .filter(|reading| rank(reading.status) > rank(Severity::Ok))
                .and_then(|reading| {
                    let route = self.route.clone().unwrap_or_default();
                    let cleared = &confirmation.router_only;
                    localise(&usable, reading.point, reading.cause?, &route, cleared)
                });
            self.track_fault(located, now);
            incident = self.follow_incident(primary.as_ref(), now);
        }

        let state = match state {
            LiveState::Measuring if self.established() => LiveState::Live,
            other => other,
        };
        if state != self.state || reason != self.frozen_reason {
            self.state = state;
            self.state_since = now;
            self.frozen_reason = reason;
        }
        if state != LiveState::Frozen {
            self.view = View {
                zones: zone_evidence(
                    self.route.as_ref(),
                    &usable,
                    self.status,
                    self.fault.as_ref(),
                ),
                primary,
                points,
                region: self.region_view(now),
            };
        }

        Tick {
            status: self.snapshot(now),
            incident,
        }
    }

    pub fn snapshot(&self, now: DateTime<Utc>) -> LiveStatus {
        LiveStatus {
            session_id: self.ctx.session_id,
            game_name: self.ctx.game_name.clone(),
            state: self.state,
            state_since: stamp(self.state_since),
            frozen_reason: self.frozen_reason,
            server_ip: Some(self.ctx.server_ip.clone()),
            server_port: Some(self.ctx.server_port),
            match_started_at: Some(self.ctx.started_at.clone()),
            last_sample_at: self.last_sample_at.map(stamp),
            status: self.status,
            status_since: self.status_since.map(stamp),
            cause: self.cause,
            primary: self.view.primary.clone(),
            points: self.view.points.clone(),
            zones: self.view.zones.clone(),
            fault: self.fault.clone(),
            region: self.view.region.clone(),
            updated_at: stamp(now),
        }
    }

    pub fn finish(&mut self, now: DateTime<Utc>) -> Option<IncidentChange> {
        let mut open = self.incident.take()?;
        let ended = if self.state == LiveState::Frozen {
            self.state_since
        } else {
            now
        };
        open.ended_at = Some(stamp(ended));
        Some(IncidentChange::Close(open))
    }
}

pub fn waiting(
    session_id: i64,
    game_name: &str,
    since: DateTime<Utc>,
    now: DateTime<Utc>,
) -> LiveStatus {
    LiveStatus {
        session_id,
        game_name: game_name.to_string(),
        state: LiveState::Waiting,
        state_since: stamp(since),
        frozen_reason: None,
        server_ip: None,
        server_port: None,
        match_started_at: None,
        last_sample_at: None,
        status: Severity::Unmeasured,
        status_since: None,
        cause: None,
        primary: None,
        points: Vec::new(),
        zones: Vec::new(),
        fault: None,
        region: None,
        updated_at: stamp(now),
    }
}

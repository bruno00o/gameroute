use super::stats::{stamp, stats, Observation, SliceBuilder};
use crate::config::{
    LIVE_PROBE_MAX_PACKETS_PER_SESSION, LIVE_PROBE_MAX_PACKETS_PER_TICK, LIVE_PROBE_STATS_SAMPLES,
    LIVE_PROBE_WINDOW_SAMPLES,
};
use crate::models::insights::PingSource;
use crate::models::live_probe::{
    LiveProbeSample, LiveProbeSlice, LiveProbeState, LiveTrack, ProbeProtocol, ProbeTarget,
};
use chrono::{DateTime, Utc};
use std::collections::{HashMap, VecDeque};
use std::net::IpAddr;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Probe {
    pub source: PingSource,
    pub ip: IpAddr,
    pub protocol: ProbeProtocol,
    pub port: Option<u16>,
    pub ttl: Option<u8>,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct ProbeReply {
    pub rtt_ms: Option<f64>,
    pub from: Option<IpAddr>,
    pub at_destination: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlannedProbe {
    pub target: ProbeTarget,
    pub ip: IpAddr,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ProbePlan {
    pub floor: Option<PlannedProbe>,
    pub region: Option<PlannedProbe>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PacketBudget {
    pub limit: u64,
    pub sent: u64,
}

impl PacketBudget {
    pub fn new(limit: u64) -> Self {
        Self { limit, sent: 0 }
    }

    pub fn take(&mut self) -> bool {
        if self.sent >= self.limit {
            return false;
        }
        self.sent += 1;
        true
    }
}

struct Track {
    planned: PlannedProbe,
    window: VecDeque<LiveProbeSample>,
    observations: VecDeque<Observation>,
    slice: Option<SliceBuilder>,
}

impl Track {
    fn new(planned: PlannedProbe) -> Self {
        Self {
            planned,
            window: VecDeque::new(),
            observations: VecDeque::new(),
            slice: None,
        }
    }
}

pub struct Engine {
    session_id: i64,
    budget: PacketBudget,
    floor: Option<Track>,
    region: Option<Track>,
    ttl_caps: HashMap<String, u8>,
    protected: Box<dyn Fn(IpAddr) -> bool + Send + Sync>,
}

impl Engine {
    pub fn new(
        session_id: i64,
        limit: u64,
        protected: impl Fn(IpAddr) -> bool + Send + Sync + 'static,
    ) -> Self {
        Self {
            session_id,
            budget: PacketBudget::new(limit),
            floor: None,
            region: None,
            ttl_caps: HashMap::new(),
            protected: Box::new(protected),
        }
    }

    pub fn for_session(
        session_id: i64,
        protected: impl Fn(IpAddr) -> bool + Send + Sync + 'static,
    ) -> Self {
        Self::new(session_id, LIVE_PROBE_MAX_PACKETS_PER_SESSION, protected)
    }

    pub fn packets_sent(&self) -> u64 {
        self.budget.sent
    }

    fn capped(&self, mut planned: PlannedProbe) -> PlannedProbe {
        if let (Some(ttl), Some(cap)) = (
            planned.target.ttl,
            planned
                .target
                .server_ip
                .as_ref()
                .and_then(|ip| self.ttl_caps.get(ip)),
        ) {
            planned.target.ttl = Some(ttl.min(*cap));
        }
        planned
    }

    pub fn set_plan(&mut self, plan: ProbePlan) -> Vec<LiveProbeSlice> {
        let floor = plan.floor.map(|planned| self.capped(planned));
        let session_id = self.session_id;
        let mut flushed = Vec::new();
        for (slot, next) in [(&mut self.floor, floor), (&mut self.region, plan.region)] {
            let same = slot.as_ref().map(|track| &track.planned) == next.as_ref();
            if same {
                continue;
            }
            if let Some(track) = slot.take() {
                flushed.extend(track.slice.and_then(|slice| slice.finish(session_id)));
            }
            *slot = next.map(Track::new);
        }
        flushed
    }

    pub fn due(&mut self) -> Vec<Probe> {
        let planned: Vec<PlannedProbe> = [&self.floor, &self.region]
            .into_iter()
            .flatten()
            .map(|track| track.planned.clone())
            .take(LIVE_PROBE_MAX_PACKETS_PER_TICK)
            .collect();
        planned
            .into_iter()
            .take_while(|_| self.budget.take())
            .map(|planned| Probe {
                source: planned.target.source,
                ip: planned.ip,
                protocol: planned.target.protocol,
                port: planned.target.port,
                ttl: planned.target.ttl,
            })
            .collect()
    }

    fn guard(&mut self, probe: &Probe, reply: &ProbeReply) {
        let Some(ttl) = probe.ttl else {
            return;
        };
        let crossed = reply.from.is_some_and(|ip| (self.protected)(ip))
            || (reply.at_destination && (self.protected)(probe.ip));
        if !crossed || ttl <= 1 {
            return;
        }
        let Some(track) = self.floor.as_mut() else {
            return;
        };
        let lowered = ttl.saturating_sub(1).max(1);
        if let Some(server) = track.planned.target.server_ip.clone() {
            self.ttl_caps.insert(server, lowered);
        }
        track.planned.target.ttl = Some(lowered);
        log::warn!(
            "Live floor probe toward {} crossed into the game operator at TTL {}, lowering to {}",
            probe.ip,
            ttl,
            lowered
        );
    }

    pub fn record(
        &mut self,
        probe: &Probe,
        reply: ProbeReply,
        at: DateTime<Utc>,
    ) -> Option<(LiveProbeSample, Vec<LiveProbeSlice>)> {
        let session_id = self.session_id;
        let track = match probe.source {
            PingSource::Floor => self.floor.as_mut(),
            PingSource::Region => self.region.as_mut(),
            _ => None,
        }?;
        if track.planned.ip != probe.ip {
            return None;
        }
        let target = ProbeTarget {
            ttl: probe.ttl,
            ..track.planned.target.clone()
        };
        let observation = Observation {
            at,
            rtt_ms: reply.rtt_ms,
            reply_ip: reply.from.map(|ip| ip.to_string()),
            at_destination: reply.at_destination,
        };

        let mut flushed = Vec::new();
        if track
            .slice
            .as_ref()
            .is_some_and(|slice| !slice.holds(&target, at))
        {
            flushed.extend(
                track
                    .slice
                    .take()
                    .and_then(|slice| slice.finish(session_id)),
            );
        }
        track
            .slice
            .get_or_insert_with(|| SliceBuilder::new(target.clone(), at))
            .observations
            .push(observation.clone());

        track.observations.push_back(observation);
        while track.observations.len() > LIVE_PROBE_STATS_SAMPLES {
            track.observations.pop_front();
        }
        let sample = LiveProbeSample {
            session_id,
            target,
            measured_at: stamp(at),
            rtt_ms: reply.rtt_ms,
            reply_ip: reply.from.map(|ip| ip.to_string()),
            at_destination: reply.at_destination,
            recent: stats(&track.observations),
        };
        track.window.push_back(sample.clone());
        while track.window.len() > LIVE_PROBE_WINDOW_SAMPLES {
            track.window.pop_front();
        }

        if probe.source == PingSource::Floor {
            self.guard(probe, &reply);
        }
        Some((sample, flushed))
    }

    pub fn finish(&mut self) -> Vec<LiveProbeSlice> {
        self.set_plan(ProbePlan::default())
    }

    pub fn snapshot(&self) -> LiveProbeState {
        let track = |track: &Option<Track>| {
            track.as_ref().map(|track| LiveTrack {
                target: track.planned.target.clone(),
                samples: track.window.iter().cloned().collect(),
                stats: stats(&track.observations),
            })
        };
        LiveProbeState {
            session_id: Some(self.session_id),
            packets_sent: self.budget.sent,
            floor: track(&self.floor),
            region: track(&self.region),
        }
    }
}

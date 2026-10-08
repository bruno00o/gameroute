use super::insights::{IncidentCause, PingBasis, PingSource, UsualPing};
use super::live_probe::BeaconProvider;
use super::severity::Severity;
use super::traceroute::RouteZone;
use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum LiveState {
    Waiting,
    Measuring,
    Live,
    Frozen,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum FrozenReason {
    NoSamples,
    CaptureService,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum LivePoint {
    Gateway,
    IspEdge,
    Floor,
    Game,
}

impl LivePoint {
    pub fn of(source: PingSource) -> Option<Self> {
        match source {
            PingSource::Gateway => Some(Self::Gateway),
            PingSource::IspEdge => Some(Self::IspEdge),
            PingSource::Floor => Some(Self::Floor),
            PingSource::Game => Some(Self::Game),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveReading {
    pub point: LivePoint,
    pub basis: PingBasis,
    pub at_least: bool,
    pub zone: Option<RouteZone>,
    pub hop: Option<i32>,
    pub hop_ip: Option<String>,
    pub asn: Option<u32>,
    pub operator: Option<String>,
    pub median_ms: Option<f64>,
    pub usual: UsualPing,
    pub trace_ms: Option<f64>,
    pub jitter_ms: Option<f64>,
    pub loss_pct: Option<f64>,
    pub loss_floor_pct: Option<f64>,
    pub lost: i64,
    pub sent: i64,
    pub sample_count: u32,
    pub status: Severity,
    pub cause: Option<IncidentCause>,
    pub last_sample_at: String,
    pub fresh: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum FaultZone {
    Home,
    Isp,
    Transit,
    Service,
    AfterIsp,
    NotHome,
    Unlocated,
}

impl FaultZone {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Home => "home",
            Self::Isp => "isp",
            Self::Transit => "transit",
            Self::Service => "service",
            Self::AfterIsp => "after_isp",
            Self::NotHome => "not_home",
            Self::Unlocated => "unlocated",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveFault {
    pub zone: FaultZone,
    pub zones: Vec<RouteZone>,
    pub cause: IncidentCause,
    pub after_point: Option<LivePoint>,
    pub after_hop: Option<i32>,
    pub at_point: LivePoint,
    pub at_hop: Option<i32>,
    pub asn: Option<u32>,
    pub operator: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ZoneVerdict {
    Clear,
    Fault,
    Suspect,
    Masked,
    Unmeasured,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ZoneEvidence {
    pub zone: RouteZone,
    pub verdict: ZoneVerdict,
    pub status: Severity,
    pub point: Option<LivePoint>,
    pub first_hop: Option<i32>,
    pub last_hop: Option<i32>,
    pub asn: Option<u32>,
    pub operator: Option<String>,
    pub silent: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveRegion {
    pub region: Option<String>,
    pub provider: Option<BeaconProvider>,
    pub host: Option<String>,
    pub median_ms: Option<f64>,
    pub sent: i64,
    pub received: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveStatus {
    pub session_id: i64,
    pub game_name: String,
    pub state: LiveState,
    pub state_since: String,
    pub frozen_reason: Option<FrozenReason>,
    pub server_ip: Option<String>,
    pub server_port: Option<i32>,
    pub match_started_at: Option<String>,
    pub last_sample_at: Option<String>,
    pub status: Severity,
    pub status_since: Option<String>,
    pub cause: Option<IncidentCause>,
    pub primary: Option<LiveReading>,
    pub points: Vec<LiveReading>,
    pub zones: Vec<ZoneEvidence>,
    pub fault: Option<LiveFault>,
    pub region: Option<LiveRegion>,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MatchIncident {
    pub id: i64,
    pub session_id: i64,
    pub server_ip: String,
    pub server_port: i32,
    pub match_started_at: String,
    pub started_at: String,
    pub ended_at: Option<String>,
    pub status: Severity,
    pub cause: Option<IncidentCause>,
    pub basis: PingBasis,
    pub at_least: bool,
    pub ping_ms: Option<f64>,
    pub usual_ms: Option<f64>,
    pub loss_pct: Option<f64>,
    pub jitter_ms: Option<f64>,
    pub zone: Option<FaultZone>,
    pub after_hop: Option<i32>,
    pub at_hop: Option<i32>,
    pub asn: Option<u32>,
    pub operator: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn points_follow_the_path_from_the_pc_to_the_server() {
        let mut points = vec![
            LivePoint::Game,
            LivePoint::Gateway,
            LivePoint::Floor,
            LivePoint::IspEdge,
        ];
        points.sort();
        assert_eq!(
            points,
            vec![
                LivePoint::Gateway,
                LivePoint::IspEdge,
                LivePoint::Floor,
                LivePoint::Game
            ]
        );
        assert_eq!(LivePoint::of(PingSource::Region), None);
        assert_eq!(LivePoint::of(PingSource::IspEdge), Some(LivePoint::IspEdge));
        assert_eq!(
            serde_json::to_value(FaultZone::AfterIsp).unwrap(),
            "after_isp"
        );
        assert_eq!(FaultZone::NotHome.as_str(), "not_home");
    }
}

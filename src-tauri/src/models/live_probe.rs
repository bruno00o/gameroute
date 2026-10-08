use super::insights::{PingBasis, PingSource};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BeaconProvider {
    Gamelift,
    ValveSdr,
    Epic,
}

impl BeaconProvider {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Gamelift => "gamelift",
            Self::ValveSdr => "valve_sdr",
            Self::Epic => "epic",
        }
    }
}

impl TryFrom<String> for BeaconProvider {
    type Error = String;

    fn try_from(value: String) -> Result<Self, Self::Error> {
        match value.as_str() {
            "gamelift" => Ok(Self::Gamelift),
            "valve_sdr" => Ok(Self::ValveSdr),
            "epic" => Ok(Self::Epic),
            _ => Err(format!("unknown beacon provider {value}")),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ProbeProtocol {
    Icmp,
    Udp,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Beacon {
    pub id: String,
    pub provider: BeaconProvider,
    pub region: String,
    pub host: String,
    pub protocol: ProbeProtocol,
    #[serde(default)]
    pub port: Option<u16>,
    #[serde(default)]
    pub places: Vec<String>,
    #[serde(default = "enabled")]
    pub enabled: bool,
}

fn enabled() -> bool {
    true
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct LiveProbeConfig {
    pub enabled: bool,
    pub floor: bool,
    pub region: bool,
    pub beacons: Vec<Beacon>,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProbeTarget {
    pub source: PingSource,
    pub address: String,
    pub host: Option<String>,
    pub protocol: ProbeProtocol,
    pub port: Option<u16>,
    pub ttl: Option<u8>,
    pub server_ip: Option<String>,
    pub hop_ip: Option<String>,
    pub region: Option<String>,
    pub provider: Option<BeaconProvider>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveStats {
    pub sent: u32,
    pub received: u32,
    pub loss_pct: f64,
    pub median_ms: Option<f64>,
    pub jitter_ms: Option<f64>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveProbeSample {
    pub session_id: i64,
    #[serde(flatten)]
    pub target: ProbeTarget,
    pub measured_at: String,
    pub rtt_ms: Option<f64>,
    pub reply_ip: Option<String>,
    pub at_destination: bool,
    pub recent: LiveStats,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveTrack {
    pub target: ProbeTarget,
    pub samples: Vec<LiveProbeSample>,
    pub stats: LiveStats,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveProbeState {
    pub session_id: Option<i64>,
    pub packets_sent: u64,
    pub floor: Option<LiveTrack>,
    pub region: Option<LiveTrack>,
}

#[derive(Debug, Clone, PartialEq, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct LiveProbeSlice {
    pub session_id: i64,
    #[sqlx(try_from = "String")]
    pub source: PingSource,
    pub started_at: String,
    pub address: String,
    pub host: Option<String>,
    pub ttl: Option<i32>,
    pub server_ip: Option<String>,
    pub reply_ip: Option<String>,
    pub at_destination: bool,
    pub region: Option<String>,
    pub provider: Option<String>,
    pub sent: i64,
    pub received: i64,
    pub rtt_min: Option<f64>,
    pub rtt_median: Option<f64>,
    pub rtt_max: Option<f64>,
    pub jitter_ms: Option<f64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveSpan {
    pub started_at: String,
    pub ended_at: String,
    pub slice_count: u32,
    pub sent: i64,
    pub received: i64,
    pub loss_pct: Option<f64>,
    pub ping_ms: Option<f64>,
    pub min_ms: Option<f64>,
    pub max_ms: Option<f64>,
    pub jitter_ms: Option<f64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccessMeasure {
    pub basis: PingBasis,
    pub hop_ip: Option<String>,
    #[serde(flatten)]
    pub span: LiveSpan,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegionEstimate {
    pub region: String,
    pub provider: Option<BeaconProvider>,
    pub host: Option<String>,
    #[serde(flatten)]
    pub span: LiveSpan,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn floor_target() -> ProbeTarget {
        ProbeTarget {
            source: PingSource::Floor,
            address: "162.249.72.5".to_string(),
            host: None,
            protocol: ProbeProtocol::Icmp,
            port: None,
            ttl: Some(5),
            server_ip: Some("162.249.72.5".to_string()),
            hop_ip: Some("194.6.150.68".to_string()),
            region: None,
            provider: None,
        }
    }

    #[test]
    fn live_sample_serializes_for_the_event() {
        let sample = LiveProbeSample {
            session_id: 4,
            target: floor_target(),
            measured_at: "2026-10-08T20:00:01.000Z".to_string(),
            rtt_ms: None,
            reply_ip: None,
            at_destination: false,
            recent: LiveStats {
                sent: 10,
                received: 9,
                loss_pct: 10.0,
                median_ms: Some(4.6),
                jitter_ms: Some(0.4),
            },
        };

        let json = serde_json::to_value(&sample).unwrap();
        assert_eq!(json["source"], "floor");
        assert_eq!(json["ttl"], 5);
        assert_eq!(json["protocol"], "icmp");
        assert!(json["rttMs"].is_null());
        assert_eq!(json["recent"]["lossPct"], 10.0);
        assert!(json.get("target").is_none());
    }

    #[test]
    fn beacon_reads_with_defaults() {
        let beacon: Beacon = serde_json::from_str(
            r#"{"id":"x","provider":"valve_sdr","region":"Paris","host":"185.25.182.18","protocol":"icmp"}"#,
        )
        .unwrap();
        assert!(beacon.enabled);
        assert!(beacon.places.is_empty());
        assert_eq!(beacon.port, None);
        assert_eq!(
            BeaconProvider::try_from(beacon.provider.as_str().to_string()),
            Ok(BeaconProvider::ValveSdr)
        );
    }
}

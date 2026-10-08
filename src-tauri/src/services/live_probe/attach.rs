use super::stats::span;
use crate::config::LIVE_PROBE_SLICE_SECS;
use crate::models::insights::{PingBasis, PingSource};
use crate::models::live_probe::{AccessMeasure, BeaconProvider, LiveProbeSlice, RegionEstimate};
use crate::models::session::{MeasuredFlow, SessionMatch};
use chrono::{DateTime, Duration, Utc};
use std::collections::BTreeMap;

fn utc(timestamp: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(timestamp)
        .ok()
        .map(|at| at.with_timezone(&Utc))
}

fn during<'a>(
    flow: &MeasuredFlow,
    slices: &'a [LiveProbeSlice],
    source: PingSource,
) -> Vec<&'a LiveProbeSlice> {
    let margin = Duration::seconds(LIVE_PROBE_SLICE_SECS);
    let (Some(from), Some(to)) = (utc(&flow.started_at), utc(&flow.ended_at)) else {
        return Vec::new();
    };
    slices
        .iter()
        .filter(|slice| slice.source == source)
        .filter(|slice| slice.server_ip.as_deref() == Some(flow.ip.as_str()))
        .filter(|slice| {
            utc(&slice.started_at).is_some_and(|at| from - margin <= at && at <= to + margin)
        })
        .collect()
}

pub fn floor_basis(slice: &LiveProbeSlice, at_destination: bool, asn: Option<u32>) -> PingBasis {
    PingBasis {
        source: PingSource::Floor,
        at_destination,
        measured_hop: if at_destination { None } else { slice.ttl },
        measured_asn: if at_destination { None } else { asn },
        server_ip: if at_destination {
            slice.server_ip.clone()
        } else {
            None
        },
    }
}

fn access(
    slices: &[&LiveProbeSlice],
    asn_of: &impl Fn(&str) -> Option<u32>,
) -> Option<AccessMeasure> {
    let last = slices
        .iter()
        .rev()
        .find(|s| s.received > 0)
        .or(slices.last())?;
    let answered: Vec<&&LiveProbeSlice> = slices.iter().filter(|s| s.received > 0).collect();
    let at_destination = !answered.is_empty() && answered.iter().all(|s| s.at_destination);
    let asn = last.reply_ip.as_deref().and_then(asn_of);
    Some(AccessMeasure {
        basis: floor_basis(last, at_destination, asn),
        hop_ip: last.reply_ip.clone(),
        span: span(slices)?,
    })
}

fn region(slices: &[&LiveProbeSlice]) -> Option<RegionEstimate> {
    let mut by_region: BTreeMap<&str, Vec<&LiveProbeSlice>> = BTreeMap::new();
    for slice in slices {
        if let Some(region) = slice.region.as_deref() {
            by_region.entry(region).or_default().push(slice);
        }
    }
    let (name, chosen) = by_region
        .into_iter()
        .max_by_key(|(_, slices)| slices.len())?;
    let last = chosen.last()?;
    Some(RegionEstimate {
        region: name.to_string(),
        provider: last
            .provider
            .clone()
            .and_then(|provider| BeaconProvider::try_from(provider).ok()),
        host: last.host.clone(),
        span: span(&chosen)?,
    })
}

pub fn attach_live_measures(
    matches: &mut [SessionMatch],
    slices: &[LiveProbeSlice],
    asn_of: impl Fn(&str) -> Option<u32>,
) {
    for game in matches {
        let floor = during(&game.flow, slices, PingSource::Floor);
        game.flow.access = access(&floor, &asn_of);
        let beacons = during(&game.flow, slices, PingSource::Region);
        game.flow.region_estimate = region(&beacons);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::live_probes::fixtures::floor_slice;
    use crate::models::session::{MeasuredFlow, SessionMatch};
    use crate::models::severity::Severity;

    fn game() -> SessionMatch {
        SessionMatch {
            number: 1,
            voice: None,
            flow: MeasuredFlow {
                period_id: 1,
                ip: "162.249.72.5".to_string(),
                protocol: "UDP".to_string(),
                port: 7220,
                started_at: "2026-10-08T20:00:00Z".to_string(),
                ended_at: "2026-10-08T20:30:00Z".to_string(),
                duration_secs: 1800,
                packet_count: 5000,
                operator: None,
                trace: None,
                game: None,
                region_pings: None,
                access: None,
                region_estimate: None,
                status: Severity::Unmeasured,
            },
        }
    }

    fn beacon(started_at: &str, region: &str, median: f64) -> LiveProbeSlice {
        LiveProbeSlice {
            source: PingSource::Region,
            address: "gamelift-ping.eu-west-3.api.aws".to_string(),
            host: Some("gamelift-ping.eu-west-3.api.aws".to_string()),
            ttl: None,
            reply_ip: Some("15.188.0.1".to_string()),
            at_destination: true,
            region: Some(region.to_string()),
            provider: Some("gamelift".to_string()),
            ..floor_slice(1, started_at, median, 10)
        }
    }

    #[test]
    fn floor_becomes_the_access_measure_of_its_match() {
        let slices = vec![
            floor_slice(1, "2026-10-08T19:50:00.000Z", 40.0, 10),
            floor_slice(1, "2026-10-08T20:05:00.000Z", 4.6, 10),
            floor_slice(1, "2026-10-08T20:05:10.000Z", 4.8, 8),
            LiveProbeSlice {
                server_ip: Some("162.249.72.9".to_string()),
                ..floor_slice(1, "2026-10-08T20:05:20.000Z", 90.0, 10)
            },
            beacon("2026-10-08T20:05:00.000Z", "Paris", 5.1),
            beacon("2026-10-08T20:05:10.000Z", "Paris", 5.3),
            beacon("2026-10-08T20:05:20.000Z", "Frankfurt", 12.0),
        ];
        let mut matches = vec![game()];

        attach_live_measures(&mut matches, &slices, |ip| {
            (ip == "194.6.150.68").then_some(15557)
        });

        let flow = &matches[0].flow;
        let access = flow.access.as_ref().unwrap();
        assert_eq!(
            access.basis,
            PingBasis {
                source: PingSource::Floor,
                at_destination: false,
                measured_hop: Some(5),
                measured_asn: Some(15557),
                server_ip: None,
            }
        );
        assert_eq!(access.hop_ip.as_deref(), Some("194.6.150.68"));
        assert_eq!(access.span.slice_count, 2);
        assert_eq!((access.span.sent, access.span.received), (20, 18));
        assert_eq!(access.span.loss_pct, Some(10.0));
        assert_eq!(access.span.ping_ms, Some(4.7));

        let region = flow.region_estimate.as_ref().unwrap();
        assert_eq!(region.region, "Paris");
        assert_eq!(region.provider, Some(BeaconProvider::Gamelift));
        assert_eq!(region.span.ping_ms, Some(5.2));

        assert_eq!(flow.ping_ms(), None);
        assert!(!flow.ping_at_least());
        assert_eq!(flow.loss_pct(), None);
        assert_eq!(flow.status, Severity::Unmeasured);
    }

    #[test]
    fn match_without_live_samples_stays_as_before() {
        let mut matches = vec![game()];
        attach_live_measures(&mut matches, &[], |_| None);
        assert_eq!(matches[0], game());
    }
}

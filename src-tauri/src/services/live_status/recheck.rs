use super::window::loss_floor_pct;
use crate::config::{
    LIVE_PROBE_SLICE_SECS, LIVE_STATUS_LOSS_WINDOW_SECS, LIVE_STATUS_MIN_PROBES,
    LIVE_STATUS_WINDOW_SECS,
};
use crate::db::{get_live_probe_repository, get_match_incident_repository};
use crate::models::insights::{IncidentCause, PingSource};
use crate::models::live_probe::LiveProbeSlice;
use crate::models::live_status::{FaultZone, MatchIncident};
use crate::services::live_probe::stats::slice_start;
use crate::services::severity::{jitter_status, latency_status, loss_status, rank};
use chrono::{DateTime, Duration, Utc};
use std::collections::BTreeMap;

fn utc(timestamp: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(timestamp)
        .ok()
        .map(|at| at.with_timezone(&Utc))
}

type Slots<'a> = BTreeMap<DateTime<Utc>, Vec<&'a LiveProbeSlice>>;

fn covered<'a>(
    incident: &MatchIncident,
    slices: &'a [LiveProbeSlice],
    lookback: i64,
    pick: impl Fn(&LiveProbeSlice) -> bool,
) -> Option<Slots<'a>> {
    let (start, end) = utc(&incident.started_at).zip(incident.ended_at.as_deref().and_then(utc))?;
    let from = slice_start(start - Duration::seconds(lookback));

    let mut slots: Slots = BTreeMap::new();
    for slice in slices.iter().filter(|slice| {
        slice.session_id == incident.session_id
            && slice.server_ip.as_deref() == Some(incident.server_ip.as_str())
            && pick(slice)
    }) {
        if let Some(at) = utc(&slice.started_at).filter(|at| *at >= from && *at < end) {
            slots.entry(at).or_default().push(slice);
        }
    }

    let mut slot = from;
    while slot < end {
        let answered = slots.get(&slot).is_some_and(|slices| {
            slices
                .iter()
                .all(|slice| slice.sent > 0 && slice.received * 2 >= slice.sent)
        });
        if !answered {
            return None;
        }
        slot += Duration::seconds(LIVE_PROBE_SLICE_SECS);
    }
    Some(slots)
}

fn counts(slots: &Slots) -> (i64, i64) {
    slots
        .values()
        .flatten()
        .fold((0, 0), |(sent, lost), slice| {
            (sent + slice.sent, lost + slice.sent - slice.received)
        })
}

fn lossless((sent, lost): (i64, i64)) -> bool {
    sent >= i64::from(LIVE_STATUS_MIN_PROBES)
        && loss_floor_pct(lost, sent).is_some_and(|loss| loss_status(loss).is_none())
}

fn is_beacon(slice: &LiveProbeSlice) -> bool {
    slice.source == PingSource::Region
}

pub fn cleared_by_beacon(incident: &MatchIncident, slices: &[LiveProbeSlice]) -> bool {
    let router = incident.basis.source == PingSource::Floor && !incident.basis.at_destination;
    if !router || incident.zone != Some(FaultZone::Isp) {
        return false;
    }
    let lookback = match incident.cause {
        Some(IncidentCause::Jitter) => LIVE_STATUS_WINDOW_SECS,
        Some(IncidentCause::Loss) => LIVE_STATUS_LOSS_WINDOW_SECS,
        _ => return false,
    };
    let Some(beacon) = covered(incident, slices, lookback, is_beacon) else {
        return false;
    };
    match incident.cause {
        Some(IncidentCause::Jitter) => beacon
            .values()
            .flatten()
            .all(|slice| slice.jitter_ms.is_some_and(|j| jitter_status(j).is_none())),
        _ => lossless(counts(&beacon)),
    }
}

pub fn local_loss(incident: &MatchIncident, slices: &[LiveProbeSlice]) -> bool {
    let floor = incident.basis.source == PingSource::Floor;
    if !floor
        || incident.cause != Some(IncidentCause::Loss)
        || incident.zone != Some(FaultZone::Home)
    {
        return false;
    }
    let lookback = LIVE_STATUS_LOSS_WINDOW_SECS;
    let probes = |source: PingSource| {
        covered(incident, slices, lookback, move |slice| {
            slice.source == source
                && (source != PingSource::Floor || slice.ttl == incident.basis.measured_hop)
        })
    };
    let (Some(beacon), Some(gateway), Some(floor)) = (
        covered(incident, slices, lookback, is_beacon),
        probes(PingSource::Gateway),
        probes(PingSource::Floor),
    ) else {
        return false;
    };
    let (gateway, (floor_sent, floor_lost)) = (counts(&gateway), counts(&floor));
    lossless(counts(&beacon))
        && gateway.0 * 2 >= floor_sent
        && lossless((floor_sent, (floor_lost - gateway.1).max(0)))
}

fn without_loss(incident: &MatchIncident) -> Option<MatchIncident> {
    let jitter = incident
        .jitter_ms
        .and_then(jitter_status)
        .map(|status| (status, IncidentCause::Jitter));
    let latency = incident
        .ping_ms
        .zip(incident.usual_ms)
        .and_then(|(ping, usual)| latency_status(ping - usual))
        .map(|status| (status, IncidentCause::Latency));
    let (status, cause) = [latency, jitter]
        .into_iter()
        .flatten()
        .max_by_key(|(status, _)| rank(*status))?;
    Some(MatchIncident {
        status,
        cause: Some(cause),
        ..incident.clone()
    })
}

#[derive(Debug, Clone, PartialEq)]
pub enum Recheck {
    Remove,
    Downgrade(Box<MatchIncident>),
}

pub fn recheck(incident: &MatchIncident, slices: &[LiveProbeSlice]) -> Option<Recheck> {
    if cleared_by_beacon(incident, slices) {
        return Some(Recheck::Remove);
    }
    if !local_loss(incident, slices) {
        return None;
    }
    Some(match without_loss(incident) {
        Some(lower) => Recheck::Downgrade(Box::new(lower)),
        None => Recheck::Remove,
    })
}

pub async fn recheck_router_incidents() {
    let (Some(incidents), Some(probes)) =
        (get_match_incident_repository(), get_live_probe_repository())
    else {
        return;
    };
    let stored = match incidents.get_closed_router_incidents().await {
        Ok(stored) => stored,
        Err(e) => {
            log::error!("Failed to load live incidents to recheck: {}", e);
            return;
        }
    };

    let mut loaded: Option<(i64, Vec<LiveProbeSlice>)> = None;
    let (mut removed, mut lowered) = (0, 0);
    for incident in stored {
        if loaded
            .as_ref()
            .is_none_or(|(id, _)| *id != incident.session_id)
        {
            match probes.get_slices_for_session(incident.session_id).await {
                Ok(slices) => loaded = Some((incident.session_id, slices)),
                Err(e) => {
                    log::error!(
                        "Failed to load probes of session {}: {}",
                        incident.session_id,
                        e
                    );
                    loaded = None;
                    continue;
                }
            }
        }
        let slices = loaded.as_ref().map(|(_, slices)| slices.as_slice());
        match recheck(&incident, slices.unwrap_or_default()) {
            None => {}
            Some(Recheck::Remove) => match incidents.delete(incident.id).await {
                Ok(()) => removed += 1,
                Err(e) => log::error!("Failed to remove live incident {}: {}", incident.id, e),
            },
            Some(Recheck::Downgrade(lower)) => match incidents.update(&lower).await {
                Ok(()) => lowered += 1,
                Err(e) => log::error!("Failed to update live incident {}: {}", incident.id, e),
            },
        }
    }

    if removed + lowered > 0 {
        log::info!(
            "Rechecked live incidents: {} removed, {} kept without the probe loss",
            removed,
            lowered
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::insights::PingBasis;
    use crate::models::severity::Severity;
    use chrono::{SecondsFormat, TimeZone};

    const SERVER: &str = "185.40.64.1";

    fn at(sec: i64) -> String {
        (Utc.with_ymd_and_hms(2026, 10, 10, 14, 50, 0).unwrap() + Duration::seconds(sec))
            .to_rfc3339_opts(SecondsFormat::Millis, true)
    }

    fn incident(cause: IncidentCause) -> MatchIncident {
        MatchIncident {
            id: 1,
            session_id: 196,
            server_ip: SERVER.to_string(),
            server_port: 7295,
            match_started_at: at(-960),
            started_at: "2026-10-10T14:58:04.130Z".to_string(),
            ended_at: Some("2026-10-10T14:58:25.269Z".to_string()),
            status: Severity::Watch,
            cause: Some(cause),
            basis: PingBasis {
                source: PingSource::Floor,
                at_destination: false,
                measured_hop: Some(5),
                measured_asn: None,
                server_ip: None,
            },
            at_least: true,
            ping_ms: Some(6.75),
            usual_ms: None,
            loss_pct: Some(0.0),
            jitter_ms: Some(14.56),
            zone: Some(FaultZone::Isp),
            after_hop: Some(2),
            at_hop: Some(5),
            asn: Some(15557),
            operator: Some("SFR".to_string()),
        }
    }

    fn slice(source: PingSource, sec: i64, received: i64, jitter: f64) -> LiveProbeSlice {
        LiveProbeSlice {
            session_id: 196,
            source,
            started_at: at(sec),
            address: "gamelift-ping.eu-west-3.api.aws".to_string(),
            host: None,
            ttl: None,
            server_ip: Some(SERVER.to_string()),
            reply_ip: None,
            at_destination: true,
            region: Some("Paris".to_string()),
            provider: None,
            sent: 10,
            received,
            rtt_min: Some(2.8),
            rtt_median: Some(4.8),
            rtt_max: Some(7.2),
            jitter_ms: Some(jitter),
        }
    }

    fn beacon(jitter: impl Fn(i64) -> f64, received: impl Fn(i64) -> i64) -> Vec<LiveProbeSlice> {
        (0..60)
            .map(|i| i * 10)
            .map(|sec| slice(PingSource::Region, sec, received(sec), jitter(sec)))
            .collect()
    }

    #[test]
    fn a_router_incident_the_beacon_saw_clean_is_cleared() {
        let calm = beacon(|_| 1.5, |_| 10);
        assert!(cleared_by_beacon(&incident(IncidentCause::Jitter), &calm));
        assert!(cleared_by_beacon(&incident(IncidentCause::Loss), &calm));

        let mut late = incident(IncidentCause::Jitter);
        late.ended_at = Some(at(700));
        assert!(!cleared_by_beacon(&late, &calm));
        assert!(!cleared_by_beacon(&incident(IncidentCause::Jitter), &[]));
    }

    #[test]
    fn a_router_incident_the_beacon_confirms_or_cannot_judge_is_kept() {
        let jittery = beacon(|sec| if sec == 470 { 9.0 } else { 1.5 }, |_| 10);
        assert!(!cleared_by_beacon(
            &incident(IncidentCause::Jitter),
            &jittery
        ));

        let lossy = beacon(|_| 1.5, |sec| if sec % 30 == 0 { 9 } else { 10 });
        assert!(cleared_by_beacon(&incident(IncidentCause::Jitter), &lossy));
        assert!(!cleared_by_beacon(&incident(IncidentCause::Loss), &lossy));

        let gap: Vec<LiveProbeSlice> = beacon(|_| 1.5, |_| 10)
            .into_iter()
            .filter(|slice| slice.started_at != at(480))
            .collect();
        assert!(!cleared_by_beacon(&incident(IncidentCause::Jitter), &gap));

        let calm = beacon(|_| 1.5, |_| 10);
        assert!(!cleared_by_beacon(&incident(IncidentCause::Latency), &calm));
        let mut transit = incident(IncidentCause::Jitter);
        transit.zone = Some(FaultZone::Transit);
        assert!(!cleared_by_beacon(&transit, &calm));
        let mut home = incident(IncidentCause::Jitter);
        home.zone = Some(FaultZone::Home);
        assert!(!cleared_by_beacon(&home, &calm));
        let mut server = incident(IncidentCause::Jitter);
        server.basis.at_destination = true;
        assert!(!cleared_by_beacon(&server, &calm));

        assert_eq!(
            recheck(&incident(IncidentCause::Loss), &calm),
            Some(Recheck::Remove)
        );
        assert_eq!(recheck(&incident(IncidentCause::Loss), &lossy), None);

        let floor_only: Vec<LiveProbeSlice> = calm
            .iter()
            .cloned()
            .map(|slice| LiveProbeSlice {
                source: PingSource::Floor,
                ..slice
            })
            .collect();
        assert!(!cleared_by_beacon(
            &incident(IncidentCause::Jitter),
            &floor_only
        ));
    }

    fn home_loss() -> MatchIncident {
        MatchIncident {
            status: Severity::Critical,
            ping_ms: Some(22.68),
            loss_pct: Some(8.62),
            jitter_ms: Some(13.62),
            zone: Some(FaultZone::Home),
            after_hop: None,
            at_hop: Some(2),
            asn: None,
            operator: None,
            ..incident(IncidentCause::Loss)
        }
    }

    fn loaded(
        gateway_lost: impl Fn(i64) -> i64,
        floor_lost: impl Fn(i64) -> i64,
        beacon_lost: impl Fn(i64) -> i64,
    ) -> Vec<LiveProbeSlice> {
        (0..60)
            .map(|i| i * 10)
            .flat_map(|sec| {
                let gateway = LiveProbeSlice {
                    address: "192.168.1.1".to_string(),
                    ..slice(PingSource::Gateway, sec, 10 - gateway_lost(sec), 1.0)
                };
                let floor = LiveProbeSlice {
                    address: SERVER.to_string(),
                    ttl: Some(5),
                    at_destination: false,
                    ..slice(PingSource::Floor, sec, 10 - floor_lost(sec), 9.0)
                };
                [
                    gateway,
                    floor,
                    slice(PingSource::Region, sec, 10 - beacon_lost(sec), 9.0),
                ]
            })
            .collect()
    }

    fn pc_drops(sec: i64) -> i64 {
        [0, 1, 2, 1][(sec / 10 % 4) as usize]
    }

    #[test]
    fn a_home_loss_the_beacon_did_not_see_keeps_only_its_jitter() {
        let slices = loaded(pc_drops, |sec| pc_drops(sec) + i64::from(sec == 400), |_| 0);
        let Some(Recheck::Downgrade(lower)) = recheck(&home_loss(), &slices) else {
            panic!("the probe loss should be dropped");
        };
        assert_eq!(lower.status, Severity::Watch);
        assert_eq!(lower.cause, Some(IncidentCause::Jitter));
        assert_eq!(
            MatchIncident {
                status: Severity::Critical,
                cause: Some(IncidentCause::Loss),
                ..(*lower).clone()
            },
            home_loss()
        );
        assert_eq!(recheck(&lower, &slices), None);

        let calm = MatchIncident {
            jitter_ms: Some(3.0),
            ..home_loss()
        };
        assert_eq!(recheck(&calm, &slices), Some(Recheck::Remove));

        let slower = MatchIncident {
            usual_ms: Some(2.0),
            ..calm
        };
        let Some(Recheck::Downgrade(lower)) = recheck(&slower, &slices) else {
            panic!("the latency should stay");
        };
        assert_eq!(lower.cause, Some(IncidentCause::Latency));
    }

    #[test]
    fn a_home_loss_the_beacon_saw_or_could_not_judge_is_kept() {
        let seen = loaded(pc_drops, pc_drops, pc_drops);
        assert_eq!(recheck(&home_loss(), &seen), None);

        let beyond = loaded(pc_drops, |sec| pc_drops(sec) + 1, |_| 0);
        assert_eq!(recheck(&home_loss(), &beyond), None);

        let gap: Vec<LiveProbeSlice> = loaded(pc_drops, pc_drops, |_| 0)
            .into_iter()
            .filter(|slice| !(slice.source == PingSource::Gateway && slice.started_at == at(420)))
            .collect();
        assert_eq!(recheck(&home_loss(), &gap), None);

        let other_floor: Vec<LiveProbeSlice> = loaded(pc_drops, pc_drops, |_| 0)
            .into_iter()
            .map(|slice| LiveProbeSlice {
                ttl: slice.ttl.map(|ttl| ttl + 1),
                ..slice
            })
            .collect();
        assert_eq!(recheck(&home_loss(), &other_floor), None);

        let clean = loaded(pc_drops, pc_drops, |_| 0);
        let jitter = MatchIncident {
            cause: Some(IncidentCause::Jitter),
            ..home_loss()
        };
        assert_eq!(recheck(&jitter, &clean), None);
    }
}

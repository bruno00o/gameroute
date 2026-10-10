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
use crate::services::severity::{jitter_status, loss_status};
use chrono::{DateTime, Duration, Utc};
use std::collections::BTreeMap;

fn utc(timestamp: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(timestamp)
        .ok()
        .map(|at| at.with_timezone(&Utc))
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
    let Some((start, end)) =
        utc(&incident.started_at).zip(incident.ended_at.as_deref().and_then(utc))
    else {
        return false;
    };
    let from = slice_start(start - Duration::seconds(lookback));

    let mut beacon: BTreeMap<DateTime<Utc>, Vec<&LiveProbeSlice>> = BTreeMap::new();
    for slice in slices.iter().filter(|slice| {
        slice.source == PingSource::Region
            && slice.session_id == incident.session_id
            && slice.server_ip.as_deref() == Some(incident.server_ip.as_str())
    }) {
        if let Some(at) = utc(&slice.started_at).filter(|at| *at >= from && *at < end) {
            beacon.entry(at).or_default().push(slice);
        }
    }

    let mut slot = from;
    while slot < end {
        let answered = beacon.get(&slot).is_some_and(|slices| {
            slices
                .iter()
                .all(|slice| slice.sent > 0 && slice.received * 2 >= slice.sent)
        });
        if !answered {
            return false;
        }
        slot += Duration::seconds(LIVE_PROBE_SLICE_SECS);
    }

    let covered = beacon.values().flatten();
    match incident.cause {
        Some(IncidentCause::Jitter) => covered
            .into_iter()
            .all(|slice| slice.jitter_ms.is_some_and(|j| jitter_status(j).is_none())),
        _ => {
            let (sent, lost) = covered.fold((0, 0), |(sent, lost), slice| {
                (sent + slice.sent, lost + slice.sent - slice.received)
            });
            sent >= i64::from(LIVE_STATUS_MIN_PROBES)
                && loss_floor_pct(lost, sent).is_some_and(|loss| loss_status(loss).is_none())
        }
    }
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
    let mut removed = 0;
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
        if !cleared_by_beacon(&incident, slices.unwrap_or_default()) {
            continue;
        }
        match incidents.delete(incident.id).await {
            Ok(()) => removed += 1,
            Err(e) => log::error!("Failed to remove live incident {}: {}", incident.id, e),
        }
    }

    if removed > 0 {
        log::info!(
            "Rechecked live incidents: {} answered only by the last router",
            removed
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
}

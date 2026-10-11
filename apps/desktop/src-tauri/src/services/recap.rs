use crate::config::LIVE_PROBE_SLICE_SECS;
use crate::models::game_ping::GamePingSample;
use crate::models::insights::{PingBasis, PingSource};
use crate::models::ip_period::IpPeriod;
use crate::models::live_probe::LiveProbeSlice;
use crate::models::live_status::{LivePoint, MatchIncident};
use crate::models::recap::{MatchRecap, RecapPeak, RecapPoint, TimelineCell};
use crate::models::severity::Severity;
use crate::services::live_probe::attach::floor_basis;
use crate::services::live_probe::stats::span;
use crate::services::live_status::machine::gateway_basis;
use crate::services::matches::{game_samples_at, median};
use crate::services::severity::rank;
use crate::services::usual::game_basis;
use chrono::{DateTime, Duration, Utc};

pub const RECAP_BUCKET_SECS: i64 = 30;

const PROBE_POINTS: [(LivePoint, PingSource); 3] = [
    (LivePoint::Gateway, PingSource::Gateway),
    (LivePoint::IspEdge, PingSource::IspEdge),
    (LivePoint::Floor, PingSource::Floor),
];

fn utc(timestamp: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(timestamp)
        .ok()
        .map(|at| at.with_timezone(&Utc))
}

fn round(value: f64) -> f64 {
    (value * 10.0).round() / 10.0
}

fn peak<'a, T>(
    items: impl IntoIterator<Item = &'a T>,
    value: impl Fn(&T) -> Option<f64>,
    at: impl Fn(&T) -> &str,
) -> Option<RecapPeak>
where
    T: 'a,
{
    items
        .into_iter()
        .filter_map(|item| value(item).map(|value| (value, item)))
        .max_by(|a, b| a.0.total_cmp(&b.0))
        .map(|(value, item)| RecapPeak {
            value: round(value),
            at: at(item).to_string(),
        })
}

fn game_point(samples: &[&GamePingSample], server_ip: &str) -> Option<RecapPoint> {
    if samples.is_empty() {
        return None;
    }
    let sent: i64 = samples.iter().filter_map(|s| s.packets_sent).sum();
    let lost: i64 = samples.iter().filter_map(|s| s.packets_lost).sum();
    Some(RecapPoint {
        point: LivePoint::Game,
        basis: game_basis(server_ip),
        at_least: false,
        hop_ip: Some(server_ip.to_string()),
        sample_count: samples.len() as u32,
        sent,
        lost,
        loss_pct: (sent > 0).then(|| round(lost as f64 * 100.0 / sent as f64)),
        ping_ms: median(samples.iter().filter_map(|s| s.rtt_ms).collect()).map(round),
        jitter_ms: median(samples.iter().filter_map(|s| s.jitter_ms).collect()).map(round),
        jitter_peak: peak(
            samples.iter().copied(),
            |s| s.jitter_ms,
            |s| s.measured_at.as_str(),
        ),
        worst: peak(
            samples.iter().copied(),
            |s| s.rtt_ms,
            |s| s.measured_at.as_str(),
        ),
    })
}

fn probe_basis(
    point: LivePoint,
    last: &LiveProbeSlice,
    at_destination: bool,
    asn: Option<u32>,
) -> PingBasis {
    match point {
        LivePoint::Floor => floor_basis(last, at_destination, asn),
        LivePoint::Gateway => gateway_basis(),
        _ => PingBasis {
            source: PingSource::IspEdge,
            at_destination: false,
            measured_hop: last.ttl,
            measured_asn: asn,
            server_ip: None,
        },
    }
}

fn probe_point(
    point: LivePoint,
    slices: &[&LiveProbeSlice],
    asn_of: &impl Fn(&str) -> Option<u32>,
) -> Option<RecapPoint> {
    let total = span(slices)?;
    let answered: Vec<&&LiveProbeSlice> = slices.iter().filter(|s| s.received > 0).collect();
    let last = answered.last().map(|s| **s).or(slices.last().copied())?;
    let at_destination = point == LivePoint::Floor
        && !answered.is_empty()
        && answered.iter().all(|s| s.at_destination);
    let asn = last.reply_ip.as_deref().and_then(asn_of);
    let basis = probe_basis(point, last, at_destination, asn);
    Some(RecapPoint {
        point,
        at_least: point == LivePoint::Floor && !basis.at_destination,
        basis,
        hop_ip: last.reply_ip.clone(),
        sample_count: total.slice_count,
        sent: total.sent,
        lost: total.sent - total.received,
        loss_pct: total.loss_pct,
        ping_ms: total.ping_ms.map(round),
        jitter_ms: total.jitter_ms.map(round),
        jitter_peak: peak(
            slices.iter().copied(),
            |s| s.jitter_ms,
            |s| s.started_at.as_str(),
        ),
        worst: peak(
            slices.iter().copied(),
            |s| s.rtt_max,
            |s| s.started_at.as_str(),
        ),
    })
}

fn incident_span(
    incident: &MatchIncident,
    match_end: DateTime<Utc>,
) -> Option<(DateTime<Utc>, DateTime<Utc>)> {
    let from = utc(&incident.started_at)?;
    let to = incident
        .ended_at
        .as_deref()
        .and_then(utc)
        .unwrap_or(match_end)
        .max(from + Duration::seconds(1));
    Some((from, to))
}

fn match_incidents(
    period: &IpPeriod,
    incidents: &[MatchIncident],
    from: DateTime<Utc>,
    to: DateTime<Utc>,
) -> Vec<MatchIncident> {
    incidents
        .iter()
        .filter(|incident| incident.server_ip == period.ip && incident.server_port == period.port)
        .filter(|incident| {
            incident_span(incident, to).is_some_and(|(start, end)| start < to && end > from)
        })
        .map(|incident| MatchIncident {
            ended_at: incident
                .ended_at
                .clone()
                .or_else(|| Some(period.ended_at.clone())),
            ..incident.clone()
        })
        .collect()
}

struct CellData {
    primary: Vec<f64>,
    measured: bool,
}

fn timeline(
    start: DateTime<Utc>,
    end: DateTime<Utc>,
    primary: Option<LivePoint>,
    samples: &[&GamePingSample],
    slices: &[(PingSource, &LiveProbeSlice)],
    incidents: &[MatchIncident],
) -> Vec<TimelineCell> {
    let duration = (end - start).num_seconds().max(0);
    let count = ((duration + RECAP_BUCKET_SECS - 1) / RECAP_BUCKET_SECS).max(1) as usize;
    let index = |at: DateTime<Utc>| {
        let offset = (at - start).num_seconds().max(0);
        ((offset / RECAP_BUCKET_SECS) as usize).min(count - 1)
    };
    let mut cells: Vec<CellData> = (0..count)
        .map(|_| CellData {
            primary: Vec::new(),
            measured: false,
        })
        .collect();

    for sample in samples {
        if let Some(at) = sample.at() {
            let cell = &mut cells[index(at)];
            cell.measured = true;
            if primary == Some(LivePoint::Game) {
                cell.primary.extend(sample.rtt_ms);
            }
        }
    }
    for (source, slice) in slices {
        if let Some(at) = utc(&slice.started_at) {
            let cell = &mut cells[index(at)];
            cell.measured |= slice.sent > 0;
            if primary == Some(LivePoint::Floor) && *source == PingSource::Floor {
                cell.primary.extend(slice.rtt_median);
            }
        }
    }

    let spans: Vec<(DateTime<Utc>, DateTime<Utc>, Severity)> = incidents
        .iter()
        .filter_map(|incident| {
            incident_span(incident, end).map(|(from, to)| (from, to, incident.status))
        })
        .collect();

    cells
        .into_iter()
        .enumerate()
        .map(|(i, cell)| {
            let offset_secs = i as i64 * RECAP_BUCKET_SECS;
            let from = start + Duration::seconds(offset_secs);
            let to = from + Duration::seconds(RECAP_BUCKET_SECS);
            let worst = spans
                .iter()
                .filter(|(a, b, _)| *a < to && *b > from)
                .map(|(_, _, status)| *status)
                .max_by_key(|status| rank(*status));
            let status = match worst {
                Some(status) => status,
                None if cell.measured => Severity::Ok,
                None => Severity::Unmeasured,
            };
            TimelineCell {
                offset_secs,
                status,
                ping_ms: median(cell.primary).map(round),
            }
        })
        .collect()
}

pub struct RecapInput<'a> {
    pub session_id: i64,
    pub period: &'a IpPeriod,
    pub pings: &'a [GamePingSample],
    pub slices: &'a [LiveProbeSlice],
    pub incidents: &'a [MatchIncident],
}

pub fn build_recap(input: RecapInput, asn_of: impl Fn(&str) -> Option<u32>) -> Option<MatchRecap> {
    let period = input.period;
    let start = utc(&period.started_at)?;
    let end = utc(&period.ended_at)?.max(start);
    let margin = Duration::seconds(LIVE_PROBE_SLICE_SECS);

    let slices: Vec<(PingSource, &LiveProbeSlice)> = input
        .slices
        .iter()
        .filter(|slice| slice.server_ip.as_deref() == Some(period.ip.as_str()))
        .filter(|slice| {
            utc(&slice.started_at).is_some_and(|at| start - margin <= at && at <= end + margin)
        })
        .map(|slice| (slice.source, slice))
        .collect();
    let samples = game_samples_at(period, input.pings);

    let mut points: Vec<RecapPoint> = PROBE_POINTS
        .iter()
        .filter_map(|(point, source)| {
            let of_point: Vec<&LiveProbeSlice> = slices
                .iter()
                .filter(|(s, _)| s == source)
                .map(|(_, slice)| *slice)
                .collect();
            probe_point(*point, &of_point, &asn_of)
        })
        .collect();
    points.extend(game_point(&samples, &period.ip));

    let primary = [LivePoint::Game, LivePoint::Floor]
        .into_iter()
        .find(|wanted| points.iter().any(|p| p.point == *wanted));
    let incidents = match_incidents(period, input.incidents, start, end);
    let cells = timeline(start, end, primary, &samples, &slices, &incidents);

    Some(MatchRecap {
        session_id: input.session_id,
        period_id: period.id,
        server_ip: period.ip.clone(),
        server_port: period.port,
        started_at: period.started_at.clone(),
        ended_at: period.ended_at.clone(),
        duration_secs: (end - start).num_seconds(),
        bucket_secs: RECAP_BUCKET_SECS,
        primary,
        points,
        cells,
        incidents,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::live_probes::fixtures::floor_slice;
    use crate::models::insights::IncidentCause;
    use crate::models::live_status::FaultZone;
    use chrono::{SecondsFormat, TimeZone};

    const RIOT: &str = "162.249.72.5";

    fn at(sec: i64) -> String {
        (Utc.with_ymd_and_hms(2026, 10, 8, 20, 0, 0).unwrap() + Duration::seconds(sec))
            .to_rfc3339_opts(SecondsFormat::Millis, true)
    }

    fn period(duration: i64) -> IpPeriod {
        IpPeriod {
            id: 7,
            session_id: 1,
            ip: RIOT.to_string(),
            protocol: "UDP".to_string(),
            port: 7220,
            started_at: at(0),
            ended_at: at(duration),
            packet_count: 5000,
            is_game_server: true,
            flow_kind: None,
        }
    }

    fn slice(source: PingSource, sec: i64, median: f64, received: i64) -> LiveProbeSlice {
        LiveProbeSlice {
            source,
            ..floor_slice(1, &at(sec), median, received)
        }
    }

    fn reported(sec: i64, rtt: f64, jitter: f64, lost: i64) -> GamePingSample {
        let mut sample = GamePingSample::new(PingSource::Game, utc(&at(sec)).unwrap());
        sample.session_id = 1;
        sample.peer_ip = Some(RIOT.to_string());
        sample.peer_port = Some(7220);
        sample.rtt_ms = Some(rtt);
        sample.jitter_ms = Some(jitter);
        sample.packets_lost = Some(lost);
        sample.packets_sent = Some(200);
        sample
    }

    fn incident(from: i64, to: Option<i64>, status: Severity) -> MatchIncident {
        MatchIncident {
            id: 1,
            session_id: 1,
            server_ip: RIOT.to_string(),
            server_port: 7220,
            match_started_at: at(0),
            started_at: at(from),
            ended_at: to.map(at),
            status,
            cause: Some(IncidentCause::Loss),
            basis: PingBasis {
                source: PingSource::Floor,
                at_destination: false,
                measured_hop: Some(5),
                measured_asn: None,
                server_ip: None,
            },
            at_least: true,
            ping_ms: None,
            usual_ms: None,
            loss_pct: Some(4.0),
            jitter_ms: None,
            zone: Some(FaultZone::Isp),
            after_hop: None,
            at_hop: Some(5),
            asn: None,
            operator: None,
        }
    }

    fn recap(
        duration: i64,
        pings: &[GamePingSample],
        slices: &[LiveProbeSlice],
        incidents: &[MatchIncident],
    ) -> MatchRecap {
        let period = period(duration);
        build_recap(
            RecapInput {
                session_id: 1,
                period: &period,
                pings,
                slices,
                incidents,
            },
            |ip| (ip == "194.6.150.68").then_some(15557),
        )
        .unwrap()
    }

    fn point(recap: &MatchRecap, wanted: LivePoint) -> &RecapPoint {
        recap.points.iter().find(|p| p.point == wanted).unwrap()
    }

    #[test]
    fn the_game_ping_leads_and_the_probes_give_their_own_points() {
        let pings = [
            reported(10, 13.0, 1.0, 0),
            reported(20, 14.0, 2.0, 1),
            reported(40, 52.0, 9.4, 0),
        ];
        let slices = [
            slice(PingSource::Floor, 10, 4.6, 10),
            slice(PingSource::Floor, 20, 4.8, 8),
            slice(PingSource::Gateway, 10, 0.6, 10),
        ];

        let recap = recap(60, &pings, &slices, &[]);

        assert_eq!(recap.primary, Some(LivePoint::Game));
        let order: Vec<LivePoint> = recap.points.iter().map(|p| p.point).collect();
        assert_eq!(
            order,
            vec![LivePoint::Gateway, LivePoint::Floor, LivePoint::Game]
        );

        let game = point(&recap, LivePoint::Game);
        assert_eq!(game.basis.source, PingSource::Game);
        assert!(game.basis.at_destination);
        assert!(!game.at_least);
        assert_eq!(game.sample_count, 3);
        assert_eq!(game.ping_ms, Some(14.0));
        assert_eq!(game.jitter_ms, Some(2.0));
        assert_eq!((game.sent, game.lost), (600, 1));
        assert_eq!(game.loss_pct, Some(0.2));
        assert_eq!(
            game.worst,
            Some(RecapPeak {
                value: 52.0,
                at: at(40)
            })
        );
        assert_eq!(game.jitter_peak.as_ref().map(|p| p.value), Some(9.4));

        let floor = point(&recap, LivePoint::Floor);
        assert!(floor.at_least);
        assert_eq!(floor.basis.measured_hop, Some(5));
        assert_eq!(floor.basis.measured_asn, Some(15557));
        assert_eq!(floor.hop_ip.as_deref(), Some("194.6.150.68"));
        assert_eq!((floor.sent, floor.lost), (20, 2));
        assert_eq!(floor.loss_pct, Some(10.0));
        assert_eq!(floor.ping_ms, Some(4.7));
        assert_eq!(floor.worst.as_ref().map(|p| p.value), Some(5.8));

        let gateway = point(&recap, LivePoint::Gateway);
        assert!(!gateway.at_least);
        assert_eq!(gateway.basis.source, PingSource::Gateway);
    }

    #[test]
    fn without_the_game_the_floor_leads_and_is_a_lower_bound() {
        let slices = [slice(PingSource::Floor, 0, 4.6, 10)];

        let recap = recap(30, &[], &slices, &[]);

        assert_eq!(recap.primary, Some(LivePoint::Floor));
        assert_eq!(recap.cells.len(), 1);
        assert_eq!(recap.cells[0].ping_ms, Some(4.6));
        assert!(point(&recap, LivePoint::Floor).at_least);
    }

    #[test]
    fn a_floor_that_reached_the_server_is_not_a_lower_bound() {
        let slices = [LiveProbeSlice {
            at_destination: true,
            ttl: None,
            reply_ip: Some(RIOT.to_string()),
            ..slice(PingSource::Floor, 0, 12.0, 10)
        }];

        let recap = recap(30, &[], &slices, &[]);

        let floor = point(&recap, LivePoint::Floor);
        assert!(!floor.at_least);
        assert!(floor.basis.at_destination);
        assert_eq!(floor.basis.server_ip.as_deref(), Some(RIOT));
    }

    #[test]
    fn a_match_without_any_measure_has_no_points_and_only_unmeasured_cells() {
        let recap = recap(95, &[], &[], &[]);

        assert_eq!(recap.primary, None);
        assert!(recap.points.is_empty());
        assert_eq!(recap.cells.len(), 4);
        assert!(recap.cells.iter().all(|c| c.status == Severity::Unmeasured));
        assert_eq!(recap.duration_secs, 95);
        assert_eq!(recap.bucket_secs, 30);
    }

    #[test]
    fn cells_are_grey_unless_an_incident_crosses_them() {
        let slices: Vec<LiveProbeSlice> = (0..12)
            .map(|i| slice(PingSource::Floor, i * 10, 4.6, 10))
            .collect();
        let incidents = [incident(45, Some(70), Severity::Degraded)];

        let recap = recap(120, &[], &slices, &incidents);

        let statuses: Vec<Severity> = recap.cells.iter().map(|c| c.status).collect();
        assert_eq!(
            statuses,
            vec![
                Severity::Ok,
                Severity::Degraded,
                Severity::Degraded,
                Severity::Ok
            ]
        );
    }

    #[test]
    fn the_worst_incident_colours_a_shared_cell() {
        let slices = [slice(PingSource::Floor, 0, 4.6, 10)];
        let incidents = [
            incident(2, Some(10), Severity::Watch),
            incident(12, Some(20), Severity::Critical),
        ];

        let recap = recap(30, &[], &slices, &incidents);

        assert_eq!(recap.cells[0].status, Severity::Critical);
    }

    #[test]
    fn an_open_incident_ends_with_the_match_and_foreign_ones_are_left_out() {
        let slices = [slice(PingSource::Floor, 0, 4.6, 10)];
        let foreign = MatchIncident {
            server_ip: "162.249.72.9".to_string(),
            ..incident(0, Some(10), Severity::Critical)
        };
        let before = incident(-300, Some(-200), Severity::Critical);
        let incidents = [incident(40, None, Severity::Watch), foreign, before];

        let recap = recap(90, &[], &slices, &incidents);

        assert_eq!(recap.incidents.len(), 1);
        assert_eq!(recap.incidents[0].ended_at, Some(at(90)));
        assert_eq!(recap.cells[1].status, Severity::Watch);
        assert_eq!(recap.cells[2].status, Severity::Watch);
    }

    #[test]
    fn samples_outside_the_match_do_not_count() {
        let pings = [
            reported(10, 13.0, 1.0, 0),
            reported(2000, 90.0, 1.0, 0),
            GamePingSample {
                peer_port: Some(7999),
                ..reported(10, 80.0, 1.0, 0)
            },
        ];
        let slices = [
            slice(PingSource::Floor, 3000, 40.0, 10),
            LiveProbeSlice {
                server_ip: Some("162.249.72.9".to_string()),
                ..slice(PingSource::Floor, 10, 90.0, 10)
            },
        ];

        let recap = recap(60, &pings, &slices, &[]);

        assert_eq!(recap.points.len(), 1);
        assert_eq!(point(&recap, LivePoint::Game).ping_ms, Some(13.0));
        assert_eq!(recap.cells[0].ping_ms, Some(13.0));
    }

    #[test]
    fn lost_probes_never_become_a_zero_ping() {
        let slices = [LiveProbeSlice {
            received: 0,
            rtt_min: None,
            rtt_median: None,
            rtt_max: None,
            jitter_ms: None,
            ..slice(PingSource::Floor, 0, 0.0, 0)
        }];

        let recap = recap(30, &[], &slices, &[]);

        let floor = point(&recap, LivePoint::Floor);
        assert_eq!(floor.ping_ms, None);
        assert_eq!(floor.worst, None);
        assert_eq!(floor.loss_pct, Some(100.0));
        assert_eq!(recap.cells[0].ping_ms, None);
        assert_eq!(recap.cells[0].status, Severity::Ok);
    }
}

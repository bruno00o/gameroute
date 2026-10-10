use crate::config::{
    LAST_HOP_JUMP_MS, SEVERITY_JITTER_MS, SEVERITY_LOSS_PCT, SEVERITY_OVER_BASELINE_MS,
    SEVERITY_RTT_MS,
};
use crate::models::hop::ProbedHop;
pub use crate::models::severity::{Severity, SeverityThreshold, SeverityThresholds};
use crate::models::traceroute_record::TracerouteWithHops;
use crate::services::traceroute::persistent_loss_onset;

const LEVELS: [Severity; 3] = [Severity::Watch, Severity::Degraded, Severity::Critical];

#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub struct Measurement {
    pub rtt_ms: Option<f64>,
    pub baseline_ms: Option<f64>,
    pub jitter_ms: Option<f64>,
    pub loss_pct: Option<f64>,
}

fn level(value: f64, steps: &[f64; 3]) -> Option<usize> {
    steps.iter().rposition(|&step| value >= step)
}

pub fn thresholds() -> SeverityThresholds {
    let at = |i: usize| SeverityThreshold {
        loss_pct: SEVERITY_LOSS_PCT[i],
        jitter_ms: SEVERITY_JITTER_MS[i],
        over_baseline_ms: SEVERITY_OVER_BASELINE_MS[i],
        rtt_ms: SEVERITY_RTT_MS[i],
    };
    SeverityThresholds {
        watch: at(0),
        degraded: at(1),
        critical: at(2),
    }
}

pub fn severity(m: &Measurement) -> Severity {
    let Some(rtt) = m.rtt_ms else {
        return Severity::Unmeasured;
    };
    let latency = match m.baseline_ms {
        Some(baseline) => level(rtt - baseline, &SEVERITY_OVER_BASELINE_MS),
        None => level(rtt, &SEVERITY_RTT_MS),
    };
    let loss = m.loss_pct.and_then(|loss| level(loss, &SEVERITY_LOSS_PCT));
    let jitter = m
        .jitter_ms
        .and_then(|jitter| level(jitter, &SEVERITY_JITTER_MS));

    [latency, loss, jitter]
        .into_iter()
        .flatten()
        .max()
        .map_or(Severity::Ok, |i| LEVELS[i])
}

pub fn loss_status(loss_pct: f64) -> Option<Severity> {
    level(loss_pct, &SEVERITY_LOSS_PCT).map(|i| LEVELS[i])
}

pub fn jitter_status(jitter_ms: f64) -> Option<Severity> {
    level(jitter_ms, &SEVERITY_JITTER_MS).map(|i| LEVELS[i])
}

pub fn latency_status(over_baseline_ms: f64) -> Option<Severity> {
    level(over_baseline_ms, &SEVERITY_OVER_BASELINE_MS).map(|i| LEVELS[i])
}

pub fn rank(status: Severity) -> u8 {
    match status {
        Severity::Unmeasured => 0,
        Severity::Ok => 1,
        Severity::Watch => 2,
        Severity::Degraded => 3,
        Severity::Critical => 4,
    }
}

pub fn answers_late<H: ProbedHop>(hop: &H, previous: &H) -> bool {
    let (Some(rtt), Some((fastest, _)), Some(floor)) =
        (hop.rtt_avg(), hop.rtt_range(), previous.rtt_avg())
    else {
        return false;
    };
    rtt - floor >= LAST_HOP_JUMP_MS && fastest - floor < LAST_HOP_JUMP_MS
}

pub fn late_last_hop<H: ProbedHop>(hops: &[H], target_ip: &str) -> Option<(usize, usize)> {
    let mut answered = (0..hops.len()).rev().filter(|&i| hops[i].responded());
    let last = answered.next()?;
    let previous = answered.next()?;
    (hops[last].ip() != Some(target_ip) && answers_late(&hops[last], &hops[previous]))
        .then_some((last, previous))
}

pub fn measured_hop<'a, H: ProbedHop>(hops: &'a [H], target_ip: &str) -> Option<&'a H> {
    match late_last_hop(hops, target_ip) {
        Some((_, previous)) => Some(&hops[previous]),
        None => hops.iter().rev().find(|hop| hop.responded()),
    }
}

pub fn route_status<H: ProbedHop>(hops: &[H], target_ip: &str) -> Severity {
    let Some(last) = measured_hop(hops, target_ip) else {
        return Severity::Unmeasured;
    };
    let loss_persists = persistent_loss_onset(hops, target_ip).is_some();

    severity(&Measurement {
        rtt_ms: last.rtt_avg(),
        loss_pct: loss_persists.then(|| last.loss_pct()),
        ..Measurement::default()
    })
}

pub fn assess_traceroute(traceroute: &mut TracerouteWithHops) {
    traceroute.status = route_status(&traceroute.hops, &traceroute.target_ip);
    let onset = persistent_loss_onset(&traceroute.hops, &traceroute.target_ip);

    for (i, hop) in traceroute.hops.iter_mut().enumerate() {
        let persistent = onset.is_some_and(|start| i >= start) && hop.responded();
        hop.loss_status = if persistent {
            loss_status(hop.loss_pct())
        } else {
            None
        };
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::session::DbHop;
    use crate::models::HopResult;

    fn rtt(rtt_ms: f64) -> Measurement {
        Measurement {
            rtt_ms: Some(rtt_ms),
            ..Measurement::default()
        }
    }

    fn assert_levels(cases: &[(f64, Severity)], measure: impl Fn(f64) -> Measurement) {
        for &(value, expected) in cases {
            assert_eq!(severity(&measure(value)), expected, "value {value}");
        }
    }

    #[test]
    fn absolute_latency_boundaries() {
        assert_levels(
            &[
                (59.9, Severity::Ok),
                (60.0, Severity::Watch),
                (99.9, Severity::Watch),
                (100.0, Severity::Degraded),
                (149.9, Severity::Degraded),
                (150.0, Severity::Critical),
            ],
            rtt,
        );
    }

    #[test]
    fn latency_over_baseline_boundaries() {
        assert_levels(
            &[
                (19.9, Severity::Ok),
                (20.0, Severity::Watch),
                (49.9, Severity::Watch),
                (50.0, Severity::Degraded),
                (99.9, Severity::Degraded),
                (100.0, Severity::Critical),
            ],
            |over| Measurement {
                rtt_ms: Some(150.0 + over),
                baseline_ms: Some(150.0),
                ..Measurement::default()
            },
        );
    }

    #[test]
    fn loss_boundaries() {
        assert_levels(
            &[
                (0.49, Severity::Ok),
                (0.5, Severity::Watch),
                (1.99, Severity::Watch),
                (2.0, Severity::Degraded),
                (4.99, Severity::Degraded),
                (5.0, Severity::Critical),
            ],
            |loss| Measurement {
                loss_pct: Some(loss),
                ..rtt(20.0)
            },
        );
    }

    #[test]
    fn jitter_boundaries() {
        assert_levels(
            &[
                (7.9, Severity::Ok),
                (8.0, Severity::Watch),
                (14.9, Severity::Watch),
                (15.0, Severity::Degraded),
                (29.9, Severity::Degraded),
                (30.0, Severity::Critical),
            ],
            |jitter| Measurement {
                jitter_ms: Some(jitter),
                ..rtt(20.0)
            },
        );
    }

    #[test]
    fn worst_criterion_wins() {
        let m = Measurement {
            rtt_ms: Some(65.0),
            jitter_ms: Some(16.0),
            loss_pct: Some(0.2),
            ..Measurement::default()
        };
        assert_eq!(severity(&m), Severity::Degraded);
    }

    #[test]
    fn baseline_replaces_absolute_latency_thresholds() {
        let m = Measurement {
            rtt_ms: Some(180.0),
            baseline_ms: Some(170.0),
            ..Measurement::default()
        };
        assert_eq!(severity(&m), Severity::Ok);
    }

    #[test]
    fn no_latency_is_unmeasured() {
        let m = Measurement {
            loss_pct: Some(100.0),
            ..Measurement::default()
        };
        assert_eq!(severity(&m), Severity::Unmeasured);
    }

    #[test]
    fn loss_status_has_no_status_below_watch() {
        assert_eq!(loss_status(0.0), None);
        assert_eq!(loss_status(0.49), None);
        assert_eq!(loss_status(0.5), Some(Severity::Watch));
        assert_eq!(loss_status(2.0), Some(Severity::Degraded));
        assert_eq!(loss_status(5.0), Some(Severity::Critical));
        assert_eq!(loss_status(f64::NAN), None);
    }

    #[test]
    fn jitter_and_latency_statuses_use_the_same_steps() {
        assert_eq!(jitter_status(7.9), None);
        assert_eq!(jitter_status(15.0), Some(Severity::Degraded));
        assert_eq!(latency_status(19.9), None);
        assert_eq!(latency_status(100.0), Some(Severity::Critical));
        assert!(rank(Severity::Unmeasured) < rank(Severity::Ok));
        assert!(rank(Severity::Degraded) < rank(Severity::Critical));
    }

    #[test]
    fn thresholds_follow_config_order() {
        let t = thresholds();
        assert_eq!(t.watch.rtt_ms, 60.0);
        assert_eq!(t.degraded.loss_pct, 2.0);
        assert_eq!(t.critical.jitter_ms, 30.0);
        assert_eq!(t.critical.over_baseline_ms, 100.0);
    }

    const TARGET: &str = "162.249.72.5";

    fn hop(ttl: u32, ip: &str, rtt: f64, lost: usize, sent: usize) -> HopResult {
        let mut probes = vec![Some(rtt); sent - lost];
        probes.resize(sent, None);
        HopResult::new(ttl, Some(ip.to_string()), None, probes)
    }

    #[test]
    fn rate_limited_routers_do_not_count() {
        let hops = vec![
            hop(1, "192.168.1.254", 0.5, 2, 3),
            hop(2, "10.0.0.1", 3.0, 1, 3),
            HopResult::timeout(3, 3),
            hop(4, TARGET, 12.0, 0, 3),
        ];
        assert_eq!(route_status(&hops, TARGET), Severity::Ok);
    }

    #[test]
    fn persistent_loss_reaches_the_status() {
        let hops = vec![
            hop(1, "192.168.1.254", 0.5, 0, 10),
            hop(2, "87.245.1.1", 5.0, 3, 10),
            hop(3, TARGET, 12.0, 3, 10),
        ];
        assert_eq!(route_status(&hops, TARGET), Severity::Critical);
    }

    #[test]
    fn silent_destination_uses_last_responding_hop() {
        let hops = vec![
            hop(1, "192.168.1.254", 0.5, 0, 3),
            hop(2, "104.160.1.1", 75.0, 0, 3),
            HopResult::timeout(3, 3),
        ];
        assert_eq!(route_status(&hops, TARGET), Severity::Watch);
    }

    #[test]
    fn route_without_answer_is_unmeasured() {
        let hops = vec![HopResult::timeout(1, 3), HopResult::timeout(2, 3)];
        assert_eq!(route_status(&hops, TARGET), Severity::Unmeasured);
        assert_eq!(route_status::<HopResult>(&[], TARGET), Severity::Unmeasured);
    }

    fn db_hop(n: i32, ip: Option<&str>, rtt: Option<f64>, loss: f64) -> DbHop {
        DbHop {
            id: n as i64,
            traceroute_id: 1,
            hop_number: n,
            ip: ip.map(str::to_string),
            hostname: None,
            latency_min: rtt,
            latency_avg: rtt,
            latency_max: rtt,
            packet_loss: Some(loss),
            is_problem_hop: false,
            source: None,
            loss_status: None,
        }
    }

    fn ranged(n: i32, ip: &str, (min, avg, max): (f64, f64, f64)) -> DbHop {
        DbHop {
            latency_min: Some(min),
            latency_max: Some(max),
            ..db_hop(n, Some(ip), Some(avg), 0.0)
        }
    }

    fn late_sfr_router() -> Vec<DbHop> {
        vec![
            ranged(1, "10.0.10.1", (0.5, 0.5, 0.5)),
            ranged(2, "192.168.1.1", (0.5, 0.5, 0.5)),
            ranged(3, "10.153.10.245", (12.0, 12.7, 13.0)),
            ranged(4, "86.69.254.18", (3.0, 13.3, 32.0)),
            ranged(5, "194.6.150.68", (22.0, 44.0, 75.0)),
        ]
    }

    #[test]
    fn a_last_router_that_answers_late_falls_back_to_the_router_before() {
        let hops = late_sfr_router();

        let measured = measured_hop(&hops, TARGET).unwrap();
        assert_eq!(measured.hop_number, 4);
        assert_eq!(measured.latency_avg, Some(13.3));
        assert_eq!(late_last_hop(&hops, TARGET), Some((4, 3)));
    }

    #[test]
    fn a_jump_confirmed_by_the_fastest_probe_or_a_later_router_is_kept() {
        let mut steady = late_sfr_router();
        steady[4] = ranged(5, "194.6.150.68", (43.0, 44.0, 45.0));
        assert_eq!(measured_hop(&steady, TARGET).unwrap().hop_number, 5);

        let mut confirmed = late_sfr_router();
        confirmed.push(ranged(6, "194.6.150.70", (44.0, 45.0, 46.0)));
        assert_eq!(measured_hop(&confirmed, TARGET).unwrap().hop_number, 6);
        assert_eq!(late_last_hop(&confirmed, TARGET), None);

        let mut destination = late_sfr_router();
        destination[4].ip = Some(TARGET.to_string());
        assert_eq!(measured_hop(&destination, TARGET).unwrap().hop_number, 5);
    }

    #[test]
    fn assess_colours_loss_only_where_it_persists() {
        let mut traceroute = TracerouteWithHops {
            id: 1,
            session_id: 1,
            target_ip: TARGET.to_string(),
            started_at: "2026-10-08T20:00:00Z".to_string(),
            completed_at: None,
            problem_hop_index: Some(4),
            traceroute_method: None,
            hops: vec![
                db_hop(1, Some("192.168.1.254"), Some(0.5), 33.3),
                db_hop(2, Some("10.0.0.1"), Some(3.0), 0.0),
                db_hop(3, None, None, 100.0),
                db_hop(4, Some("87.245.1.1"), Some(5.0), 30.0),
                db_hop(5, Some(TARGET), Some(12.0), 20.0),
            ],
            status: Severity::default(),
            route: None,
        };

        assess_traceroute(&mut traceroute);

        let statuses: Vec<Option<Severity>> =
            traceroute.hops.iter().map(|h| h.loss_status).collect();
        assert_eq!(
            statuses,
            vec![
                None,
                None,
                None,
                Some(Severity::Critical),
                Some(Severity::Critical)
            ]
        );
        assert_eq!(traceroute.status, Severity::Critical);
    }
}

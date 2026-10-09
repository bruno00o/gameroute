use super::*;
use crate::models::insights::{PingBasis, PingSource, UsualPing};
use crate::models::live_status::{FaultZone, LiveFault, LiveReading};
use crate::models::settings::AlertSettings;
use crate::services::live_probe::stats::stamp;
use crate::services::live_status::machine::waiting;
use chrono::TimeZone;
use std::sync::{Arc, Mutex};

const STARTED: &str = "2026-10-08T20:00:00.000Z";

fn at(sec: i64) -> DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 10, 8, 20, 0, 0).unwrap() + Duration::seconds(sec)
}

#[derive(Default)]
struct Recorder {
    sent: Mutex<Vec<Alert>>,
    fail: bool,
}

struct Shared(Arc<Recorder>);

impl Notifier for Shared {
    fn notify(&self, alert: &Alert) -> Result<(), String> {
        self.0.sent.lock().unwrap().push(alert.clone());
        if self.0.fail {
            Err("toast refused".to_string())
        } else {
            Ok(())
        }
    }
}

fn service() -> (AlertService, Arc<Recorder>) {
    service_with(Recorder::default())
}

fn service_with(recorder: Recorder) -> (AlertService, Arc<Recorder>) {
    let recorder = Arc::new(recorder);
    (
        AlertService::new(Box::new(Shared(recorder.clone()))),
        recorder,
    )
}

fn count(recorder: &Recorder) -> usize {
    recorder.sent.lock().unwrap().len()
}

fn reading(point: LivePoint, at_destination: bool) -> LiveReading {
    LiveReading {
        point,
        basis: PingBasis {
            source: if point == LivePoint::Game {
                PingSource::Game
            } else {
                PingSource::Floor
            },
            at_destination,
            measured_hop: if at_destination { None } else { Some(5) },
            measured_asn: None,
            server_ip: None,
        },
        at_least: !at_destination,
        zone: None,
        hop: if at_destination { None } else { Some(5) },
        hop_ip: None,
        asn: None,
        operator: if at_destination {
            None
        } else {
            Some("SFR".to_string())
        },
        median_ms: Some(140.0),
        usual: UsualPing {
            median_ms: Some(40.0),
            sample_count: 30,
        },
        trace_ms: None,
        jitter_ms: Some(4.0),
        loss_pct: Some(6.0),
        loss_floor_pct: Some(4.0),
        lost: 6,
        sent: 100,
        sample_count: 100,
        status: Severity::Critical,
        cause: Some(IncidentCause::Loss),
        last_sample_at: stamp(at(0)),
        fresh: true,
    }
}

fn critical_since(sec: i64) -> LiveStatus {
    let mut status = waiting(1, "VALORANT", at(-60), at(0));
    status.state = LiveState::Live;
    status.status = Severity::Critical;
    status.status_since = Some(stamp(at(sec)));
    status.cause = Some(IncidentCause::Loss);
    status.match_started_at = Some(STARTED.to_string());
    status.primary = Some(reading(LivePoint::Floor, true));
    status.fault = Some(LiveFault {
        zone: FaultZone::Isp,
        zones: Vec::new(),
        cause: IncidentCause::Loss,
        after_point: None,
        after_hop: None,
        at_point: LivePoint::IspEdge,
        at_hop: Some(3),
        asn: Some(3215),
        operator: Some("SFR".to_string()),
    });
    status
}

fn on() -> AppSettings {
    AppSettings {
        locale: Some("fr".to_string()),
        ..AppSettings::default()
    }
}

#[test]
fn nothing_fires_before_thirty_seconds_of_critical() {
    let (alerts, recorder) = service();
    let status = critical_since(0);

    assert!(!alerts.observe(&status, &on(), at(1)));
    assert!(!alerts.observe(&status, &on(), at(29)));
    assert_eq!(count(&recorder), 0);

    assert!(alerts.observe(&status, &on(), at(30)));
    assert_eq!(count(&recorder), 1);
}

#[test]
fn an_isolated_spike_never_reaches_the_alert() {
    let (alerts, recorder) = service();
    let mut status = critical_since(0);
    status.status = Severity::Ok;
    status.status_since = Some(stamp(at(0)));

    for sec in 0..120 {
        alerts.observe(&status, &on(), at(sec));
    }
    assert_eq!(count(&recorder), 0);
}

#[test]
fn watch_and_degraded_never_notify() {
    let (alerts, recorder) = service();
    for severity in [Severity::Watch, Severity::Degraded, Severity::Ok] {
        let mut status = critical_since(0);
        status.status = severity;
        for sec in [30, 60, 600] {
            alerts.observe(&status, &on(), at(sec));
        }
    }
    assert_eq!(count(&recorder), 0);
}

#[test]
fn one_alert_per_match_however_long_it_stays_critical() {
    let (alerts, recorder) = service();
    let status = critical_since(0);

    for sec in 30..400 {
        alerts.observe(&status, &on(), at(sec));
    }
    assert_eq!(count(&recorder), 1);
}

#[test]
fn a_second_critical_run_in_the_same_match_stays_quiet() {
    let (alerts, recorder) = service();
    assert!(alerts.observe(&critical_since(0), &on(), at(31)));

    assert!(!alerts.observe(&critical_since(900), &on(), at(1000)));
    assert_eq!(count(&recorder), 1);
}

#[test]
fn the_cooldown_spaces_alerts_across_matches() {
    let (alerts, recorder) = service();
    assert!(alerts.observe(&critical_since(0), &on(), at(31)));

    let mut next = critical_since(100);
    next.match_started_at = Some("2026-10-08T20:01:00.000Z".to_string());
    assert!(!alerts.observe(&next, &on(), at(140)));
    assert!(!alerts.observe(&next, &on(), at(31 + ALERT_COOLDOWN_SECS - 1)));
    assert_eq!(count(&recorder), 1);

    assert!(alerts.observe(&next, &on(), at(31 + ALERT_COOLDOWN_SECS)));
    assert_eq!(count(&recorder), 2);
}

#[test]
fn a_new_session_is_a_new_match() {
    let (alerts, recorder) = service();
    assert!(alerts.observe(&critical_since(0), &on(), at(31)));

    let mut later = critical_since(ALERT_COOLDOWN_SECS + 100);
    later.session_id = 2;
    assert!(alerts.observe(&later, &on(), at(ALERT_COOLDOWN_SECS + 140)));
    assert_eq!(count(&recorder), 2);
}

#[test]
fn the_setting_switches_the_alert_off() {
    let (alerts, recorder) = service();
    let mut settings = on();
    settings.alerts = AlertSettings {
        critical_alert: false,
        ..settings.alerts
    };

    assert!(!alerts.observe(&critical_since(0), &settings, at(120)));
    assert_eq!(count(&recorder), 0);

    assert!(alerts.observe(&critical_since(0), &on(), at(121)));
    assert_eq!(count(&recorder), 1);
}

#[test]
fn do_not_disturb_silences_the_alert() {
    let (alerts, recorder) = service();
    let mut settings = on();
    settings.alerts.do_not_disturb = true;

    assert!(!alerts.observe(&critical_since(0), &settings, at(120)));
    assert_eq!(count(&recorder), 0);
}

#[test]
fn alerts_are_on_by_default() {
    let (alerts, recorder) = service();

    assert!(alerts.observe(&critical_since(0), &AppSettings::default(), at(30)));
    assert_eq!(count(&recorder), 1);
}

#[test]
fn a_frozen_or_measuring_match_does_not_alert() {
    let (alerts, recorder) = service();
    for state in [LiveState::Frozen, LiveState::Measuring, LiveState::Waiting] {
        let mut status = critical_since(0);
        status.state = state;
        assert!(!alerts.observe(&status, &on(), at(120)));
    }
    assert_eq!(count(&recorder), 0);
}

#[test]
fn a_status_without_a_start_or_a_match_does_not_alert() {
    let (alerts, recorder) = service();
    let mut no_since = critical_since(0);
    no_since.status_since = None;
    let mut no_match = critical_since(0);
    no_match.match_started_at = None;
    let mut bad_since = critical_since(0);
    bad_since.status_since = Some("not a date".to_string());

    for status in [no_since, no_match, bad_since] {
        assert!(!alerts.observe(&status, &on(), at(120)));
    }
    assert_eq!(count(&recorder), 0);
}

#[test]
fn an_alert_without_a_measure_to_quote_waits() {
    let (alerts, recorder) = service();
    let mut status = critical_since(0);
    status.primary = None;
    assert!(!alerts.observe(&status, &on(), at(60)));

    let mut status = critical_since(0);
    if let Some(primary) = status.primary.as_mut() {
        primary.loss_pct = None;
        primary.loss_floor_pct = None;
    }
    assert!(!alerts.observe(&status, &on(), at(60)));
    assert_eq!(count(&recorder), 0);

    assert!(alerts.observe(&critical_since(0), &on(), at(61)));
}

#[test]
fn switching_the_alert_on_mid_incident_still_fires_once() {
    let (alerts, recorder) = service();
    let mut off = on();
    off.alerts.critical_alert = false;
    let status = critical_since(0);

    for sec in 30..90 {
        alerts.observe(&status, &off, at(sec));
    }
    assert_eq!(count(&recorder), 0);

    assert!(alerts.observe(&status, &on(), at(90)));
    assert!(!alerts.observe(&status, &on(), at(91)));
    assert_eq!(count(&recorder), 1);
}

#[test]
fn a_refused_toast_is_not_retried_every_second() {
    let (alerts, recorder) = service_with(Recorder {
        fail: true,
        ..Recorder::default()
    });
    let status = critical_since(0);

    for sec in 30..60 {
        alerts.observe(&status, &on(), at(sec));
    }
    assert_eq!(count(&recorder), 1);
}

#[test]
fn the_toast_is_a_plain_title_and_body() {
    let (alerts, recorder) = service();
    alerts.observe(&critical_since(0), &on(), at(40));

    let sent = recorder.sent.lock().unwrap();
    let Alert { title, body } = sent[0].clone();
    assert_eq!(title, "Connexion critique depuis 40\u{a0}s");
    assert_eq!(
        body,
        "Perte 6\u{a0}% jusqu’au serveur. Ça commence chez votre FAI (SFR)."
    );
}

#[test]
fn the_text_follows_the_saved_language() {
    let (alerts, recorder) = service();
    let mut settings = on();
    settings.locale = Some("en".to_string());
    alerts.observe(&critical_since(0), &settings, at(45));

    let sent = recorder.sent.lock().unwrap();
    assert_eq!(sent[0].title, "Critical connection for 45\u{a0}s");
    assert_eq!(
        sent[0].body,
        "Loss 6% to the server. It starts at your ISP (SFR)."
    );
}

#[test]
fn a_ping_measured_at_a_hop_is_quoted_as_a_lower_bound() {
    let (alerts, recorder) = service();
    let mut status = critical_since(0);
    status.cause = Some(IncidentCause::Latency);
    status.primary = Some(LiveReading {
        cause: Some(IncidentCause::Latency),
        median_ms: Some(120.0),
        ..reading(LivePoint::Floor, false)
    });
    status.fault = None;

    alerts.observe(&status, &on(), at(35));

    let sent = recorder.sent.lock().unwrap();
    assert_eq!(
        sent[0].body,
        "Latence ≥ 120\u{a0}ms jusqu’au saut 5 (SFR) (habituel 40\u{a0}ms)."
    );
}

#[test]
fn a_game_measure_is_labelled() {
    let (alerts, recorder) = service();
    let mut status = critical_since(0);
    status.cause = Some(IncidentCause::Latency);
    status.primary = Some(LiveReading {
        cause: Some(IncidentCause::Latency),
        ..reading(LivePoint::Game, true)
    });
    status.fault = None;

    alerts.observe(&status, &on(), at(35));

    let sent = recorder.sent.lock().unwrap();
    assert_eq!(
        sent[0].body,
        "Latence 140\u{a0}ms (mesure du jeu) (habituel 40\u{a0}ms)."
    );
}

#[test]
fn a_loss_known_only_by_its_floor_is_quoted_as_a_lower_bound() {
    let (alerts, recorder) = service();
    let mut status = critical_since(0);
    if let Some(primary) = status.primary.as_mut() {
        primary.loss_pct = None;
        primary.loss_floor_pct = Some(5.0);
    }
    status.fault = None;

    alerts.observe(&status, &on(), at(35));

    let sent = recorder.sent.lock().unwrap();
    assert_eq!(sent[0].body, "Perte ≥ 5\u{a0}% jusqu’au serveur.");
}

use std::sync::{Mutex, PoisonError};

use chrono::{DateTime, Duration, Utc};
use tauri::{AppHandle, Manager};
use tauri_plugin_notification::NotificationExt;

use super::alert_text::{compose, AlertFacts, Locale, Place};
use super::app_settings::SettingsStore;
use super::usual::parse;
use crate::config::{ALERT_COOLDOWN_SECS, ALERT_CRITICAL_SECS};
use crate::models::insights::IncidentCause;
use crate::models::live_status::{LivePoint, LiveState, LiveStatus};
use crate::models::settings::AppSettings;
use crate::models::severity::Severity;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Alert {
    pub title: String,
    pub body: String,
}

pub trait Notifier: Send + Sync {
    fn notify(&self, alert: &Alert) -> Result<(), String>;
}

pub struct SystemNotifier {
    app: AppHandle,
}

impl SystemNotifier {
    pub fn new(app: AppHandle) -> Self {
        Self { app }
    }
}

impl Notifier for SystemNotifier {
    fn notify(&self, alert: &Alert) -> Result<(), String> {
        self.app
            .notification()
            .builder()
            .title(&alert.title)
            .body(&alert.body)
            .show()
            .map_err(|e| e.to_string())
    }
}

type MatchKey = (i64, String);

#[derive(Default)]
struct Memory {
    alerted: Option<MatchKey>,
    last_alert_at: Option<DateTime<Utc>>,
}

pub struct AlertService {
    memory: Mutex<Memory>,
    notifier: Box<dyn Notifier>,
}

impl AlertService {
    pub fn new(notifier: Box<dyn Notifier>) -> Self {
        Self {
            memory: Mutex::new(Memory::default()),
            notifier,
        }
    }

    pub fn observe(&self, status: &LiveStatus, settings: &AppSettings, now: DateTime<Utc>) -> bool {
        let alerts = &settings.alerts;
        if !alerts.critical_alert || alerts.do_not_disturb {
            return false;
        }
        let Some((key, seconds)) = critical_for(status, now) else {
            return false;
        };
        let locale = Locale::from_code(settings.locale.as_deref());
        let Some(alert) = alert_for(status, seconds, locale) else {
            return false;
        };
        {
            let mut memory = self.memory.lock().unwrap_or_else(PoisonError::into_inner);
            if memory.alerted.as_ref() == Some(&key) {
                return false;
            }
            if memory
                .last_alert_at
                .is_some_and(|at| now - at < Duration::seconds(ALERT_COOLDOWN_SECS))
            {
                return false;
            }
            memory.alerted = Some(key);
            memory.last_alert_at = Some(now);
        }
        if let Err(e) = self.notifier.notify(&alert) {
            log::warn!("Failed to show the critical alert: {}", e);
        }
        true
    }
}

fn critical_for(status: &LiveStatus, now: DateTime<Utc>) -> Option<(MatchKey, i64)> {
    if status.state != LiveState::Live || status.status != Severity::Critical {
        return None;
    }
    let since = parse(status.status_since.as_deref()?)?;
    let seconds = (now - since.with_timezone(&Utc)).num_seconds();
    if seconds < ALERT_CRITICAL_SECS {
        return None;
    }
    let started = status.match_started_at.clone()?;
    Some(((status.session_id, started), seconds))
}

fn alert_for(status: &LiveStatus, seconds: i64, locale: Locale) -> Option<Alert> {
    let primary = status.primary.as_ref()?;
    let cause = status.cause.or(primary.cause)?;
    let (value, lower_bound) = match cause {
        IncidentCause::Loss => match (primary.loss_pct, primary.loss_floor_pct) {
            (Some(loss), _) => (loss, false),
            (None, Some(floor)) => (floor, true),
            (None, None) => return None,
        },
        IncidentCause::Latency => (primary.median_ms?, primary.at_least),
        IncidentCause::Jitter => (primary.jitter_ms?, false),
    };
    let place = if primary.point == LivePoint::Game {
        Place::Game
    } else if primary.at_least {
        Place::Hop {
            hop: primary.hop,
            operator: primary.operator.clone(),
        }
    } else {
        Place::Server
    };
    let fault = status.fault.as_ref();
    let text = compose(
        locale,
        &AlertFacts {
            seconds,
            cause,
            value,
            lower_bound,
            place,
            usual_ms: primary.usual.median_ms,
            zone: fault.map(|fault| fault.zone),
            operator: fault.and_then(|fault| fault.operator.clone()),
        },
    );
    Some(Alert {
        title: text.title,
        body: text.body,
    })
}

pub fn watch(app: &AppHandle, status: &LiveStatus) {
    let (Some(service), Some(store)) = (
        app.try_state::<AlertService>(),
        app.try_state::<SettingsStore>(),
    ) else {
        return;
    };
    service.observe(status, &store.get(), Utc::now());
}

#[cfg(test)]
mod tests;

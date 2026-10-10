use crate::config::{
    LIVE_STATUS_GAME_STALE_SECS, LIVE_STATUS_JITTER_TRIM, LIVE_STATUS_LOSS_CONFIDENCE_Z,
    LIVE_STATUS_LOSS_WINDOW_SECS, LIVE_STATUS_MIN_PROBES, LIVE_STATUS_PROBE_STALE_SECS,
    LIVE_STATUS_WINDOW_SECS,
};
use crate::models::insights::PingBasis;
use crate::models::live_status::LivePoint;
use crate::services::live_probe::stats::round;
use crate::services::matches::median;
use chrono::{DateTime, Duration, Utc};
use std::collections::VecDeque;

#[derive(Debug, Clone, PartialEq)]
pub struct Observation {
    pub at: DateTime<Utc>,
    pub rtt_ms: Option<f64>,
    pub sent: i64,
    pub lost: i64,
    pub jitter_ms: Option<f64>,
}

impl Observation {
    pub fn probe(at: DateTime<Utc>, rtt_ms: Option<f64>) -> Self {
        Self {
            at,
            rtt_ms,
            sent: 1,
            lost: i64::from(rtt_ms.is_none()),
            jitter_ms: None,
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct WindowStats {
    pub sample_count: u32,
    pub median_ms: Option<f64>,
    pub jitter_ms: Option<f64>,
    pub sent: i64,
    pub lost: i64,
    pub loss_pct: Option<f64>,
    pub loss_floor_pct: Option<f64>,
}

pub fn loss_floor_pct(lost: i64, sent: i64) -> Option<f64> {
    if sent <= 0 {
        return None;
    }
    if lost <= 1 {
        return Some(0.0);
    }
    let n = sent as f64;
    let p = (lost.min(sent) as f64) / n;
    let z = LIVE_STATUS_LOSS_CONFIDENCE_Z;
    let z2 = z * z;
    let spread = z * (p * (1.0 - p) / n + z2 / (4.0 * n * n)).sqrt();
    let lower = (p + z2 / (2.0 * n) - spread) / (1.0 + z2 / n);
    Some(round(lower.max(0.0) * 100.0))
}

pub fn trimmed_jitter(rtts: &[f64]) -> Option<f64> {
    if rtts.len() < 2 {
        return None;
    }
    let mut steps: Vec<f64> = rtts
        .windows(2)
        .map(|pair| (pair[1] - pair[0]).abs())
        .collect();
    steps.sort_by(f64::total_cmp);
    let dropped = (steps.len() as f64 * LIVE_STATUS_JITTER_TRIM).ceil() as usize;
    let kept = &steps[..steps.len() - dropped.min(steps.len() - 1)];
    Some(round(kept.iter().sum::<f64>() / kept.len() as f64))
}

pub fn window_stats(
    observations: &VecDeque<Observation>,
    now: DateTime<Utc>,
    reported_jitter: bool,
) -> WindowStats {
    let since = now - Duration::seconds(LIVE_STATUS_WINDOW_SECS);
    let loss_since = now - Duration::seconds(LIVE_STATUS_LOSS_WINDOW_SECS);
    let recent: Vec<&Observation> = observations
        .iter()
        .filter(|observation| observation.at > since && observation.at <= now)
        .collect();
    let rtts: Vec<f64> = recent.iter().filter_map(|o| o.rtt_ms).collect();
    let jitter_ms = if reported_jitter {
        median(recent.iter().filter_map(|o| o.jitter_ms).collect()).map(round)
    } else {
        trimmed_jitter(&rtts)
    };
    let (sent, lost) = observations
        .iter()
        .filter(|observation| observation.at > loss_since && observation.at <= now)
        .fold((0, 0), |(sent, lost), o| {
            (sent + o.sent, lost + o.lost.min(o.sent))
        });
    WindowStats {
        sample_count: recent.len() as u32,
        median_ms: median(rtts).map(round),
        jitter_ms,
        sent,
        lost,
        loss_pct: (sent > 0).then(|| round(lost as f64 * 100.0 / sent as f64)),
        loss_floor_pct: loss_floor_pct(lost, sent),
    }
}

#[derive(Debug, Clone)]
pub struct PointWindow {
    pub point: LivePoint,
    pub basis: PingBasis,
    pub hop_ip: Option<String>,
    pub observations: VecDeque<Observation>,
    pub last_at: DateTime<Utc>,
}

impl PointWindow {
    pub fn new(
        point: LivePoint,
        basis: PingBasis,
        hop_ip: Option<String>,
        at: DateTime<Utc>,
    ) -> Self {
        Self {
            point,
            basis,
            hop_ip,
            observations: VecDeque::new(),
            last_at: at,
        }
    }

    pub fn push(&mut self, observation: Observation) {
        self.last_at = self.last_at.max(observation.at);
        self.observations.push_back(observation);
    }

    pub fn prune(&mut self, now: DateTime<Utc>) {
        let oldest = now - Duration::seconds(LIVE_STATUS_LOSS_WINDOW_SECS);
        while self
            .observations
            .front()
            .is_some_and(|observation| observation.at <= oldest)
        {
            self.observations.pop_front();
        }
    }

    pub fn is_fresh(&self, now: DateTime<Utc>) -> bool {
        let stale = match self.point {
            LivePoint::Game => LIVE_STATUS_GAME_STALE_SECS,
            _ => LIVE_STATUS_PROBE_STALE_SECS,
        };
        now - self.last_at <= Duration::seconds(stale)
    }

    pub fn stats(&self, now: DateTime<Utc>) -> WindowStats {
        window_stats(&self.observations, now, self.point == LivePoint::Game)
    }

    pub fn evaluable(&self, stats: &WindowStats) -> bool {
        match self.point {
            LivePoint::Game => stats.sample_count > 0 && stats.median_ms.is_some(),
            _ => stats.sample_count >= LIVE_STATUS_MIN_PROBES,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::insights::PingSource;
    use chrono::TimeZone;

    fn at(sec: i64) -> DateTime<Utc> {
        Utc.with_ymd_and_hms(2026, 10, 8, 20, 0, 0).unwrap() + Duration::seconds(sec)
    }

    fn floor_window() -> PointWindow {
        let basis = PingBasis {
            source: PingSource::Floor,
            at_destination: false,
            measured_hop: Some(7),
            measured_asn: Some(9002),
            server_ip: None,
        };
        PointWindow::new(LivePoint::Floor, basis, None, at(0))
    }

    #[test]
    fn a_single_lost_probe_is_not_read_as_a_lossy_link() {
        assert_eq!(loss_floor_pct(0, 120), Some(0.0));
        assert!(loss_floor_pct(1, 120).unwrap() < 0.5);
        assert_eq!(loss_floor_pct(0, 0), None);
        let four_pct = loss_floor_pct(5, 120).unwrap();
        assert!((2.0..5.0).contains(&four_pct), "{four_pct}");
        let game = loss_floor_pct(40, 1000).unwrap();
        assert!((3.0..4.0).contains(&game), "{game}");
        assert_eq!(loss_floor_pct(120, 120).map(|p| p > 95.0), Some(true));
    }

    #[test]
    fn an_isolated_spike_barely_moves_the_jitter() {
        let mut rtts = vec![18.0; 30];
        rtts[10] = 41.0;
        rtts[11] = 41.0;
        rtts[12] = 41.0;
        assert_eq!(trimmed_jitter(&rtts), Some(0.0));
        let noisy: Vec<f64> = (0..30)
            .map(|i| if i % 2 == 0 { 10.0 } else { 30.0 })
            .collect();
        assert_eq!(trimmed_jitter(&noisy), Some(20.0));
        assert_eq!(trimmed_jitter(&[4.0]), None);
    }

    #[test]
    fn latency_uses_thirty_seconds_and_loss_two_minutes() {
        let mut window = floor_window();
        for sec in 0..150 {
            let rtt = (sec % 25 != 0).then_some(if sec < 120 { 40.0 } else { 18.0 });
            window.push(Observation::probe(at(sec), rtt));
        }
        let now = at(149);
        window.prune(now);
        let stats = window.stats(now);
        assert_eq!(stats.sample_count, 30);
        assert_eq!(stats.median_ms, Some(18.0));
        assert_eq!(stats.sent, 120);
        assert_eq!(stats.lost, 4);
        assert_eq!(stats.loss_pct, Some(3.33));
        assert!(window.evaluable(&stats));
        assert!(window.is_fresh(at(152)));
        assert!(!window.is_fresh(at(153)));
        assert_eq!(window.observations.len(), 120);
    }
}

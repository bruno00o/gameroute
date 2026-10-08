use crate::config::LIVE_PROBE_SLICE_SECS;
use crate::models::live_probe::{LiveProbeSlice, LiveSpan, LiveStats, ProbeTarget};
use crate::services::matches::median;
use chrono::{DateTime, Duration, SecondsFormat, TimeZone, Utc};

#[derive(Debug, Clone, PartialEq)]
pub struct Observation {
    pub at: DateTime<Utc>,
    pub rtt_ms: Option<f64>,
    pub reply_ip: Option<String>,
    pub at_destination: bool,
}

pub fn round(value: f64) -> f64 {
    (value * 100.0).round() / 100.0
}

pub fn jitter(rtts: &[f64]) -> Option<f64> {
    if rtts.len() < 2 {
        return None;
    }
    let total: f64 = rtts.windows(2).map(|pair| (pair[1] - pair[0]).abs()).sum();
    Some(round(total / (rtts.len() - 1) as f64))
}

fn loss_pct(sent: u32, received: u32) -> f64 {
    if sent == 0 {
        return 0.0;
    }
    round(f64::from(sent - received) * 100.0 / f64::from(sent))
}

pub fn stats<'a>(observations: impl IntoIterator<Item = &'a Observation>) -> LiveStats {
    let mut sent = 0;
    let mut rtts = Vec::new();
    for observation in observations {
        sent += 1;
        rtts.extend(observation.rtt_ms);
    }
    let received = rtts.len() as u32;
    LiveStats {
        sent,
        received,
        loss_pct: loss_pct(sent, received),
        median_ms: median(rtts.clone()).map(round),
        jitter_ms: jitter(&rtts),
    }
}

pub fn slice_start(at: DateTime<Utc>) -> DateTime<Utc> {
    let seconds = at.timestamp().div_euclid(LIVE_PROBE_SLICE_SECS) * LIVE_PROBE_SLICE_SECS;
    Utc.timestamp_opt(seconds, 0).single().unwrap_or(at)
}

pub fn stamp(at: DateTime<Utc>) -> String {
    at.to_rfc3339_opts(SecondsFormat::Millis, true)
}

#[derive(Debug, Clone)]
pub struct SliceBuilder {
    pub target: ProbeTarget,
    pub started_at: DateTime<Utc>,
    pub observations: Vec<Observation>,
}

impl SliceBuilder {
    pub fn new(target: ProbeTarget, at: DateTime<Utc>) -> Self {
        Self {
            target,
            started_at: slice_start(at),
            observations: Vec::new(),
        }
    }

    pub fn holds(&self, target: &ProbeTarget, at: DateTime<Utc>) -> bool {
        &self.target == target && slice_start(at) == self.started_at
    }

    pub fn finish(self, session_id: i64) -> Option<LiveProbeSlice> {
        if self.observations.is_empty() {
            return None;
        }
        let summary = stats(&self.observations);
        let rtts: Vec<f64> = self.observations.iter().filter_map(|o| o.rtt_ms).collect();
        let answered: Vec<&Observation> = self
            .observations
            .iter()
            .filter(|o| o.rtt_ms.is_some())
            .collect();
        Some(LiveProbeSlice {
            session_id,
            source: self.target.source,
            started_at: stamp(self.started_at),
            address: self.target.address.clone(),
            host: self.target.host.clone(),
            ttl: self.target.ttl.map(i32::from),
            server_ip: self.target.server_ip.clone(),
            reply_ip: answered.iter().rev().find_map(|o| o.reply_ip.clone()),
            at_destination: !answered.is_empty() && answered.iter().all(|o| o.at_destination),
            region: self.target.region.clone(),
            provider: self.target.provider.map(|p| p.as_str().to_string()),
            sent: i64::from(summary.sent),
            received: i64::from(summary.received),
            rtt_min: rtts.iter().copied().reduce(f64::min).map(round),
            rtt_median: summary.median_ms,
            rtt_max: rtts.iter().copied().reduce(f64::max).map(round),
            jitter_ms: summary.jitter_ms,
        })
    }
}

pub fn span(slices: &[&LiveProbeSlice]) -> Option<LiveSpan> {
    let first = slices.first()?;
    let last = slices.last()?;
    let ended_at = DateTime::parse_from_rfc3339(&last.started_at)
        .ok()
        .map(|at| stamp(at.with_timezone(&Utc) + Duration::seconds(LIVE_PROBE_SLICE_SECS)))
        .unwrap_or_else(|| last.started_at.clone());
    let sent: i64 = slices.iter().map(|s| s.sent).sum();
    let received: i64 = slices.iter().map(|s| s.received).sum();
    Some(LiveSpan {
        started_at: first.started_at.clone(),
        ended_at,
        slice_count: slices.len() as u32,
        sent,
        received,
        loss_pct: (sent > 0).then(|| round((sent - received) as f64 * 100.0 / sent as f64)),
        ping_ms: median(slices.iter().filter_map(|s| s.rtt_median).collect()).map(round),
        min_ms: slices.iter().filter_map(|s| s.rtt_min).reduce(f64::min),
        max_ms: slices.iter().filter_map(|s| s.rtt_max).reduce(f64::max),
        jitter_ms: median(slices.iter().filter_map(|s| s.jitter_ms).collect()).map(round),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::insights::PingSource;
    use crate::models::live_probe::ProbeProtocol;

    fn target() -> ProbeTarget {
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

    fn at(sec: i64) -> DateTime<Utc> {
        Utc.with_ymd_and_hms(2026, 10, 8, 20, 0, 0).unwrap() + Duration::seconds(sec)
    }

    fn seen(sec: i64, rtt_ms: Option<f64>) -> Observation {
        Observation {
            at: at(sec),
            rtt_ms,
            reply_ip: rtt_ms.map(|_| "194.6.150.68".to_string()),
            at_destination: false,
        }
    }

    #[test]
    fn lost_probes_count_as_loss_never_as_zero() {
        let window = [
            seen(0, Some(4.0)),
            seen(1, None),
            seen(2, Some(6.0)),
            seen(3, Some(5.0)),
        ];
        let summary = stats(&window);
        assert_eq!(summary.sent, 4);
        assert_eq!(summary.received, 3);
        assert_eq!(summary.loss_pct, 25.0);
        assert_eq!(summary.median_ms, Some(5.0));
        assert_eq!(summary.jitter_ms, Some(1.5));

        let silent = stats(&[seen(0, None), seen(1, None)]);
        assert_eq!(silent.loss_pct, 100.0);
        assert_eq!(silent.median_ms, None);
        assert_eq!(silent.jitter_ms, None);
    }

    #[test]
    fn slices_are_aligned_on_ten_seconds() {
        assert_eq!(slice_start(at(19)), at(10));
        assert_eq!(slice_start(at(20)), at(20));
        let builder = SliceBuilder::new(target(), at(13));
        assert!(builder.holds(&target(), at(19)));
        assert!(!builder.holds(&target(), at(20)));
        let mut other = target();
        other.ttl = Some(4);
        assert!(!builder.holds(&other, at(14)));
    }

    #[test]
    fn slice_keeps_min_median_max_and_loss() {
        let mut builder = SliceBuilder::new(target(), at(10));
        builder.observations = (10..20)
            .map(|sec| seen(sec, (sec != 15).then_some(4.0 + (sec % 3) as f64)))
            .collect();
        let slice = builder.finish(7).unwrap();
        assert_eq!(slice.session_id, 7);
        assert_eq!(slice.started_at, "2026-10-08T20:00:10.000Z");
        assert_eq!((slice.sent, slice.received), (10, 9));
        assert_eq!(slice.rtt_min, Some(4.0));
        assert_eq!(slice.rtt_max, Some(6.0));
        assert_eq!(slice.rtt_median, Some(5.0));
        assert_eq!(slice.ttl, Some(5));
        assert_eq!(slice.reply_ip.as_deref(), Some("194.6.150.68"));
        assert!(!slice.at_destination);

        assert!(SliceBuilder::new(target(), at(0)).finish(7).is_none());
    }

    #[test]
    fn span_sums_slices_over_the_match() {
        let mut builder = SliceBuilder::new(target(), at(0));
        builder.observations = (0..10).map(|sec| seen(sec, Some(4.0))).collect();
        let first = builder.finish(1).unwrap();
        let mut builder = SliceBuilder::new(target(), at(10));
        builder.observations = (10..20)
            .map(|sec| seen(sec, (sec % 2 == 0).then_some(8.0)))
            .collect();
        let second = builder.finish(1).unwrap();

        let span = span(&[&first, &second]).unwrap();
        assert_eq!(span.started_at, "2026-10-08T20:00:00.000Z");
        assert_eq!(span.ended_at, "2026-10-08T20:00:20.000Z");
        assert_eq!((span.sent, span.received), (20, 15));
        assert_eq!(span.loss_pct, Some(25.0));
        assert_eq!(span.ping_ms, Some(6.0));
        assert_eq!((span.min_ms, span.max_ms), (Some(4.0), Some(8.0)));
    }
}

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HopResult {
    pub hop_number: u32,
    pub ip: Option<String>,
    pub hostname: Option<String>,
    pub rtt_probes: Vec<Option<f64>>,
    pub rtt_min: Option<f64>,
    pub rtt_avg: Option<f64>,
    pub rtt_max: Option<f64>,
    pub timeout_count: u32,
    pub probe_count: u32,
    pub responded: bool,
}

impl HopResult {
    pub fn new(
        hop_number: u32,
        ip: Option<String>,
        hostname: Option<String>,
        rtt_probes: Vec<Option<f64>>,
    ) -> Self {
        let successful_rtts: Vec<f64> = rtt_probes.iter().filter_map(|&r| r).collect();
        let timeout_count = rtt_probes.iter().filter(|r| r.is_none()).count() as u32;
        let probe_count = rtt_probes.len() as u32;
        let responded = !successful_rtts.is_empty();

        let (rtt_min, rtt_avg, rtt_max) = if responded {
            let min = successful_rtts
                .iter()
                .cloned()
                .fold(f64::INFINITY, f64::min);
            let max = successful_rtts
                .iter()
                .cloned()
                .fold(f64::NEG_INFINITY, f64::max);
            let avg = successful_rtts.iter().sum::<f64>() / successful_rtts.len() as f64;
            (Some(min), Some(avg), Some(max))
        } else {
            (None, None, None)
        };

        Self {
            hop_number,
            ip,
            hostname,
            rtt_probes,
            rtt_min,
            rtt_avg,
            rtt_max,
            timeout_count,
            probe_count,
            responded,
        }
    }

    pub fn timeout(hop_number: u32, probe_count: u32) -> Self {
        Self {
            hop_number,
            ip: None,
            hostname: None,
            rtt_probes: vec![None; probe_count as usize],
            rtt_min: None,
            rtt_avg: None,
            rtt_max: None,
            timeout_count: probe_count,
            probe_count,
            responded: false,
        }
    }

    pub fn packet_loss(&self) -> f64 {
        if self.probe_count > 0 {
            (self.timeout_count as f64 / self.probe_count as f64) * 100.0
        } else {
            0.0
        }
    }
}

pub trait ProbedHop {
    fn ip(&self) -> Option<&str>;
    fn responded(&self) -> bool;
    fn loss_pct(&self) -> f64;
    fn rtt_avg(&self) -> Option<f64>;
    fn rtt_range(&self) -> Option<(f64, f64)>;
}

impl ProbedHop for HopResult {
    fn ip(&self) -> Option<&str> {
        self.ip.as_deref()
    }

    fn responded(&self) -> bool {
        self.responded
    }

    fn loss_pct(&self) -> f64 {
        self.packet_loss()
    }

    fn rtt_avg(&self) -> Option<f64> {
        self.rtt_avg
    }

    fn rtt_range(&self) -> Option<(f64, f64)> {
        self.rtt_min.zip(self.rtt_max)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_hop_result_new_all_success() {
        let hop = HopResult::new(
            1,
            Some("1.1.1.1".to_string()),
            Some("one.one.one.one".to_string()),
            vec![Some(10.0), Some(12.0), Some(11.0)],
        );

        assert_eq!(hop.hop_number, 1);
        assert_eq!(hop.ip, Some("1.1.1.1".to_string()));
        assert!(hop.responded);
        assert_eq!(hop.timeout_count, 0);
        assert_eq!(hop.rtt_min, Some(10.0));
        assert!(hop.rtt_avg.unwrap() > 10.0 && hop.rtt_avg.unwrap() < 12.0);
        assert_eq!(hop.rtt_max, Some(12.0));
    }

    #[test]
    fn test_hop_result_partial_timeout() {
        let hop = HopResult::new(
            2,
            Some("8.8.8.8".to_string()),
            None,
            vec![Some(20.0), None, Some(22.0)],
        );

        assert!(hop.responded);
        assert_eq!(hop.timeout_count, 1);
        assert_eq!(hop.probe_count, 3);
    }

    #[test]
    fn test_hop_result_all_timeout() {
        let hop = HopResult::timeout(3, 3);

        assert!(!hop.responded);
        assert_eq!(hop.timeout_count, 3);
        assert!(hop.ip.is_none());
        assert!(hop.rtt_avg.is_none());
    }
}

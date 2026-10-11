use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Severity {
    Ok,
    Watch,
    Degraded,
    Critical,
    #[default]
    Unmeasured,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SeverityThreshold {
    pub loss_pct: f64,
    pub jitter_ms: f64,
    pub over_baseline_ms: f64,
    pub rtt_ms: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SeverityThresholds {
    pub watch: SeverityThreshold,
    pub degraded: SeverityThreshold,
    pub critical: SeverityThreshold,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn severity_serializes_as_lowercase_token() {
        assert_eq!(serde_json::to_string(&Severity::Ok).unwrap(), "\"ok\"");
        assert_eq!(
            serde_json::to_string(&Severity::Unmeasured).unwrap(),
            "\"unmeasured\""
        );
    }

    #[test]
    fn threshold_serializes_in_camel_case() {
        let threshold = SeverityThreshold {
            loss_pct: 0.5,
            jitter_ms: 8.0,
            over_baseline_ms: 20.0,
            rtt_ms: 60.0,
        };

        let json = serde_json::to_string(&threshold).unwrap();
        assert!(json.contains("lossPct"));
        assert!(json.contains("overBaselineMs"));
        assert!(json.contains("rttMs"));
    }
}

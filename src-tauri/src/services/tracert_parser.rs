use crate::models::HopResult;
use std::net::IpAddr;

/// Parse a single line of `tracert.exe` output into a `HopResult`.
///
/// Tracert output looks like:
/// ```text
///   1    <1 ms    <1 ms    <1 ms  192.168.1.1
///   2     8 ms     9 ms     7 ms  10.0.0.1
///   3     *        *        *     Request timed out.
/// ```
///
/// Returns `None` for header/footer lines that don't start with a hop number.
#[allow(dead_code)]
pub fn parse_tracert_line(line: &str) -> Option<HopResult> {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return None;
    }

    let tokens: Vec<&str> = trimmed.split_whitespace().collect();
    if tokens.is_empty() {
        return None;
    }

    // First token must be the hop number
    let hop_number: u32 = tokens[0].parse().ok()?;

    // Parse the 3 RTT probes and collect the trailing IP
    let mut rtt_probes: Vec<Option<f64>> = Vec::new();
    let mut ip_str: Option<String> = None;

    let mut i = 1;
    while i < tokens.len() {
        let token = tokens[i];

        if token == "*" {
            rtt_probes.push(None);
            i += 1;
        } else if let Some(num_part) = token.strip_prefix('<') {
            // Handle "<1" with separate "ms" token: "<1 ms" → 0.5
            // The number part is after '<'
            if let Ok(_val) = num_part.parse::<f64>() {
                rtt_probes.push(Some(0.5));
            }
            // Skip the "ms" token if present
            if i + 1 < tokens.len() && tokens[i + 1] == "ms" {
                i += 2;
            } else {
                i += 1;
            }
        } else if let Ok(val) = token.parse::<f64>() {
            rtt_probes.push(Some(val));
            // Skip the "ms" token if present
            if i + 1 < tokens.len() && tokens[i + 1] == "ms" {
                i += 2;
            } else {
                i += 1;
            }
        } else if token.parse::<IpAddr>().is_ok() {
            ip_str = Some(token.to_string());
            i += 1;
        } else {
            // Skip unrecognized tokens (e.g. "Request", "timed", "out.")
            i += 1;
        }
    }

    // Must have parsed at least one probe to be a valid hop line
    if rtt_probes.is_empty() {
        return None;
    }

    if ip_str.is_some() {
        Some(HopResult::new(hop_number, ip_str, None, rtt_probes))
    } else {
        // All-timeout line (no IP found)
        let probe_count = rtt_probes.len() as u32;
        Some(HopResult::timeout(hop_number, probe_count))
    }
}

/// Run `tracert.exe` on Windows and stream hop results via a callback.
///
/// Spawns `tracert.exe -d -w {timeout_ms} -h {max_hops} {ip}` as a child
/// process, reads stdout line-by-line, parses each hop, and calls `on_hop`
/// for live streaming to the frontend.
#[cfg(target_os = "windows")]
pub async fn run_tracert<H>(
    target_ip: &str,
    max_hops: u8,
    timeout_secs: u64,
    on_hop: H,
    job_index: u32,
) -> Result<Vec<HopResult>, String>
where
    H: Fn(&HopResult, u32, &str) + Send + Sync + 'static,
{
    use std::process::Stdio;
    use tokio::io::{AsyncBufReadExt, BufReader};
    use tokio::time::Duration;

    let timeout_ms = timeout_secs * 1000;

    let mut child = {
        const CREATE_NO_WINDOW: u32 = 0x08000000;

        let mut cmd = tokio::process::Command::new("tracert.exe");
        cmd.args([
            "-d",
            "-w",
            &timeout_ms.to_string(),
            "-h",
            &max_hops.to_string(),
            target_ip,
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .creation_flags(CREATE_NO_WINDOW);

        cmd.spawn()
            .map_err(|e| format!("Failed to spawn tracert.exe: {}", e))?
    };

    let stdout = child
        .stdout
        .take()
        .ok_or("Failed to capture tracert stdout")?;

    let mut reader = BufReader::new(stdout).lines();
    let mut hops: Vec<HopResult> = Vec::new();

    // Add a generous buffer on top of tracert's own per-hop timeout
    let overall_timeout = Duration::from_secs(timeout_secs * (max_hops as u64) + 30);

    let read_result = tokio::time::timeout(overall_timeout, async {
        while let Some(line) = reader
            .next_line()
            .await
            .map_err(|e| format!("Error reading tracert output: {}", e))?
        {
            if let Some(hop_result) = parse_tracert_line(&line) {
                on_hop(&hop_result, job_index, target_ip);
                hops.push(hop_result);
            }
        }
        Ok::<(), String>(())
    })
    .await;

    match read_result {
        Ok(Ok(())) => {}
        Ok(Err(e)) => {
            let _ = child.kill().await;
            return Err(e);
        }
        Err(_) => {
            log::warn!("tracert.exe for {} timed out, killing process", target_ip);
            let _ = child.kill().await;
            return Err(format!(
                "tracert.exe timed out after {}s",
                overall_timeout.as_secs()
            ));
        }
    }

    let _ = child.wait().await;

    Ok(hops)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_normal_hop() {
        let line = "  3    10 ms     9 ms    11 ms  10.0.0.1";
        let hop = parse_tracert_line(line).unwrap();

        assert_eq!(hop.hop_number, 3);
        assert_eq!(hop.ip, Some("10.0.0.1".to_string()));
        assert!(hop.responded);
        assert_eq!(hop.probe_count, 3);
        assert_eq!(hop.timeout_count, 0);
        assert_eq!(hop.rtt_probes, vec![Some(10.0), Some(9.0), Some(11.0)]);
    }

    #[test]
    fn test_timeout_hop() {
        let line = "  5     *        *        *     Request timed out.";
        let hop = parse_tracert_line(line).unwrap();

        assert_eq!(hop.hop_number, 5);
        assert!(hop.ip.is_none());
        assert!(!hop.responded);
        assert_eq!(hop.timeout_count, 3);
        assert_eq!(hop.probe_count, 3);
    }

    #[test]
    fn test_less_than_1ms_hop() {
        let line = "  1    <1 ms    <1 ms    <1 ms  192.168.1.1";
        let hop = parse_tracert_line(line).unwrap();

        assert_eq!(hop.hop_number, 1);
        assert_eq!(hop.ip, Some("192.168.1.1".to_string()));
        assert!(hop.responded);
        assert_eq!(hop.rtt_probes, vec![Some(0.5), Some(0.5), Some(0.5)]);
    }

    #[test]
    fn test_mixed_probes() {
        let line = "  4    12 ms     *       15 ms  172.16.0.1";
        let hop = parse_tracert_line(line).unwrap();

        assert_eq!(hop.hop_number, 4);
        assert_eq!(hop.ip, Some("172.16.0.1".to_string()));
        assert!(hop.responded);
        assert_eq!(hop.timeout_count, 1);
        assert_eq!(hop.rtt_probes, vec![Some(12.0), None, Some(15.0)]);
    }

    #[test]
    fn test_header_line_returns_none() {
        let line = "Tracing route to 8.8.8.8 over a maximum of 30 hops:";
        assert!(parse_tracert_line(line).is_none());
    }

    #[test]
    fn test_empty_line_returns_none() {
        assert!(parse_tracert_line("").is_none());
        assert!(parse_tracert_line("   ").is_none());
    }

    #[test]
    fn test_footer_line_returns_none() {
        let line = "Trace complete.";
        assert!(parse_tracert_line(line).is_none());
    }

    #[test]
    fn test_ipv6_hop() {
        let line = "  2     5 ms     4 ms     6 ms  2001:db8::1";
        let hop = parse_tracert_line(line).unwrap();

        assert_eq!(hop.hop_number, 2);
        assert_eq!(hop.ip, Some("2001:db8::1".to_string()));
        assert!(hop.responded);
    }

    #[test]
    fn test_timeout_only_stars() {
        // Some locales may not include "Request timed out."
        let line = "  7     *        *        *";
        let hop = parse_tracert_line(line).unwrap();

        assert_eq!(hop.hop_number, 7);
        assert!(hop.ip.is_none());
        assert!(!hop.responded);
        assert_eq!(hop.timeout_count, 3);
    }

    #[test]
    fn test_single_probe_timeout_with_ip() {
        let line = "  6     *       20 ms    18 ms  10.10.10.1";
        let hop = parse_tracert_line(line).unwrap();

        assert_eq!(hop.hop_number, 6);
        assert_eq!(hop.ip, Some("10.10.10.1".to_string()));
        assert!(hop.responded);
        assert_eq!(hop.timeout_count, 1);
        assert_eq!(hop.rtt_probes, vec![None, Some(20.0), Some(18.0)]);
    }
}

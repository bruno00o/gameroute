use crate::config::{CDN_ASNS, TRACE_FALLBACK_TARGET_LIMIT};
use crate::models::ip_period::TraceCandidate;
use crate::services::asn_resolver::get_resolver;
use std::net::IpAddr;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TraceTarget {
    pub ip: String,
    pub protocol: String,
    pub port: u16,
}

impl From<&TraceCandidate> for TraceTarget {
    fn from(candidate: &TraceCandidate) -> Self {
        Self {
            ip: candidate.ip.clone(),
            protocol: candidate.protocol.clone(),
            port: u16::try_from(candidate.port).unwrap_or(0),
        }
    }
}

pub fn is_cdn(ip: &str) -> bool {
    let Ok(addr) = ip.parse::<IpAddr>() else {
        return false;
    };
    get_resolver()
        .and_then(|resolver| resolver.asn_number(addr))
        .is_some_and(|asn| CDN_ASNS.contains(&asn))
}

fn is_quic(protocol: &str, port: i32) -> bool {
    protocol == "UDP" && port == 443
}

pub fn is_traceable_game_server(ip: &str, protocol: &str, port: i32) -> bool {
    !is_quic(protocol, port) && !is_cdn(ip)
}

pub fn select_targets(
    candidates: &[TraceCandidate],
    is_cdn: impl Fn(&str) -> bool,
) -> Vec<TraceTarget> {
    let eligible: Vec<&TraceCandidate> = candidates
        .iter()
        .filter(|c| !is_quic(&c.protocol, c.port) && !is_cdn(&c.ip))
        .collect();

    let game_servers: Vec<&TraceCandidate> =
        eligible.iter().copied().filter(|c| c.is_game_server).collect();

    let chosen = if game_servers.is_empty() {
        let mut longest = eligible;
        longest.sort_by_key(|c| std::cmp::Reverse(c.total_secs));
        longest.truncate(TRACE_FALLBACK_TARGET_LIMIT);
        longest
    } else {
        game_servers
    };

    chosen.into_iter().map(TraceTarget::from).collect()
}

pub fn select_session_targets(candidates: &[TraceCandidate]) -> Vec<TraceTarget> {
    select_targets(candidates, is_cdn)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn candidate(ip: &str, protocol: &str, port: i32, is_game_server: bool, total_secs: i64) -> TraceCandidate {
        TraceCandidate {
            ip: ip.to_string(),
            protocol: protocol.to_string(),
            port,
            is_game_server,
            total_secs,
        }
    }

    fn cloudflare(ip: &str) -> bool {
        ip.starts_with("104.18.")
    }

    #[test]
    fn keeps_only_game_servers_when_present() {
        let candidates = vec![
            candidate("104.18.41.183", "TCP", 443, false, 5000),
            candidate("3.5.1.1", "TCP", 443, false, 4000),
            candidate("162.249.72.5", "UDP", 7032, true, 1500),
        ];

        let targets = select_targets(&candidates, cloudflare);

        assert_eq!(
            targets,
            vec![TraceTarget { ip: "162.249.72.5".into(), protocol: "UDP".into(), port: 7032 }]
        );
    }

    #[test]
    fn drops_cdn_and_quic_game_server_flags() {
        let candidates = vec![
            candidate("104.18.41.183", "UDP", 7000, true, 900),
            candidate("142.250.1.1", "UDP", 443, true, 900),
            candidate("185.40.64.1", "UDP", 7334, true, 600),
        ];

        let targets = select_targets(&candidates, cloudflare);

        assert_eq!(targets.len(), 1);
        assert_eq!(targets[0].ip, "185.40.64.1");
    }

    #[test]
    fn falls_back_to_longest_non_cdn_connections() {
        let candidates: Vec<TraceCandidate> = (0..8)
            .map(|i| candidate(&format!("20.0.0.{i}"), "TCP", 443, false, i * 100))
            .chain(std::iter::once(candidate("104.18.0.1", "TCP", 443, false, 99_999)))
            .collect();

        let targets = select_targets(&candidates, cloudflare);

        let ips: Vec<&str> = targets.iter().map(|t| t.ip.as_str()).collect();
        assert_eq!(ips, vec!["20.0.0.7", "20.0.0.6", "20.0.0.5", "20.0.0.4", "20.0.0.3"]);
    }

    #[test]
    fn empty_candidates_give_no_targets() {
        assert!(select_targets(&[], cloudflare).is_empty());
    }

    #[test]
    fn out_of_range_port_maps_to_zero() {
        let target = TraceTarget::from(&candidate("1.2.3.4", "UDP", 70_000, true, 1));
        assert_eq!(target.port, 0);
    }
}

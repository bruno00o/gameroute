use crate::db::get_ip_period_repository;
pub use crate::models::flow_kind::FlowKind;
use crate::services::asn_resolver::get_resolver;
use std::net::IpAddr;
use std::ops::RangeInclusive;

struct FlowRule {
    asns: &'static [u32],
    ports: RangeInclusive<u16>,
    kind: FlowKind,
}

const FLOW_RULES: &[FlowRule] = &[
    FlowRule {
        asns: &[8068, 8069, 8075],
        ports: 27000..=27099,
        kind: FlowKind::Voice,
    },
    FlowRule {
        asns: &[6507],
        ports: 7000..=7999,
        kind: FlowKind::Game,
    },
];

fn known_kind(asn: Option<u32>, protocol: &str, port: u16) -> Option<FlowKind> {
    if protocol != "UDP" {
        return None;
    }
    let asn = asn?;
    FLOW_RULES
        .iter()
        .find(|rule| rule.asns.contains(&asn) && rule.ports.contains(&port))
        .map(|rule| rule.kind)
}

pub fn classify(asn: Option<u32>, protocol: &str, port: u16) -> FlowKind {
    known_kind(asn, protocol, port).unwrap_or(FlowKind::Game)
}

pub fn is_known_game_server(asn: Option<u32>, protocol: &str, port: u16) -> bool {
    known_kind(asn, protocol, port) == Some(FlowKind::Game)
}

fn asn_of(ip: &str) -> Option<u32> {
    ip.parse::<IpAddr>()
        .ok()
        .and_then(|addr| get_resolver().and_then(|resolver| resolver.asn_number(addr)))
}

pub fn classify_ip(ip: &str, protocol: &str, port: u16) -> FlowKind {
    classify(asn_of(ip), protocol, port)
}

pub async fn backfill_flow_kinds() {
    let Some(repo) = get_ip_period_repository() else {
        return;
    };

    let flows = match repo.get_unclassified_game_server_flows().await {
        Ok(flows) => flows,
        Err(e) => {
            log::error!("Failed to load unclassified flows: {}", e);
            return;
        }
    };

    let mut voice = 0;
    for (ip, protocol, port) in &flows {
        let kind = classify_ip(ip, protocol, u16::try_from(*port).unwrap_or(0));
        if kind == FlowKind::Voice {
            voice += 1;
        }
        if let Err(e) = repo.classify_flow(ip, protocol, *port, kind).await {
            log::error!("Failed to classify flow {}:{}: {}", ip, port, e);
        }
    }

    if !flows.is_empty() {
        log::info!("Classified {} game-server flows ({} voice)", flows.len(), voice);
    }
}

pub async fn backfill_match_periods() {
    let (Some(repo), Some(_)) = (get_ip_period_repository(), get_resolver()) else {
        return;
    };

    let known = |ip: &str, protocol: &str, port: u16| is_known_game_server(asn_of(ip), protocol, port);
    match repo.merge_closed_match_periods(known).await {
        Ok(merged) if merged.recognised > 0 || merged.absorbed > 0 => log::info!(
            "Recognised {} game-server periods and merged {} match fragments",
            merged.recognised,
            merged.absorbed
        ),
        Ok(_) => {}
        Err(e) => log::error!("Failed to merge match periods: {}", e),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn valorant_voice_on_azure_is_voice() {
        assert_eq!(classify(Some(8069), "UDP", 27020), FlowKind::Voice);
        assert_eq!(classify(Some(8075), "UDP", 27032), FlowKind::Voice);
        assert!(!is_known_game_server(Some(8069), "UDP", 27020));
    }

    #[test]
    fn riot_game_traffic_is_game() {
        assert_eq!(classify(Some(6507), "UDP", 7032), FlowKind::Game);
    }

    #[test]
    fn riot_match_ports_are_known_game_servers() {
        for port in [7002, 7036, 7286, 7492] {
            assert!(is_known_game_server(Some(6507), "UDP", port));
        }
    }

    #[test]
    fn riot_qos_pings_and_other_operators_are_not_known_game_servers() {
        assert!(!is_known_game_server(Some(6507), "UDP", 8181));
        assert!(!is_known_game_server(Some(16509), "UDP", 7032));
        assert!(!is_known_game_server(Some(6507), "TCP", 7032));
        assert!(!is_known_game_server(None, "UDP", 7032));
    }

    #[test]
    fn source_engine_ports_outside_azure_stay_game() {
        assert_eq!(classify(Some(32590), "UDP", 27015), FlowKind::Game);
        assert_eq!(classify(None, "UDP", 27020), FlowKind::Game);
        assert!(!is_known_game_server(Some(32590), "UDP", 27015));
    }

    #[test]
    fn tcp_is_never_voice() {
        assert_eq!(classify(Some(8069), "TCP", 27020), FlowKind::Game);
    }
}

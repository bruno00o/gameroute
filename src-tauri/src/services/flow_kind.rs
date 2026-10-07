use crate::db::get_ip_period_repository;
pub use crate::models::flow_kind::FlowKind;
use crate::services::asn_resolver::get_resolver;
use std::net::IpAddr;
use std::ops::RangeInclusive;

struct VoiceRule {
    asns: &'static [u32],
    ports: RangeInclusive<u16>,
}

const VOICE_RULES: &[VoiceRule] = &[VoiceRule {
    asns: &[8068, 8069, 8075],
    ports: 27000..=27099,
}];

pub fn classify(asn: Option<u32>, protocol: &str, port: u16) -> FlowKind {
    let is_voice = protocol == "UDP"
        && asn.is_some_and(|asn| {
            VOICE_RULES
                .iter()
                .any(|rule| rule.asns.contains(&asn) && rule.ports.contains(&port))
        });

    if is_voice {
        FlowKind::Voice
    } else {
        FlowKind::Game
    }
}

pub fn classify_ip(ip: &str, protocol: &str, port: u16) -> FlowKind {
    let asn = ip
        .parse::<IpAddr>()
        .ok()
        .and_then(|addr| get_resolver().and_then(|resolver| resolver.asn_number(addr)));
    classify(asn, protocol, port)
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn valorant_voice_on_azure_is_voice() {
        assert_eq!(classify(Some(8069), "UDP", 27020), FlowKind::Voice);
        assert_eq!(classify(Some(8075), "UDP", 27032), FlowKind::Voice);
    }

    #[test]
    fn riot_game_traffic_is_game() {
        assert_eq!(classify(Some(6507), "UDP", 7032), FlowKind::Game);
    }

    #[test]
    fn source_engine_ports_outside_azure_stay_game() {
        assert_eq!(classify(Some(32590), "UDP", 27015), FlowKind::Game);
        assert_eq!(classify(None, "UDP", 27020), FlowKind::Game);
    }

    #[test]
    fn tcp_is_never_voice() {
        assert_eq!(classify(Some(8069), "TCP", 27020), FlowKind::Game);
    }
}

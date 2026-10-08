use serde::Serialize;

pub const RIOT_ASN: u32 = 6507;
pub const RIOT_UDP_PORTS: (u16, u16) = (7000, 7999);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GameProfile {
    pub operator: &'static str,
    pub asn: Option<u32>,
    pub udp_ports: Option<(u16, u16)>,
    pub voice_separate: bool,
    pub relay: bool,
}

struct ProfileEntry {
    executables: &'static [&'static str],
    profile: GameProfile,
}

const PROFILES: &[ProfileEntry] = &[
    ProfileEntry {
        executables: &["valorant-win64-shipping.exe", "valorant.exe"],
        profile: GameProfile {
            operator: "Riot Games",
            asn: Some(RIOT_ASN),
            udp_ports: Some(RIOT_UDP_PORTS),
            voice_separate: true,
            relay: false,
        },
    },
    ProfileEntry {
        executables: &["league of legends.exe"],
        profile: GameProfile {
            operator: "Riot Games",
            asn: Some(RIOT_ASN),
            udp_ports: Some(RIOT_UDP_PORTS),
            voice_separate: false,
            relay: false,
        },
    },
    ProfileEntry {
        executables: &["cs2.exe"],
        profile: GameProfile {
            operator: "Valve",
            asn: None,
            udp_ports: None,
            voice_separate: false,
            relay: true,
        },
    },
];

#[cfg(test)]
pub fn all_profiles()-> impl Iterator<Item = GameProfile> {
    PROFILES.iter().map(|entry| entry.profile)
}

pub fn profile_for(executable_name: &str) -> Option<GameProfile> {
    let name = executable_name.trim().to_lowercase();
    PROFILES
        .iter()
        .find(|entry| entry.executables.contains(&name.as_str()))
        .map(|entry| entry.profile)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn valorant_profile_matches_any_casing() {
        let profile = profile_for("VALORANT-Win64-Shipping.exe").unwrap();
        assert_eq!(profile.asn, Some(RIOT_ASN));
        assert_eq!(profile.udp_ports, Some((7000, 7999)));
        assert!(profile.voice_separate);
    }

    #[test]
    fn league_shares_the_riot_range_and_has_no_separate_voice() {
        let profile = profile_for("League of Legends.exe").unwrap();
        assert_eq!(profile.asn, Some(RIOT_ASN));
        assert_eq!(profile.udp_ports, Some(RIOT_UDP_PORTS));
        assert!(!profile.voice_separate);
        assert!(!profile.relay);
    }

    #[test]
    fn cs2_is_a_relay_without_ports() {
        let profile = profile_for("cs2.exe").unwrap();
        assert!(profile.relay);
        assert_eq!(profile.udp_ports, None);
    }

    #[test]
    fn unknown_executable_has_no_profile() {
        assert_eq!(profile_for("RocketLeague.exe"), None);
        assert_eq!(profile_for(""), None);
    }

    #[test]
    fn serializes_ports_as_a_pair() {
        let json = serde_json::to_value(profile_for("valorant.exe").unwrap()).unwrap();
        assert_eq!(json["udpPorts"], serde_json::json!([7000, 7999]));
        assert_eq!(json["voiceSeparate"], serde_json::json!(true));
    }
}

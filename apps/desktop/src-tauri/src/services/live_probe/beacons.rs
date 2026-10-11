use crate::models::live_probe::{Beacon, BeaconProvider, LiveProbeConfig, ProbeProtocol};
use crate::services::game_profiles::RIOT_ASN;

pub const GAMELIFT_PORT: u16 = 7770;
pub const VALVE_ASN: u32 = 32590;
pub const AWS_ASNS: &[u32] = &[16509, 14618];

const GAMELIFT: &[(&str, &str, &[&str])] = &[
    ("eu-west-3", "Paris", &["paris", "france"]),
    (
        "eu-central-1",
        "Frankfurt",
        &["frankfurt", "frankfurt am main", "germany"],
    ),
    ("eu-west-2", "London", &["london", "united kingdom"]),
    ("eu-west-1", "Ireland", &["dublin", "ireland"]),
    ("eu-north-1", "Stockholm", &["stockholm", "sweden"]),
    ("eu-south-1", "Milan", &["milan", "italy"]),
    (
        "us-east-1",
        "N. Virginia",
        &["ashburn", "virginia", "n. virginia"],
    ),
    ("us-east-2", "Ohio", &["columbus", "ohio"]),
    (
        "us-west-1",
        "N. California",
        &["san jose", "san francisco", "n. california"],
    ),
    ("us-west-2", "Oregon", &["oregon", "boardman", "portland"]),
    ("ca-central-1", "Montreal", &["montreal", "canada"]),
    (
        "sa-east-1",
        "São Paulo",
        &["sao paulo", "são paulo", "brazil"],
    ),
    ("ap-northeast-1", "Tokyo", &["tokyo", "japan"]),
    ("ap-northeast-2", "Seoul", &["seoul", "south korea"]),
    ("ap-southeast-1", "Singapore", &["singapore"]),
    ("ap-southeast-2", "Sydney", &["sydney", "australia"]),
    ("ap-south-1", "Mumbai", &["mumbai", "india"]),
    ("me-south-1", "Bahrain", &["bahrain"]),
];

const VALVE_RELAYS: &[(&str, &str, &str, &[&str])] = &[
    ("par", "Paris", "185.25.182.18", &["paris", "france"]),
    (
        "fra",
        "Frankfurt",
        "155.133.226.68",
        &["frankfurt", "frankfurt am main", "germany"],
    ),
    (
        "ams",
        "Amsterdam",
        "155.133.248.36",
        &["amsterdam", "netherlands"],
    ),
    (
        "lhr",
        "London",
        "162.254.196.66",
        &["london", "united kingdom"],
    ),
    ("mad", "Madrid", "155.133.246.34", &["madrid", "spain"]),
    (
        "sto",
        "Stockholm",
        "162.254.198.41",
        &["stockholm", "kista", "sweden"],
    ),
    ("vie", "Vienna", "146.66.155.66", &["vienna", "austria"]),
    ("waw", "Warsaw", "155.133.230.98", &["warsaw", "poland"]),
    (
        "iad",
        "Sterling",
        "162.254.192.88",
        &["sterling", "ashburn", "virginia"],
    ),
    ("ord", "Chicago", "162.254.193.71", &["chicago", "illinois"]),
    ("atl", "Atlanta", "162.254.199.170", &["atlanta", "georgia"]),
    ("dfw", "Dallas", "162.254.194.37", &["dallas", "texas"]),
    (
        "lax",
        "Los Angeles",
        "162.254.195.52",
        &["los angeles", "california"],
    ),
    (
        "sea",
        "Seattle",
        "205.196.6.135",
        &["seattle", "washington"],
    ),
    (
        "gru",
        "São Paulo",
        "155.133.227.35",
        &["sao paulo", "são paulo", "brazil"],
    ),
    ("sgp", "Singapore", "103.10.124.116", &["singapore"]),
    ("tyo", "Tokyo", "45.121.184.5", &["tokyo", "japan"]),
    ("seo", "Seoul", "146.66.152.36", &["seoul", "south korea"]),
    ("hkg", "Hong Kong", "103.28.54.163", &["hong kong"]),
    ("syd", "Sydney", "103.10.125.20", &["sydney", "australia"]),
];

const EPIC: &[(&str, &str, &[&str])] = &[
    (
        "eu",
        "Europe",
        &[
            "france",
            "germany",
            "united kingdom",
            "netherlands",
            "belgium",
            "spain",
            "italy",
            "portugal",
            "ireland",
            "switzerland",
            "austria",
            "poland",
            "sweden",
            "norway",
            "denmark",
            "finland",
            "czechia",
        ],
    ),
    (
        "na-east",
        "NA East",
        &["virginia", "ashburn", "ohio", "new york"],
    ),
    (
        "na-central",
        "NA Central",
        &["texas", "dallas", "illinois", "chicago"],
    ),
    (
        "na-west",
        "NA West",
        &["california", "oregon", "seattle", "washington"],
    ),
    ("br", "Brazil", &["brazil", "sao paulo", "são paulo"]),
    ("me", "Middle East", &["bahrain", "united arab emirates"]),
    (
        "asia",
        "Asia",
        &["japan", "tokyo", "singapore", "south korea"],
    ),
    ("oce", "Oceania", &["australia", "sydney"]),
];

fn places(names: &[&str]) -> Vec<String> {
    names.iter().map(|name| name.to_string()).collect()
}

pub fn default_beacons() -> Vec<Beacon> {
    let gamelift = GAMELIFT.iter().map(|(code, region, names)| Beacon {
        id: format!("gamelift-{code}"),
        provider: BeaconProvider::Gamelift,
        region: region.to_string(),
        host: format!("gamelift-ping.{code}.api.aws"),
        protocol: ProbeProtocol::Udp,
        port: Some(GAMELIFT_PORT),
        places: places(names),
        enabled: true,
    });
    let valve = VALVE_RELAYS.iter().map(|(pop, region, ip, names)| Beacon {
        id: format!("valve-{pop}"),
        provider: BeaconProvider::ValveSdr,
        region: region.to_string(),
        host: ip.to_string(),
        protocol: ProbeProtocol::Icmp,
        port: None,
        places: places(names),
        enabled: true,
    });
    let epic = EPIC.iter().map(|(code, region, names)| Beacon {
        id: format!("epic-{code}"),
        provider: BeaconProvider::Epic,
        region: region.to_string(),
        host: format!("ping-{code}.ds.on.epicgames.com"),
        protocol: ProbeProtocol::Icmp,
        port: None,
        places: places(names),
        enabled: true,
    });
    gamelift.chain(valve).chain(epic).collect()
}

impl Default for LiveProbeConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            floor: true,
            region: true,
            zones: true,
            beacons: default_beacons(),
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct RegionContext<'a> {
    pub game_name: &'a str,
    pub server_asn: Option<u32>,
    pub server_city: Option<&'a str>,
    pub server_country: Option<&'a str>,
    pub game_regions: Vec<String>,
}

pub fn provider_for(context: &RegionContext) -> Option<BeaconProvider> {
    let game = context.game_name.to_lowercase();
    match context.server_asn {
        _ if game.contains("fortnite") => Some(BeaconProvider::Epic),
        Some(VALVE_ASN) => Some(BeaconProvider::ValveSdr),
        Some(asn) if AWS_ASNS.contains(&asn) => Some(BeaconProvider::Gamelift),
        Some(RIOT_ASN) if !context.game_regions.is_empty() => Some(BeaconProvider::Gamelift),
        _ => None,
    }
}

fn hints(context: &RegionContext) -> Vec<String> {
    if context.server_asn == Some(RIOT_ASN) {
        return context
            .game_regions
            .iter()
            .map(|r| r.to_lowercase())
            .collect();
    }
    context
        .game_regions
        .iter()
        .map(String::as_str)
        .chain(context.server_city)
        .chain(context.server_country)
        .map(str::to_lowercase)
        .collect()
}

pub fn choose_beacon<'b>(beacons: &'b [Beacon], context: &RegionContext) -> Option<&'b Beacon> {
    let provider = provider_for(context)?;
    let candidates: Vec<&Beacon> = beacons
        .iter()
        .filter(|beacon| beacon.enabled && beacon.provider == provider)
        .filter(|beacon| beacon.protocol == ProbeProtocol::Icmp || beacon.port.is_some())
        .collect();
    hints(context).iter().find_map(|hint| {
        candidates.iter().copied().find(|beacon| {
            beacon.region.to_lowercase() == *hint
                || beacon
                    .places
                    .iter()
                    .any(|place| place.to_lowercase() == *hint)
        })
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn valorant(regions: &[&str]) -> RegionContext<'static> {
        RegionContext {
            game_name: "VALORANT",
            server_asn: Some(RIOT_ASN),
            server_city: Some("Amsterdam"),
            server_country: Some("Netherlands"),
            game_regions: regions.iter().map(|r| r.to_string()).collect(),
        }
    }

    #[test]
    fn default_table_has_unique_ids_and_usable_targets() {
        let beacons = default_beacons();
        let mut ids: Vec<&str> = beacons.iter().map(|b| b.id.as_str()).collect();
        ids.sort_unstable();
        ids.dedup();
        assert_eq!(ids.len(), beacons.len());
        for beacon in &beacons {
            assert!(beacon.enabled);
            assert!(!beacon.places.is_empty());
            match beacon.provider {
                BeaconProvider::Gamelift => {
                    assert_eq!(beacon.protocol, ProbeProtocol::Udp);
                    assert_eq!(beacon.port, Some(7770));
                    assert!(
                        beacon.host.starts_with("gamelift-ping.")
                            && beacon.host.ends_with(".api.aws")
                    );
                }
                BeaconProvider::ValveSdr => {
                    assert_eq!(beacon.protocol, ProbeProtocol::Icmp);
                    assert!(beacon.host.parse::<std::net::Ipv4Addr>().is_ok());
                }
                BeaconProvider::Epic => {
                    assert_eq!(beacon.protocol, ProbeProtocol::Icmp);
                    assert!(beacon.host.ends_with(".ds.on.epicgames.com"));
                }
            }
        }
        assert_eq!(LiveProbeConfig::default().beacons, beacons);
    }

    #[test]
    fn valorant_uses_the_closest_region_the_game_measured() {
        let beacons = default_beacons();
        let chosen = choose_beacon(&beacons, &valorant(&["Paris", "Frankfurt", "London"])).unwrap();
        assert_eq!(chosen.id, "gamelift-eu-west-3");
        assert_eq!(chosen.region, "Paris");

        let chosen = choose_beacon(&beacons, &valorant(&["Warsaw", "Frankfurt"])).unwrap();
        assert_eq!(chosen.id, "gamelift-eu-central-1");
    }

    #[test]
    fn riot_server_location_is_never_trusted() {
        let beacons = default_beacons();
        assert_eq!(choose_beacon(&beacons, &valorant(&[])), None);
        let league = RegionContext {
            game_name: "League of Legends",
            ..valorant(&[])
        };
        assert_eq!(choose_beacon(&beacons, &league), None);
    }

    #[test]
    fn hosted_games_follow_their_operator() {
        let beacons = default_beacons();
        let cs2 = RegionContext {
            game_name: "Counter-Strike 2",
            server_asn: Some(VALVE_ASN),
            server_city: Some("Frankfurt am Main"),
            server_country: Some("Germany"),
            game_regions: Vec::new(),
        };
        assert_eq!(choose_beacon(&beacons, &cs2).unwrap().id, "valve-fra");

        let aws = RegionContext {
            game_name: "Some AWS Game",
            server_asn: Some(16509),
            server_city: None,
            server_country: Some("Sweden"),
            game_regions: Vec::new(),
        };
        assert_eq!(
            choose_beacon(&beacons, &aws).unwrap().id,
            "gamelift-eu-north-1"
        );

        let fortnite = RegionContext {
            game_name: "Fortnite",
            server_asn: Some(16509),
            server_city: Some("Frankfurt am Main"),
            server_country: Some("Germany"),
            game_regions: Vec::new(),
        };
        assert_eq!(choose_beacon(&beacons, &fortnite).unwrap().id, "epic-eu");

        let unknown = RegionContext {
            game_name: "Rocket League",
            server_asn: Some(3356),
            server_city: Some("Paris"),
            server_country: Some("France"),
            game_regions: Vec::new(),
        };
        assert_eq!(choose_beacon(&beacons, &unknown), None);
    }

    #[test]
    fn disabled_or_incomplete_beacons_are_skipped() {
        let mut beacons = default_beacons();
        beacons
            .iter_mut()
            .filter(|b| b.id == "gamelift-eu-west-3")
            .for_each(|b| b.enabled = false);
        let context = valorant(&["Paris", "Frankfurt"]);
        assert_eq!(
            choose_beacon(&beacons, &context).unwrap().id,
            "gamelift-eu-central-1"
        );

        beacons
            .iter_mut()
            .filter(|b| b.id == "gamelift-eu-central-1")
            .for_each(|b| b.port = None);
        assert_eq!(choose_beacon(&beacons, &context), None);
    }
}

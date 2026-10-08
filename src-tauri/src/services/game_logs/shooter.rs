use super::zone::LogZone;
use crate::models::game_ping::GamePingSample;
use crate::models::insights::PingSource;
use chrono::{DateTime, NaiveDateTime, Utc};
use std::net::IpAddr;

const ENDPOINT_PREFIX: &str = "aresriot.";
const TRAVEL: &str = "LogTravelManager: Beginning travel to ";
const BURST_LOSS: &str = "Burst Loss Detected!";

#[derive(Debug, Clone, PartialEq)]
pub enum ShooterEvent {
    RegionPings(Vec<(String, f64)>),
    Travel(Option<(String, i32)>),
    BurstLoss(i64),
}

pub fn log_opened_at(first_line: &str, zone: LogZone) -> Option<DateTime<Utc>> {
    let stamp = first_line.trim().strip_prefix("Log file open, ")?;
    zone.to_utc(NaiveDateTime::parse_from_str(stamp, "%m/%d/%y %H:%M:%S").ok()?)
}

fn timestamp(line: &str) -> Option<(DateTime<Utc>, &str)> {
    let rest = line.strip_prefix('[')?;
    let (stamp, rest) = rest.split_once(']')?;
    let at = NaiveDateTime::parse_from_str(stamp, "%Y.%m.%d-%H.%M.%S:%3f").ok()?;
    let rest = rest
        .strip_prefix('[')
        .and_then(|rest| rest.split_once(']'))?
        .1;
    Some((at.and_utc(), rest))
}

pub fn region_name(endpoint: &str) -> String {
    let city = endpoint.rsplit("-gp-").next().unwrap_or(endpoint);
    let city = city
        .rsplit_once('-')
        .filter(|(_, n)| !n.is_empty() && n.chars().all(|c| c.is_ascii_digit()))
        .map_or(city, |(city, _)| city);
    let mut chars = city.chars();
    chars.next().map_or_else(String::new, |first| {
        first.to_uppercase().chain(chars).collect()
    })
}

fn region_pings(text: &str) -> Vec<(String, f64)> {
    text.match_indices(ENDPOINT_PREFIX)
        .filter_map(|(start, _)| {
            let token = text[start..].split(['&', ']', ' ', ',']).next()?;
            let (endpoint, ms) = token.split_once('=')?;
            Some((region_name(endpoint), ms.parse::<f64>().ok()?))
        })
        .collect()
}

fn travel_target(text: &str) -> Option<(String, i32)> {
    let (ip, port) = text.trim().rsplit_once(':')?;
    let ip: IpAddr = ip.parse().ok()?;
    Some((ip.to_string(), port.parse::<u16>().ok()?.into()))
}

pub fn parse_line(line: &str) -> Option<(DateTime<Utc>, ShooterEvent)> {
    let (at, text) = timestamp(line)?;
    let event = if let Some(target) = text.strip_prefix(TRAVEL) {
        ShooterEvent::Travel(travel_target(target))
    } else if let Some((_, rest)) = text.split_once(BURST_LOSS) {
        let packets = rest.split_whitespace().next()?.parse().ok()?;
        ShooterEvent::BurstLoss(packets)
    } else if text.contains(ENDPOINT_PREFIX) {
        let pings = region_pings(text);
        if pings.is_empty() {
            return None;
        }
        ShooterEvent::RegionPings(pings)
    } else {
        return None;
    };
    Some((at, event))
}

#[derive(Default)]
pub struct ShooterParser {
    target: Option<(String, i32)>,
}

impl ShooterParser {
    pub fn push(&mut self, line: &str) -> Vec<GamePingSample> {
        let Some((at, event)) = parse_line(line) else {
            return Vec::new();
        };
        match event {
            ShooterEvent::Travel(target) => {
                self.target = target;
                Vec::new()
            }
            ShooterEvent::BurstLoss(packets) => {
                let Some((ip, port)) = &self.target else {
                    return Vec::new();
                };
                let mut sample = GamePingSample::new(PingSource::Game, at);
                sample.peer_ip = Some(ip.clone());
                sample.peer_port = Some(*port);
                sample.packets_lost = Some(packets);
                vec![sample]
            }
            ShooterEvent::RegionPings(pings) => pings
                .into_iter()
                .map(|(region, ms)| {
                    let mut sample = GamePingSample::new(PingSource::GameRegion, at);
                    sample.region = Some(region);
                    sample.rtt_ms = Some(ms);
                    sample
                })
                .collect(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::super::zone::offset;
    use super::*;
    use chrono::TimeZone;

    const FIXTURE: &str = include_str!("../../../tests/fixtures/game_logs/ShooterGame.txt");

    fn utc(h: u32, m: u32, s: u32, ms: u32) -> DateTime<Utc> {
        Utc.with_ymd_and_hms(2026, 10, 4, h, m, s).unwrap()
            + chrono::Duration::milliseconds(ms.into())
    }

    #[test]
    fn region_pings_are_read_from_the_party_requests() {
        let line = "[2026.10.04-13.13.11:009][912]LogPlatformCommon: Platform HTTP Query End. QueryName: [Party_RefreshPings], URL [POST https://glz-eu-1.eu.a.pvp.net/parties/v1/parties/00000000-0000-0000-0000-000000000000/members/00000000-0000-0000-0000-000000000000/refreshPings?aresriot.aws-euc1-prod.eu-gp-frankfurt-1=13&aresriot.aws-euw2-prod.eu-gp-london-1=14&aresriot.aws-euw3-prod.eu-gp-paris-1=4&aresriot.aws-ist1-prod.eu-gp-istanbul-2=42&preferredgamepods=aresriot.aws-euw2-prod.eu-gp-london-1,aresriot.aws-euc1-prod.eu-gp-frankfurt-1], @trace_id:0 Response Code: [200]";

        assert_eq!(
            parse_line(line),
            Some((
                utc(13, 13, 11, 9),
                ShooterEvent::RegionPings(vec![
                    ("Frankfurt".to_string(), 13.0),
                    ("London".to_string(), 14.0),
                    ("Paris".to_string(), 4.0),
                    ("Istanbul".to_string(), 42.0),
                ])
            ))
        );
    }

    #[test]
    fn failed_region_pings_and_other_lines_are_ignored() {
        for line in [
            "[2026.10.04-13.02.38:459][213]LogPingManager: Warning: Failure to ping endpoint aresriot.aws-euw3-prod.eu-gp-paris-1, not reporting stats.",
            "[2026.10.04-13.02.40:389][482]LogTravelManagerX: something",
            "Log file open, 10/04/26 15:02:14",
            "",
        ] {
            assert_eq!(parse_line(line), None, "{line}");
        }
    }

    #[test]
    fn travel_names_the_match_server_or_leaves_it() {
        assert_eq!(
            parse_line("[2026.10.04-13.04.49:716][167]LogTravelManager: Beginning travel to 185.40.64.1:7164"),
            Some((
                utc(13, 4, 49, 716),
                ShooterEvent::Travel(Some(("185.40.64.1".to_string(), 7164)))
            ))
        );
        assert_eq!(
            parse_line("[2026.10.04-13.02.40:389][482]LogTravelManager: Beginning travel to /Game/Maps/Menu/MainMenuV2"),
            Some((utc(13, 2, 40, 389), ShooterEvent::Travel(None)))
        );
    }

    #[test]
    fn burst_loss_is_tied_to_the_server_travelled_to() {
        let samples: Vec<GamePingSample> = {
            let mut parser = ShooterParser::default();
            FIXTURE.lines().flat_map(|line| parser.push(line)).collect()
        };

        let regions: Vec<(&str, f64)> = samples
            .iter()
            .filter(|s| s.source == PingSource::GameRegion)
            .map(|s| (s.region.as_deref().unwrap(), s.rtt_ms.unwrap()))
            .collect();
        assert_eq!(
            regions,
            vec![("Frankfurt", 13.0), ("London", 14.0), ("Paris", 4.0)]
        );

        let losses: Vec<(&str, Option<i32>, Option<i64>)> = samples
            .iter()
            .filter(|s| s.source == PingSource::Game)
            .map(|s| (s.measured_at.as_str(), s.peer_port, s.packets_lost))
            .collect();
        assert_eq!(
            losses,
            vec![
                ("2026-10-04T13:15:56.177Z", Some(7097), Some(15)),
                ("2026-10-04T13:18:46.693Z", Some(7097), Some(3)),
            ]
        );
        assert!(samples
            .iter()
            .all(|s| s.rtt_ms.is_some() != (s.source == PingSource::Game)));
    }

    #[test]
    fn region_names_drop_the_shard_and_index() {
        assert_eq!(region_name("aresriot.aws-euw3-prod.eu-gp-paris-1"), "Paris");
        assert_eq!(
            region_name("aresriot.aws-use1-prod.na-gp-ashburn-1"),
            "Ashburn"
        );
        assert_eq!(
            region_name("aresriot.aws-ist1-prod.eu-gp-istanbul-2"),
            "Istanbul"
        );
        assert_eq!(region_name("custom"), "Custom");
    }

    #[test]
    fn log_opening_time_is_local_while_lines_are_utc() {
        let header = "Log file open, 10/04/26 15:02:14";

        assert_eq!(log_opened_at(header, offset(2)), Some(utc(13, 2, 14, 0)));
        assert_eq!(log_opened_at(header, offset(0)), Some(utc(15, 2, 14, 0)));
        assert_eq!(log_opened_at("garbage", offset(2)), None);
    }
}

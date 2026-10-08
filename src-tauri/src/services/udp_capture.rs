//! UDP port extraction for game processes.
//!
//! Uses netstat2 to find local UDP ports bound by the target PIDs.
//! These ports are then sent to the capture service for packet monitoring.

use netstat2::{get_sockets_info, AddressFamilyFlags, ProtocolFlags, ProtocolSocketInfo};
use std::collections::{HashMap, HashSet};
use std::net::IpAddr;

/// Get all local UDP ports bound by the given PIDs.
///
/// Returns a deduplicated list of port numbers that can be passed to the
/// capture service for monitoring outgoing UDP traffic.
pub fn get_udp_local_ports(target_pids: &HashSet<u32>) -> Vec<u16> {
    let af_flags = AddressFamilyFlags::IPV4 | AddressFamilyFlags::IPV6;
    let proto_flags = ProtocolFlags::UDP;

    let sockets = match get_sockets_info(af_flags, proto_flags) {
        Ok(s) => s,
        Err(e) => {
            log::warn!("Failed to enumerate UDP sockets: {}", e);
            return Vec::new();
        }
    };

    let mut ports: HashSet<u16> = HashSet::new();

    for socket in sockets {
        let matches_pid = socket
            .associated_pids
            .iter()
            .any(|pid| target_pids.contains(pid));

        if !matches_pid {
            continue;
        }

        if let ProtocolSocketInfo::Udp(udp_info) = &socket.protocol_socket_info {
            let port = udp_info.local_port;
            // Skip ephemeral/system ports that are unlikely to be game traffic
            if port > 0 {
                ports.insert(port);
            }
        }
    }

    let result: Vec<u16> = ports.into_iter().collect();

    if !result.is_empty() {
        log::info!(
            "UDP port scan: found {} ports for {} PIDs: {:?}",
            result.len(),
            target_pids.len(),
            result
        );
    }

    result
}

const DISCOVERY_PORTS: &[u16] = &[137, 138, 1900, 3702, 5353, 5355];

fn is_game_candidate_socket(local_addr: IpAddr, local_port: u16) -> bool {
    local_port > 0 && !local_addr.is_loopback() && !DISCOVERY_PORTS.contains(&local_port)
}

/// Count UDP sockets per PID, ignoring loopback and local discovery sockets.
pub fn udp_socket_counts() -> HashMap<u32, u32> {
    let af_flags = AddressFamilyFlags::IPV4 | AddressFamilyFlags::IPV6;
    let sockets = match get_sockets_info(af_flags, ProtocolFlags::UDP) {
        Ok(s) => s,
        Err(e) => {
            log::warn!("Failed to enumerate UDP sockets: {}", e);
            return HashMap::new();
        }
    };

    let mut counts: HashMap<u32, u32> = HashMap::new();
    for socket in sockets {
        let ProtocolSocketInfo::Udp(udp_info) = &socket.protocol_socket_info else {
            continue;
        };
        if !is_game_candidate_socket(udp_info.local_addr, udp_info.local_port) {
            continue;
        }
        for pid in &socket.associated_pids {
            *counts.entry(*pid).or_default() += 1;
        }
    }
    counts
}

pub fn count_for_pids(counts: &HashMap<u32, u32>, pids: &[u32]) -> u32 {
    pids.iter().filter_map(|pid| counts.get(pid)).sum()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn discovery_and_loopback_sockets_are_not_game_candidates() {
        let lan: IpAddr = "192.168.1.20".parse().unwrap();
        assert!(is_game_candidate_socket(lan, 50000));
        assert!(is_game_candidate_socket("::".parse().unwrap(), 7032));
        assert!(!is_game_candidate_socket(lan, 5353));
        assert!(!is_game_candidate_socket(lan, 0));
        assert!(!is_game_candidate_socket("127.0.0.1".parse().unwrap(), 50000));
        assert!(!is_game_candidate_socket("::1".parse().unwrap(), 50000));
    }

    #[test]
    fn sockets_are_summed_over_every_pid_of_an_app() {
        let counts = HashMap::from([(10, 2), (11, 1), (12, 5)]);
        assert_eq!(count_for_pids(&counts, &[10, 11]), 3);
        assert_eq!(count_for_pids(&counts, &[99]), 0);
        assert_eq!(count_for_pids(&counts, &[]), 0);
    }

    #[test]
    fn test_empty_pids_returns_empty() {
        let pids = HashSet::new();
        let ports = get_udp_local_ports(&pids);
        assert!(ports.is_empty());
    }

    #[test]
    fn test_nonexistent_pid_returns_empty() {
        let mut pids = HashSet::new();
        // Use an unlikely PID
        pids.insert(999999999);
        let ports = get_udp_local_ports(&pids);
        assert!(ports.is_empty());
    }
}

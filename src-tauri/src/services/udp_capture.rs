//! UDP port extraction for game processes.
//!
//! Uses netstat2 to find local UDP ports bound by the target PIDs.
//! These ports are then sent to the capture service for packet monitoring.

use netstat2::{get_sockets_info, AddressFamilyFlags, ProtocolFlags, ProtocolSocketInfo};
use std::collections::HashSet;

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

#[cfg(test)]
mod tests {
    use super::*;

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

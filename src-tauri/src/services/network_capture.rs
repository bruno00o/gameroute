use crate::models::CapturedConnection;
use netstat2::{get_sockets_info, AddressFamilyFlags, ProtocolFlags, ProtocolSocketInfo, TcpState};
use std::collections::HashSet;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};

/// Capture active TCP connections for a set of PIDs (process tree).
pub fn capture_connections_for_pids(target_pids: &HashSet<u32>) -> Vec<CapturedConnection> {
    let af_flags = AddressFamilyFlags::IPV4 | AddressFamilyFlags::IPV6;
    let proto_flags = ProtocolFlags::UDP | ProtocolFlags::TCP;

    let sockets = match get_sockets_info(af_flags, proto_flags) {
        Ok(s) => s,
        Err(e) => {
            log::warn!("Failed to enumerate network sockets: {}", e);
            return Vec::new();
        }
    };

    let mut connections = Vec::new();
    let mut seen_ips: HashSet<String> = HashSet::new();

    for socket in sockets {
        let matches_pid = socket
            .associated_pids
            .iter()
            .any(|pid| target_pids.contains(pid));
        if !matches_pid {
            continue;
        }

        let (remote_ip, remote_port, protocol): (String, u16, String) =
            match &socket.protocol_socket_info {
                ProtocolSocketInfo::Udp(_) => {
                    continue;
                }
                ProtocolSocketInfo::Tcp(tcp_info) => {
                    if tcp_info.state != TcpState::Established {
                        continue;
                    }

                    let ip_str = tcp_info.remote_addr.to_string();
                    (ip_str, tcp_info.remote_port, "TCP".to_string())
                }
            };

        if is_private_or_special_ip(&remote_ip) {
            continue;
        }

        if seen_ips.contains(&remote_ip) {
            continue;
        }
        seen_ips.insert(remote_ip.clone());

        log::debug!(
            "Captured connection for PID tree ({} PIDs): {}:{} ({})",
            target_pids.len(),
            remote_ip,
            remote_port,
            protocol
        );

        connections.push(CapturedConnection::new(remote_ip, remote_port, protocol));
    }

    connections
}

fn is_private_or_special_ip(ip: &str) -> bool {
    let addr: IpAddr = match ip.parse() {
        Ok(a) => a,
        Err(_) => return true,
    };

    match addr {
        IpAddr::V4(v4) => is_private_or_special_v4(v4),
        IpAddr::V6(v6) => is_private_or_special_v6(v6),
    }
}

fn is_private_or_special_v4(addr: Ipv4Addr) -> bool {
    let octets = addr.octets();

    // Loopback (127.0.0.0/8)
    if octets[0] == 127 {
        return true;
    }
    // Class A private (10.0.0.0/8)
    if octets[0] == 10 {
        return true;
    }
    // Class B private (172.16.0.0/12)
    if octets[0] == 172 && (16..=31).contains(&octets[1]) {
        return true;
    }
    // Class C private (192.168.0.0/16)
    if octets[0] == 192 && octets[1] == 168 {
        return true;
    }
    // Link-local (169.254.0.0/16)
    if octets[0] == 169 && octets[1] == 254 {
        return true;
    }
    // Multicast (224.0.0.0/4)
    if (224..=239).contains(&octets[0]) {
        return true;
    }
    // Broadcast
    if octets == [255, 255, 255, 255] {
        return true;
    }
    // Unspecified
    if octets == [0, 0, 0, 0] {
        return true;
    }

    false
}

fn is_private_or_special_v6(addr: Ipv6Addr) -> bool {
    // Loopback (::1)
    if addr.is_loopback() {
        return true;
    }
    // Unspecified (::)
    if addr.is_unspecified() {
        return true;
    }

    let segments = addr.segments();

    // Link-local (fe80::/10)
    if segments[0] & 0xffc0 == 0xfe80 {
        return true;
    }
    // Unique local (fc00::/7)
    if segments[0] & 0xfe00 == 0xfc00 {
        return true;
    }
    // Multicast (ff00::/8)
    if segments[0] & 0xff00 == 0xff00 {
        return true;
    }

    false
}

#[cfg(test)]
mod tests {
    use super::*;

    // IPv4 tests

    #[test]
    fn test_private_ips_filtered() {
        assert!(is_private_or_special_ip("10.0.0.1"));
        assert!(is_private_or_special_ip("10.255.255.255"));
        assert!(is_private_or_special_ip("172.16.0.1"));
        assert!(is_private_or_special_ip("172.31.255.255"));
        assert!(is_private_or_special_ip("192.168.0.1"));
        assert!(is_private_or_special_ip("192.168.255.255"));
    }

    #[test]
    fn test_loopback_filtered() {
        assert!(is_private_or_special_ip("127.0.0.1"));
        assert!(is_private_or_special_ip("127.255.255.255"));
    }

    #[test]
    fn test_link_local_filtered() {
        assert!(is_private_or_special_ip("169.254.0.1"));
        assert!(is_private_or_special_ip("169.254.255.255"));
    }

    #[test]
    fn test_multicast_filtered() {
        assert!(is_private_or_special_ip("224.0.0.1"));
        assert!(is_private_or_special_ip("239.255.255.255"));
    }

    #[test]
    fn test_broadcast_filtered() {
        assert!(is_private_or_special_ip("255.255.255.255"));
    }

    #[test]
    fn test_unspecified_filtered() {
        assert!(is_private_or_special_ip("0.0.0.0"));
    }

    #[test]
    fn test_public_ips_not_filtered() {
        assert!(!is_private_or_special_ip("8.8.8.8"));
        assert!(!is_private_or_special_ip("1.1.1.1"));
        assert!(!is_private_or_special_ip("185.60.112.157"));
        assert!(!is_private_or_special_ip("104.16.0.1"));
        assert!(!is_private_or_special_ip("172.15.255.255"));
        assert!(!is_private_or_special_ip("172.32.0.1"));
    }

    #[test]
    fn test_invalid_ip_filtered() {
        assert!(is_private_or_special_ip("invalid"));
        assert!(is_private_or_special_ip(""));
        assert!(is_private_or_special_ip("256.256.256.256"));
    }

    // IPv6 tests

    #[test]
    fn test_ipv6_loopback_filtered() {
        assert!(is_private_or_special_ip("::1"));
    }

    #[test]
    fn test_ipv6_unspecified_filtered() {
        assert!(is_private_or_special_ip("::"));
    }

    #[test]
    fn test_ipv6_link_local_filtered() {
        assert!(is_private_or_special_ip("fe80::1"));
        assert!(is_private_or_special_ip("fe80::abcd:1234:5678:9abc"));
    }

    #[test]
    fn test_ipv6_unique_local_filtered() {
        assert!(is_private_or_special_ip("fc00::1"));
        assert!(is_private_or_special_ip("fd00::1"));
        assert!(is_private_or_special_ip("fdab:cdef:1234::1"));
    }

    #[test]
    fn test_ipv6_multicast_filtered() {
        assert!(is_private_or_special_ip("ff02::1"));
        assert!(is_private_or_special_ip("ff05::1:3"));
    }

    #[test]
    fn test_ipv6_public_not_filtered() {
        assert!(!is_private_or_special_ip("2001:4860:4860::8888"));
        assert!(!is_private_or_special_ip("2606:4700:4700::1111"));
        assert!(!is_private_or_special_ip("2a00:1450:4007:80e::200e"));
    }
}

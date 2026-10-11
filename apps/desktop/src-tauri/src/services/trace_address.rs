use std::net::{IpAddr, ToSocketAddrs};

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum TraceAddressError {
    #[error("not an IP address or a host name")]
    Invalid,
    #[error("the host name does not resolve")]
    Unresolved,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TraceAddress {
    Ip(IpAddr),
    Host(String),
}

fn is_traceable(ip: &IpAddr) -> bool {
    !(ip.is_unspecified() || ip.is_loopback() || ip.is_multicast())
}

fn is_host_label(label: &str) -> bool {
    !label.is_empty()
        && label.len() <= 63
        && !label.starts_with('-')
        && !label.ends_with('-')
        && label.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
}

fn is_host_name(host: &str) -> bool {
    let host = host.strip_suffix('.').unwrap_or(host);
    host.contains('.') && host.len() <= 253 && host.split('.').all(is_host_label)
}

pub fn parse_address(input: &str) -> Result<TraceAddress, TraceAddressError> {
    let input = input.trim();
    if let Ok(ip) = input.parse::<IpAddr>() {
        return if is_traceable(&ip) {
            Ok(TraceAddress::Ip(ip))
        } else {
            Err(TraceAddressError::Invalid)
        };
    }
    let looks_numeric = input.chars().all(|c| c.is_ascii_digit() || c == '.');
    if !looks_numeric && is_host_name(input) {
        Ok(TraceAddress::Host(input.to_string()))
    } else {
        Err(TraceAddressError::Invalid)
    }
}

pub fn prefer_ipv4(addresses: impl IntoIterator<Item = IpAddr>) -> Option<IpAddr> {
    let traceable: Vec<IpAddr> = addresses.into_iter().filter(is_traceable).collect();
    traceable
        .iter()
        .find(|ip| ip.is_ipv4())
        .or_else(|| traceable.first())
        .copied()
}

pub async fn resolve_address(input: &str) -> Result<IpAddr, TraceAddressError> {
    match parse_address(input)? {
        TraceAddress::Ip(ip) => Ok(ip),
        TraceAddress::Host(host) => {
            let found = tokio::task::spawn_blocking(move || {
                (host.as_str(), 0)
                    .to_socket_addrs()
                    .map(|addresses| addresses.map(|a| a.ip()).collect::<Vec<_>>())
            })
            .await
            .map_err(|_| TraceAddressError::Unresolved)?
            .map_err(|_| TraceAddressError::Unresolved)?;
            prefer_ipv4(found).ok_or(TraceAddressError::Unresolved)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_ipv4_and_ipv6_literals() {
        assert_eq!(
            parse_address(" 162.249.72.1 "),
            Ok(TraceAddress::Ip("162.249.72.1".parse().unwrap()))
        );
        assert_eq!(
            parse_address("2606:4700:4700::1111"),
            Ok(TraceAddress::Ip("2606:4700:4700::1111".parse().unwrap()))
        );
    }

    #[test]
    fn accepts_host_names() {
        assert_eq!(
            parse_address("example.com"),
            Ok(TraceAddress::Host("example.com".to_string()))
        );
        assert_eq!(
            parse_address("ping-eu.example.net."),
            Ok(TraceAddress::Host("ping-eu.example.net.".to_string()))
        );
    }

    #[test]
    fn rejects_what_is_not_an_address() {
        for input in [
            "",
            "   ",
            "localhost",
            "162.249.72",
            "999.1.1.1",
            "1.2.3.4.5",
            "exa mple.com",
            "-bad.example.com",
            "example..com",
            "http://example.com",
            "example.com/path",
            "example.com:443",
        ] {
            assert_eq!(
                parse_address(input),
                Err(TraceAddressError::Invalid),
                "{input}"
            );
        }
    }

    #[test]
    fn rejects_addresses_that_cannot_be_traced() {
        for input in ["0.0.0.0", "127.0.0.1", "::1", "224.0.0.1"] {
            assert_eq!(
                parse_address(input),
                Err(TraceAddressError::Invalid),
                "{input}"
            );
        }
    }

    #[test]
    fn prefers_an_ipv4_answer() {
        let v6: IpAddr = "2606:4700::1".parse().unwrap();
        let v4: IpAddr = "104.18.0.1".parse().unwrap();
        assert_eq!(prefer_ipv4([v6, v4]), Some(v4));
        assert_eq!(prefer_ipv4([v6]), Some(v6));
        assert_eq!(prefer_ipv4([]), None);
    }

    #[tokio::test]
    async fn literal_addresses_resolve_without_a_lookup() {
        assert_eq!(
            resolve_address("162.249.72.1").await,
            Ok("162.249.72.1".parse().unwrap())
        );
        assert_eq!(
            resolve_address("nope").await,
            Err(TraceAddressError::Invalid)
        );
    }
}

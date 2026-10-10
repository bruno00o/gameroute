use std::collections::HashMap;
use std::net::IpAddr;
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use serde::Serialize;

use crate::platform::dns::reverse_lookup;
use crate::services::network_capture::is_private_or_special_ip;

pub const MAX_BATCH: usize = 64;
const LOOKUP_TIMEOUT: Duration = Duration::from_secs(4);
const MAX_CACHED: usize = 4096;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostnameEntry {
    pub ip: String,
    pub hostname: Option<String>,
}

type Lookup = fn(IpAddr) -> Option<String>;

pub struct ReverseDns {
    lookup: Lookup,
    cache: Mutex<HashMap<IpAddr, Option<String>>>,
}

pub fn get_reverse_dns() -> &'static ReverseDns {
    static INSTANCE: OnceLock<ReverseDns> = OnceLock::new();
    INSTANCE.get_or_init(|| ReverseDns::new(reverse_lookup))
}

fn lookable(ip: &IpAddr) -> bool {
    let carrier_nat = match ip {
        IpAddr::V4(v4) => v4.octets()[0] == 100 && (64..128).contains(&v4.octets()[1]),
        IpAddr::V6(_) => false,
    };
    !carrier_nat && !is_private_or_special_ip(&ip.to_string())
}

impl ReverseDns {
    pub fn new(lookup: Lookup) -> Self {
        Self {
            lookup,
            cache: Mutex::new(HashMap::new()),
        }
    }

    fn cached(&self, ip: &IpAddr) -> Option<Option<String>> {
        self.cache
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .get(ip)
            .cloned()
    }

    fn remember(&self, ip: IpAddr, hostname: Option<String>) {
        let mut cache = self.cache.lock().unwrap_or_else(|e| e.into_inner());
        if cache.len() >= MAX_CACHED {
            cache.clear();
        }
        cache.insert(ip, hostname);
    }

    async fn resolve_one(&self, ip: IpAddr) -> Option<String> {
        if let Some(hostname) = self.cached(&ip) {
            return hostname;
        }
        let lookup = self.lookup;
        let task = tokio::task::spawn_blocking(move || lookup(ip));
        match tokio::time::timeout(LOOKUP_TIMEOUT, task).await {
            Ok(Ok(hostname)) => {
                self.remember(ip, hostname.clone());
                hostname
            }
            _ => None,
        }
    }

    pub async fn resolve(&self, ips: &[String]) -> Vec<HostnameEntry> {
        let mut seen = Vec::new();
        for ip in ips.iter().filter_map(|ip| ip.parse::<IpAddr>().ok()) {
            if lookable(&ip) && !seen.contains(&ip) && seen.len() < MAX_BATCH {
                seen.push(ip);
            }
        }
        let names = futures::future::join_all(seen.iter().map(|&ip| self.resolve_one(ip))).await;
        seen.into_iter()
            .zip(names)
            .map(|(ip, hostname)| HostnameEntry {
                ip: ip.to_string(),
                hostname,
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    static CALLS: AtomicUsize = AtomicUsize::new(0);

    fn fake(ip: IpAddr) -> Option<String> {
        CALLS.fetch_add(1, Ordering::SeqCst);
        match ip.to_string().as_str() {
            "62.115.118.58" => Some("prs-bb1-link.ip.twelve99.net".to_string()),
            _ => None,
        }
    }

    fn ips(list: &[&str]) -> Vec<String> {
        list.iter().map(|ip| ip.to_string()).collect()
    }

    #[tokio::test]
    async fn resolves_public_addresses_once_and_skips_private_ones() {
        let dns = ReverseDns::new(fake);
        let before = CALLS.load(Ordering::SeqCst);
        let list = ips(&[
            "192.168.1.1",
            "10.0.10.1",
            "100.72.1.1",
            "not-an-ip",
            "62.115.118.58",
            "62.115.118.58",
            "86.69.254.18",
        ]);

        let first = dns.resolve(&list).await;
        assert_eq!(
            first,
            vec![
                HostnameEntry {
                    ip: "62.115.118.58".to_string(),
                    hostname: Some("prs-bb1-link.ip.twelve99.net".to_string()),
                },
                HostnameEntry {
                    ip: "86.69.254.18".to_string(),
                    hostname: None,
                },
            ]
        );
        assert_eq!(dns.resolve(&list).await, first);
        assert_eq!(CALLS.load(Ordering::SeqCst) - before, 2);
    }

    #[tokio::test]
    async fn caps_the_batch() {
        let dns = ReverseDns::new(|_| None);
        let list: Vec<String> = (0..100).map(|i| format!("62.115.1.{i}")).collect();
        assert_eq!(dns.resolve(&list).await.len(), MAX_BATCH);
    }
}

use crate::db::get_ip_metadata_repository;
use crate::models::asn::{AsnInfo, GeoLocation, IpApiResponse, ResolvedIpData};
use crate::models::ip_metadata::IpMetadataData;
use crate::services::cache_ttl::{now_iso8601, should_use_cache, CacheDecision};
use lru::LruCache;
use std::net::{Ipv4Addr, Ipv6Addr};
use std::num::NonZeroUsize;
use std::sync::Arc;
use std::time::{Duration, Instant};
use thiserror::Error;
use tokio::sync::Mutex;

use crate::config::{
    ASN_MAX_BATCH_SIZE, ASN_MAX_RETRIES, ASN_MEMORY_CACHE_CAPACITY, ASN_MIN_REQUEST_INTERVAL,
    ASN_OFFLINE_RETRY_INTERVAL, IP_API_BATCH_URL,
};

#[derive(Debug, Error)]
pub enum AsnError {
    #[error("HTTP request failed: {0}")]
    HttpError(#[from] reqwest::Error),

    #[error("Rate limit exceeded, try again later")]
    RateLimitExceeded,

    #[error("Invalid response from ip-api.com")]
    InvalidResponse,
}

struct RateLimiter {
    last_request: Mutex<Instant>,
}

impl RateLimiter {
    fn new() -> Self {
        Self {
            last_request: Mutex::new(Instant::now() - ASN_MIN_REQUEST_INTERVAL),
        }
    }

    async fn wait_if_needed(&self) {
        let mut last = self.last_request.lock().await;
        let elapsed = last.elapsed();

        if elapsed < ASN_MIN_REQUEST_INTERVAL {
            let wait_time = ASN_MIN_REQUEST_INTERVAL - elapsed;
            log::info!(
                "Rate limiting: waiting {} ms before ip-api.com request",
                wait_time.as_millis()
            );
            tokio::time::sleep(wait_time).await;
        }

        *last = Instant::now();
    }
}

pub struct AsnResolver {
    client: reqwest::Client,
    rate_limiter: RateLimiter,
    memory_cache: Mutex<LruCache<String, ResolvedIpData>>,
    went_offline_at: Mutex<Option<Instant>>,
}

impl AsnResolver {
    pub fn new() -> Self {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(30))
            .build()
            .unwrap_or_else(|e| {
                log::warn!(
                    "Failed to create HTTP client with custom config: {}, using defaults",
                    e
                );
                reqwest::Client::new()
            });

        Self {
            client,
            rate_limiter: RateLimiter::new(),
            memory_cache: Mutex::new(LruCache::new(
                NonZeroUsize::new(ASN_MEMORY_CACHE_CAPACITY).unwrap(),
            )),
            went_offline_at: Mutex::new(None),
        }
    }

    pub async fn resolve_batch(&self, ips: Vec<String>) -> Result<Vec<ResolvedIpData>, AsnError> {
        let mut results: Vec<ResolvedIpData> = Vec::new();
        let mut ips_to_resolve: Vec<String> = Vec::new();
        let is_offline = {
            let offline_at = self.went_offline_at.lock().await;
            match *offline_at {
                Some(when) if when.elapsed() < ASN_OFFLINE_RETRY_INTERVAL => true,
                Some(_) => {
                    log::info!(
                        "Offline cooldown expired ({}s), will retry API",
                        ASN_OFFLINE_RETRY_INTERVAL.as_secs()
                    );
                    false
                }
                None => false,
            }
        };

        {
            let mut memory_cache = self.memory_cache.lock().await;

            for ip in ips {
                if is_private_ip(&ip) {
                    log::debug!("IP {} is private, skipping resolution", ip);
                    results.push(ResolvedIpData::private_ip(ip));
                    continue;
                }

                if let Some(cached) = memory_cache.get(&ip) {
                    log::debug!("L1 cache hit for IP {}", ip);
                    results.push(cached.clone());
                    continue;
                }

                if let Some(resolved) = self.check_sqlite_cache(&ip, is_offline).await {
                    log::debug!("L2 cache hit for IP {}", ip);
                    results.push(resolved);
                    continue;
                }

                if !ips_to_resolve.contains(&ip) {
                    ips_to_resolve.push(ip);
                }
            }
        }

        if ips_to_resolve.is_empty() {
            log::debug!("All IPs resolved from cache, no API call needed");
            return Ok(results);
        }

        if is_offline {
            log::warn!(
                "Offline mode: {} IPs could not be resolved from cache",
                ips_to_resolve.len()
            );
            for ip in ips_to_resolve {
                results.push(ResolvedIpData::failed(ip));
            }
            return Ok(results);
        }

        let api_results = self.resolve_from_api(ips_to_resolve).await?;

        {
            let mut memory_cache = self.memory_cache.lock().await;

            for resolved in api_results {
                memory_cache.put(resolved.ip.clone(), resolved.clone());

                self.save_to_sqlite_cache(&resolved).await;

                results.push(resolved);
            }
        }

        log::info!("ASN resolution complete: {} IPs resolved", results.len());
        Ok(results)
    }

    async fn check_sqlite_cache(&self, ip: &str, is_offline: bool) -> Option<ResolvedIpData> {
        let repo = get_ip_metadata_repository()?;
        let metadata = repo.get_metadata(ip).await.ok().flatten()?;
        let decision = should_use_cache(&metadata.resolved_at, is_offline);

        match decision {
            CacheDecision::UseCache | CacheDecision::PreferCacheAllowRefresh => {
                log::debug!(
                    "SQLite cache valid for IP {} (decision: {:?})",
                    ip,
                    decision
                );
                Some(self.build_resolved_from_metadata(ip, &metadata))
            }
            CacheDecision::UseStaleCache => {
                log::warn!("Using stale SQLite cache for IP {} (offline mode)", ip);
                Some(self.build_resolved_from_metadata(ip, &metadata))
            }
            CacheDecision::RequireRefresh => {
                log::debug!("SQLite cache stale for IP {}, will refresh", ip);
                None
            }
        }
    }

    fn build_resolved_from_metadata(
        &self,
        ip: &str,
        metadata: &crate::models::ip_metadata::IpMetadata,
    ) -> ResolvedIpData {
        ResolvedIpData {
            ip: ip.to_string(),
            asn_info: AsnInfo {
                asn: metadata.asn.clone(),
                isp: metadata.isp.clone(),
                org: metadata.org.clone(),
            },
            geo: GeoLocation {
                lat: metadata.lat,
                lon: metadata.lon,
                city: metadata.city.clone(),
                country: metadata.country.clone(),
            },
        }
    }

    async fn save_to_sqlite_cache(&self, resolved: &ResolvedIpData) {
        let Some(repo) = get_ip_metadata_repository() else {
            log::debug!("SQLite cache not initialized, skipping persist");
            return;
        };

        let now = now_iso8601();

        let data = IpMetadataData {
            ip: resolved.ip.clone(),
            asn: resolved.asn_info.asn.clone(),
            isp: resolved.asn_info.isp.clone(),
            org: resolved.asn_info.org.clone(),
            country: resolved.geo.country.clone(),
            city: resolved.geo.city.clone(),
            lat: resolved.geo.lat,
            lon: resolved.geo.lon,
            resolved_at: now,
        };

        if let Err(e) = repo.upsert_metadata(&data).await {
            log::warn!("Failed to save IP metadata for {}: {}", resolved.ip, e);
        } else {
            log::debug!("Saved to SQLite cache: {}", resolved.ip);
        }
    }

    async fn resolve_from_api(&self, ips: Vec<String>) -> Result<Vec<ResolvedIpData>, AsnError> {
        let mut results = Vec::new();

        for chunk in ips.chunks(ASN_MAX_BATCH_SIZE) {
            self.rate_limiter.wait_if_needed().await;

            log::info!(
                "Resolving {} IPs via ip-api.com batch endpoint",
                chunk.len()
            );

            let mut last_error: Option<AsnError> = None;
            let mut api_responses: Option<Vec<IpApiResponse>> = None;

            for attempt in 1..=ASN_MAX_RETRIES {
                let response = match self.client.post(IP_API_BATCH_URL).json(&chunk).send().await {
                    Ok(r) => r,
                    Err(e) => {
                        log::warn!(
                            "ip-api.com request failed (attempt {}/{}): {}",
                            attempt,
                            ASN_MAX_RETRIES,
                            e
                        );

                        if e.is_connect() || e.is_timeout() {
                            *self.went_offline_at.lock().await = Some(Instant::now());
                        }
                        last_error = Some(AsnError::HttpError(e));
                        if attempt < ASN_MAX_RETRIES {
                            tokio::time::sleep(Duration::from_secs(1)).await;
                        }
                        continue;
                    }
                };

                *self.went_offline_at.lock().await = None;

                if response.status() == reqwest::StatusCode::TOO_MANY_REQUESTS {
                    log::warn!("ip-api.com rate limit exceeded (HTTP 429)");
                    return Err(AsnError::RateLimitExceeded);
                }

                if !response.status().is_success() {
                    log::error!("ip-api.com returned error: {}", response.status());
                    last_error = Some(AsnError::InvalidResponse);
                    if attempt < ASN_MAX_RETRIES {
                        tokio::time::sleep(Duration::from_secs(1)).await;
                    }
                    continue;
                }

                match response.json::<Vec<IpApiResponse>>().await {
                    Ok(responses) => {
                        api_responses = Some(responses);
                        break;
                    }
                    Err(e) => {
                        log::warn!("Failed to parse ip-api.com response: {}", e);
                        last_error = Some(AsnError::HttpError(e));
                        if attempt < ASN_MAX_RETRIES {
                            tokio::time::sleep(Duration::from_secs(1)).await;
                        }
                    }
                }
            }

            let api_responses = match api_responses {
                Some(r) => r,
                None => return Err(last_error.unwrap_or(AsnError::InvalidResponse)),
            };

            for api_response in api_responses {
                let resolved = if api_response.status == "success" {
                    ResolvedIpData::from_api_response(&api_response)
                } else {
                    log::debug!(
                        "ip-api.com failed for IP {}: status={}",
                        api_response.query,
                        api_response.status
                    );
                    ResolvedIpData::failed(api_response.query.clone())
                };

                results.push(resolved);
            }
        }

        Ok(results)
    }

    pub async fn clear_cache(&self) {
        {
            let mut cache = self.memory_cache.lock().await;
            cache.clear();
        }

        log::info!("ASN memory cache cleared");
    }

    pub async fn cache_stats(&self) -> CacheStats {
        let memory_count = {
            let cache = self.memory_cache.lock().await;
            cache.len()
        };

        CacheStats {
            memory_entries: memory_count,
        }
    }
}

#[derive(Debug, Clone)]
pub struct CacheStats {
    pub memory_entries: usize,
}

impl Default for AsnResolver {
    fn default() -> Self {
        Self::new()
    }
}

pub fn is_private_ip(ip: &str) -> bool {
    if let Ok(addr) = ip.parse::<Ipv4Addr>() {
        let octets = addr.octets();
        return match octets[0] {
            10 => true,
            172 => (16..=31).contains(&octets[1]),
            192 => octets[1] == 168,
            127 => true,
            169 => octets[1] == 254,
            _ => false,
        };
    }

    if let Ok(addr) = ip.parse::<Ipv6Addr>() {
        if addr.is_loopback() {
            return true;
        }
        let segments = addr.segments();

        if segments[0] & 0xffc0 == 0xfe80 {
            return true;
        }

        if segments[0] & 0xfe00 == 0xfc00 {
            return true;
        }
        return false;
    }

    false
}

static ASN_RESOLVER: std::sync::OnceLock<Arc<AsnResolver>> = std::sync::OnceLock::new();

pub fn get_resolver() -> Arc<AsnResolver> {
    ASN_RESOLVER
        .get_or_init(|| Arc::new(AsnResolver::new()))
        .clone()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_private_ip_class_a() {
        assert!(is_private_ip("10.0.0.1"));
        assert!(is_private_ip("10.255.255.255"));
    }

    #[test]
    fn test_is_private_ip_class_b() {
        assert!(is_private_ip("172.16.0.1"));
        assert!(is_private_ip("172.31.255.255"));
        assert!(!is_private_ip("172.15.0.1"));
        assert!(!is_private_ip("172.32.0.1"));
    }

    #[test]
    fn test_is_private_ip_class_c() {
        assert!(is_private_ip("192.168.0.1"));
        assert!(is_private_ip("192.168.255.255"));
        assert!(!is_private_ip("192.167.0.1"));
    }

    #[test]
    fn test_is_private_ip_loopback() {
        assert!(is_private_ip("127.0.0.1"));
        assert!(is_private_ip("127.255.255.255"));
    }

    #[test]
    fn test_is_private_ip_link_local() {
        assert!(is_private_ip("169.254.0.1"));
        assert!(is_private_ip("169.254.255.255"));
    }

    #[test]
    fn test_is_private_ip_public() {
        assert!(!is_private_ip("8.8.8.8"));
        assert!(!is_private_ip("1.1.1.1"));
        assert!(!is_private_ip("185.60.112.157"));
        assert!(!is_private_ip("208.80.152.201"));
    }

    #[test]
    fn test_is_private_ip_invalid() {
        assert!(!is_private_ip("invalid"));
        assert!(!is_private_ip(""));
    }

    #[test]
    fn test_is_private_ip_ipv6_loopback() {
        assert!(is_private_ip("::1"));
    }

    #[test]
    fn test_is_private_ip_ipv6_link_local() {
        assert!(is_private_ip("fe80::1"));
        assert!(is_private_ip("fe80::abcd:1234:5678:9abc"));
    }

    #[test]
    fn test_is_private_ip_ipv6_unique_local() {
        assert!(is_private_ip("fc00::1"));
        assert!(is_private_ip("fd00::1"));
        assert!(is_private_ip("fdab:cdef:1234::1"));
    }

    #[test]
    fn test_is_private_ip_ipv6_public() {
        assert!(!is_private_ip("2001:4860:4860::8888"));
        assert!(!is_private_ip("2606:4700:4700::1111"));
    }
}

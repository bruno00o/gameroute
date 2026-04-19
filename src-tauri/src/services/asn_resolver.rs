use super::network_capture::is_private_or_special_ip;
use crate::db::get_ip_metadata_repository;
use crate::models::asn::{AsnInfo, GeoLocation, ResolvedIpData};
use crate::models::ip_metadata::IpMetadataData;
use chrono::Utc;
use maxminddb::{geoip2, MaxMindDBError, Reader};
use std::net::IpAddr;
use std::path::Path;
use std::sync::{Arc, OnceLock};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum AsnError {
    #[error("MaxMind DB error: {0}")]
    MaxMindError(#[from] MaxMindDBError),
}

pub struct AsnResolver {
    city_reader: Reader<Vec<u8>>,
    asn_reader: Reader<Vec<u8>>,
}

impl AsnResolver {
    pub fn new(city_db: &Path, asn_db: &Path) -> Result<Self, AsnError> {
        let city_reader = Reader::open_readfile(city_db)?;
        let asn_reader = Reader::open_readfile(asn_db)?;
        log::info!(
            "GeoLite2 databases loaded (City build: {}, ASN build: {})",
            city_reader.metadata.build_epoch,
            asn_reader.metadata.build_epoch
        );
        Ok(Self {
            city_reader,
            asn_reader,
        })
    }

    pub async fn resolve_batch(&self, ips: Vec<String>) -> Result<Vec<ResolvedIpData>, AsnError> {
        let mut results = Vec::with_capacity(ips.len());

        for ip_str in ips {
            if is_private_or_special_ip(&ip_str) {
                log::debug!("IP {} is private, skipping resolution", ip_str);
                results.push(ResolvedIpData::private_ip(ip_str));
                continue;
            }

            let ip: IpAddr = match ip_str.parse() {
                Ok(ip) => ip,
                Err(_) => {
                    log::warn!("Invalid IP address: {}", ip_str);
                    results.push(ResolvedIpData::failed(ip_str));
                    continue;
                }
            };

            let resolved = self.lookup(ip, &ip_str);
            self.save_to_sqlite_cache(&resolved).await;
            results.push(resolved);
        }

        log::debug!("ASN resolution complete: {} IPs resolved", results.len());
        Ok(results)
    }

    fn lookup(&self, ip: IpAddr, ip_str: &str) -> ResolvedIpData {
        let asn_info = match self.asn_reader.lookup::<geoip2::Asn>(ip) {
            Ok(asn) => AsnInfo {
                asn: asn.autonomous_system_number.map(|n| format!("AS{}", n)),
                isp: asn.autonomous_system_organization.map(String::from),
                org: asn.autonomous_system_organization.map(String::from),
            },
            Err(MaxMindDBError::AddressNotFoundError(_)) => AsnInfo::default(),
            Err(e) => {
                log::warn!("ASN lookup failed for {}: {}", ip_str, e);
                AsnInfo::default()
            }
        };

        let geo = match self.city_reader.lookup::<geoip2::City>(ip) {
            Ok(city) => GeoLocation {
                lat: city.location.as_ref().and_then(|l| l.latitude),
                lon: city.location.as_ref().and_then(|l| l.longitude),
                city: city
                    .city
                    .as_ref()
                    .and_then(|c| c.names.as_ref())
                    .and_then(|n| n.get("en").copied())
                    .map(String::from),
                country: city
                    .country
                    .as_ref()
                    .and_then(|c| c.names.as_ref())
                    .and_then(|n| n.get("en").copied())
                    .map(String::from),
            },
            Err(MaxMindDBError::AddressNotFoundError(_)) => GeoLocation::default(),
            Err(e) => {
                log::warn!("City lookup failed for {}: {}", ip_str, e);
                GeoLocation::default()
            }
        };

        ResolvedIpData {
            ip: ip_str.to_string(),
            asn_info,
            geo,
        }
    }

    async fn save_to_sqlite_cache(&self, resolved: &ResolvedIpData) {
        let Some(repo) = get_ip_metadata_repository() else {
            return;
        };

        let data = IpMetadataData {
            ip: resolved.ip.clone(),
            asn: resolved.asn_info.asn.clone(),
            isp: resolved.asn_info.isp.clone(),
            org: resolved.asn_info.org.clone(),
            country: resolved.geo.country.clone(),
            city: resolved.geo.city.clone(),
            lat: resolved.geo.lat,
            lon: resolved.geo.lon,
            resolved_at: Utc::now().to_rfc3339(),
        };

        if let Err(e) = repo.upsert_metadata(&data).await {
            log::warn!("Failed to save IP metadata for {}: {}", resolved.ip, e);
        }
    }

}

static ASN_RESOLVER: OnceLock<Arc<AsnResolver>> = OnceLock::new();

pub fn init_resolver(city_db: &Path, asn_db: &Path) -> Result<(), AsnError> {
    let resolver = AsnResolver::new(city_db, asn_db)?;
    if ASN_RESOLVER.set(Arc::new(resolver)).is_err() {
        log::warn!("ASN resolver already initialized");
    }
    Ok(())
}

pub fn get_resolver() -> Option<Arc<AsnResolver>> {
    ASN_RESOLVER.get().cloned()
}

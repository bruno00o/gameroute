use crate::db::get_ip_metadata_repository;
use crate::models::ResolvedIpData;
use crate::services::asn_resolver;
use std::net::IpAddr;

const MAX_RESOLVE_BATCH: usize = 500;

#[derive(Debug, Clone, serde::Serialize)]
pub struct AsnCommandError {
    pub code: String,
    pub message: String,
}

impl From<asn_resolver::AsnError> for AsnCommandError {
    fn from(e: asn_resolver::AsnError) -> Self {
        match e {
            asn_resolver::AsnError::RateLimitExceeded => Self {
                code: "RATE_LIMIT_EXCEEDED".to_string(),
                message: "Rate limit reached, please try again in a few moments".to_string(),
            },
            asn_resolver::AsnError::HttpError(_) => Self {
                code: "NETWORK_ERROR".to_string(),
                message: "Unable to reach the resolution service".to_string(),
            },
            asn_resolver::AsnError::InvalidResponse => Self {
                code: "INVALID_RESPONSE".to_string(),
                message: "Invalid response from the resolution service".to_string(),
            },
        }
    }
}

#[tauri::command]
pub async fn resolve_asn(ips: Vec<String>) -> Result<Vec<ResolvedIpData>, AsnCommandError> {
    log::info!("resolve_asn called with {} IPs", ips.len());

    if ips.is_empty() {
        log::debug!("No IPs to resolve, returning empty list");
        return Ok(Vec::new());
    }

    if ips.len() > MAX_RESOLVE_BATCH {
        return Err(AsnCommandError {
            code: "BATCH_TOO_LARGE".to_string(),
            message: format!("Maximum {} IPs per request", MAX_RESOLVE_BATCH),
        });
    }

    let valid_ips: Vec<String> = ips
        .into_iter()
        .filter(|ip| {
            if ip.parse::<IpAddr>().is_ok() {
                true
            } else {
                log::warn!("Skipping invalid IP address: {}", ip);
                false
            }
        })
        .collect();

    if valid_ips.is_empty() {
        return Ok(Vec::new());
    }

    let resolver = asn_resolver::get_resolver();

    let result = resolver.resolve_batch(valid_ips).await?;

    log::info!("ASN resolution complete: {} results", result.len());
    Ok(result)
}

#[tauri::command]
pub async fn clear_ip_metadata_cache() -> Result<(), AsnCommandError> {
    log::info!("Clearing IP metadata cache");

    let resolver = asn_resolver::get_resolver();
    resolver.clear_cache().await;

    if let Some(repo) = get_ip_metadata_repository() {
        if let Err(e) = repo.clear_all().await {
            log::error!("Failed to clear IP metadata cache: {}", e);
        }
    }

    Ok(())
}

#[tauri::command]
pub async fn get_ip_metadata_stats() -> Result<IpMetadataCacheStats, AsnCommandError> {
    let resolver = asn_resolver::get_resolver();
    let memory_stats = resolver.cache_stats().await;

    let mut stats = IpMetadataCacheStats {
        memory_entries: memory_stats.memory_entries,
        sqlite_entries: 0,
        entries_with_asn: 0,
        entries_with_geo: 0,
        oldest_entry: None,
    };

    if let Some(repo) = get_ip_metadata_repository() {
        if let Ok(db_stats) = repo.get_stats().await {
            stats.sqlite_entries = db_stats.total_entries;
            stats.entries_with_asn = db_stats.entries_with_asn;
            stats.entries_with_geo = db_stats.entries_with_geo;
            stats.oldest_entry = db_stats.oldest_entry;
        }
    }

    Ok(stats)
}

#[tauri::command]
pub async fn prune_ip_metadata_cache() -> Result<PruneCacheResult, AsnCommandError> {
    log::info!("Pruning expired IP metadata cache entries");

    let mut deleted = 0;

    if let Some(repo) = get_ip_metadata_repository() {
        match repo.prune_expired(30).await {
            Ok(count) => deleted = count,
            Err(e) => log::error!("Failed to prune IP metadata cache: {}", e),
        }
    }

    Ok(PruneCacheResult {
        entries_deleted: deleted,
    })
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IpMetadataCacheStats {
    pub memory_entries: usize,

    pub sqlite_entries: usize,

    pub entries_with_asn: usize,

    pub entries_with_geo: usize,

    pub oldest_entry: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PruneCacheResult {
    pub entries_deleted: usize,
}

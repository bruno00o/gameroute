use crate::db::DbError;
use crate::models::ip_metadata::{IpMetadata, IpMetadataData};
use sqlx::sqlite::SqlitePool;
use sqlx::QueryBuilder;
use std::sync::{Arc, OnceLock};

pub struct IpMetadataRepository {
    pool: SqlitePool,
}

#[allow(dead_code)] // Methods used via Tauri commands (invisible to clippy)
impl IpMetadataRepository {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }

    pub async fn get_metadata(&self, ip: &str) -> Result<Option<IpMetadata>, DbError> {
        sqlx::query_as::<_, IpMetadata>(
            "SELECT ip, asn, isp, org, country, city, lat, lon, resolved_at
             FROM ip_metadata WHERE ip = $1",
        )
        .bind(ip)
        .fetch_optional(&self.pool)
        .await
        .map_err(Into::into)
    }

    pub async fn upsert_metadata(&self, data: &IpMetadataData) -> Result<(), DbError> {
        sqlx::query(
            r#"
            INSERT INTO ip_metadata (ip, asn, isp, org, country, city, lat, lon, resolved_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            ON CONFLICT(ip) DO UPDATE SET
                asn = excluded.asn,
                isp = excluded.isp,
                org = excluded.org,
                country = excluded.country,
                city = excluded.city,
                lat = excluded.lat,
                lon = excluded.lon,
                resolved_at = excluded.resolved_at
            "#,
        )
        .bind(&data.ip)
        .bind(&data.asn)
        .bind(&data.isp)
        .bind(&data.org)
        .bind(&data.country)
        .bind(&data.city)
        .bind(data.lat)
        .bind(data.lon)
        .bind(&data.resolved_at)
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    pub async fn insert_metadata(&self, metadata: &IpMetadata) -> Result<(), DbError> {
        self.upsert_metadata(&IpMetadataData::from(metadata.clone()))
            .await
    }

    pub async fn get_metadata_batch(
        &self,
        ips: &[String],
    ) -> Result<Vec<(String, Option<IpMetadata>)>, DbError> {
        if ips.is_empty() {
            return Ok(Vec::new());
        }

        let mut query_builder: QueryBuilder<sqlx::Sqlite> = QueryBuilder::new(
            "SELECT ip, asn, isp, org, country, city, lat, lon, resolved_at FROM ip_metadata WHERE ip IN (",
        );

        let mut separated = query_builder.separated(", ");
        for ip in ips {
            separated.push_bind(ip);
        }
        separated.push_unseparated(")");

        let rows = query_builder
            .build_query_as::<IpMetadata>()
            .fetch_all(&self.pool)
            .await?;

        let mut found: std::collections::HashMap<String, IpMetadata> =
            std::collections::HashMap::new();
        for metadata in rows {
            found.insert(metadata.ip.clone(), metadata);
        }

        Ok(ips
            .iter()
            .map(|ip| (ip.clone(), found.remove(ip)))
            .collect())
    }

    pub async fn get_all_cached_ips(&self) -> Result<Vec<String>, DbError> {
        let rows: Vec<(String,)> = sqlx::query_as("SELECT ip FROM ip_metadata")
            .fetch_all(&self.pool)
            .await?;

        Ok(rows.into_iter().map(|r| r.0).collect())
    }

    pub async fn prune_expired(&self, max_age_days: i64) -> Result<usize, DbError> {
        let cutoff = chrono::Utc::now()
            .checked_sub_signed(chrono::Duration::days(max_age_days))
            .unwrap()
            .to_rfc3339();

        let result = sqlx::query("DELETE FROM ip_metadata WHERE resolved_at < $1")
            .bind(&cutoff)
            .execute(&self.pool)
            .await?;

        let deleted = result.rows_affected() as usize;

        log::info!(
            "Cache pruned: {} entries deleted (older than {} days)",
            deleted,
            max_age_days
        );

        Ok(deleted)
    }

    pub async fn clear_all(&self) -> Result<(), DbError> {
        sqlx::query("DELETE FROM ip_metadata")
            .execute(&self.pool)
            .await?;

        log::info!("All IP metadata cache cleared");
        Ok(())
    }

    pub async fn get_stats(&self) -> Result<CacheStats, DbError> {
        let total_count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM ip_metadata")
            .fetch_one(&self.pool)
            .await?;

        let with_asn: (i64,) = sqlx::query_as(
            "SELECT COUNT(*) FROM ip_metadata WHERE asn IS NOT NULL OR isp IS NOT NULL",
        )
        .fetch_one(&self.pool)
        .await?;

        let with_geo: (i64,) = sqlx::query_as(
            "SELECT COUNT(*) FROM ip_metadata WHERE lat IS NOT NULL AND lon IS NOT NULL",
        )
        .fetch_one(&self.pool)
        .await?;

        let oldest_entry: Option<String> =
            sqlx::query_as::<_, (Option<String>,)>("SELECT MIN(resolved_at) FROM ip_metadata")
                .fetch_one(&self.pool)
                .await
                .map(|r| r.0)
                .unwrap_or(None);

        Ok(CacheStats {
            total_entries: total_count.0 as usize,
            entries_with_asn: with_asn.0 as usize,
            entries_with_geo: with_geo.0 as usize,
            oldest_entry,
        })
    }
}

#[derive(Debug, Clone)]
pub struct CacheStats {
    pub total_entries: usize,
    pub entries_with_asn: usize,
    pub entries_with_geo: usize,
    pub oldest_entry: Option<String>,
}

static IP_METADATA_REPOSITORY: OnceLock<Arc<IpMetadataRepository>> = OnceLock::new();

pub fn init_ip_metadata_repository(pool: SqlitePool) {
    let repo = IpMetadataRepository::new(pool);
    let _ = IP_METADATA_REPOSITORY.set(Arc::new(repo));
    log::info!("IP Metadata repository initialized");
}

pub fn get_ip_metadata_repository() -> Option<Arc<IpMetadataRepository>> {
    IP_METADATA_REPOSITORY.get().cloned()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::create_test_pool;

    async fn create_test_repo() -> IpMetadataRepository {
        let pool = create_test_pool().await;
        IpMetadataRepository::new(pool)
    }

    #[tokio::test]
    async fn test_upsert_and_get() {
        let repo = create_test_repo().await;

        let data = IpMetadataData {
            ip: "8.8.8.8".to_string(),
            asn: Some("AS15169".to_string()),
            isp: Some("Google LLC".to_string()),
            org: Some("Google Public DNS".to_string()),
            country: Some("United States".to_string()),
            city: Some("Mountain View".to_string()),
            lat: Some(37.386),
            lon: Some(-122.084),
            resolved_at: "2026-01-25T10:00:00Z".to_string(),
        };

        repo.upsert_metadata(&data).await.unwrap();

        let retrieved = repo.get_metadata("8.8.8.8").await.unwrap().unwrap();
        assert_eq!(retrieved.asn, Some("AS15169".to_string()));
        assert_eq!(retrieved.isp, Some("Google LLC".to_string()));
        assert!((retrieved.lat.unwrap() - 37.386).abs() < 0.001);
    }

    #[tokio::test]
    async fn test_upsert_updates_existing() {
        let repo = create_test_repo().await;

        let data1 = IpMetadataData {
            ip: "8.8.8.8".to_string(),
            asn: Some("AS15169".to_string()),
            isp: Some("Old ISP".to_string()),
            org: None,
            country: None,
            city: None,
            lat: None,
            lon: None,
            resolved_at: "2026-01-20T10:00:00Z".to_string(),
        };
        repo.upsert_metadata(&data1).await.unwrap();

        let data2 = IpMetadataData {
            ip: "8.8.8.8".to_string(),
            asn: Some("AS15169".to_string()),
            isp: Some("New ISP".to_string()),
            org: None,
            country: None,
            city: None,
            lat: None,
            lon: None,
            resolved_at: "2026-01-25T10:00:00Z".to_string(),
        };
        repo.upsert_metadata(&data2).await.unwrap();

        let retrieved = repo.get_metadata("8.8.8.8").await.unwrap().unwrap();
        assert_eq!(retrieved.isp, Some("New ISP".to_string()));
        assert_eq!(retrieved.resolved_at, "2026-01-25T10:00:00Z");
    }

    #[tokio::test]
    async fn test_cache_miss() {
        let repo = create_test_repo().await;
        let result = repo.get_metadata("1.2.3.4").await.unwrap();
        assert!(result.is_none());
    }

    #[tokio::test]
    async fn test_batch_get() {
        let repo = create_test_repo().await;

        for ip in ["1.1.1.1", "8.8.8.8", "9.9.9.9"] {
            repo.upsert_metadata(&IpMetadataData {
                ip: ip.to_string(),
                asn: Some(format!("AS-{}", ip)),
                isp: None,
                org: None,
                country: None,
                city: None,
                lat: None,
                lon: None,
                resolved_at: "2026-01-25T10:00:00Z".to_string(),
            })
            .await
            .unwrap();
        }

        let ips = vec![
            "1.1.1.1".to_string(),
            "2.2.2.2".to_string(),
            "8.8.8.8".to_string(),
        ];
        let results = repo.get_metadata_batch(&ips).await.unwrap();

        assert_eq!(results.len(), 3);
        assert!(results[0].1.is_some());
        assert!(results[1].1.is_none());
        assert!(results[2].1.is_some());
    }

    #[tokio::test]
    async fn test_cache_stats() {
        let repo = create_test_repo().await;

        repo.upsert_metadata(&IpMetadataData {
            ip: "1.1.1.1".to_string(),
            asn: Some("AS13335".to_string()),
            isp: Some("Cloudflare".to_string()),
            org: None,
            country: None,
            city: None,
            lat: Some(37.0),
            lon: Some(-122.0),
            resolved_at: "2026-01-25T10:00:00Z".to_string(),
        })
        .await
        .unwrap();

        repo.upsert_metadata(&IpMetadataData {
            ip: "2.2.2.2".to_string(),
            asn: None,
            isp: None,
            org: None,
            country: Some("US".to_string()),
            city: None,
            lat: None,
            lon: None,
            resolved_at: "2026-01-25T10:00:00Z".to_string(),
        })
        .await
        .unwrap();

        let stats = repo.get_stats().await.unwrap();
        assert_eq!(stats.total_entries, 2);
        assert_eq!(stats.entries_with_asn, 1);
        assert_eq!(stats.entries_with_geo, 1);
    }

    #[tokio::test]
    async fn test_clear_all() {
        let repo = create_test_repo().await;

        repo.upsert_metadata(&IpMetadataData {
            ip: "1.1.1.1".to_string(),
            asn: Some("AS13335".to_string()),
            isp: None,
            org: None,
            country: None,
            city: None,
            lat: None,
            lon: None,
            resolved_at: "2026-01-25T10:00:00Z".to_string(),
        })
        .await
        .unwrap();

        repo.clear_all().await.unwrap();

        let stats = repo.get_stats().await.unwrap();
        assert_eq!(stats.total_entries, 0);
    }
}

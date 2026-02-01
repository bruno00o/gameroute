use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct IpMetadata {
    pub ip: String,
    pub asn: Option<String>,
    pub isp: Option<String>,
    pub org: Option<String>,
    pub country: Option<String>,
    pub city: Option<String>,
    pub lat: Option<f64>,
    pub lon: Option<f64>,
    pub resolved_at: String,
}

#[allow(dead_code)]
impl IpMetadata {
    #[allow(clippy::too_many_arguments)]
    pub fn from_resolution(
        ip: String,
        asn: Option<String>,
        isp: Option<String>,
        org: Option<String>,
        country: Option<String>,
        city: Option<String>,
        lat: Option<f64>,
        lon: Option<f64>,
        resolved_at: String,
    ) -> Self {
        Self {
            ip,
            asn,
            isp,
            org,
            country,
            city,
            lat,
            lon,
            resolved_at,
        }
    }

    pub fn has_coordinates(&self) -> bool {
        self.lat.is_some() && self.lon.is_some()
    }

    pub fn has_asn(&self) -> bool {
        self.asn.is_some() || self.isp.is_some()
    }
}

#[derive(Debug, Clone)]
pub struct IpMetadataData {
    pub ip: String,
    pub asn: Option<String>,
    pub isp: Option<String>,
    pub org: Option<String>,
    pub country: Option<String>,
    pub city: Option<String>,
    pub lat: Option<f64>,
    pub lon: Option<f64>,
    pub resolved_at: String,
}

impl From<IpMetadata> for IpMetadataData {
    fn from(metadata: IpMetadata) -> Self {
        Self {
            ip: metadata.ip,
            asn: metadata.asn,
            isp: metadata.isp,
            org: metadata.org,
            country: metadata.country,
            city: metadata.city,
            lat: metadata.lat,
            lon: metadata.lon,
            resolved_at: metadata.resolved_at,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_ip_metadata_serialization() {
        let metadata = IpMetadata {
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

        let json = serde_json::to_string(&metadata).unwrap();
        assert!(json.contains("resolvedAt"));
        assert!(json.contains("Google LLC"));
    }

    #[test]
    fn test_has_coordinates() {
        let with_coords = IpMetadata {
            ip: "8.8.8.8".to_string(),
            asn: None,
            isp: None,
            org: None,
            country: None,
            city: None,
            lat: Some(37.0),
            lon: Some(-122.0),
            resolved_at: "2026-01-25T10:00:00Z".to_string(),
        };
        assert!(with_coords.has_coordinates());

        let without_coords = IpMetadata {
            ip: "8.8.8.8".to_string(),
            asn: None,
            isp: None,
            org: None,
            country: None,
            city: None,
            lat: None,
            lon: None,
            resolved_at: "2026-01-25T10:00:00Z".to_string(),
        };
        assert!(!without_coords.has_coordinates());
    }

    #[test]
    fn test_has_asn() {
        let with_asn = IpMetadata {
            ip: "8.8.8.8".to_string(),
            asn: Some("AS15169".to_string()),
            isp: None,
            org: None,
            country: None,
            city: None,
            lat: None,
            lon: None,
            resolved_at: "2026-01-25T10:00:00Z".to_string(),
        };
        assert!(with_asn.has_asn());

        let with_isp = IpMetadata {
            ip: "8.8.8.8".to_string(),
            asn: None,
            isp: Some("Google".to_string()),
            org: None,
            country: None,
            city: None,
            lat: None,
            lon: None,
            resolved_at: "2026-01-25T10:00:00Z".to_string(),
        };
        assert!(with_isp.has_asn());
    }
}

use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize)]
pub struct IpApiResponse {
    pub status: String,
    pub query: String,
    #[serde(rename = "as")]
    pub asn_string: Option<String>,
    pub isp: Option<String>,
    pub org: Option<String>,
    pub lat: Option<f64>,
    pub lon: Option<f64>,
    pub city: Option<String>,
    pub country: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AsnInfo {
    pub asn: Option<String>,

    pub isp: Option<String>,

    pub org: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct GeoLocation {
    pub lat: Option<f64>,
    pub lon: Option<f64>,
    pub city: Option<String>,
    pub country: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedIpData {
    pub ip: String,
    pub asn_info: AsnInfo,
    pub geo: GeoLocation,
}

impl ResolvedIpData {
    pub fn from_api_response(response: &IpApiResponse) -> Self {
        Self {
            ip: response.query.clone(),
            asn_info: AsnInfo {
                asn: parse_asn_number(response.asn_string.as_deref()),
                isp: response.isp.clone(),
                org: response.org.clone(),
            },
            geo: GeoLocation {
                lat: response.lat,
                lon: response.lon,
                city: response.city.clone(),
                country: response.country.clone(),
            },
        }
    }

    pub fn private_ip(ip: String) -> Self {
        Self {
            ip,
            asn_info: AsnInfo::default(),
            geo: GeoLocation::default(),
        }
    }

    pub fn failed(ip: String) -> Self {
        Self {
            ip,
            asn_info: AsnInfo::default(),
            geo: GeoLocation::default(),
        }
    }
}

pub fn parse_asn_number(asn_string: Option<&str>) -> Option<String> {
    asn_string.and_then(|s| {
        let trimmed = s.trim();
        if trimmed.is_empty() {
            return None;
        }

        if trimmed.starts_with("AS") {
            let asn_part = trimmed
                .split_whitespace()
                .next()
                .filter(|part| part.starts_with("AS") && part.len() > 2);
            asn_part.map(|s| s.to_string())
        } else {
            None
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_asn_number_full_string() {
        assert_eq!(
            parse_asn_number(Some("AS14907 Wikimedia Foundation Inc")),
            Some("AS14907".to_string())
        );
    }

    #[test]
    fn test_parse_asn_number_only() {
        assert_eq!(
            parse_asn_number(Some("AS12345")),
            Some("AS12345".to_string())
        );
    }

    #[test]
    fn test_parse_asn_number_empty() {
        assert_eq!(parse_asn_number(Some("")), None);
        assert_eq!(parse_asn_number(None), None);
    }

    #[test]
    fn test_parse_asn_number_invalid() {
        assert_eq!(parse_asn_number(Some("Invalid")), None);
        assert_eq!(parse_asn_number(Some("AS")), None);
    }

    #[test]
    fn test_resolved_ip_data_from_api_response() {
        let response = IpApiResponse {
            status: "success".to_string(),
            query: "8.8.8.8".to_string(),
            asn_string: Some("AS15169 Google LLC".to_string()),
            isp: Some("Google LLC".to_string()),
            org: Some("Google LLC".to_string()),
            lat: Some(37.751),
            lon: Some(-97.822),
            city: Some("Mountain View".to_string()),
            country: Some("United States".to_string()),
        };

        let resolved = ResolvedIpData::from_api_response(&response);

        assert_eq!(resolved.ip, "8.8.8.8");
        assert_eq!(resolved.asn_info.asn, Some("AS15169".to_string()));
        assert_eq!(resolved.asn_info.isp, Some("Google LLC".to_string()));
        assert_eq!(resolved.geo.lat, Some(37.751));
        assert_eq!(resolved.geo.country, Some("United States".to_string()));
    }

    #[test]
    fn test_private_ip() {
        let resolved = ResolvedIpData::private_ip("192.168.1.1".to_string());

        assert_eq!(resolved.ip, "192.168.1.1");
        assert!(resolved.asn_info.asn.is_none());
        assert!(resolved.geo.lat.is_none());
    }

    #[test]
    fn test_geo_extraction_from_api_response() {
        let response = IpApiResponse {
            status: "success".to_string(),
            query: "185.60.112.157".to_string(),
            asn_string: Some("AS12345 Example ISP".to_string()),
            isp: Some("Example ISP".to_string()),
            org: Some("Example Organization".to_string()),
            lat: Some(48.8566),
            lon: Some(2.3522),
            city: Some("Paris".to_string()),
            country: Some("France".to_string()),
        };

        let resolved = ResolvedIpData::from_api_response(&response);

        assert_eq!(resolved.geo.lat, Some(48.8566));
        assert_eq!(resolved.geo.lon, Some(2.3522));
        assert_eq!(resolved.geo.city, Some("Paris".to_string()));
        assert_eq!(resolved.geo.country, Some("France".to_string()));
    }

    #[test]
    fn test_geo_extraction_missing_coords() {
        let response = IpApiResponse {
            status: "success".to_string(),
            query: "10.0.0.1".to_string(),
            asn_string: None,
            isp: None,
            org: None,
            lat: None,
            lon: None,
            city: None,
            country: None,
        };

        let resolved = ResolvedIpData::from_api_response(&response);

        assert!(resolved.geo.lat.is_none());
        assert!(resolved.geo.lon.is_none());
        assert!(resolved.geo.city.is_none());
        assert!(resolved.geo.country.is_none());
    }
}

use serde::{Deserialize, Serialize};

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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_private_ip() {
        let resolved = ResolvedIpData::private_ip("192.168.1.1".to_string());

        assert_eq!(resolved.ip, "192.168.1.1");
        assert!(resolved.asn_info.asn.is_none());
        assert!(resolved.geo.lat.is_none());
    }

    #[test]
    fn test_failed_ip() {
        let resolved = ResolvedIpData::failed("invalid".to_string());

        assert_eq!(resolved.ip, "invalid");
        assert!(resolved.asn_info.asn.is_none());
        assert!(resolved.geo.country.is_none());
    }
}

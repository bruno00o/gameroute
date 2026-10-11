use crate::config::{
    REPORT_API_CONNECT_TIMEOUT, REPORT_API_TIMEOUT, REPORT_API_URL, REPORT_API_URL_ENV,
    REPORT_MAX_BYTES,
};
use chrono::{DateTime, SecondsFormat, Utc};
use reqwest::header::CONTENT_TYPE;
use serde::Deserialize;
use std::sync::OnceLock;
use thiserror::Error;

const REPORT_ID_MAX: usize = 64;
const DELETE_TOKEN_MAX: usize = 512;
const LOGGED_BODY_CHARS: usize = 300;

#[derive(Debug, Error)]
pub enum ShareError {
    #[error("The report service cannot be reached: {0}")]
    Offline(String),
    #[error("Too many reports shared recently")]
    RateLimited,
    #[error("The report service rejected the report: {0}")]
    Rejected(String),
    #[error("The report is too large")]
    TooLarge,
    #[error("The report service refused the delete token")]
    Forbidden,
    #[error("The report service answered with status {0}")]
    Server(u16),
    #[error("Unexpected answer from the report service: {0}")]
    InvalidResponse(String),
    #[error("Invalid report: {0}")]
    InvalidPayload(String),
}

impl ShareError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::Offline(_) => "SHARE_OFFLINE",
            Self::RateLimited => "SHARE_RATE_LIMITED",
            Self::Rejected(_) | Self::InvalidPayload(_) => "SHARE_REJECTED",
            Self::TooLarge => "SHARE_TOO_LARGE",
            Self::Forbidden => "SHARE_FORBIDDEN",
            Self::Server(_) | Self::InvalidResponse(_) => "SHARE_FAILED",
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct PublishedReport {
    pub id: String,
    pub url: String,
    pub delete_token: String,
    pub expires_at: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DeleteOutcome {
    Deleted,
    Gone,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreatedBody {
    id: String,
    url: String,
    delete_token: String,
    expires_at: String,
}

pub fn timestamp(time: DateTime<Utc>) -> String {
    time.to_rfc3339_opts(SecondsFormat::Millis, true)
}

pub fn normalize_time(value: &str) -> Option<String> {
    DateTime::parse_from_rfc3339(value)
        .ok()
        .map(|time| timestamp(time.with_timezone(&Utc)))
}

pub fn valid_report_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= REPORT_ID_MAX
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

fn valid_report_url(url: &str) -> bool {
    reqwest::Url::parse(url)
        .is_ok_and(|url| matches!(url.scheme(), "https" | "http") && url.host().is_some())
}

fn excerpt(body: &str) -> String {
    body.chars().take(LOGGED_BODY_CHARS).collect()
}

fn status_error(status: u16, body: &str) -> ShareError {
    match status {
        400 | 422 => ShareError::Rejected(excerpt(body)),
        403 => ShareError::Forbidden,
        413 => ShareError::TooLarge,
        429 => ShareError::RateLimited,
        _ => ShareError::Server(status),
    }
}

pub fn parse_published(status: u16, body: &str) -> Result<PublishedReport, ShareError> {
    if !(200..300).contains(&status) {
        return Err(status_error(status, body));
    }
    let created: CreatedBody = serde_json::from_str(body)
        .map_err(|e| ShareError::InvalidResponse(format!("unreadable body: {e}")))?;
    if !valid_report_id(&created.id) {
        return Err(ShareError::InvalidResponse("invalid id".into()));
    }
    if !valid_report_url(&created.url) {
        return Err(ShareError::InvalidResponse("invalid url".into()));
    }
    if created.delete_token.is_empty() || created.delete_token.len() > DELETE_TOKEN_MAX {
        return Err(ShareError::InvalidResponse("invalid delete token".into()));
    }
    let expires_at = normalize_time(&created.expires_at)
        .ok_or_else(|| ShareError::InvalidResponse("invalid expiry".into()))?;
    Ok(PublishedReport {
        id: created.id,
        url: created.url,
        delete_token: created.delete_token,
        expires_at,
    })
}

pub fn parse_deleted(status: u16, body: &str) -> Result<DeleteOutcome, ShareError> {
    match status {
        200..=299 => Ok(DeleteOutcome::Deleted),
        404 | 410 => Ok(DeleteOutcome::Gone),
        _ => Err(status_error(status, body)),
    }
}

fn base_from(configured: Option<String>) -> String {
    configured
        .map(|url| url.trim().trim_end_matches('/').to_string())
        .filter(|url| !url.is_empty())
        .unwrap_or_else(|| REPORT_API_URL.to_string())
}

pub fn api_base() -> String {
    let configured = if cfg!(debug_assertions) {
        std::env::var(REPORT_API_URL_ENV).ok()
    } else {
        None
    };
    base_from(configured)
}

fn client() -> Result<&'static reqwest::Client, ShareError> {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    if let Some(client) = CLIENT.get() {
        return Ok(client);
    }
    if rustls::crypto::CryptoProvider::get_default().is_none() {
        let _ = rustls::crypto::ring::default_provider().install_default();
    }
    let client = reqwest::Client::builder()
        .timeout(REPORT_API_TIMEOUT)
        .connect_timeout(REPORT_API_CONNECT_TIMEOUT)
        .redirect(reqwest::redirect::Policy::none())
        .user_agent(concat!("GameRoute/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|e| ShareError::Offline(e.to_string()))?;
    Ok(CLIENT.get_or_init(|| client))
}

fn unreachable(error: reqwest::Error) -> ShareError {
    ShareError::Offline(error.without_url().to_string())
}

pub fn encode_payload(payload: &serde_json::Value) -> Result<Vec<u8>, ShareError> {
    if !payload.is_object() {
        return Err(ShareError::InvalidPayload("not an object".into()));
    }
    let body =
        serde_json::to_vec(payload).map_err(|e| ShareError::InvalidPayload(e.to_string()))?;
    if body.len() > REPORT_MAX_BYTES {
        return Err(ShareError::TooLarge);
    }
    Ok(body)
}

pub async fn publish(payload: &serde_json::Value) -> Result<PublishedReport, ShareError> {
    let body = encode_payload(payload)?;
    let response = client()?
        .post(format!("{}/api/reports", api_base()))
        .header(CONTENT_TYPE, "application/json")
        .body(body)
        .send()
        .await
        .map_err(unreachable)?;
    let status = response.status().as_u16();
    let text = response.text().await.map_err(unreachable)?;
    let result = parse_published(status, &text);
    if let Err(e) = &result {
        log::warn!("Sharing a report failed: {}", e);
    }
    result
}

pub async fn delete(id: &str, token: &str) -> Result<DeleteOutcome, ShareError> {
    if !valid_report_id(id) {
        return Err(ShareError::InvalidPayload("invalid report id".into()));
    }
    let response = client()?
        .delete(format!("{}/api/reports/{}", api_base(), id))
        .bearer_auth(token)
        .send()
        .await
        .map_err(unreachable)?;
    let status = response.status().as_u16();
    let text = response.text().await.unwrap_or_default();
    let result = parse_deleted(status, &text);
    if let Err(e) = &result {
        log::warn!("Deleting shared report {} failed: {}", id, e);
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    const CREATED: &str = r#"{"id":"k3J9_x-2","url":"https://gameroute.test/r/k3J9_x-2","deleteToken":"secret","expiresAt":"2027-01-09T10:15:00+01:00"}"#;

    #[test]
    fn reads_a_created_report_and_keeps_its_expiry_in_utc() {
        let report = parse_published(201, CREATED).unwrap();

        assert_eq!(
            report,
            PublishedReport {
                id: "k3J9_x-2".into(),
                url: "https://gameroute.test/r/k3J9_x-2".into(),
                delete_token: "secret".into(),
                expires_at: "2027-01-09T09:15:00.000Z".into(),
            }
        );
    }

    #[test]
    fn refuses_a_created_report_it_could_not_use_safely() {
        let cases = [
            CREATED.replace("k3J9_x-2\",\"url", "../admin\",\"url"),
            CREATED.replace("https://gameroute.test", "javascript:alert(1)//"),
            CREATED.replace("\"secret\"", "\"\""),
            CREATED.replace("2027-01-09T10:15:00+01:00", "soon"),
            "not json".to_string(),
        ];
        for body in cases {
            assert!(
                matches!(
                    parse_published(201, &body),
                    Err(ShareError::InvalidResponse(_))
                ),
                "{body}"
            );
        }
    }

    #[test]
    fn maps_refusals_to_errors_the_player_can_act_on() {
        let invalid = r#"{"error":"invalid_report","issues":[{"path":["gameSlug"]}]}"#;
        assert!(
            matches!(parse_published(400, invalid), Err(ShareError::Rejected(body)) if body.contains("invalid_report"))
        );
        assert!(matches!(
            parse_published(413, ""),
            Err(ShareError::TooLarge)
        ));
        assert!(matches!(
            parse_published(429, ""),
            Err(ShareError::RateLimited)
        ));
        assert!(matches!(
            parse_published(503, ""),
            Err(ShareError::Server(503))
        ));
    }

    #[test]
    fn treats_an_unknown_or_expired_report_as_already_deleted() {
        assert_eq!(parse_deleted(204, "").unwrap(), DeleteOutcome::Deleted);
        assert_eq!(parse_deleted(404, "").unwrap(), DeleteOutcome::Gone);
        assert!(matches!(parse_deleted(403, ""), Err(ShareError::Forbidden)));
        assert!(matches!(
            parse_deleted(429, ""),
            Err(ShareError::RateLimited)
        ));
        assert!(matches!(
            parse_deleted(500, ""),
            Err(ShareError::Server(500))
        ));
    }

    #[test]
    fn gives_each_error_a_stable_code() {
        assert_eq!(
            ShareError::Offline("timeout".into()).code(),
            "SHARE_OFFLINE"
        );
        assert_eq!(ShareError::RateLimited.code(), "SHARE_RATE_LIMITED");
        assert_eq!(ShareError::Rejected(String::new()).code(), "SHARE_REJECTED");
        assert_eq!(ShareError::TooLarge.code(), "SHARE_TOO_LARGE");
        assert_eq!(ShareError::Forbidden.code(), "SHARE_FORBIDDEN");
        assert_eq!(ShareError::Server(502).code(), "SHARE_FAILED");
    }

    #[test]
    fn accepts_only_short_url_safe_ids() {
        assert!(valid_report_id("Ab3_-x"));
        assert!(!valid_report_id(""));
        assert!(!valid_report_id("a/b"));
        assert!(!valid_report_id("a?b"));
        assert!(!valid_report_id(&"a".repeat(REPORT_ID_MAX + 1)));
    }

    #[test]
    fn sends_nothing_too_large_or_not_an_object() {
        let large = serde_json::json!({ "padding": "x".repeat(REPORT_MAX_BYTES) });
        assert!(matches!(encode_payload(&large), Err(ShareError::TooLarge)));
        assert!(matches!(
            encode_payload(&serde_json::json!([1, 2])),
            Err(ShareError::InvalidPayload(_))
        ));
        assert_eq!(
            encode_payload(&serde_json::json!({ "version": 1 })).unwrap(),
            br#"{"version":1}"#.to_vec()
        );
    }

    #[test]
    fn uses_the_test_deploy_unless_a_local_api_is_configured() {
        assert_eq!(base_from(None), REPORT_API_URL);
        assert_eq!(base_from(Some("  ".into())), REPORT_API_URL);
        assert_eq!(
            base_from(Some("http://localhost:5173/".into())),
            "http://localhost:5173"
        );
    }
}

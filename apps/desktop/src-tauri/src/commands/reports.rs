use super::CommandError;
use crate::db::{get_shared_report_repository, DbError};
use crate::models::shared_report::{SharedReport, SharedReportLink, SharedReportRecord};
use crate::services::report_share::{self, PublishedReport, ShareError};
use chrono::Utc;
use serde_json::Value;

const RECIPIENTS: [&str; 3] = ["isp", "publisher", "forum"];

impl From<ShareError> for CommandError {
    fn from(e: ShareError) -> Self {
        Self {
            code: e.code().to_string(),
            message: e.to_string(),
        }
    }
}

fn db_error(e: DbError) -> CommandError {
    CommandError::internal(format!("Shared reports database error: {e}"))
}

fn repository(
) -> Result<std::sync::Arc<crate::db::shared_reports::SharedReportRepository>, CommandError> {
    get_shared_report_repository()
        .ok_or_else(|| CommandError::repo_not_initialized("Shared report"))
}

fn report_game_name(slug: &str) -> Option<&'static str> {
    match slug {
        "valorant" => Some("VALORANT"),
        "league-of-legends" => Some("League of Legends"),
        "counter-strike-2" => Some("Counter-Strike 2"),
        _ => None,
    }
}

#[derive(Debug, PartialEq)]
struct ReportMeta {
    game_name: &'static str,
    recipient: String,
}

fn report_meta(payload: &Value) -> Result<ReportMeta, ShareError> {
    let game_name = payload
        .get("gameSlug")
        .and_then(Value::as_str)
        .and_then(report_game_name)
        .ok_or_else(|| ShareError::InvalidPayload("unknown game".into()))?;
    let recipient = payload
        .get("recipient")
        .and_then(Value::as_str)
        .filter(|recipient| RECIPIENTS.contains(recipient))
        .ok_or_else(|| ShareError::InvalidPayload("unknown recipient".into()))?;
    Ok(ReportMeta {
        game_name,
        recipient: recipient.to_string(),
    })
}

fn record_of(
    meta: ReportMeta,
    published: PublishedReport,
    created_at: String,
) -> SharedReportRecord {
    SharedReportRecord {
        report: SharedReport {
            id: published.id,
            url: published.url,
            game_name: meta.game_name.to_string(),
            recipient: meta.recipient,
            created_at,
            expires_at: published.expires_at,
        },
        delete_token: published.delete_token,
    }
}

#[tauri::command]
pub async fn share_report(payload: Value) -> Result<SharedReportLink, CommandError> {
    let repo = repository()?;
    let meta = report_meta(&payload)?;
    let published = report_share::publish(&payload).await?;
    let record = record_of(meta, published, report_share::timestamp(Utc::now()));

    if let Err(e) = repo.insert(&record).await {
        log::error!("Failed to store shared report {}: {}", record.report.id, e);
        if let Err(err) = report_share::delete(&record.report.id, &record.delete_token).await {
            log::warn!(
                "Could not withdraw unsaved report {}: {}",
                record.report.id,
                err
            );
        }
        return Err(db_error(e));
    }

    log::info!(
        "Shared report {} until {}",
        record.report.id,
        record.report.expires_at
    );
    let report = record.report;
    Ok(SharedReportLink {
        id: report.id,
        url: report.url,
        expires_at: report.expires_at,
    })
}

#[tauri::command]
pub async fn list_shared_reports() -> Result<Vec<SharedReport>, CommandError> {
    let repo = repository()?;
    let removed = repo
        .delete_expired(&report_share::timestamp(Utc::now()))
        .await
        .map_err(db_error)?;
    if removed > 0 {
        log::info!("Removed {} expired shared reports", removed);
    }
    repo.list().await.map_err(db_error)
}

#[tauri::command]
pub async fn delete_shared_report(id: String) -> Result<(), CommandError> {
    let repo = repository()?;
    let Some(token) = repo.delete_token(&id).await.map_err(db_error)? else {
        return Ok(());
    };
    report_share::delete(&id, &token).await?;
    repo.delete(&id).await.map_err(db_error)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn names_the_game_and_recipient_from_the_payload() {
        let meta = report_meta(&json!({ "gameSlug": "league-of-legends", "recipient": "isp" }));

        assert_eq!(
            meta.unwrap(),
            ReportMeta {
                game_name: "League of Legends",
                recipient: "isp".into(),
            }
        );
    }

    #[test]
    fn refuses_a_payload_for_an_unprofiled_game_or_recipient() {
        for payload in [
            json!({ "gameSlug": "fortnite", "recipient": "isp" }),
            json!({ "recipient": "isp" }),
            json!({ "gameSlug": "valorant", "recipient": "everyone" }),
        ] {
            assert!(matches!(
                report_meta(&payload),
                Err(ShareError::InvalidPayload(_))
            ));
        }
    }

    #[test]
    fn keeps_the_delete_token_out_of_what_the_screen_receives() {
        let record = record_of(
            ReportMeta {
                game_name: "VALORANT",
                recipient: "forum".into(),
            },
            PublishedReport {
                id: "abc".into(),
                url: "https://gameroute.test/r/abc".into(),
                delete_token: "secret".into(),
                expires_at: "2027-01-09T09:15:00.000Z".into(),
            },
            "2026-10-11T09:15:00.000Z".into(),
        );

        assert_eq!(record.delete_token, "secret");
        let listed = serde_json::to_value(&record.report).unwrap();
        assert_eq!(
            listed,
            json!({
                "id": "abc",
                "url": "https://gameroute.test/r/abc",
                "gameName": "VALORANT",
                "recipient": "forum",
                "createdAt": "2026-10-11T09:15:00.000Z",
                "expiresAt": "2027-01-09T09:15:00.000Z",
            })
        );
    }

    #[test]
    fn maps_share_errors_to_command_codes() {
        let error = CommandError::from(ShareError::RateLimited);
        assert_eq!(error.code, "SHARE_RATE_LIMITED");
    }
}

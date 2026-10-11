use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct SharedReport {
    pub id: String,
    pub url: String,
    pub game_name: String,
    pub recipient: String,
    pub created_at: String,
    pub expires_at: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SharedReportLink {
    pub id: String,
    pub url: String,
    pub expires_at: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct SharedReportRecord {
    pub report: SharedReport,
    pub delete_token: String,
}

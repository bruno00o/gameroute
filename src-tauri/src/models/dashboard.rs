use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardData {
    pub total_sessions: i64,
    pub total_play_time_secs: i64,
    pub unique_games: i64,
    pub recent_sessions: Vec<RecentSession>,
}

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct RecentSession {
    pub id: i64,
    pub game_name: String,
    pub started_at: String,
    pub ended_at: Option<String>,
    pub icon_url: Option<String>,
}

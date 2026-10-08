use crate::db::DbError;
use crate::models::game_ping::GamePingSample;
use crate::models::session::Session;
use sqlx::sqlite::SqlitePool;
use std::sync::{Arc, OnceLock};

pub struct GamePingRepository {
    pool: SqlitePool,
}

impl GamePingRepository {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }

    pub async fn insert_samples(
        &self,
        samples: &[GamePingSample],
    ) -> Result<Vec<GamePingSample>, DbError> {
        let mut inserted = Vec::new();
        let mut tx = self.pool.begin().await?;
        for sample in samples {
            let result = sqlx::query(
                "INSERT OR IGNORE INTO game_ping_samples
                    (session_id, source, measured_at, peer_ip, peer_port, region, rtt_ms, jitter_ms, packets_lost, packets_sent)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)",
            )
            .bind(sample.session_id)
            .bind(sample.source.as_str())
            .bind(&sample.measured_at)
            .bind(&sample.peer_ip)
            .bind(sample.peer_port)
            .bind(&sample.region)
            .bind(sample.rtt_ms)
            .bind(sample.jitter_ms)
            .bind(sample.packets_lost)
            .bind(sample.packets_sent)
            .execute(&mut *tx)
            .await?;
            if result.rows_affected() > 0 {
                inserted.push(sample.clone());
            }
        }
        tx.commit().await?;
        Ok(inserted)
    }

    pub async fn get_samples_for_sessions(
        &self,
        session_ids: &[i64],
    ) -> Result<Vec<GamePingSample>, DbError> {
        sqlx::query_as::<_, GamePingSample>(
            "SELECT session_id, source, measured_at, peer_ip, peer_port, region, rtt_ms, jitter_ms, packets_lost, packets_sent
             FROM game_ping_samples
             WHERE session_id IN (SELECT value FROM json_each($1))
             ORDER BY session_id ASC, measured_at ASC, id ASC",
        )
        .bind(serde_json::to_string(session_ids).unwrap_or_default())
        .fetch_all(&self.pool)
        .await
        .map_err(Into::into)
    }

    pub async fn get_unsampled_sessions(&self) -> Result<Vec<UnsampledSession>, DbError> {
        sqlx::query_as::<_, UnsampledSession>(
            "SELECT s.id, s.game_name, s.started_at, s.ended_at, c.scanned_at
             FROM sessions s
             LEFT JOIN game_log_scans c ON c.session_id = s.id
             WHERE s.ended_at IS NOT NULL
               AND NOT EXISTS (SELECT 1 FROM game_ping_samples g WHERE g.session_id = s.id)
             ORDER BY s.started_at ASC",
        )
        .fetch_all(&self.pool)
        .await
        .map_err(Into::into)
    }

    pub async fn mark_scanned(&self, session_ids: &[i64], scanned_at: &str) -> Result<(), DbError> {
        sqlx::query(
            "INSERT INTO game_log_scans (session_id, scanned_at)
             SELECT value, $2 FROM json_each($1) WHERE true
             ON CONFLICT(session_id) DO UPDATE SET scanned_at = excluded.scanned_at",
        )
        .bind(serde_json::to_string(session_ids).unwrap_or_default())
        .bind(scanned_at)
        .execute(&self.pool)
        .await?;
        Ok(())
    }
}

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct UnsampledSession {
    #[sqlx(flatten)]
    pub session: Session,
    pub scanned_at: Option<String>,
}

static GAME_PING_REPOSITORY: OnceLock<Arc<GamePingRepository>> = OnceLock::new();

pub fn init_game_ping_repository(pool: SqlitePool) {
    let repo = GamePingRepository::new(pool);
    let _ = GAME_PING_REPOSITORY.set(Arc::new(repo));
    log::info!("Game ping repository initialized");
}

pub fn get_game_ping_repository() -> Option<Arc<GamePingRepository>> {
    GAME_PING_REPOSITORY.get().cloned()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::create_test_pool;
    use crate::db::sessions::SessionRepository;
    use crate::models::insights::PingSource;
    use chrono::{TimeZone, Utc};

    fn rtt(session_id: i64, sec: u32, ms: f64) -> GamePingSample {
        let mut sample = GamePingSample::new(
            PingSource::Game,
            Utc.with_ymd_and_hms(2026, 10, 8, 17, 35, sec).unwrap(),
        );
        sample.session_id = session_id;
        sample.peer_ip = Some("162.249.72.5".to_string());
        sample.peer_port = Some(7318);
        sample.rtt_ms = Some(ms);
        sample
    }

    fn region(session_id: i64, name: &str, ms: f64) -> GamePingSample {
        let mut sample = GamePingSample::new(
            PingSource::GameRegion,
            Utc.with_ymd_and_hms(2026, 10, 8, 17, 30, 0).unwrap(),
        );
        sample.session_id = session_id;
        sample.region = Some(name.to_string());
        sample.rtt_ms = Some(ms);
        sample
    }

    async fn setup() -> (GamePingRepository, SessionRepository) {
        let pool = create_test_pool().await;
        (
            GamePingRepository::new(pool.clone()),
            SessionRepository::new(pool),
        )
    }

    #[tokio::test]
    async fn samples_are_stored_once_and_read_back_per_session() {
        let (repo, sessions) = setup().await;
        let lol = sessions
            .insert_session("League of Legends", "2026-10-08T17:30:00Z")
            .await
            .unwrap();
        let valorant = sessions
            .insert_session("VALORANT", "2026-10-08T17:00:00Z")
            .await
            .unwrap();

        let batch = vec![
            rtt(lol, 16, 13.8),
            rtt(lol, 26, 14.4),
            region(valorant, "Paris", 4.0),
            region(valorant, "London", 14.0),
        ];
        assert_eq!(repo.insert_samples(&batch).await.unwrap().len(), 4);

        let again = vec![rtt(lol, 26, 14.4), rtt(lol, 36, 12.7)];
        let inserted = repo.insert_samples(&again).await.unwrap();
        assert_eq!(inserted, vec![rtt(lol, 36, 12.7)]);

        let stored = repo.get_samples_for_sessions(&[lol]).await.unwrap();
        assert_eq!(
            stored.iter().map(|s| s.rtt_ms).collect::<Vec<_>>(),
            vec![Some(13.8), Some(14.4), Some(12.7)]
        );
        assert_eq!(
            repo.get_samples_for_sessions(&[valorant]).await.unwrap(),
            vec![
                region(valorant, "Paris", 4.0),
                region(valorant, "London", 14.0)
            ]
        );
    }

    #[tokio::test]
    async fn samples_go_away_with_their_session() {
        let (repo, sessions) = setup().await;
        let id = sessions
            .insert_session("League of Legends", "2026-10-08T17:30:00Z")
            .await
            .unwrap();
        repo.insert_samples(&[rtt(id, 16, 13.8)]).await.unwrap();

        sessions.delete_session(id).await.unwrap();

        assert!(repo
            .get_samples_for_sessions(&[id])
            .await
            .unwrap()
            .is_empty());
    }

    #[tokio::test]
    async fn only_ended_sessions_without_samples_are_left_to_import() {
        let (repo, sessions) = setup().await;
        let sampled = sessions
            .insert_session("League of Legends", "2026-10-08T15:00:00Z")
            .await
            .unwrap();
        let missing = sessions
            .insert_session("League of Legends", "2026-10-08T16:00:00Z")
            .await
            .unwrap();
        sessions
            .insert_session("VALORANT", "2026-10-08T17:00:00Z")
            .await
            .unwrap();
        for id in [sampled, missing] {
            sessions
                .update_session_ended(id, "2026-10-08T16:50:00Z")
                .await
                .unwrap();
        }
        repo.insert_samples(&[rtt(sampled, 16, 13.8)])
            .await
            .unwrap();

        let left: Vec<(i64, Option<String>)> = repo
            .get_unsampled_sessions()
            .await
            .unwrap()
            .into_iter()
            .map(|left| (left.session.id, left.scanned_at))
            .collect();
        assert_eq!(left, vec![(missing, None)]);

        repo.mark_scanned(&[missing], "2026-10-08T18:00:00Z")
            .await
            .unwrap();
        repo.mark_scanned(&[missing], "2026-10-09T18:00:00Z")
            .await
            .unwrap();
        let scanned = repo.get_unsampled_sessions().await.unwrap();
        assert_eq!(
            scanned[0].scanned_at.as_deref(),
            Some("2026-10-09T18:00:00Z")
        );

        sessions.delete_session(missing).await.unwrap();
        assert!(repo.get_unsampled_sessions().await.unwrap().is_empty());
    }
}

use super::{GameLogFollower, GameLogKind, LogZone};
use crate::config::GAME_LOG_POLL_SECS;
use crate::db::get_game_ping_repository;
use crate::models::game_ping::GamePingSample;
use crate::models::MonitoringState;
use chrono::{DateTime, Utc};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::RwLock;

pub fn follow_game_logs(
    monitoring_state: Arc<RwLock<MonitoringState>>,
    session_id: i64,
    game_name: &str,
    since: &str,
    on_sample: impl Fn(&GamePingSample) + Send + 'static,
) {
    let Some(kind) = GameLogKind::for_game(game_name) else {
        return;
    };
    let Some(dir) = kind.logs_dir() else {
        log::info!(
            "No game logs found for {}, in-match ping stays unmeasured",
            game_name
        );
        return;
    };
    let since = DateTime::parse_from_rfc3339(since)
        .map(|at| at.with_timezone(&Utc))
        .unwrap_or_else(|_| Utc::now());
    log::info!("Following {} logs in {}", game_name, dir.display());

    tokio::spawn(async move {
        let mut follower = GameLogFollower::new(kind, dir, session_id, since, LogZone::LOCAL);
        let mut ticks = tokio::time::interval(Duration::from_secs(GAME_LOG_POLL_SECS));
        loop {
            ticks.tick().await;
            let playing = {
                let state = monitoring_state.read().await;
                state.is_monitoring && state.current_session_id == Some(session_id)
            };
            let Ok((returned, polled)) = tokio::task::spawn_blocking(move || {
                let polled = follower.poll(!playing);
                (follower, polled)
            })
            .await
            else {
                break;
            };
            follower = returned;

            match polled {
                Ok(samples) if !samples.is_empty() => {
                    if let Some(repo) = get_game_ping_repository() {
                        match repo.insert_samples(&samples).await {
                            Ok(inserted) => inserted.iter().for_each(&on_sample),
                            Err(e) => log::error!("Failed to save game pings: {}", e),
                        }
                    }
                }
                Ok(_) => {}
                Err(e) => log::debug!("Game log not readable yet: {}", e),
            }
            if !playing {
                break;
            }
        }
    });
}

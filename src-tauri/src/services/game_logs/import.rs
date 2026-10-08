use super::netstats::log_start;
use super::shooter::log_opened_at;
use super::tail::first_line;
use super::{netstats_files, read_netstats, read_shooter_log, slack, GameLogKind};
use crate::db::game_pings::UnsampledSession;
use crate::db::get_game_ping_repository;
use crate::models::game_ping::GamePingSample;
use chrono::{DateTime, Utc};
use std::path::{Path, PathBuf};

pub struct Span {
    session_id: i64,
    kind: GameLogKind,
    from: DateTime<Utc>,
    to: DateTime<Utc>,
    scanned_at: Option<DateTime<Utc>>,
}

impl Span {
    fn covers(&self, at: DateTime<Utc>) -> bool {
        self.from <= at && at <= self.to
    }

    fn wants(&self, from: DateTime<Utc>, to: DateTime<Utc>, modified: DateTime<Utc>) -> bool {
        self.from <= to
            && from <= self.to
            && self.scanned_at.is_none_or(|scanned| modified > scanned)
    }
}

fn utc(timestamp: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(timestamp)
        .ok()
        .map(|at| at.with_timezone(&Utc))
}

pub fn spans(sessions: &[UnsampledSession]) -> Vec<Span> {
    sessions
        .iter()
        .filter_map(|left| {
            let session = &left.session;
            Some(Span {
                session_id: session.id,
                kind: GameLogKind::for_game(&session.game_name)?,
                from: utc(&session.started_at)? - slack(),
                to: utc(session.ended_at.as_deref()?)? + slack(),
                scanned_at: left.scanned_at.as_deref().and_then(utc),
            })
        })
        .collect()
}

fn modified(path: &Path) -> Option<DateTime<Utc>> {
    Some(std::fs::metadata(path).ok()?.modified().ok()?.into())
}

fn shooter_logs(dir: &Path) -> Vec<PathBuf> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    entries
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| {
            path.file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.starts_with("ShooterGame") && name.ends_with(".log"))
        })
        .collect()
}

fn written_between(path: &Path) -> Option<(DateTime<Utc>, DateTime<Utc>)> {
    let opened = log_opened_at(&first_line(path).ok()?)?;
    Some((opened, modified(path)?))
}

pub fn collect(kind: GameLogKind, dir: &Path, spans: &[Span]) -> Vec<GamePingSample> {
    let spans: Vec<&Span> = spans.iter().filter(|span| span.kind == kind).collect();
    let wanted = |from: DateTime<Utc>, to: DateTime<Utc>, modified: DateTime<Utc>| {
        spans.iter().any(|span| span.wants(from, to, modified))
    };
    let samples: Vec<GamePingSample> = match kind {
        GameLogKind::League => netstats_files(dir)
            .into_iter()
            .filter(|path| {
                log_start(path)
                    .zip(modified(path))
                    .is_some_and(|(start, at)| wanted(start, start, at))
            })
            .flat_map(|path| read_netstats(&path).unwrap_or_default())
            .collect(),
        GameLogKind::Valorant => shooter_logs(dir)
            .into_iter()
            .filter(|path| written_between(path).is_some_and(|(from, to)| wanted(from, to, to)))
            .flat_map(|path| read_shooter_log(&path).unwrap_or_default())
            .collect(),
    };
    samples
        .into_iter()
        .filter_map(|mut sample| {
            let at = sample.at()?;
            sample.session_id = spans
                .iter()
                .filter(|span| span.covers(at))
                .max_by_key(|span| span.from)?
                .session_id;
            Some(sample)
        })
        .collect()
}

pub async fn backfill_game_pings() {
    let Some(repo) = get_game_ping_repository() else {
        return;
    };
    let sessions = match repo.get_unsampled_sessions().await {
        Ok(sessions) => sessions,
        Err(e) => {
            log::error!("Failed to list sessions for game pings: {}", e);
            return;
        }
    };
    let spans = spans(&sessions);
    if spans.is_empty() {
        return;
    }
    let scanned: Vec<i64> = spans.iter().map(|span| span.session_id).collect();
    let scanned_at = Utc::now().to_rfc3339();

    let collected = tokio::task::spawn_blocking(move || {
        [GameLogKind::League, GameLogKind::Valorant]
            .into_iter()
            .filter_map(|kind| Some((kind, kind.logs_dir()?)))
            .flat_map(|(kind, dir)| collect(kind, &dir, &spans))
            .collect::<Vec<GamePingSample>>()
    })
    .await;

    let samples = match collected {
        Ok(samples) => samples,
        Err(e) => {
            log::error!("Game log import failed: {}", e);
            return;
        }
    };
    if !samples.is_empty() {
        match repo.insert_samples(&samples).await {
            Ok(inserted) => log::info!(
                "Imported {} game ping samples from game logs",
                inserted.len()
            ),
            Err(e) => {
                log::error!("Failed to import game ping samples: {}", e);
                return;
            }
        }
    }
    if let Err(e) = repo.mark_scanned(&scanned, &scanned_at).await {
        log::error!("Failed to remember scanned game logs: {}", e);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::insights::PingSource;
    use crate::models::session::Session;
    use chrono::{Duration, Local, TimeZone};

    const NETSTATS: &str =
        include_str!("../../../tests/fixtures/game_logs/2026-10-08T19-35-06_netstats.csv");
    const SHOOTER: &str = include_str!("../../../tests/fixtures/game_logs/ShooterGame.txt");

    fn session(id: i64, game: &str, from: DateTime<Utc>, minutes: i64) -> UnsampledSession {
        UnsampledSession {
            session: Session {
                id,
                game_name: game.to_string(),
                started_at: from.to_rfc3339(),
                ended_at: Some((from + Duration::minutes(minutes)).to_rfc3339()),
            },
            scanned_at: None,
        }
    }

    fn scanned(mut left: UnsampledSession, at: DateTime<Utc>) -> UnsampledSession {
        left.scanned_at = Some(at.to_rfc3339());
        left
    }

    fn league_logs(dir: &Path) {
        for stamp in ["2026-10-08T19-35-06", "2026-10-01T12-00-00"] {
            let folder = dir.join(stamp);
            std::fs::create_dir_all(&folder).unwrap();
            std::fs::write(folder.join(format!("{stamp}_netstats.csv")), NETSTATS).unwrap();
        }
    }

    fn lol_started() -> DateTime<Utc> {
        Local
            .with_ymd_and_hms(2026, 10, 8, 17, 56, 20)
            .unwrap()
            .with_timezone(&Utc)
    }

    #[test]
    fn league_matches_land_in_the_session_that_was_running() {
        let dir = tempfile::tempdir().unwrap();
        league_logs(dir.path());
        let mut live = session(192, "League of Legends", lol_started(), 0);
        live.session.ended_at = None;
        let sessions = vec![
            session(191, "League of Legends", lol_started(), 122),
            session(190, "VALORANT", lol_started(), 122),
            live,
        ];

        let samples = collect(GameLogKind::League, dir.path(), &spans(&sessions));

        assert_eq!(samples.len(), 8);
        assert!(samples
            .iter()
            .all(|s| s.session_id == 191 && s.source == PingSource::Game));
    }

    #[test]
    fn logs_unchanged_since_the_last_scan_are_not_read_again() {
        let dir = tempfile::tempdir().unwrap();
        league_logs(dir.path());
        std::fs::write(dir.path().join("ShooterGame.log"), SHOOTER).unwrap();
        let later = Utc::now() + Duration::minutes(1);
        let earlier = Utc::now() - Duration::days(1);
        let valorant = Utc.with_ymd_and_hms(2026, 10, 4, 13, 2, 0).unwrap();

        let done = vec![
            scanned(session(191, "League of Legends", lol_started(), 122), later),
            scanned(session(1, "VALORANT", valorant, 60), later),
        ];
        assert!(collect(GameLogKind::League, dir.path(), &spans(&done)).is_empty());
        assert!(collect(GameLogKind::Valorant, dir.path(), &spans(&done)).is_empty());

        let stale = vec![
            scanned(
                session(191, "League of Legends", lol_started(), 122),
                earlier,
            ),
            scanned(session(1, "VALORANT", valorant, 60), earlier),
        ];
        assert_eq!(
            collect(GameLogKind::League, dir.path(), &spans(&stale)).len(),
            8
        );
        assert_eq!(
            collect(GameLogKind::Valorant, dir.path(), &spans(&stale)).len(),
            5
        );
    }

    #[test]
    fn valorant_events_are_split_between_sessions_by_time() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("ShooterGame.log"), SHOOTER).unwrap();
        std::fs::write(dir.path().join("cef3.log"), "ignored").unwrap();
        let at = |h: u32, m: u32| Utc.with_ymd_and_hms(2026, 10, 4, h, m, 0).unwrap();
        let sessions = vec![
            session(1, "VALORANT", at(13, 2), 13),
            session(2, "VALORANT", at(13, 15), 30),
            session(3, "League of Legends", at(13, 0), 60),
        ];
        let spans = spans(&sessions);

        let samples: Vec<(i64, PingSource)> = collect(GameLogKind::Valorant, dir.path(), &spans)
            .iter()
            .map(|s| (s.session_id, s.source))
            .collect();

        assert_eq!(
            samples,
            vec![
                (1, PingSource::GameRegion),
                (1, PingSource::GameRegion),
                (1, PingSource::GameRegion),
                (2, PingSource::Game),
                (2, PingSource::Game),
            ]
        );
    }
}

use crate::config::USUAL_PING_MIN_SAMPLES;
use crate::db::analytics::AnalyticsRepository;
use crate::db::game_pings::GamePingRepository;
use crate::db::ip_metadata::IpMetadataRepository;
use crate::db::ip_periods::IpPeriodRepository;
use crate::db::traceroutes::TracerouteRepository;
use crate::db::DbError;
use crate::models::insights::{PingBasis, PingSource, WeekHourCell, WeekHourGame, WeekHourGrid};
use crate::models::severity::Severity;
use crate::services::matches::median;
use crate::services::usual::{assess, assessments, match_history, parse, Assessment, PingSample};
use crate::services::usual::{SampleId, ServerMatch};
use chrono::{DateTime, Datelike, FixedOffset, Local, SecondsFormat, TimeZone, Timelike, Utc};
use std::cmp::Reverse;
use std::collections::{BTreeMap, HashMap};

type Measured<'a> = (&'a PingSample, &'a Assessment);

#[derive(Default)]
struct Bucket<'a> {
    matches: u32,
    samples: Vec<Measured<'a>>,
}

struct Played<'a> {
    first: DateTime<FixedOffset>,
    last: DateTime<FixedOffset>,
    matches: u32,
    cells: BTreeMap<(u8, u8), Bucket<'a>>,
}

fn rank(basis: &PingBasis) -> u8 {
    match (basis.source, basis.at_destination) {
        (PingSource::Game, _) => 2,
        (_, true) => 1,
        _ => 0,
    }
}

fn cell(weekday: u8, hour: u8, bucket: &Bucket) -> WeekHourCell {
    let top = bucket
        .samples
        .iter()
        .map(|(sample, _)| rank(&sample.basis))
        .max();
    let kept: Vec<&Measured> = bucket
        .samples
        .iter()
        .filter(|(sample, _)| Some(rank(&sample.basis)) == top)
        .collect();
    let compared: Vec<&Measured> = kept
        .iter()
        .copied()
        .filter(|(_, assessment)| assessment.usual.median_ms.is_some())
        .collect();
    let chosen = if compared.is_empty() {
        &kept
    } else {
        &compared
    };

    let median_ms = median(chosen.iter().map(|(sample, _)| sample.ping_ms).collect());
    let loss_pct = median(chosen.iter().map(|(sample, _)| sample.loss_pct).collect());
    let usual_ms = median(
        compared
            .iter()
            .filter_map(|(_, assessment)| assessment.usual.median_ms)
            .collect(),
    );
    let status = median_ms.map_or(Severity::Unmeasured, |ping| {
        assess(ping, usual_ms, loss_pct.unwrap_or(0.0)).0
    });

    WeekHourCell {
        weekday,
        hour,
        match_count: bucket.matches,
        sample_count: kept.len() as u32,
        compared_count: compared.len() as u32,
        source: top.map(|rank| {
            if rank == 2 {
                PingSource::Game
            } else {
                PingSource::Trace
            }
        }),
        at_least: top == Some(0),
        median_ms,
        usual_ms,
        over_usual_ms: median_ms.zip(usual_ms).map(|(ping, usual)| ping - usual),
        loss_pct,
        status,
    }
}

pub fn week_hour_games<Tz: TimeZone>(
    matches: &[ServerMatch],
    since: DateTime<FixedOffset>,
    zone: &Tz,
) -> Vec<WeekHourGame> {
    let assessed: HashMap<SampleId, Assessment> = assessments(matches);
    let mut games: BTreeMap<&str, Played> = BTreeMap::new();

    for game in matches {
        let Some(started) = parse(&game.started_at).filter(|started| *started >= since) else {
            continue;
        };
        let local = started.with_timezone(zone);
        let key = (
            local.weekday().num_days_from_monday() as u8,
            local.hour() as u8,
        );
        let played = games.entry(game.game_name.as_str()).or_insert(Played {
            first: started,
            last: started,
            matches: 0,
            cells: BTreeMap::new(),
        });
        played.first = played.first.min(started);
        played.last = played.last.max(started);
        played.matches += 1;
        let bucket = played.cells.entry(key).or_default();
        bucket.matches += 1;
        if let Some((sample, assessment)) = game
            .sample
            .as_ref()
            .and_then(|sample| Some((sample, assessed.get(&sample.id)?)))
        {
            bucket.samples.push((sample, assessment));
        }
    }

    let mut games: Vec<WeekHourGame> = games
        .into_iter()
        .map(|(name, played)| WeekHourGame {
            game_name: name.to_string(),
            match_count: played.matches,
            first_played_at: played.first.to_rfc3339_opts(SecondsFormat::Secs, true),
            last_played_at: played.last.to_rfc3339_opts(SecondsFormat::Secs, true),
            cells: played
                .cells
                .iter()
                .map(|(&(weekday, hour), bucket)| cell(weekday, hour, bucket))
                .collect(),
        })
        .collect();
    games.sort_by_key(|game| Reverse(game.match_count));
    games
}

pub async fn week_hour_grid(
    analytics: &AnalyticsRepository,
    periods: &IpPeriodRepository,
    traceroutes: &TracerouteRepository,
    game_pings: Option<&GamePingRepository>,
    metadata: Option<&IpMetadataRepository>,
    since: DateTime<Utc>,
) -> Result<WeekHourGrid, DbError> {
    let history = match_history(analytics, periods, traceroutes, game_pings, metadata).await?;
    Ok(WeekHourGrid {
        since: since.to_rfc3339_opts(SecondsFormat::Secs, true),
        usual_min_samples: USUAL_PING_MIN_SAMPLES as u32,
        games: week_hour_games(&history.matches, since.fixed_offset(), &Local),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::usual::fixtures::*;

    fn paris() -> FixedOffset {
        FixedOffset::east_opt(2 * 3600).unwrap()
    }

    fn cells(matches: &[ServerMatch]) -> Vec<WeekHourCell> {
        let mut games = week_hour_games(matches, day(1, 0), &paris());
        assert_eq!(games.len(), 1);
        games.remove(0).cells
    }

    fn at_cell(cells: &[WeekHourCell], weekday: u8, hour: u8) -> &WeekHourCell {
        cells
            .iter()
            .find(|cell| cell.weekday == weekday && cell.hour == hour)
            .unwrap()
    }

    fn series(day_of_month: u32, basis: PingBasis, ping_ms: f64) -> Vec<ServerMatch> {
        (1..=6)
            .map(|n| measured(day(day_of_month, n), basis.clone(), ping_ms))
            .collect()
    }

    fn usual_history() -> Vec<ServerMatch> {
        series(10, lower_bound(5), 5.0)
    }

    #[test]
    fn hours_and_weekdays_follow_the_given_zone() {
        let mut matches = usual_history();
        matches.push(measured(
            day(12, 22) + chrono::Duration::minutes(30),
            lower_bound(5),
            5.0,
        ));

        let cells = cells(&matches);

        assert_eq!(at_cell(&cells, 6, 0).match_count, 1);
        assert!(cells
            .iter()
            .all(|cell| !(cell.weekday == 5 && cell.hour == 22)));
        let utc = week_hour_games(&matches, day(1, 0), &Utc);
        assert!(utc[0]
            .cells
            .iter()
            .any(|cell| cell.weekday == 5 && cell.hour == 22));
    }

    #[test]
    fn a_small_gap_stays_under_the_threshold() {
        let mut matches = usual_history();
        matches.push(measured(day(18, 21), lower_bound(5), 8.0));
        matches.push(measured(day(19, 21), lower_bound(5), 31.0));

        let cells = cells(&matches);

        let friday = at_cell(&cells, 4, 23);
        assert_eq!(friday.over_usual_ms, Some(3.0));
        assert_eq!(friday.usual_ms, Some(5.0));
        assert_eq!(friday.status, Severity::Ok);
        let saturday = at_cell(&cells, 5, 23);
        assert_eq!(saturday.over_usual_ms, Some(26.0));
        assert_eq!(saturday.status, Severity::Watch);
    }

    #[test]
    fn lower_bounds_are_flagged_and_never_mixed_with_real_pings() {
        let mut matches = series(9, exact(), 30.0);
        matches.extend(usual_history());
        let hour = day(18, 21);
        matches.push(measured(hour, exact(), 33.0));
        matches.push(measured(
            hour + chrono::Duration::minutes(5),
            lower_bound(5),
            9.0,
        ));
        matches.push(measured(day(18, 22), lower_bound(5), 7.0));

        let cells = cells(&matches);

        let mixed = at_cell(&cells, 4, 23);
        assert_eq!(mixed.sample_count, 1);
        assert_eq!(mixed.median_ms, Some(33.0));
        assert!(!mixed.at_least);
        let bound = at_cell(&cells, 5, 0);
        assert_eq!(bound.median_ms, Some(7.0));
        assert!(bound.at_least);
        assert_eq!(bound.source, Some(PingSource::Trace));
    }

    #[test]
    fn the_ping_measured_by_the_game_wins_over_the_trace() {
        let mut matches = series(9, game(), 13.0);
        matches.extend(usual_history());
        let hour = day(18, 21);
        matches.push(measured(hour, game(), 15.0));
        matches.push(measured(
            hour + chrono::Duration::minutes(5),
            lower_bound(5),
            5.0,
        ));

        let cells = cells(&matches);

        let cell = at_cell(&cells, 4, 23);
        assert_eq!(cell.source, Some(PingSource::Game));
        assert_eq!(cell.median_ms, Some(15.0));
        assert_eq!(cell.usual_ms, Some(13.0));
        assert_eq!(cell.over_usual_ms, Some(2.0));
        assert!(!cell.at_least);
    }

    #[test]
    fn a_cell_without_enough_history_has_no_gap() {
        let matches = vec![
            measured(day(18, 21), lower_bound(5), 8.0),
            played("VALORANT", riot(RIOT_PARIS, None), day(18, 22)),
        ];

        let cells = cells(&matches);

        let first = at_cell(&cells, 4, 23);
        assert_eq!(first.sample_count, 1);
        assert_eq!(first.compared_count, 0);
        assert_eq!(first.median_ms, Some(8.0));
        assert_eq!(first.over_usual_ms, None);
        let unmeasured = at_cell(&cells, 5, 0);
        assert_eq!(unmeasured.match_count, 1);
        assert_eq!(unmeasured.median_ms, None);
        assert_eq!(unmeasured.status, Severity::Unmeasured);
    }

    #[test]
    fn only_matches_since_the_start_of_the_window_count() {
        let mut matches = usual_history();
        matches.push(measured(day(18, 21), lower_bound(5), 8.0));

        let games = week_hour_games(&matches, day(18, 0), &paris());

        assert_eq!(games.len(), 1);
        assert_eq!(games[0].match_count, 1);
        assert_eq!(games[0].cells.len(), 1);
        assert_eq!(games[0].first_played_at, "2026-09-18T21:00:00Z");
        let usual = games[0].cells[0].usual_ms;
        assert_eq!(usual, Some(5.0));
    }
}

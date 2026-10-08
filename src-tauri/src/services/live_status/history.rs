use super::machine::gateway_basis;
use crate::db::live_probes::GameSlice;
use crate::models::insights::{PingBasis, PingSource, UsualPing};
use crate::models::live_probe::LiveProbeSlice;
use crate::services::live_probe::attach::floor_basis;
use crate::services::live_probe::stats::span;
use crate::services::usual::{parse, usual_ping, PingSample, SampleId, ServerMatch};
use chrono::{DateTime, FixedOffset};
use std::collections::BTreeMap;

#[derive(Debug, Clone, PartialEq)]
pub struct PathSample {
    pub same_pool: bool,
    pub sample: PingSample,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct LiveHistory {
    pub game: Vec<PingSample>,
    pub path: Vec<PathSample>,
}

pub struct Current<'a> {
    pub session_id: i64,
    pub game_name: &'a str,
    pub server_ip: &'a str,
    pub server_asn: Option<u32>,
}

fn slice_basis(slice: &LiveProbeSlice, asn_of: &impl Fn(&str) -> Option<u32>) -> Option<PingBasis> {
    match slice.source {
        PingSource::Gateway => Some(gateway_basis()),
        PingSource::Floor => {
            let asn = slice.reply_ip.as_deref().and_then(asn_of);
            Some(floor_basis(slice, slice.at_destination, asn))
        }
        PingSource::IspEdge => Some(PingBasis {
            source: PingSource::IspEdge,
            at_destination: false,
            measured_hop: slice.ttl,
            measured_asn: slice.reply_ip.as_deref().and_then(asn_of),
            server_ip: None,
        }),
        _ => None,
    }
}

pub fn path_samples(
    slices: &[GameSlice],
    current: &Current,
    asn_of: impl Fn(&str) -> Option<u32>,
) -> Vec<PathSample> {
    let operator = |ip: &str| match asn_of(ip) {
        Some(asn) => (Some(asn), None),
        None => (None, Some(ip.to_string())),
    };
    let pool = match current.server_asn {
        Some(asn) => (Some(asn), None),
        None => operator(current.server_ip),
    };

    type Key = (i64, String, String, Option<i32>);
    let mut groups: BTreeMap<Key, (&str, Vec<&LiveProbeSlice>)> = BTreeMap::new();
    for GameSlice { game_name, slice } in slices {
        if slice.session_id == current.session_id {
            continue;
        }
        let Some(server) = slice.server_ip.clone() else {
            continue;
        };
        let key = (
            slice.session_id,
            server,
            slice.source.as_str().to_string(),
            slice.ttl,
        );
        groups
            .entry(key)
            .or_insert_with(|| (game_name.as_str(), Vec::new()))
            .1
            .push(slice);
    }

    groups
        .into_iter()
        .filter_map(|((session_id, server, _, _), (game_name, group))| {
            let answered = group.iter().rev().find(|slice| slice.received > 0)?;
            let basis = slice_basis(answered, &asn_of)?;
            let measured = span(&group)?;
            let measured_at = parse(&measured.started_at)?;
            Some(PathSample {
                same_pool: game_name == current.game_name && operator(&server) == pool,
                sample: PingSample {
                    id: SampleId::Match(session_id),
                    measured_at,
                    cutoff: measured_at,
                    basis,
                    ping_ms: measured.ping_ms?,
                    loss_pct: measured.loss_pct.unwrap_or(0.0),
                    session_id,
                    match_number: 0,
                    match_started_at: measured.started_at,
                },
            })
        })
        .collect()
}

pub fn game_samples(matches: &[ServerMatch], current: &Current) -> Vec<PingSample> {
    let fallback = (
        current.server_asn,
        current.server_asn.is_none().then_some(current.server_ip),
    );
    let pool = matches
        .iter()
        .find(|game| game.game_name == current.game_name && game.server.ip == current.server_ip)
        .map_or(fallback, |game| game.server.operator_key());
    matches
        .iter()
        .filter(|game| game.game_name == current.game_name && game.server.operator_key() == pool)
        .filter_map(|game| game.sample.clone())
        .filter(|sample| sample.session_id != current.session_id)
        .collect()
}

pub fn usual_for(
    history: &LiveHistory,
    basis: &PingBasis,
    before: DateTime<FixedOffset>,
) -> UsualPing {
    match basis.source {
        PingSource::Game => usual_ping(&history.game, basis, before),
        PingSource::Floor => usual_ping(
            history
                .path
                .iter()
                .filter(|path| path.same_pool)
                .map(|path| &path.sample),
            basis,
            before,
        ),
        PingSource::Gateway | PingSource::IspEdge => {
            usual_ping(history.path.iter().map(|path| &path.sample), basis, before)
        }
        _ => UsualPing::default(),
    }
}

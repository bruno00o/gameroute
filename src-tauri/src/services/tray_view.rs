use crate::config::TRAY_TOOLTIP_MAX_CHARS;
use crate::models::insights::PingSource;
use crate::models::live_status::{LiveReading, LiveState, LiveStatus};
use crate::models::severity::Severity;
use crate::services::alert_text::Locale;

const NBSP: char = '\u{a0}';
const SEPARATOR: &str = ", ";
const MIN_GAME_CHARS: usize = 8;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TrayIconState {
    Idle,
    Waiting,
    Live,
}

#[derive(Debug, Clone, Copy)]
pub struct TrayInput<'a> {
    pub status: Option<&'a LiveStatus>,
    pub monitoring: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MenuLabels {
    pub open: &'static str,
    pub mini: &'static str,
    pub monitoring_stop: &'static str,
    pub monitoring_start: &'static str,
    pub quit: &'static str,
}

pub fn menu_labels(lang: Locale) -> MenuLabels {
    match lang {
        Locale::Fr => MenuLabels {
            open: "Ouvrir GameRoute",
            mini: "Afficher la mini-fenêtre",
            monitoring_stop: "Arrêter la surveillance",
            monitoring_start: "Démarrer la surveillance",
            quit: "Quitter GameRoute",
        },
        Locale::En => MenuLabels {
            open: "Open GameRoute",
            mini: "Show the mini window",
            monitoring_stop: "Stop monitoring",
            monitoring_start: "Start monitoring",
            quit: "Quit GameRoute",
        },
        Locale::Es => MenuLabels {
            open: "Abrir GameRoute",
            mini: "Mostrar la miniventana",
            monitoring_stop: "Detener el monitoreo",
            monitoring_start: "Iniciar el monitoreo",
            quit: "Salir de GameRoute",
        },
    }
}

pub fn still_running(lang: Locale) -> &'static str {
    match lang {
        Locale::Fr => "GameRoute continue de tourner dans la zone de notification.",
        Locale::En => "GameRoute is still running in the system tray.",
        Locale::Es => "GameRoute sigue en la bandeja del sistema.",
    }
}

pub fn icon_state(status: Option<&LiveStatus>) -> TrayIconState {
    match status.map(|status| status.state) {
        Some(LiveState::Live) => TrayIconState::Live,
        Some(LiveState::Waiting | LiveState::Measuring | LiveState::Frozen) => {
            TrayIconState::Waiting
        }
        None => TrayIconState::Idle,
    }
}

pub fn summary(input: TrayInput, lang: Locale) -> String {
    build(input, lang, usize::MAX)
}

pub fn tooltip(input: TrayInput, lang: Locale) -> String {
    let full = |game_chars| format!("GameRoute{SEPARATOR}{}", build(input, lang, game_chars));
    let mut game_chars = input
        .status
        .map_or(0, |status| status.game_name.chars().count());
    let mut text = full(game_chars);
    while text.chars().count() > TRAY_TOOLTIP_MAX_CHARS && game_chars > MIN_GAME_CHARS {
        game_chars -= 1;
        text = full(game_chars);
    }
    if text.chars().count() > TRAY_TOOLTIP_MAX_CHARS {
        text = text.chars().take(TRAY_TOOLTIP_MAX_CHARS - 1).collect();
        text.push('…');
    }
    text
}

fn build(input: TrayInput, lang: Locale, game_chars: usize) -> String {
    let Some(status) = input.status else {
        return if input.monitoring {
            words(lang).no_game
        } else {
            words(lang).monitoring_off
        }
        .to_string();
    };
    let game = shorten(&status.game_name, game_chars);
    let mut parts = vec![game];
    match status.state {
        LiveState::Waiting => parts.push(words(lang).waiting.to_string()),
        LiveState::Measuring => parts.push(words(lang).measuring.to_string()),
        LiveState::Frozen => parts.push(words(lang).frozen.to_string()),
        LiveState::Live => {
            match status
                .primary
                .as_ref()
                .and_then(|reading| reading_text(reading, lang))
            {
                Some(reading) => parts.push(reading),
                None => parts.push(words(lang).in_match.to_string()),
            }
            parts.push(status_label(status.status, lang).to_string());
        }
    }
    parts.join(SEPARATOR)
}

fn reading_text(reading: &LiveReading, lang: Locale) -> Option<String> {
    let ms = reading.median_ms.filter(|_| reading.fresh)?;
    let prefix = if reading.at_least {
        format!("≥{NBSP}")
    } else {
        String::new()
    };
    let mut text = format!("{prefix}{}{NBSP}ms", ms.round() as i64);
    if reading.at_least {
        if let Some(hop) = reading.hop.or(reading.basis.measured_hop) {
            text.push_str(&format!(" ({} {hop})", words(lang).up_to_hop));
        }
    }
    if reading.basis.source == PingSource::Game {
        text.push_str(&format!(" ({})", words(lang).by_game));
    }
    Some(text)
}

fn shorten(text: &str, max_chars: usize) -> String {
    if text.chars().count() <= max_chars {
        return text.to_string();
    }
    let mut cut: String = text.chars().take(max_chars.saturating_sub(1)).collect();
    cut.push('…');
    cut
}

fn status_label(status: Severity, lang: Locale) -> &'static str {
    match (lang, status) {
        (Locale::Fr, Severity::Ok) => "Bon",
        (Locale::Fr, Severity::Watch) => "À surveiller",
        (Locale::Fr, Severity::Degraded) => "Dégradé",
        (Locale::Fr, Severity::Critical) => "Critique",
        (Locale::Fr, Severity::Unmeasured) => "Non mesurable",
        (Locale::En, Severity::Ok) => "Good",
        (Locale::En, Severity::Watch) => "Watch",
        (Locale::En, Severity::Degraded) => "Degraded",
        (Locale::En, Severity::Critical) => "Critical",
        (Locale::En, Severity::Unmeasured) => "Not measurable",
        (Locale::Es, Severity::Ok) => "Bueno",
        (Locale::Es, Severity::Watch) => "Vigilar",
        (Locale::Es, Severity::Degraded) => "Degradado",
        (Locale::Es, Severity::Critical) => "Crítico",
        (Locale::Es, Severity::Unmeasured) => "No medible",
    }
}

struct Words {
    monitoring_off: &'static str,
    no_game: &'static str,
    waiting: &'static str,
    measuring: &'static str,
    frozen: &'static str,
    in_match: &'static str,
    up_to_hop: &'static str,
    by_game: &'static str,
}

fn words(lang: Locale) -> Words {
    match lang {
        Locale::Fr => Words {
            monitoring_off: "Surveillance arrêtée",
            no_game: "Aucun jeu ouvert",
            waiting: "En attente du match",
            measuring: "Mesure en cours",
            frozen: "Signal figé",
            in_match: "En match",
            up_to_hop: "jusqu'au saut",
            by_game: "mesuré par le jeu",
        },
        Locale::En => Words {
            monitoring_off: "Monitoring stopped",
            no_game: "No game open",
            waiting: "Waiting for the match",
            measuring: "Measuring",
            frozen: "Signal frozen",
            in_match: "In match",
            up_to_hop: "up to hop",
            by_game: "measured by the game",
        },
        Locale::Es => Words {
            monitoring_off: "Monitoreo detenido",
            no_game: "Ningún juego abierto",
            waiting: "Esperando la partida",
            measuring: "Midiendo",
            frozen: "Señal congelada",
            in_match: "En partida",
            up_to_hop: "hasta el salto",
            by_game: "medido por el juego",
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::insights::{PingBasis, UsualPing};
    use crate::models::live_status::LivePoint;

    fn reading(
        point: LivePoint,
        source: PingSource,
        ms: Option<f64>,
        at_least: bool,
    ) -> LiveReading {
        LiveReading {
            point,
            basis: PingBasis {
                source,
                at_destination: !at_least,
                measured_hop: at_least.then_some(8),
                measured_asn: None,
                server_ip: None,
            },
            at_least,
            zone: None,
            hop: at_least.then_some(8),
            hop_ip: None,
            asn: None,
            operator: None,
            median_ms: ms,
            usual: UsualPing::default(),
            trace_ms: None,
            jitter_ms: None,
            loss_pct: None,
            loss_floor_pct: None,
            lost: 0,
            sent: 0,
            sample_count: 0,
            status: Severity::Ok,
            cause: None,
            last_sample_at: String::new(),
            fresh: true,
        }
    }

    fn status(game: &str, state: LiveState, primary: Option<LiveReading>) -> LiveStatus {
        LiveStatus {
            session_id: 1,
            game_name: game.to_string(),
            state,
            state_since: String::new(),
            frozen_reason: None,
            server_ip: None,
            server_port: None,
            match_started_at: None,
            last_sample_at: None,
            status: Severity::Ok,
            status_since: None,
            cause: None,
            primary,
            points: Vec::new(),
            zones: Vec::new(),
            fault: None,
            region: None,
            updated_at: String::new(),
        }
    }

    fn input(status: &LiveStatus) -> TrayInput<'_> {
        TrayInput {
            status: Some(status),
            monitoring: true,
        }
    }

    #[test]
    fn a_lower_bound_keeps_its_sign_and_names_the_hop() {
        let live = status(
            "VALORANT",
            LiveState::Live,
            Some(reading(
                LivePoint::Floor,
                PingSource::Floor,
                Some(17.6),
                true,
            )),
        );

        assert_eq!(
            tooltip(input(&live), Locale::Fr),
            "GameRoute, VALORANT, ≥\u{a0}18\u{a0}ms (jusqu'au saut 8), Bon"
        );
        assert_eq!(
            tooltip(input(&live), Locale::En),
            "GameRoute, VALORANT, ≥\u{a0}18\u{a0}ms (up to hop 8), Good"
        );
    }

    #[test]
    fn a_ping_measured_at_the_server_has_no_sign() {
        let live = status(
            "Counter-Strike 2",
            LiveState::Live,
            Some(reading(
                LivePoint::Game,
                PingSource::Trace,
                Some(31.0),
                false,
            )),
        );

        assert_eq!(
            tooltip(input(&live), Locale::Es),
            "GameRoute, Counter-Strike 2, 31\u{a0}ms, Bueno"
        );
    }

    #[test]
    fn the_game_ping_says_who_measured_it() {
        let live = status(
            "League of Legends",
            LiveState::Live,
            Some(reading(
                LivePoint::Game,
                PingSource::Game,
                Some(38.2),
                false,
            )),
        );

        assert_eq!(
            tooltip(input(&live), Locale::Fr),
            "GameRoute, League of Legends, 38\u{a0}ms (mesuré par le jeu), Bon"
        );
    }

    #[test]
    fn the_status_word_follows_the_status() {
        let mut live = status(
            "VALORANT",
            LiveState::Live,
            Some(reading(
                LivePoint::Floor,
                PingSource::Floor,
                Some(90.0),
                true,
            )),
        );
        live.status = Severity::Degraded;

        assert!(tooltip(input(&live), Locale::Fr).ends_with(", Dégradé"));
        live.status = Severity::Critical;
        assert!(tooltip(input(&live), Locale::En).ends_with(", Critical"));
    }

    #[test]
    fn a_stale_reading_is_not_shown_as_a_number() {
        let mut stale = reading(LivePoint::Floor, PingSource::Floor, Some(18.0), true);
        stale.fresh = false;
        let live = status("VALORANT", LiveState::Live, Some(stale));

        assert_eq!(
            tooltip(input(&live), Locale::En),
            "GameRoute, VALORANT, In match, Good"
        );
    }

    #[test]
    fn states_without_a_reading_say_what_they_wait_for() {
        for (state, fr, en) in [
            (
                LiveState::Waiting,
                "En attente du match",
                "Waiting for the match",
            ),
            (LiveState::Measuring, "Mesure en cours", "Measuring"),
            (LiveState::Frozen, "Signal figé", "Signal frozen"),
        ] {
            let current = status("VALORANT", state, None);
            assert_eq!(
                tooltip(input(&current), Locale::Fr),
                format!("GameRoute, VALORANT, {fr}")
            );
            assert_eq!(
                tooltip(input(&current), Locale::En),
                format!("GameRoute, VALORANT, {en}")
            );
        }
    }

    #[test]
    fn without_a_game_the_tooltip_tells_if_monitoring_is_on() {
        let off = TrayInput {
            status: None,
            monitoring: false,
        };
        let on = TrayInput {
            status: None,
            monitoring: true,
        };

        assert_eq!(tooltip(off, Locale::Fr), "GameRoute, Surveillance arrêtée");
        assert_eq!(tooltip(on, Locale::Fr), "GameRoute, Aucun jeu ouvert");
        assert_eq!(summary(on, Locale::En), "No game open");
    }

    #[test]
    fn the_summary_is_the_tooltip_without_the_app_name() {
        let live = status(
            "VALORANT",
            LiveState::Live,
            Some(reading(
                LivePoint::Floor,
                PingSource::Floor,
                Some(18.0),
                false,
            )),
        );

        assert_eq!(
            format!("GameRoute, {}", summary(input(&live), Locale::Fr)),
            tooltip(input(&live), Locale::Fr)
        );
    }

    #[test]
    fn a_long_game_name_is_cut_before_the_numbers() {
        let long = "A very long game name ".repeat(8);
        let live = status(
            &long,
            LiveState::Live,
            Some(reading(
                LivePoint::Floor,
                PingSource::Floor,
                Some(18.0),
                true,
            )),
        );

        let text = tooltip(input(&live), Locale::Fr);

        assert!(text.chars().count() <= TRAY_TOOLTIP_MAX_CHARS);
        assert!(text.contains('…'));
        assert!(text.ends_with("≥\u{a0}18\u{a0}ms (jusqu'au saut 8), Bon"));
    }

    #[test]
    fn the_icon_follows_the_live_state() {
        assert_eq!(icon_state(None), TrayIconState::Idle);
        for (state, expected) in [
            (LiveState::Waiting, TrayIconState::Waiting),
            (LiveState::Measuring, TrayIconState::Waiting),
            (LiveState::Frozen, TrayIconState::Waiting),
            (LiveState::Live, TrayIconState::Live),
        ] {
            assert_eq!(icon_state(Some(&status("VALORANT", state, None))), expected);
        }
    }

    #[test]
    fn every_menu_label_is_translated() {
        let fr = menu_labels(Locale::Fr);
        let en = menu_labels(Locale::En);
        let es = menu_labels(Locale::Es);

        assert_eq!(fr.quit, "Quitter GameRoute");
        for labels in [fr, en, es] {
            for text in [
                labels.open,
                labels.mini,
                labels.monitoring_stop,
                labels.monitoring_start,
                labels.quit,
            ] {
                assert!(!text.is_empty());
            }
        }
        assert_ne!(fr, en);
        assert_ne!(en, es);
        assert_ne!(fr, es);
    }
}

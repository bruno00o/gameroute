use crate::models::insights::IncidentCause;
use crate::models::live_status::FaultZone;

const NBSP: char = '\u{a0}';

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Locale {
    En,
    Fr,
    Es,
}

impl Locale {
    pub fn from_code(code: Option<&str>) -> Self {
        match code {
            Some("fr") => Self::Fr,
            Some("es") => Self::Es,
            _ => Self::En,
        }
    }

    fn decimal_comma(self) -> bool {
        self != Self::En
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum Place {
    Game,
    Server,
    Hop {
        hop: Option<i32>,
        operator: Option<String>,
    },
}

#[derive(Debug, Clone, PartialEq)]
pub struct AlertFacts {
    pub seconds: i64,
    pub cause: IncidentCause,
    pub value: f64,
    pub lower_bound: bool,
    pub place: Place,
    pub usual_ms: Option<f64>,
    pub zone: Option<FaultZone>,
    pub operator: Option<String>,
}

pub struct AlertText {
    pub title: String,
    pub body: String,
}

fn number(locale: Locale, value: f64, decimals: bool) -> String {
    let text = if decimals {
        let rounded = (value * 10.0).round() / 10.0;
        if rounded.fract() == 0.0 {
            format!("{rounded:.0}")
        } else {
            format!("{rounded:.1}")
        }
    } else {
        format!("{:.0}", value.round())
    };
    if locale.decimal_comma() {
        text.replace('.', ",")
    } else {
        text
    }
}

fn duration(seconds: i64) -> String {
    let seconds = seconds.max(0);
    if seconds < 60 {
        format!("{seconds}{NBSP}s")
    } else {
        format!("{}{NBSP}min", seconds / 60)
    }
}

fn title(locale: Locale, seconds: i64) -> String {
    let elapsed = duration(seconds);
    match locale {
        Locale::En => format!("Critical connection for {elapsed}"),
        Locale::Fr => format!("Connexion critique depuis {elapsed}"),
        Locale::Es => format!("Conexión crítica desde hace {elapsed}"),
    }
}

fn metric(locale: Locale, facts: &AlertFacts) -> String {
    let bound = if facts.lower_bound { "≥ " } else { "" };
    let (label, value) = match facts.cause {
        IncidentCause::Loss => {
            let label = match locale {
                Locale::En => "Loss",
                Locale::Fr => "Perte",
                Locale::Es => "Pérdida",
            };
            let percent = if locale == Locale::En {
                "%".to_string()
            } else {
                format!("{NBSP}%")
            };
            (
                label,
                format!("{}{percent}", number(locale, facts.value, true)),
            )
        }
        IncidentCause::Latency => {
            let label = match locale {
                Locale::En => "Latency",
                Locale::Fr => "Latence",
                Locale::Es => "Latencia",
            };
            (
                label,
                format!("{}{NBSP}ms", number(locale, facts.value, false)),
            )
        }
        IncidentCause::Jitter => {
            let label = match locale {
                Locale::En | Locale::Es => "Jitter",
                Locale::Fr => "Gigue",
            };
            (
                label,
                format!("{}{NBSP}ms", number(locale, facts.value, false)),
            )
        }
    };
    format!("{label} {bound}{value}")
}

fn place(locale: Locale, place: &Place) -> String {
    match (place, locale) {
        (Place::Game, Locale::En) => " (measured by the game)".to_string(),
        (Place::Game, Locale::Fr) => " (mesure du jeu)".to_string(),
        (Place::Game, Locale::Es) => " (medido por el juego)".to_string(),
        (Place::Server, Locale::En) => " to the server".to_string(),
        (Place::Server, Locale::Fr) => " jusqu’au serveur".to_string(),
        (Place::Server, Locale::Es) => " hasta el servidor".to_string(),
        (Place::Hop { hop, operator }, locale) => {
            let target = match (hop, locale) {
                (Some(hop), Locale::En) => format!(" up to hop {hop}"),
                (Some(hop), Locale::Fr) => format!(" jusqu’au saut {hop}"),
                (Some(hop), Locale::Es) => format!(" hasta el salto {hop}"),
                (None, Locale::En) => " up to the last router that answers".to_string(),
                (None, Locale::Fr) => " jusqu’au dernier routeur qui répond".to_string(),
                (None, Locale::Es) => " hasta el último router que responde".to_string(),
            };
            match operator {
                Some(operator) => format!("{target} ({operator})"),
                None => target,
            }
        }
    }
}

fn usual(locale: Locale, usual_ms: f64) -> String {
    let value = number(locale, usual_ms, false);
    match locale {
        Locale::En => format!(" (usually {value}{NBSP}ms)"),
        Locale::Fr => format!(" (habituel {value}{NBSP}ms)"),
        Locale::Es => format!(" (habitual {value}{NBSP}ms)"),
    }
}

fn origin(locale: Locale, zone: FaultZone, operator: Option<&str>) -> Option<String> {
    let text = match (zone, locale) {
        (FaultZone::Unlocated, _) => return None,
        (FaultZone::Home, Locale::En) => "It comes from your home network.".to_string(),
        (FaultZone::Home, Locale::Fr) => "Ça vient de chez vous.".to_string(),
        (FaultZone::Home, Locale::Es) => "Viene de tu red local.".to_string(),
        (FaultZone::NotHome, Locale::En) => "It does not come from your home network.".to_string(),
        (FaultZone::NotHome, Locale::Fr) => "Ça ne vient pas de chez vous.".to_string(),
        (FaultZone::NotHome, Locale::Es) => "No viene de tu red local.".to_string(),
        (FaultZone::Isp, locale) => {
            let with = |base: &str| match operator {
                Some(operator) => format!("{base} ({operator})."),
                None => format!("{base}."),
            };
            match locale {
                Locale::En => with("It starts at your ISP"),
                Locale::Fr => with("Ça commence chez votre FAI"),
                Locale::Es => with("Empieza en tu proveedor"),
            }
        }
        (FaultZone::Transit, locale) => match (operator, locale) {
            (Some(operator), Locale::En) => format!("It starts at {operator}."),
            (Some(operator), Locale::Fr) => format!("Ça commence chez {operator}."),
            (Some(operator), Locale::Es) => format!("Empieza en {operator}."),
            (None, Locale::En) => "It starts in transit.".to_string(),
            (None, Locale::Fr) => "Ça commence sur le transit.".to_string(),
            (None, Locale::Es) => "Empieza en el tránsito.".to_string(),
        },
        (FaultZone::Service, Locale::En) => "It starts at the game server.".to_string(),
        (FaultZone::Service, Locale::Fr) => "Ça commence au niveau du serveur de jeu.".to_string(),
        (FaultZone::Service, Locale::Es) => "Empieza en el servidor de juego.".to_string(),
        (FaultZone::AfterIsp, Locale::En) => "It starts after your ISP.".to_string(),
        (FaultZone::AfterIsp, Locale::Fr) => "Ça commence après votre FAI.".to_string(),
        (FaultZone::AfterIsp, Locale::Es) => "Empieza después de tu proveedor.".to_string(),
    };
    Some(text)
}

pub fn compose(locale: Locale, facts: &AlertFacts) -> AlertText {
    let mut measure = format!("{}{}", metric(locale, facts), place(locale, &facts.place));
    if let (IncidentCause::Latency, Some(usual_ms)) = (facts.cause, facts.usual_ms) {
        measure.push_str(&usual(locale, usual_ms));
    }
    measure.push('.');
    let body = match facts
        .zone
        .and_then(|zone| origin(locale, zone, facts.operator.as_deref()))
    {
        Some(origin) => format!("{measure} {origin}"),
        None => measure,
    };
    AlertText {
        title: title(locale, facts.seconds),
        body,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn facts(cause: IncidentCause, value: f64, place: Place) -> AlertFacts {
        AlertFacts {
            seconds: 40,
            cause,
            value,
            lower_bound: false,
            place,
            usual_ms: None,
            zone: None,
            operator: None,
        }
    }

    #[test]
    fn loss_at_the_server_names_where_it_starts() {
        let mut loss = facts(IncidentCause::Loss, 6.0, Place::Server);
        loss.zone = Some(FaultZone::Isp);
        loss.operator = Some("SFR".to_string());

        let text = compose(Locale::Fr, &loss);

        assert_eq!(text.title, "Connexion critique depuis 40\u{a0}s");
        assert_eq!(
            text.body,
            "Perte 6\u{a0}% jusqu’au serveur. Ça commence chez votre FAI (SFR)."
        );
    }

    #[test]
    fn a_hop_ping_stays_a_lower_bound() {
        let mut ping = facts(
            IncidentCause::Latency,
            120.0,
            Place::Hop {
                hop: Some(5),
                operator: Some("SFR".to_string()),
            },
        );
        ping.lower_bound = true;

        assert_eq!(
            compose(Locale::Fr, &ping).body,
            "Latence ≥ 120\u{a0}ms jusqu’au saut 5 (SFR)."
        );
        assert_eq!(
            compose(Locale::En, &ping).body,
            "Latency ≥ 120\u{a0}ms up to hop 5 (SFR)."
        );
        assert_eq!(
            compose(Locale::Es, &ping).body,
            "Latencia ≥ 120\u{a0}ms hasta el salto 5 (SFR)."
        );
    }

    #[test]
    fn the_game_measure_is_labelled_and_the_usual_is_shown() {
        let mut ping = facts(IncidentCause::Latency, 142.4, Place::Game);
        ping.usual_ms = Some(41.0);
        ping.zone = Some(FaultZone::NotHome);

        assert_eq!(
            compose(Locale::Fr, &ping).body,
            "Latence 142\u{a0}ms (mesure du jeu) (habituel 41\u{a0}ms). Ça ne vient pas de chez vous."
        );
        assert_eq!(
            compose(Locale::En, &ping).body,
            "Latency 142\u{a0}ms (measured by the game) (usually 41\u{a0}ms). It does not come from your home network."
        );
    }

    #[test]
    fn decimals_follow_the_language() {
        let loss = facts(IncidentCause::Loss, 5.5, Place::Server);

        assert!(compose(Locale::En, &loss)
            .body
            .starts_with("Loss 5.5% to the server"));
        assert!(compose(Locale::Fr, &loss)
            .body
            .starts_with("Perte 5,5\u{a0}% jusqu’au"));
        assert!(compose(Locale::Es, &loss)
            .body
            .starts_with("Pérdida 5,5\u{a0}% hasta"));
    }

    #[test]
    fn the_title_counts_in_minutes_past_a_minute() {
        let mut loss = facts(IncidentCause::Jitter, 35.0, Place::Server);
        loss.seconds = 125;

        assert_eq!(
            compose(Locale::En, &loss).title,
            "Critical connection for 2\u{a0}min"
        );
        assert_eq!(
            compose(Locale::Es, &loss).title,
            "Conexión crítica desde hace 2\u{a0}min"
        );
        assert!(compose(Locale::Fr, &loss)
            .body
            .starts_with("Gigue 35\u{a0}ms"));
    }

    #[test]
    fn unknown_codes_fall_back_to_english() {
        assert_eq!(Locale::from_code(Some("fr")), Locale::Fr);
        assert_eq!(Locale::from_code(Some("es")), Locale::Es);
        assert_eq!(Locale::from_code(Some("de")), Locale::En);
        assert_eq!(Locale::from_code(None), Locale::En);
    }
}

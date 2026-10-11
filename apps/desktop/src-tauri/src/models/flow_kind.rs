use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum FlowKind {
    Game,
    Voice,
    Other,
}

impl FlowKind {
    pub fn as_str(self) -> &'static str {
        match self {
            FlowKind::Game => "game",
            FlowKind::Voice => "voice",
            FlowKind::Other => "other",
        }
    }

    pub fn priority(self) -> u8 {
        match self {
            FlowKind::Game => 0,
            FlowKind::Voice => 1,
            FlowKind::Other => 2,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn priority_orders_game_first() {
        assert!(FlowKind::Game.priority() < FlowKind::Voice.priority());
        assert!(FlowKind::Voice.priority() < FlowKind::Other.priority());
    }
}

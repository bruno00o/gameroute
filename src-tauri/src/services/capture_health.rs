use std::sync::atomic::{AtomicU8, Ordering};

const UNKNOWN: u8 = 0;
const ANSWERING: u8 = 1;
const DOWN: u8 = 2;

static LAST_CAPTURE: AtomicU8 = AtomicU8::new(UNKNOWN);

pub fn record(answered: bool) {
    LAST_CAPTURE.store(if answered { ANSWERING } else { DOWN }, Ordering::Relaxed);
}

pub fn is_down() -> bool {
    LAST_CAPTURE.load(Ordering::Relaxed) == DOWN
}

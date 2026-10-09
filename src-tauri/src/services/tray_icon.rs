use super::tray_view::TrayIconState;

pub const ICON_SIZE: u32 = 32;

const SCALE: f64 = ICON_SIZE as f64 / 20.0;
const OFFSET_Y: f64 = (ICON_SIZE as f64 - 12.0 * SCALE) / 2.0;
const STROKE: f64 = 1.6;
const RING_RX: f64 = 8.6;
const RING_RY: f64 = 3.1;
const RING_TILT_DEG: f64 = -18.0;
const DOT_R: f64 = 3.4;
const DASH: f64 = 5.0;
const GAP: f64 = 4.0;
const RING_STEPS: usize = 120;
const SUPERSAMPLE: u32 = 4;

type Rgb = [u8; 3];

struct Look {
    color: Rgb,
    ring_alpha: f64,
    dashed: bool,
    filled: bool,
}

fn look(state: TrayIconState, light_taskbar: bool) -> Look {
    let (muted, ink, signal): (Rgb, Rgb, Rgb) = if light_taskbar {
        ([0x4d, 0x53, 0x5b], [0x15, 0x1a, 0x21], [0x00, 0x6e, 0xa4])
    } else {
        ([0xb2, 0xb8, 0xbf], [0xee, 0xf0, 0xf3], [0x63, 0xcc, 0xf8])
    };
    match state {
        TrayIconState::Idle => Look {
            color: muted,
            ring_alpha: 0.6,
            dashed: false,
            filled: false,
        },
        TrayIconState::Waiting => Look {
            color: ink,
            ring_alpha: 1.0,
            dashed: true,
            filled: true,
        },
        TrayIconState::Live => Look {
            color: signal,
            ring_alpha: 1.0,
            dashed: false,
            filled: true,
        },
    }
}

struct Segment {
    from: (f64, f64),
    to: (f64, f64),
    drawn: bool,
}

fn ring_segments(dashed: bool) -> Vec<Segment> {
    let tilt = RING_TILT_DEG.to_radians();
    let (sin, cos) = tilt.sin_cos();
    let point = |step: usize| {
        let t = step as f64 / RING_STEPS as f64 * std::f64::consts::TAU;
        let (x, y) = (RING_RX * t.cos(), RING_RY * t.sin());
        (10.0 + x * cos - y * sin, 6.0 + x * sin + y * cos)
    };
    let mut travelled = 0.0;
    (0..RING_STEPS)
        .map(|step| {
            let (from, to) = (point(step), point(step + 1));
            let drawn = !dashed || travelled % (DASH + GAP) < DASH;
            travelled += ((to.0 - from.0).powi(2) + (to.1 - from.1).powi(2)).sqrt();
            Segment { from, to, drawn }
        })
        .collect()
}

fn distance_to_segment(p: (f64, f64), a: (f64, f64), b: (f64, f64)) -> f64 {
    let (dx, dy) = (b.0 - a.0, b.1 - a.1);
    let length_sq = dx * dx + dy * dy;
    let t = if length_sq == 0.0 {
        0.0
    } else {
        (((p.0 - a.0) * dx + (p.1 - a.1) * dy) / length_sq).clamp(0.0, 1.0)
    };
    ((p.0 - (a.0 + t * dx)).powi(2) + (p.1 - (a.1 + t * dy)).powi(2)).sqrt()
}

pub fn render(state: TrayIconState, light_taskbar: bool) -> Vec<u8> {
    let look = look(state, light_taskbar);
    let ring = ring_segments(look.dashed);
    let half_stroke = STROKE / 2.0;
    let mut rgba = vec![0u8; (ICON_SIZE * ICON_SIZE * 4) as usize];

    for py in 0..ICON_SIZE {
        for px in 0..ICON_SIZE {
            let (mut ring_hits, mut dot_hits) = (0u32, 0u32);
            for sy in 0..SUPERSAMPLE {
                for sx in 0..SUPERSAMPLE {
                    let fx = px as f64 + (sx as f64 + 0.5) / SUPERSAMPLE as f64;
                    let fy = py as f64 + (sy as f64 + 0.5) / SUPERSAMPLE as f64;
                    let p = (fx / SCALE, (fy - OFFSET_Y) / SCALE);
                    let to_center = ((p.0 - 10.0).powi(2) + (p.1 - 6.0).powi(2)).sqrt();
                    let in_dot = if look.filled {
                        to_center <= DOT_R
                    } else {
                        (to_center - DOT_R).abs() <= half_stroke
                    };
                    if in_dot {
                        dot_hits += 1;
                    } else if ring
                        .iter()
                        .any(|s| s.drawn && distance_to_segment(p, s.from, s.to) <= half_stroke)
                    {
                        ring_hits += 1;
                    }
                }
            }
            let samples = (SUPERSAMPLE * SUPERSAMPLE) as f64;
            let alpha = (dot_hits as f64 + ring_hits as f64 * look.ring_alpha) / samples;
            let at = ((py * ICON_SIZE + px) * 4) as usize;
            rgba[at..at + 3].copy_from_slice(&look.color);
            rgba[at + 3] = (alpha * 255.0).round() as u8;
        }
    }
    rgba
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pixel(rgba: &[u8], x: u32, y: u32) -> [u8; 4] {
        let at = ((y * ICON_SIZE + x) * 4) as usize;
        [rgba[at], rgba[at + 1], rgba[at + 2], rgba[at + 3]]
    }

    const CENTER: u32 = ICON_SIZE / 2;

    #[test]
    fn the_buffer_is_a_square_rgba_image() {
        for state in [
            TrayIconState::Idle,
            TrayIconState::Waiting,
            TrayIconState::Live,
        ] {
            assert_eq!(
                render(state, false).len(),
                (ICON_SIZE * ICON_SIZE * 4) as usize
            );
        }
    }

    #[test]
    fn the_three_states_look_different() {
        let idle = render(TrayIconState::Idle, false);
        let waiting = render(TrayIconState::Waiting, false);
        let live = render(TrayIconState::Live, false);

        assert_ne!(idle, waiting);
        assert_ne!(idle, live);
        assert_ne!(waiting, live);
    }

    #[test]
    fn idle_is_hollow_and_the_others_have_a_dot() {
        assert_eq!(
            pixel(&render(TrayIconState::Idle, false), CENTER, CENTER)[3],
            0
        );
        assert_eq!(
            pixel(&render(TrayIconState::Waiting, false), CENTER, CENTER)[3],
            255
        );
        assert_eq!(
            pixel(&render(TrayIconState::Live, false), CENTER, CENTER)[3],
            255
        );
    }

    #[test]
    fn cyan_is_for_the_live_state_only() {
        let is_cyan = |rgba: &[u8]| {
            let [r, _, b, a] = pixel(rgba, CENTER, CENTER);
            a == 255 && i32::from(b) > i32::from(r) + 60
        };

        assert!(is_cyan(&render(TrayIconState::Live, false)));
        assert!(is_cyan(&render(TrayIconState::Live, true)));
        assert!(!is_cyan(&render(TrayIconState::Waiting, false)));
        assert!(!is_cyan(&render(TrayIconState::Waiting, true)));
    }

    #[test]
    fn the_waiting_ring_is_dashed() {
        let covered = |rgba: &[u8]| rgba.chunks(4).filter(|px| px[3] > 0).count();

        assert!(
            covered(&render(TrayIconState::Waiting, false))
                < covered(&render(TrayIconState::Live, false))
        );
    }

    #[test]
    fn the_glyph_follows_the_taskbar_theme() {
        let dark = render(TrayIconState::Waiting, false);
        let light = render(TrayIconState::Waiting, true);

        assert!(pixel(&dark, CENTER, CENTER)[0] > 0xc0);
        assert!(pixel(&light, CENTER, CENTER)[0] < 0x40);
    }
}

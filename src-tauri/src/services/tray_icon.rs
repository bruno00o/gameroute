use super::tray_view::TrayIconState;

pub const ICON_SIZE: u32 = 32;

const MARK_SIZE: usize = 128;
const MARK: &[u8; MARK_SIZE * MARK_SIZE] = include_bytes!("../../assets/tray-mark.bin");
const BLOCK: usize = MARK_SIZE / ICON_SIZE as usize;
const DOT_CENTER: (f64, f64) = (25.5, 25.5);
const DOT_R: f64 = 5.0;
const DOT_RING: f64 = 2.0;
const DOT_CLEARANCE: f64 = 1.8;
const SUPERSAMPLE: u32 = 4;

type Rgb = [u8; 3];

#[derive(Clone, Copy, PartialEq)]
enum Dot {
    None,
    Hollow,
    Filled,
}

struct Look {
    color: Rgb,
    mark_alpha: f64,
    dot: Dot,
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
            mark_alpha: 0.65,
            dot: Dot::None,
        },
        TrayIconState::Waiting => Look {
            color: ink,
            mark_alpha: 1.0,
            dot: Dot::Hollow,
        },
        TrayIconState::Live => Look {
            color: signal,
            mark_alpha: 1.0,
            dot: Dot::Filled,
        },
    }
}

fn mark_coverage(px: u32, py: u32) -> f64 {
    let (x0, y0) = (px as usize * BLOCK, py as usize * BLOCK);
    let sum: u32 = (y0..y0 + BLOCK)
        .flat_map(|y| (x0..x0 + BLOCK).map(move |x| u32::from(MARK[y * MARK_SIZE + x])))
        .sum();
    f64::from(sum) / (255.0 * (BLOCK * BLOCK) as f64)
}

fn dot_coverage(px: u32, py: u32, dot: Dot) -> (f64, f64) {
    let (mut dot_hits, mut clear_hits) = (0u32, 0u32);
    for sy in 0..SUPERSAMPLE {
        for sx in 0..SUPERSAMPLE {
            let fx = px as f64 + (sx as f64 + 0.5) / SUPERSAMPLE as f64;
            let fy = py as f64 + (sy as f64 + 0.5) / SUPERSAMPLE as f64;
            let d = ((fx - DOT_CENTER.0).powi(2) + (fy - DOT_CENTER.1).powi(2)).sqrt();
            if d <= DOT_R + DOT_CLEARANCE {
                clear_hits += 1;
            }
            let inked = match dot {
                Dot::None => false,
                Dot::Filled => d <= DOT_R,
                Dot::Hollow => (DOT_R - DOT_RING..=DOT_R).contains(&d),
            };
            if inked {
                dot_hits += 1;
            }
        }
    }
    let samples = (SUPERSAMPLE * SUPERSAMPLE) as f64;
    (dot_hits as f64 / samples, clear_hits as f64 / samples)
}

pub fn render(state: TrayIconState, light_taskbar: bool) -> Vec<u8> {
    let look = look(state, light_taskbar);
    let mut rgba = vec![0u8; (ICON_SIZE * ICON_SIZE * 4) as usize];

    for py in 0..ICON_SIZE {
        for px in 0..ICON_SIZE {
            let (dot, clear) = if look.dot == Dot::None {
                (0.0, 0.0)
            } else {
                dot_coverage(px, py, look.dot)
            };
            let mark = mark_coverage(px, py) * look.mark_alpha * (1.0 - clear);
            let alpha = (mark + dot).min(1.0);
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

    const STATES: [TrayIconState; 3] = [
        TrayIconState::Idle,
        TrayIconState::Waiting,
        TrayIconState::Live,
    ];
    const DOT_PIXEL: u32 = 25;

    fn pixel(rgba: &[u8], x: u32, y: u32) -> [u8; 4] {
        let at = ((y * ICON_SIZE + x) * 4) as usize;
        [rgba[at], rgba[at + 1], rgba[at + 2], rgba[at + 3]]
    }

    fn ink(rgba: &[u8]) -> [u8; 3] {
        let p = rgba.chunks(4).find(|px| px[3] > 0).expect("an inked pixel");
        [p[0], p[1], p[2]]
    }

    fn mark_footprint(rgba: &[u8]) -> Vec<bool> {
        (0..ICON_SIZE * ICON_SIZE)
            .filter(|i| {
                let (x, y) = (f64::from(i % ICON_SIZE) + 0.5, f64::from(i / ICON_SIZE) + 0.5);
                ((x - DOT_CENTER.0).powi(2) + (y - DOT_CENTER.1).powi(2)).sqrt()
                    > DOT_R + DOT_CLEARANCE + 1.5
            })
            .map(|i| rgba[(i * 4 + 3) as usize] > 0)
            .collect()
    }

    #[test]
    fn the_buffer_is_a_square_rgba_image() {
        for state in STATES {
            for light in [false, true] {
                assert_eq!(
                    render(state, light).len(),
                    (ICON_SIZE * ICON_SIZE * 4) as usize
                );
            }
        }
    }

    #[test]
    fn every_state_draws_something_and_leaves_the_corners_clear() {
        for state in STATES {
            let rgba = render(state, false);

            assert!(rgba.chunks(4).filter(|px| px[3] > 0).count() > 60);
            assert_eq!(pixel(&rgba, 0, 0)[3], 0);
            assert_eq!(pixel(&rgba, ICON_SIZE - 1, 0)[3], 0);
        }
    }

    #[test]
    fn the_three_states_look_different_on_both_taskbars() {
        for light in [false, true] {
            let idle = render(TrayIconState::Idle, light);
            let waiting = render(TrayIconState::Waiting, light);
            let live = render(TrayIconState::Live, light);

            assert_ne!(idle, waiting);
            assert_ne!(idle, live);
            assert_ne!(waiting, live);
        }
    }

    #[test]
    fn the_planet_and_ring_are_the_same_in_every_state() {
        let idle = mark_footprint(&render(TrayIconState::Idle, false));
        let waiting = mark_footprint(&render(TrayIconState::Waiting, false));
        let live = mark_footprint(&render(TrayIconState::Live, false));

        assert!(live.iter().filter(|on| **on).count() > 60);
        assert_eq!(waiting, live);
        assert!(idle.iter().zip(&live).all(|(idle, live)| !idle || *live));
    }

    #[test]
    fn the_status_dot_is_absent_hollow_or_filled() {
        let dot = |state| pixel(&render(state, false), DOT_PIXEL, DOT_PIXEL)[3];

        assert_eq!(dot(TrayIconState::Idle), 0);
        assert_eq!(dot(TrayIconState::Waiting), 0);
        assert_eq!(dot(TrayIconState::Live), 255);
        assert!(pixel(&render(TrayIconState::Waiting, false), DOT_PIXEL + 3, DOT_PIXEL)[3] > 0);
    }

    #[test]
    fn cyan_is_for_the_live_state_only() {
        let is_cyan = |rgba: &[u8]| {
            let [r, _, b] = ink(rgba);
            i32::from(b) > i32::from(r) + 60
        };

        assert!(is_cyan(&render(TrayIconState::Live, false)));
        assert!(is_cyan(&render(TrayIconState::Live, true)));
        for state in [TrayIconState::Idle, TrayIconState::Waiting] {
            assert!(!is_cyan(&render(state, false)));
            assert!(!is_cyan(&render(state, true)));
        }
    }

    #[test]
    fn the_glyph_follows_the_taskbar_theme() {
        let dark = ink(&render(TrayIconState::Waiting, false));
        let light = ink(&render(TrayIconState::Waiting, true));

        assert!(dark[0] > 0xc0);
        assert!(light[0] < 0x40);
    }
}

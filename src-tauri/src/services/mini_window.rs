use std::sync::{Mutex, PoisonError};

use tauri::{
    AppHandle, LogicalSize, Manager, Monitor, PhysicalPosition, Runtime, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder, Window, WindowEvent,
};
use thiserror::Error;

use crate::config::{
    MINI_COLLAPSED_SIZE, MINI_EXPANDED_SIZE, MINI_SCREEN_MARGIN_PX, MINI_WINDOW_LABEL,
    MINI_WINDOW_URL,
};
use crate::models::shell::{MiniPosition, MiniState};
use crate::services::shell_settings::{ShellSettingsError, ShellSettingsStore};

const MIN_VISIBLE_PX: f64 = 48.0;

#[derive(Debug, Error)]
pub enum MiniWindowError {
    #[error("{0}")]
    Window(#[from] tauri::Error),

    #[error("{0}")]
    Settings(#[from] ShellSettingsError),

    #[error("The mini window settings are not loaded")]
    SettingsMissing,
}

#[derive(Default)]
pub struct MiniWindowState {
    last_position: Mutex<Option<MiniPosition>>,
}

impl MiniWindowState {
    fn remember(&self, position: MiniPosition) {
        *self
            .last_position
            .lock()
            .unwrap_or_else(PoisonError::into_inner) = Some(position);
    }

    fn take(&self) -> Option<MiniPosition> {
        self.last_position
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .take()
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Area {
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
    pub scale: f64,
}

impl Area {
    fn of(monitor: &Monitor) -> Self {
        let work = monitor.work_area();
        Self {
            x: work.position.x,
            y: work.position.y,
            width: work.size.width as i32,
            height: work.size.height as i32,
            scale: monitor.scale_factor(),
        }
    }

    fn holds(&self, position: MiniPosition, window: (f64, f64)) -> bool {
        let (width, height) = (window.0 * self.scale, window.1 * self.scale);
        let (x, y) = (f64::from(position.x), f64::from(position.y));
        let (left, top) = (f64::from(self.x), f64::from(self.y));
        let (right, bottom) = (left + f64::from(self.width), top + f64::from(self.height));
        let overlap_x = (x + width).min(right) - x.max(left);
        let overlap_y = (y + height).min(bottom) - y.max(top);
        x >= left
            && x < right
            && y >= top
            && y < bottom
            && overlap_x >= MIN_VISIBLE_PX.min(width)
            && overlap_y >= MIN_VISIBLE_PX.min(height)
    }
}

pub fn choose_position(
    saved: Option<MiniPosition>,
    window: (f64, f64),
    areas: &[Area],
    primary: Option<Area>,
    margin: f64,
) -> Option<(f64, f64)> {
    if let Some(position) = saved {
        if let Some(area) = areas.iter().find(|area| area.holds(position, window)) {
            return Some((
                f64::from(position.x) / area.scale,
                f64::from(position.y) / area.scale,
            ));
        }
    }
    let area = primary.or_else(|| areas.first().copied())?;
    Some((
        f64::from(area.x + area.width) / area.scale - window.0 - margin,
        f64::from(area.y) / area.scale + margin,
    ))
}

fn size_for(collapsed: bool) -> (f64, f64) {
    if collapsed {
        MINI_COLLAPSED_SIZE
    } else {
        MINI_EXPANDED_SIZE
    }
}

fn find<R: Runtime>(app: &AppHandle<R>) -> Option<WebviewWindow<R>> {
    app.get_webview_window(MINI_WINDOW_LABEL)
}

fn store<R: Runtime>(
    app: &AppHandle<R>,
) -> Result<tauri::State<'_, ShellSettingsStore>, MiniWindowError> {
    app.try_state::<ShellSettingsStore>()
        .ok_or(MiniWindowError::SettingsMissing)
}

pub fn is_open<R: Runtime>(app: &AppHandle<R>) -> bool {
    find(app).is_some()
}

pub fn state<R: Runtime>(app: &AppHandle<R>) -> MiniState {
    let settings = app
        .try_state::<ShellSettingsStore>()
        .map(|store| store.get())
        .unwrap_or_default();
    MiniState {
        open: is_open(app),
        collapsed: settings.mini_collapsed,
        always_on_top: settings.mini_always_on_top,
    }
}

pub fn open<R: Runtime>(app: &AppHandle<R>) -> Result<(), MiniWindowError> {
    if is_open(app) {
        return Ok(());
    }
    let settings = store(app)?.get();
    let size = size_for(settings.mini_collapsed);
    let areas: Vec<Area> = app
        .available_monitors()
        .unwrap_or_default()
        .iter()
        .map(Area::of)
        .collect();
    let primary = app.primary_monitor().ok().flatten().map(|m| Area::of(&m));

    let mut builder = WebviewWindowBuilder::new(
        app,
        MINI_WINDOW_LABEL,
        WebviewUrl::App(MINI_WINDOW_URL.into()),
    )
    .title("GameRoute")
    .inner_size(size.0, size.1)
    .resizable(false)
    .maximizable(false)
    .minimizable(false)
    .decorations(false)
    .shadow(true)
    .skip_taskbar(true)
    .always_on_top(settings.mini_always_on_top)
    .focused(false)
    .focusable(false);
    if let Some((x, y)) = choose_position(
        settings.mini_position,
        size,
        &areas,
        primary,
        f64::from(MINI_SCREEN_MARGIN_PX),
    ) {
        builder = builder.position(x, y);
    }
    builder.build()?;
    Ok(())
}

pub fn close<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = find(app) {
        if let Err(e) = window.destroy() {
            log::warn!("Could not close the mini window: {}", e);
        }
    }
}

pub fn toggle<R: Runtime>(app: &AppHandle<R>) -> Result<(), MiniWindowError> {
    if is_open(app) {
        close(app);
        Ok(())
    } else {
        open(app)
    }
}

pub fn set_collapsed<R: Runtime>(
    app: &AppHandle<R>,
    collapsed: bool,
) -> Result<MiniState, MiniWindowError> {
    store(app)?.update(|settings| settings.mini_collapsed = collapsed)?;
    if let Some(window) = find(app) {
        let (width, height) = size_for(collapsed);
        let scale = window.scale_factor()?;
        let before = window.inner_size()?;
        let position = window.outer_position()?;
        window.set_size(LogicalSize::new(width, height))?;
        let shift = before.width as i32 - (width * scale).round() as i32;
        window.set_position(PhysicalPosition::new(position.x + shift, position.y))?;
    }
    Ok(state(app))
}

pub fn set_always_on_top<R: Runtime>(
    app: &AppHandle<R>,
    enabled: bool,
) -> Result<MiniState, MiniWindowError> {
    store(app)?.update(|settings| settings.mini_always_on_top = enabled)?;
    if let Some(window) = find(app) {
        window.set_always_on_top(enabled)?;
    }
    Ok(state(app))
}

pub fn on_window_event<R: Runtime>(window: &Window<R>, event: &WindowEvent) {
    let app = window.app_handle();
    let Some(position_state) = app.try_state::<MiniWindowState>() else {
        return;
    };
    match event {
        WindowEvent::Moved(position) => position_state.remember(MiniPosition {
            x: position.x,
            y: position.y,
        }),
        WindowEvent::Destroyed => {
            if let (Some(position), Some(store)) =
                (position_state.take(), app.try_state::<ShellSettingsStore>())
            {
                if let Err(e) = store.update(|settings| settings.mini_position = Some(position)) {
                    log::warn!("Could not save the mini window position: {}", e);
                }
            }
        }
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SCREEN: Area = Area {
        x: 0,
        y: 0,
        width: 1920,
        height: 1040,
        scale: 1.0,
    };
    const SECOND: Area = Area {
        x: 1920,
        y: 0,
        width: 2560,
        height: 1400,
        scale: 1.5,
    };
    const WINDOW: (f64, f64) = (320.0, 192.0);

    #[test]
    fn it_opens_in_the_top_right_corner_of_the_main_screen() {
        let position = choose_position(None, WINDOW, &[SCREEN, SECOND], Some(SCREEN), 16.0);

        assert_eq!(position, Some((1920.0 - 320.0 - 16.0, 16.0)));
    }

    #[test]
    fn the_corner_follows_the_scale_of_the_main_screen() {
        let position = choose_position(None, WINDOW, &[SECOND], Some(SECOND), 16.0);

        assert_eq!(position, Some((4480.0 / 1.5 - 320.0 - 16.0, 16.0)));
    }

    #[test]
    fn a_saved_position_on_a_connected_screen_is_kept() {
        let saved = MiniPosition { x: 2400, y: 300 };

        assert_eq!(
            choose_position(Some(saved), WINDOW, &[SCREEN, SECOND], Some(SCREEN), 16.0),
            Some((2400.0 / 1.5, 200.0))
        );
    }

    #[test]
    fn a_saved_position_on_a_screen_that_is_gone_is_dropped() {
        let saved = MiniPosition { x: 2400, y: 300 };

        assert_eq!(
            choose_position(Some(saved), WINDOW, &[SCREEN], Some(SCREEN), 16.0),
            Some((1920.0 - 320.0 - 16.0, 16.0))
        );
    }

    #[test]
    fn a_window_barely_on_screen_is_brought_back() {
        let saved = MiniPosition { x: 1900, y: 10 };

        assert_eq!(
            choose_position(Some(saved), WINDOW, &[SCREEN], Some(SCREEN), 16.0),
            Some((1920.0 - 320.0 - 16.0, 16.0))
        );
    }

    #[test]
    fn without_any_screen_the_system_decides() {
        assert_eq!(choose_position(None, WINDOW, &[], None, 16.0), None);
    }

    #[test]
    fn the_collapsed_bar_is_smaller_than_the_card() {
        let (card_w, card_h) = size_for(false);
        let (bar_w, bar_h) = size_for(true);

        assert!(bar_w < card_w);
        assert!(bar_h < card_h);
    }

    #[test]
    fn the_window_is_never_declared_in_the_tauri_config() {
        let config: serde_json::Value =
            serde_json::from_str(include_str!("../../tauri.conf.json")).unwrap();
        let windows = config["app"]["windows"].as_array().unwrap();

        assert!(windows.iter().all(|window| window
            .get("label")
            .is_none_or(|label| label != MINI_WINDOW_LABEL)));
        assert_eq!(windows.len(), 1);
    }
}

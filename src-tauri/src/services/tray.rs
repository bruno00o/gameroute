use std::sync::Arc;
use std::time::Duration;

use tauri::image::Image;
use tauri::menu::{CheckMenuItem, CheckMenuItemBuilder, MenuBuilder, MenuItem, MenuItemBuilder};
use tauri::tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent};
use tauri::{App, AppHandle, Emitter, Manager, Runtime};
use tokio::time::MissedTickBehavior;

use crate::commands::monitoring::{start_monitoring, stop_monitoring, AppMonitoringState};
use crate::config::TRAY_REFRESH_MS;
use crate::platform::shell::taskbar_uses_light_theme;
use crate::services::alert_text::Locale;
use crate::services::app_settings::SettingsStore;
use crate::services::live_status::LiveStatusService;
use crate::services::mini_window;
use crate::services::tray_icon::{render, ICON_SIZE};
use crate::services::tray_view::{
    icon_state, menu_labels, summary, tooltip, TrayIconState, TrayInput,
};

const TRAY_ID: &str = "main";
const MENU_SHOW: &str = "show";
const MENU_MINI: &str = "mini";
const MENU_MONITORING: &str = "monitoring";
const MENU_QUIT: &str = "quit";

#[derive(Debug, Clone, PartialEq)]
struct View {
    icon: TrayIconState,
    light_taskbar: bool,
    tooltip: String,
    summary: String,
    lang: Locale,
    monitoring: bool,
    mini_open: bool,
}

struct Handles {
    tray: TrayIcon,
    header: MenuItem<tauri::Wry>,
    open: MenuItem<tauri::Wry>,
    mini: CheckMenuItem<tauri::Wry>,
    monitoring: MenuItem<tauri::Wry>,
    quit: MenuItem<tauri::Wry>,
}

pub fn language<R: Runtime>(app: &AppHandle<R>) -> Locale {
    let locale = app
        .try_state::<SettingsStore>()
        .and_then(|store| store.get().locale);
    Locale::from_code(locale.as_deref())
}

pub fn show_main_window<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn icon_image(state: TrayIconState, light_taskbar: bool) -> Image<'static> {
    Image::new_owned(render(state, light_taskbar), ICON_SIZE, ICON_SIZE)
}

fn view_of(input: TrayInput, lang: Locale, light_taskbar: bool, mini_open: bool) -> View {
    View {
        icon: icon_state(input.status),
        light_taskbar,
        tooltip: tooltip(input, lang),
        summary: summary(input, lang),
        lang,
        monitoring: input.monitoring,
        mini_open,
    }
}

async fn collect(app: &AppHandle) -> View {
    let status = app
        .try_state::<Arc<LiveStatusService>>()
        .and_then(|service| service.snapshot());
    let monitoring = match app.try_state::<AppMonitoringState>() {
        Some(state) => state.monitoring_state.read().await.is_monitoring,
        None => false,
    };
    view_of(
        TrayInput {
            status: status.as_ref(),
            monitoring,
        },
        language(app),
        taskbar_uses_light_theme(),
        mini_window::is_open(app),
    )
}

fn monitoring_label(view: &View) -> &'static str {
    let labels = menu_labels(view.lang);
    if view.monitoring {
        labels.monitoring_stop
    } else {
        labels.monitoring_start
    }
}

fn apply(handles: &Handles, view: &View, shown: Option<&View>) {
    if shown.is_none_or(|old| old.icon != view.icon || old.light_taskbar != view.light_taskbar) {
        let _ = handles
            .tray
            .set_icon(Some(icon_image(view.icon, view.light_taskbar)));
    }
    if shown.is_none_or(|old| old.tooltip != view.tooltip) {
        let _ = handles.tray.set_tooltip(Some(view.tooltip.as_str()));
    }
    if shown.is_none_or(|old| old.summary != view.summary) {
        let _ = handles.header.set_text(&view.summary);
    }
    if shown.is_none_or(|old| old.lang != view.lang) {
        let labels = menu_labels(view.lang);
        let _ = handles.open.set_text(labels.open);
        let _ = handles.mini.set_text(labels.mini);
        let _ = handles.quit.set_text(labels.quit);
    }
    if shown.is_none_or(|old| old.lang != view.lang || old.monitoring != view.monitoring) {
        let _ = handles.monitoring.set_text(monitoring_label(view));
    }
    if shown.is_none_or(|old| old.mini_open != view.mini_open) {
        let _ = handles.mini.set_checked(view.mini_open);
    }
}

fn toggle_monitoring(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let state = app.state::<AppMonitoringState>();
        let running = state.monitoring_state.read().await.is_monitoring;
        let result = if running {
            stop_monitoring(app.clone(), state.clone()).await
        } else {
            start_monitoring(app.clone(), state.clone()).await
        };
        if let Err(e) = result {
            log::warn!("Tray could not change the monitoring: {}", e.message);
        }
        let _ = app.emit("monitoring-changed", ());
    });
}

fn toggle_mini(app: &AppHandle, item: CheckMenuItem<tauri::Wry>) {
    let app = app.clone();
    std::thread::spawn(move || {
        if let Err(e) = mini_window::toggle(&app) {
            log::warn!("Tray could not toggle the mini window: {}", e);
        }
        let _ = item.set_checked(mini_window::is_open(&app));
    });
}

pub fn setup(app: &mut App) -> tauri::Result<()> {
    let initial = view_of(
        TrayInput {
            status: None,
            monitoring: false,
        },
        language(app.handle()),
        taskbar_uses_light_theme(),
        false,
    );
    let labels = menu_labels(initial.lang);

    let header = MenuItemBuilder::with_id("header", &initial.summary)
        .enabled(false)
        .build(app)?;
    let open = MenuItemBuilder::with_id(MENU_SHOW, labels.open).build(app)?;
    let mini = CheckMenuItemBuilder::with_id(MENU_MINI, labels.mini)
        .checked(false)
        .build(app)?;
    let monitoring =
        MenuItemBuilder::with_id(MENU_MONITORING, monitoring_label(&initial)).build(app)?;
    let quit = MenuItemBuilder::with_id(MENU_QUIT, labels.quit).build(app)?;
    let menu = MenuBuilder::new(app)
        .item(&header)
        .separator()
        .item(&open)
        .item(&mini)
        .separator()
        .item(&monitoring)
        .separator()
        .item(&quit)
        .build()?;

    let mini_for_events = mini.clone();
    let tray = TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon_image(initial.icon, initial.light_taskbar))
        .tooltip(&initial.tooltip)
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(move |app, event| match event.id().as_ref() {
            MENU_SHOW => show_main_window(app),
            MENU_MINI => toggle_mini(app, mini_for_events.clone()),
            MENU_MONITORING => toggle_monitoring(app),
            MENU_QUIT => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        })
        .build(app)?;

    spawn_refresh(
        app.handle().clone(),
        Handles {
            tray,
            header,
            open,
            mini,
            monitoring,
            quit,
        },
    );
    Ok(())
}

fn spawn_refresh(app: AppHandle, handles: Handles) {
    tauri::async_runtime::spawn(async move {
        let mut ticks = tokio::time::interval(Duration::from_millis(TRAY_REFRESH_MS));
        ticks.set_missed_tick_behavior(MissedTickBehavior::Delay);
        let mut shown: Option<View> = None;
        loop {
            ticks.tick().await;
            let view = collect(&app).await;
            if shown.as_ref() != Some(&view) {
                apply(&handles, &view, shown.as_ref());
                shown = Some(view);
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    fn sources(dir: &Path, found: &mut Vec<(String, String)>) {
        for entry in std::fs::read_dir(dir).unwrap() {
            let path = entry.unwrap().path();
            if path.is_dir() {
                sources(&path, found);
            } else if path.extension().is_some_and(|ext| ext == "rs") {
                let text = std::fs::read_to_string(&path).unwrap();
                found.push((path.to_string_lossy().replace('\\', "/"), text));
            }
        }
    }

    #[test]
    fn the_mini_window_is_only_opened_by_a_user_action() {
        let mut files = Vec::new();
        sources(
            &Path::new(env!("CARGO_MANIFEST_DIR")).join("src"),
            &mut files,
        );

        let callers: Vec<_> = files
            .iter()
            .filter(|(_, text)| {
                text.contains("mini_window::open(") || text.contains("mini_window::toggle(")
            })
            .map(|(path, _)| path.rsplit("src/").next().unwrap().to_string())
            .collect();
        let mut callers = callers;
        callers.sort();

        assert_eq!(callers, vec!["commands/mini.rs", "services/tray.rs"]);
    }
}

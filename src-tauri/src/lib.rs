mod commands;
pub mod config;
mod db;
pub mod models;
mod platform;
mod services;

use std::sync::atomic::{AtomicBool, Ordering};

use commands::asn::{
    clear_ip_metadata_cache, get_ip_metadata_stats, prune_ip_metadata_cache, resolve_asn,
};
use commands::export::write_export_file;
use commands::games::{
    add_manual_game, get_game_count, get_games, get_monitored_game_count, remove_game,
    scan_all_games, scan_epic_games, scan_riot_games, scan_steam_games, search_game_count,
    search_games, toggle_game_monitored,
};
use commands::insights::{
    get_hourly_quality, get_network_quality_over_time, get_server_stability, get_server_summary,
};
use commands::monitoring::{
    cancel_traceroute, get_monitoring_status, list_running_apps,
    start_manual_monitoring, start_monitoring, stop_monitoring, AppMonitoringState,
};
use commands::network::{
    get_network_map_data, get_network_overview_stats, get_recurring_problem_hops,
    get_severity_thresholds,
};
use commands::service::{check_capture_service_status, open_log_dir, restart_capture_service};
use commands::sessions::{
    delete_session, get_previous_session_id, get_session_detail, get_session_list,
    get_session_matches, retry_traceroutes,
};
use commands::settings::{
    delete_all_data, get_app_settings, get_storage_stats, set_minimize_to_tray,
    set_session_retention,
};
use config::{CACHE_MAX_TTL_DAYS, SETTINGS_FILE_NAME};
use db::{get_ip_metadata_repository, get_session_repository};
use services::app_settings::SettingsStore;
use services::{asn_resolver, flow_kind};
use tauri::path::BaseDirectory;
use tauri::Manager;
use tauri::menu::{MenuBuilder, MenuItemBuilder};
use tauri::tray::TrayIconBuilder;

pub struct TraySettings {
    pub minimize_to_tray: AtomicBool,
    pub tray_notified: AtomicBool,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--hidden"]),
        ))
        .manage(AppMonitoringState::new())
        .manage(TraySettings {
            minimize_to_tray: AtomicBool::new(true),
            tray_notified: AtomicBool::new(false),
        })
        .setup(|app| {
            let log_level = if cfg!(debug_assertions) {
                log::LevelFilter::Info
            } else {
                log::LevelFilter::Warn
            };

            app.handle().plugin(
                tauri_plugin_log::Builder::default()
                    .targets([
                        tauri_plugin_log::Target::new(
                            tauri_plugin_log::TargetKind::LogDir {
                                file_name: Some("gameroute".into()),
                            },
                        ),
                        tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Stdout),
                        tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Webview),
                    ])
                    .level(log_level)
                    .max_file_size(5_000_000)
                    .rotation_strategy(tauri_plugin_log::RotationStrategy::KeepAll)
                    .timezone_strategy(tauri_plugin_log::TimezoneStrategy::UseLocal)
                    .build(),
            )?;

            // Log panics to file before crashing
            std::panic::set_hook(Box::new(|info| {
                let msg = if let Some(s) = info.payload().downcast_ref::<&str>() {
                    s.to_string()
                } else if let Some(s) = info.payload().downcast_ref::<String>() {
                    s.clone()
                } else {
                    "Unknown panic".to_string()
                };
                let location = info
                    .location()
                    .map(|l| format!("{}:{}:{}", l.file(), l.line(), l.column()))
                    .unwrap_or_default();
                log::error!("PANIC at {}: {}", location, msg);
            }));

            let app_data_dir = app
                .path()
                .app_data_dir()
                .map_err(|e| format!("Failed to get app data directory: {}", e))?;

            let settings_store = SettingsStore::load(app_data_dir.join(SETTINGS_FILE_NAME));
            let settings = settings_store.get();
            app.state::<TraySettings>()
                .minimize_to_tray
                .store(settings.minimize_to_tray, Ordering::Relaxed);
            app.manage(settings_store);

            match (
                app.path()
                    .resolve("resources/GeoLite2-City.mmdb", BaseDirectory::Resource),
                app.path()
                    .resolve("resources/GeoLite2-ASN.mmdb", BaseDirectory::Resource),
            ) {
                (Ok(city_db), Ok(asn_db)) => {
                    if let Err(e) = asn_resolver::init_resolver(&city_db, &asn_db) {
                        log::error!("Failed to initialize ASN resolver: {}", e);
                    }
                }
                (Err(e), _) | (_, Err(e)) => {
                    log::error!("Failed to resolve GeoLite2 resource path: {}", e);
                }
            }

            let pool =
                tauri::async_runtime::block_on(async { db::init_database(&app_data_dir).await });

            match pool {
                Ok(pool) => {
                    db::init_repositories(&pool);
                    log::info!("All repositories initialized");

                    if let Some(repo) = get_ip_metadata_repository() {
                        let prune_result = tauri::async_runtime::block_on(async {
                            repo.prune_expired(CACHE_MAX_TTL_DAYS).await
                        });
                        match prune_result {
                            Ok(count) => {
                                if count > 0 {
                                    log::info!("Startup cache prune: {} entries removed", count);
                                }
                            }
                            Err(e) => log::error!("Failed to prune cache on startup: {}", e),
                        }
                    }

                    if let Some(repo) = get_session_repository() {
                        let result = tauri::async_runtime::block_on(
                            repo.clean_up_on_startup(settings.session_retention_days),
                        );
                        match result {
                            Ok((closed, _)) if closed > 0 => {
                                log::info!("Closed {} sessions left open by a previous run", closed)
                            }
                            Ok(_) => {}
                            Err(e) => log::error!("Failed to clean up sessions on startup: {}", e),
                        }
                    }

                    tauri::async_runtime::spawn(async {
                        flow_kind::backfill_flow_kinds().await;
                        flow_kind::backfill_match_periods().await;
                    });

                    tauri::async_runtime::spawn(asn_resolver::backfill_ip_metadata());

                    tauri::async_runtime::spawn(async {
                        match crate::commands::games::scan_all_games().await {
                            Ok(r) => log::info!(
                                "Startup scan: {} found, {} added, {} updated",
                                r.games_found, r.games_added, r.games_updated
                            ),
                            Err(e) => log::warn!("Startup scan failed: {}", e.message),
                        }
                    });
                }
                Err(e) => {
                    log::error!("Failed to initialize database: {}", e);
                }
            }

            // Build system tray
            let show = MenuItemBuilder::with_id("show", "Show GameRoute").build(app)?;
            let quit = MenuItemBuilder::with_id("quit", "Quit").build(app)?;
            let menu = MenuBuilder::new(app)
                .item(&show)
                .separator()
                .item(&quit)
                .build()?;

            let launched_hidden = std::env::args().any(|a| a == "--hidden");
            if launched_hidden {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.hide();
                }
                log::info!("Launched with --hidden, window kept in tray");
            }

            TrayIconBuilder::new()
                .icon(app.default_window_icon().expect("default window icon must be set in tauri.conf.json").clone())
                .menu(&menu)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "show" => {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let tauri::tray::TrayIconEvent::Click { .. } = event {
                        if let Some(w) = tray.app_handle().get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                })
                .build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let tray_settings = window.state::<TraySettings>();
                if tray_settings.minimize_to_tray.load(Ordering::Relaxed) {
                    api.prevent_close();
                    let _ = window.hide();

                    if !tray_settings.tray_notified.swap(true, Ordering::Relaxed) {
                        use tauri_plugin_notification::NotificationExt;
                        let _ = window
                            .app_handle()
                            .notification()
                            .builder()
                            .title("GameRoute")
                            .body("GameRoute is still running in the system tray.")
                            .show();
                    }
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            start_monitoring,
            stop_monitoring,
            cancel_traceroute,
            get_monitoring_status,
            list_running_apps,
            start_manual_monitoring,
            resolve_asn,
            clear_ip_metadata_cache,
            get_ip_metadata_stats,
            prune_ip_metadata_cache,
            get_session_list,
            get_session_detail,
            get_session_matches,
            get_previous_session_id,
            delete_session,
            retry_traceroutes,
            scan_steam_games,
            scan_epic_games,
            scan_riot_games,
            scan_all_games,
            get_games,
            get_game_count,
            get_monitored_game_count,
            add_manual_game,
            remove_game,
            toggle_game_monitored,
            search_games,
            search_game_count,
            get_network_map_data,
            get_recurring_problem_hops,
            get_network_overview_stats,
            get_severity_thresholds,
            get_network_quality_over_time,
            get_server_stability,
            get_server_summary,
            get_hourly_quality,
            check_capture_service_status,
            restart_capture_service,
            open_log_dir,
            get_app_settings,
            set_minimize_to_tray,
            set_session_retention,
            get_storage_stats,
            delete_all_data,
            write_export_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

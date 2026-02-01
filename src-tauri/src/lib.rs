mod commands;
mod db;
mod models;
mod platform;
mod services;

use commands::asn::{
    clear_ip_metadata_cache, get_ip_metadata_stats, prune_ip_metadata_cache, resolve_asn,
};
use commands::dashboard::get_dashboard_data;
use commands::games::{
    add_manual_game, get_game_count, get_games, remove_game, scan_all_games, scan_epic_games,
    scan_steam_games, search_game_count, search_games, toggle_game_monitored,
};
use commands::insights::{get_hourly_quality, get_network_quality_over_time, get_server_stability};
use commands::monitoring::{
    cancel_traceroute, get_monitoring_status, list_running_apps, list_running_processes,
    start_manual_monitoring, start_monitoring, stop_monitoring, AppMonitoringState,
};
use commands::network::{
    get_network_map_data, get_network_overview_stats, get_recurring_problem_hops,
};
use commands::sessions::{delete_session, get_session_count, get_session_detail, get_sessions};
use db::get_ip_metadata_repository;
use tauri::Manager;

const CACHE_MAX_TTL_DAYS: i64 = 30;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(AppMonitoringState::new())
        .setup(|app| {
            let log_level = if cfg!(debug_assertions) {
                log::LevelFilter::Info
            } else {
                log::LevelFilter::Warn
            };

            app.handle().plugin(
                tauri_plugin_log::Builder::default()
                    .level(log_level)
                    .build(),
            )?;

            let app_data_dir = app
                .path()
                .app_data_dir()
                .map_err(|e| format!("Failed to get app data directory: {}", e))?;

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
                            Err(e) => log::warn!("Failed to prune cache on startup: {}", e),
                        }
                    }

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

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            start_monitoring,
            stop_monitoring,
            cancel_traceroute,
            get_monitoring_status,
            list_running_processes,
            list_running_apps,
            start_manual_monitoring,
            resolve_asn,
            clear_ip_metadata_cache,
            get_ip_metadata_stats,
            prune_ip_metadata_cache,
            get_sessions,
            get_session_detail,
            delete_session,
            get_session_count,
            scan_steam_games,
            scan_epic_games,
            scan_all_games,
            get_games,
            get_game_count,
            add_manual_game,
            remove_game,
            toggle_game_monitored,
            search_games,
            search_game_count,
            get_dashboard_data,
            get_network_map_data,
            get_recurring_problem_hops,
            get_network_overview_stats,
            get_network_quality_over_time,
            get_server_stability,
            get_hourly_quality,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

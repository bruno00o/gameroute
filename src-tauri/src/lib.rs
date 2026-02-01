mod commands;
mod db;
mod models;
mod platform;
mod services;

use commands::asn::{
    clear_ip_metadata_cache, get_ip_metadata_stats, prune_ip_metadata_cache, resolve_asn,
};
use commands::monitoring::{
    cancel_traceroute, get_monitoring_status, list_running_apps, list_running_processes,
    start_manual_monitoring, start_monitoring, stop_monitoring, AppMonitoringState,
};
use commands::sessions::{delete_session, get_session_count, get_session_detail, get_sessions};
use db::get_ip_metadata_repository;
use services::GamesDatabase;
use tauri::Manager;

const CACHE_MAX_TTL_DAYS: i64 = 30;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let games_db = match GamesDatabase::load() {
        Ok(db) => db,
        Err(e) => {
            eprintln!("Fatal: failed to load games database: {}", e);
            std::process::exit(1);
        }
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(AppMonitoringState::new(games_db))
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

// Release builds run without a console window on Windows.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod auto_logger;
mod commands;
mod config;
mod desktop;
mod domain;
mod error;
mod llm;
mod logger;
mod mock;
mod paths;
mod report_filename;
mod reports;
mod secrets;
mod services;
mod telemetry;
mod updates;

use auto_logger::AutoLogger;
use commands::AppState;
use config::ConfigService;
use serde_json::{json, Value};
use services::connections::ConnectionManager;
use services::git::{CommitSource, GitService};
use std::sync::Arc;
use tauri::{Manager, RunEvent, State};
use updates::UpdateService;

/// Which window background effect was applied, for the renderer to style itself.
struct Backdrop(&'static str);

#[tauri::command]
fn runtime_info(app: tauri::AppHandle, backdrop: State<Backdrop>) -> Value {
    json!({
        "version": app.package_info().version.to_string(),
        "mock": paths::is_mock_mode(),
        "backdrop": backdrop.0,
    })
}

fn main() {
    let config = Arc::new(ConfigService::new());
    let http = reqwest::Client::builder()
        .user_agent(concat!("jira-auto-logger/", env!("CARGO_PKG_VERSION")))
        .build()
        .expect("HTTP client");
    let connections = Arc::new(ConnectionManager::new(config.clone(), http.clone()));
    let git: Arc<dyn CommitSource> = if paths::is_mock_mode() {
        Arc::new(mock::clients::MockGit)
    } else {
        let folders = config.clone();
        Arc::new(GitService::new(Arc::new(move || {
            folders.get().projects.into_iter().flat_map(|p| p.git_folders).collect()
        })))
    };
    let llm = Arc::new(llm::LlmService::new(config.clone(), git.clone(), connections.clone(), http.clone()));
    let reports = Arc::new(reports::ReportService::new(config.clone(), connections.clone()));
    let auto_logger = Arc::new(AutoLogger::new(config.clone(), llm.clone(), connections.clone()));

    let app = tauri::Builder::default()
        // Keep the background services and tray icon owned by one process:
        // a second launch only brings the existing window forward.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| desktop::show_main_window(app)))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, Some(vec!["--hidden"])))
        .manage(desktop::Desktop::default())
        .manage(auto_logger.clone())
        .manage(AppState { config: config.clone(), connections, git, llm, reports })
        .setup(move |app| {
            let handle = app.handle().clone();
            let version = app.package_info().version.to_string();
            telemetry::init(config.clone(), http.clone(), version.clone());
            let updates = Arc::new(UpdateService::new(config.clone(), http.clone(), version));
            app.manage(updates.clone());

            let window = app.get_webview_window("main").expect("main window");
            app.manage(Backdrop(desktop::apply_backdrop(&window)));
            let settings = config.get();
            desktop::apply_desktop_config(&handle, &settings);
            if !desktop::start_hidden(&settings) {
                let _ = window.show();
            }
            updates.start(handle.clone());
            auto_logger.start(handle.clone());
            telemetry::track_app_started(&settings.theme_id);
            logger::info(
                "app",
                "backend started",
                Some(json!({ "logFile": logger::file_path(), "mockMode": paths::is_mock_mode() })),
            );
            Ok(())
        })
        .on_window_event(desktop::on_window_event)
        .invoke_handler(tauri::generate_handler![
            runtime_info,
            commands::config_get,
            commands::config_set,
            commands::config_get_file_path,
            commands::config_get_log_file_path,
            commands::dialog_pick_folder,
            commands::jira_test_connection,
            commands::jira_get_projects,
            commands::jira_search_issues,
            commands::jira_get_project_issues,
            commands::jira_get_issue_types,
            commands::jira_create_issue,
            commands::tempo_test_connection,
            commands::tempo_get_worklogs,
            commands::tempo_create_worklogs,
            commands::tempo_update_worklog,
            commands::tempo_delete_worklog,
            commands::tempo_get_work_attributes,
            commands::git_get_commits,
            commands::llm_generate_suggestions,
            commands::llm_preview_prompt,
            commands::llm_regenerate_description,
            commands::llm_start_claude_login,
            commands::reports_generate,
            commands::reports_get_reminder,
            commands::reports_reveal,
            commands::updates_get_state,
            commands::updates_check,
            commands::updates_get_release_history,
            commands::updates_download,
            commands::updates_quit_and_install,
            commands::auto_logger_run_now,
            commands::auto_logger_renderer_ready,
        ])
        .build(tauri::generate_context!())
        .expect("error while building the app");

    app.run(|app, event| {
        if let RunEvent::Exit = event {
            // Auto mode: a downloaded update is installed when the app quits.
            app.state::<Arc<UpdateService>>().install_on_quit();
        }
    });
}

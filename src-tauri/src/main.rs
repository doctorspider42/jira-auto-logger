// Release builds run without a console window on Windows.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

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
mod secrets;
mod services;
mod telemetry;

use commands::AppState;
use config::ConfigService;
use serde_json::{json, Value};
use services::connections::ConnectionManager;
use services::git::{CommitSource, GitService};
use std::sync::Arc;
use tauri::{Manager, State};

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

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(AppState { config, connections, git, llm })
        .setup(|app| {
            let window = app.get_webview_window("main").expect("main window");
            app.manage(Backdrop(desktop::apply_backdrop(&window)));
            logger::info(
                "app",
                "backend started",
                Some(json!({ "logFile": logger::file_path(), "mockMode": paths::is_mock_mode() })),
            );
            Ok(())
        })
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running the app");
}

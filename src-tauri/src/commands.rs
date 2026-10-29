//! One Tauri command per `IpcApi` method (see `src/shared/ipc.ts`). Every
//! fallible command returns the renderer's `Result` envelope, logging its
//! duration and failure like `toResult` did in the Electron main process.

use crate::config::ConfigService;
use crate::domain::*;
use crate::error::{AppResult, Envelope};
use crate::logger;
use crate::services::connections::ConnectionManager;
use crate::services::git::CommitSource;
use serde::Serialize;
use serde_json::json;
use std::future::Future;
use std::sync::Arc;
use std::time::Instant;
use tauri::State;

pub struct AppState {
    pub config: Arc<ConfigService>,
    pub connections: Arc<ConnectionManager>,
    pub git: Arc<dyn CommitSource>,
    pub llm: Arc<crate::llm::LlmService>,
}

pub async fn to_result<T: Serialize>(channel: &str, run: impl Future<Output = AppResult<T>>) -> Envelope<T> {
    let started = Instant::now();
    let result = run.await;
    let ms = started.elapsed().as_millis();
    match &result {
        Ok(_) => logger::debug("ipc", &format!("{channel} ok in {ms}ms"), None),
        Err(e) => logger::error(
            "ipc",
            &format!("{channel} failed in {ms}ms"),
            Some(json!({ "code": e.code, "message": e.message, "details": e.details })),
        ),
    }
    result.into()
}

// ---------- config ----------

#[tauri::command]
pub fn config_get(state: State<'_, AppState>) -> AppConfig {
    state.config.get()
}

#[tauri::command]
pub async fn config_set(config: AppConfig, state: State<'_, AppState>, app: tauri::AppHandle) -> Result<Envelope<()>, ()> {
    let result = to_result("config:set", async {
        state.config.set(config.clone()).map_err(crate::error::AppError::unknown)?;
        crate::desktop::on_config_changed(&app, &config);
        Ok(())
    })
    .await;
    Ok(result)
}

#[tauri::command]
pub fn config_get_file_path(state: State<'_, AppState>) -> String {
    state.config.file_path().display().to_string()
}

#[tauri::command]
pub fn config_get_log_file_path() -> String {
    logger::file_path().display().to_string()
}

// ---------- dialog ----------

#[tauri::command]
pub async fn dialog_pick_folder(app: tauri::AppHandle) -> Option<String> {
    use tauri_plugin_dialog::DialogExt;
    tauri::async_runtime::spawn_blocking(move || app.dialog().file().blocking_pick_folder())
        .await
        .ok()
        .flatten()
        .map(|path| path.to_string())
}

// ---------- jira ----------

#[tauri::command]
pub async fn jira_test_connection(connection_id: String, state: State<'_, AppState>) -> Result<Envelope<JiraUser>, ()> {
    Ok(to_result("jira:testConnection", state.connections.jira(&connection_id).get_myself()).await)
}

#[tauri::command]
pub async fn jira_get_projects(connection_id: String, state: State<'_, AppState>) -> Result<Envelope<Vec<JiraProject>>, ()> {
    Ok(to_result("jira:getProjects", state.connections.jira(&connection_id).get_projects()).await)
}

#[tauri::command]
pub async fn jira_search_issues(
    connection_id: String,
    query: String,
    project_keys: Vec<String>,
    state: State<'_, AppState>,
) -> Result<Envelope<Vec<JiraIssue>>, ()> {
    let jira = state.connections.jira(&connection_id);
    Ok(to_result("jira:searchIssues", async move { jira.search_issues(&query, &project_keys).await }).await)
}

#[tauri::command]
pub async fn jira_get_project_issues(
    connection_id: String,
    project_key: String,
    state: State<'_, AppState>,
) -> Result<Envelope<Vec<JiraIssue>>, ()> {
    let jira = state.connections.jira(&connection_id);
    Ok(to_result("jira:getProjectIssues", async move { jira.get_project_issues(&project_key).await }).await)
}

// ---------- tempo ----------

#[tauri::command]
pub async fn tempo_test_connection(connection_id: String, state: State<'_, AppState>) -> Result<Envelope<()>, ()> {
    let connections = state.connections.clone();
    Ok(to_result("tempo:testConnection", async move {
        let account = connections.account_id(&connection_id).await?;
        connections.tempo(&connection_id).test_connection(&account).await
    })
    .await)
}

#[tauri::command]
pub async fn tempo_get_worklogs(
    connection_id: String,
    from_date: String,
    to_date: String,
    state: State<'_, AppState>,
) -> Result<Envelope<Vec<Worklog>>, ()> {
    let connections = state.connections.clone();
    Ok(to_result("tempo:getWorklogs", async move {
        let account = connections.account_id(&connection_id).await?;
        connections.tempo(&connection_id).get_worklogs(&account, &from_date, &to_date).await
    })
    .await)
}

#[tauri::command]
pub async fn tempo_create_worklogs(
    connection_id: String,
    worklogs: Vec<NewWorklog>,
    state: State<'_, AppState>,
) -> Result<Envelope<Vec<Worklog>>, ()> {
    let connections = state.connections.clone();
    Ok(to_result("tempo:createWorklogs", async move {
        let account = connections.account_id(&connection_id).await?;
        let created = connections.tempo(&connection_id).create_worklogs(&account, &worklogs).await?;
        let hours = created.iter().map(|w| w.time_spent_seconds).sum::<i64>() as f64 / 3600.0;
        crate::telemetry::track_worklogs_created(created.len(), hours);
        Ok(created)
    })
    .await)
}

#[tauri::command]
pub async fn tempo_update_worklog(
    connection_id: String,
    tempo_worklog_id: i64,
    worklog: NewWorklog,
    state: State<'_, AppState>,
) -> Result<Envelope<Worklog>, ()> {
    let connections = state.connections.clone();
    Ok(to_result("tempo:updateWorklog", async move {
        let account = connections.account_id(&connection_id).await?;
        connections.tempo(&connection_id).update_worklog(&account, tempo_worklog_id, &worklog).await
    })
    .await)
}

#[tauri::command]
pub async fn tempo_delete_worklog(
    connection_id: String,
    tempo_worklog_id: i64,
    state: State<'_, AppState>,
) -> Result<Envelope<()>, ()> {
    let connections = state.connections.clone();
    Ok(to_result("tempo:deleteWorklog", async move {
        let account = connections.account_id(&connection_id).await?;
        connections.tempo(&connection_id).delete_worklog(&account, tempo_worklog_id).await
    })
    .await)
}

#[tauri::command]
pub async fn tempo_get_work_attributes(connection_id: String, state: State<'_, AppState>) -> Result<Envelope<Vec<TempoWorkAttribute>>, ()> {
    Ok(to_result("tempo:getWorkAttributes", state.connections.tempo(&connection_id).get_work_attributes()).await)
}

// ---------- git ----------

#[tauri::command]
pub async fn git_get_commits(folder_paths: Vec<String>, dates: Vec<String>, state: State<'_, AppState>) -> Result<Envelope<Vec<CommitInfo>>, ()> {
    let git = state.git.clone();
    Ok(to_result("git:getCommits", async move { git.get_commits(&folder_paths, &dates).await }).await)
}

// ---------- llm ----------

#[tauri::command]
pub async fn llm_generate_suggestions(request: SuggestionRequest, state: State<'_, AppState>) -> Result<Envelope<Vec<ProjectSuggestions>>, ()> {
    let llm = state.llm.clone();
    Ok(to_result("llm:generateSuggestions", async move { llm.generate_suggestions(&request).await }).await)
}

#[tauri::command]
pub async fn llm_preview_prompt(request: SuggestionRequest, state: State<'_, AppState>) -> Result<Envelope<Vec<PromptPreview>>, ()> {
    let llm = state.llm.clone();
    Ok(to_result("llm:previewPrompt", async move { llm.preview_prompt(&request).await }).await)
}

#[tauri::command]
pub async fn llm_regenerate_description(request: RegenerateDescriptionRequest, state: State<'_, AppState>) -> Result<Envelope<String>, ()> {
    let llm = state.llm.clone();
    Ok(to_result("llm:regenerateDescription", async move { llm.regenerate_description(&request).await }).await)
}

#[tauri::command]
pub async fn llm_start_claude_login(state: State<'_, AppState>) -> Result<Envelope<()>, ()> {
    let llm = state.llm.clone();
    Ok(to_result("llm:startClaudeLogin", async move { llm.start_claude_login() }).await)
}

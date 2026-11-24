//! Runs the configured weekday worklog automation while the app is alive.
//! Port of `AutoLoggerService.ts`.

use crate::activity::{self, ActivityService};
use crate::config::ConfigService;
use crate::desktop;
use crate::domain::*;
use crate::error::{AppError, AppResult, ErrorCode};
use crate::llm::LlmService;
use crate::services::connections::ConnectionManager;
use crate::{logger, paths, telemetry};
use chrono::{Datelike, Local, Weekday};
use serde_json::json;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::AppHandle;
use tauri_plugin_notification::NotificationExt;

pub struct AutoLogger {
    config: Arc<ConfigService>,
    llm: Arc<LlmService>,
    activity: Arc<ActivityService>,
    connections: Arc<ConnectionManager>,
    running: AtomicBool,
    /// Date + configured time + mode of the last scheduled (never manual) attempt.
    last_attempt_key: Mutex<String>,
    /// Notify-only reminder waiting for the user to open the app. In memory on
    /// purpose: a reminder is about today, and re-opening a stale day on every
    /// launch would be worse than losing it when the app quits.
    pending_prompt: Mutex<Option<AutoLoggerPrompt>>,
    /// Prompts that arrived before the renderer subscribed to them.
    renderer_ready: AtomicBool,
    queued: Mutex<Vec<AutoLoggerPrompt>>,
}

fn state_path() -> std::path::PathBuf {
    paths::user_data_dir().join("auto-logger-state.json")
}

fn today() -> String {
    Local::now().format("%Y-%m-%d").to_string()
}

/// Clears the running flag however the run ends.
struct RunGuard<'a>(&'a AtomicBool);

impl Drop for RunGuard<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}

impl AutoLogger {
    pub fn new(config: Arc<ConfigService>, llm: Arc<LlmService>, activity: Arc<ActivityService>, connections: Arc<ConnectionManager>) -> Self {
        let last = std::fs::read_to_string(state_path())
            .ok()
            .and_then(|text| serde_json::from_str::<serde_json::Value>(&text).ok())
            .and_then(|v| v["lastScheduledAttemptKey"].as_str().map(String::from))
            .unwrap_or_default();
        Self {
            config,
            llm,
            activity,
            connections,
            running: AtomicBool::new(false),
            last_attempt_key: Mutex::new(last),
            pending_prompt: Mutex::new(None),
            renderer_ready: AtomicBool::new(false),
            queued: Mutex::new(Vec::new()),
        }
    }

    pub fn start(self: &Arc<Self>, app: AppHandle) {
        let this = self.clone();
        tauri::async_runtime::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_secs(30));
            loop {
                interval.tick().await;
                this.check(&app).await;
            }
        });
    }

    pub fn on_config_changed(&self, config: &AppConfig) {
        let mode = &config.auto_logger.mode;
        // A reminder nobody opened yet belongs to the mode that produced it.
        if mode != "notify" {
            *self.pending_prompt.lock().unwrap() = None;
        }
        logger::info("auto-logger", "configuration changed", Some(json!({ "mode": mode, "runAt": config.auto_logger.run_at })));
    }

    /// The renderer subscribed to prompts; deliver any that arrived earlier.
    pub fn renderer_ready(&self, app: &AppHandle) {
        self.renderer_ready.store(true, Ordering::SeqCst);
        for prompt in self.queued.lock().unwrap().drain(..) {
            desktop::emit_prompt(app, &prompt);
        }
    }

    pub fn send_to_renderer(&self, app: &AppHandle, prompt: AutoLoggerPrompt) {
        if self.renderer_ready.load(Ordering::SeqCst) {
            desktop::emit_prompt(app, &prompt);
        } else {
            self.queued.lock().unwrap().push(prompt);
        }
    }

    pub async fn run_now(&self, app: &AppHandle) -> AppResult<AutoLoggerRunResult> {
        let config = self.config.get();
        let mode = config.auto_logger.mode.clone();
        if mode == "off" {
            return Err(AppError::new(ErrorCode::ConfigInvalid, "Enable the auto logger before running it"));
        }
        if self.running.swap(true, Ordering::SeqCst) {
            return Err(AppError::new(ErrorCode::ConfigInvalid, "The auto logger is already running"));
        }
        let _guard = RunGuard(&self.running);
        let date = today();
        logger::info("auto-logger", "manual run started", Some(json!({ "date": date, "mode": mode })));
        if mode == "confirm" || mode == "notify" {
            // A manual run comes from the open Settings tab, so the wizard can
            // be handed over right away even in notify-only mode.
            self.deliver_prompt(app, AutoLoggerPrompt { date, auto_start: mode == "confirm" }, true);
            return Ok(AutoLoggerRunResult { kind: "review".into(), created_count: 0, total_seconds: 0 });
        }
        let (count, seconds) = self.run_full_auto(app, &date, &config).await?;
        Ok(AutoLoggerRunResult { kind: "completed".into(), created_count: count, total_seconds: seconds })
    }

    async fn check(&self, app: &AppHandle) {
        let config = self.config.get();
        let mode = config.auto_logger.mode.clone();
        if mode == "off" || self.running.load(Ordering::SeqCst) {
            return;
        }
        let now = Local::now();
        // Automated worklogs are intentionally limited to normal workdays.
        if matches!(now.weekday(), Weekday::Sat | Weekday::Sun) {
            return;
        }
        let date = now.format("%Y-%m-%d").to_string();
        let current = now.format("%H:%M").to_string();
        let key = format!("{date}@{}@{mode}", config.auto_logger.run_at);
        if current < config.auto_logger.run_at || *self.last_attempt_key.lock().unwrap() == key {
            return;
        }
        if self.running.swap(true, Ordering::SeqCst) {
            return;
        }
        let _guard = RunGuard(&self.running);
        self.mark_attempt(&key);
        logger::info("auto-logger", "scheduled run started", Some(json!({ "date": date, "runAt": config.auto_logger.run_at, "mode": mode })));
        let polish = config.language == "pl";
        let result = match mode.as_str() {
            "confirm" => {
                self.notify(
                    app,
                    if polish { "Czas uzupełnić dzień" } else { "Time to complete your day" },
                    if polish { "Autologger otwiera propozycje do przejrzenia i zatwierdzenia." } else { "The auto logger is opening suggestions for review and approval." },
                );
                // Do not rely on an OS toast: Windows can suppress them. The
                // review wizard is the reliable confirmation surface.
                self.deliver_prompt(app, AutoLoggerPrompt { date: date.clone(), auto_start: true }, true);
                Ok(())
            }
            "notify" => {
                self.show_reminder(app, &date, polish);
                Ok(())
            }
            _ => self.run_full_auto(app, &date, &config).await.map(|_| ()),
        };
        if let Err(e) = result {
            logger::error("auto-logger", "scheduled run failed", Some(json!({ "date": date, "message": e.message })));
            self.notify(
                app,
                if polish { "Autologger: błąd" } else { "Auto logger: error" },
                if polish {
                    "Nie udało się automatycznie zalogować czasu. Otwórz aplikację, aby sprawdzić szczegóły."
                } else {
                    "Time could not be logged automatically. Open the app to check the details."
                },
            );
        }
    }

    /// Notify-only mode: nothing is generated and nothing is logged. Opening
    /// the app opens the wizard for the day, like a click on it in the calendar.
    fn show_reminder(&self, app: &AppHandle, date: &str, polish: bool) {
        let prompt = AutoLoggerPrompt { date: date.to_string(), auto_start: false };
        self.notify(
            app,
            if polish { "Czas uzupełnić dzień" } else { "Time to complete your day" },
            if polish {
                "Otwórz aplikację, aby zalogować ten dzień. Nic nie zostało jeszcze dodane."
            } else {
                "Open the app to log this day. Nothing has been added yet."
            },
        );
        // Must not steal focus: an open window just gets the wizard, a window
        // hidden in the tray keeps the reminder until the user opens the app.
        if desktop::is_main_window_visible(app) {
            self.deliver_prompt(app, prompt, false);
        } else {
            *self.pending_prompt.lock().unwrap() = Some(prompt);
        }
        logger::info("auto-logger", "reminder shown", Some(json!({ "date": date, "pending": self.pending_prompt.lock().unwrap().is_some() })));
    }

    /// Hands a reminder the user has not opened yet to the freshly shown window.
    pub fn flush_pending_prompt(&self, app: &AppHandle) {
        let pending = self.pending_prompt.lock().unwrap().take();
        if let Some(prompt) = pending {
            logger::info("auto-logger", "delivering pending reminder", Some(json!({ "date": prompt.date })));
            self.deliver_prompt(app, prompt, false);
        }
    }

    /// Opens the wizard for a day; clears the pending reminder so it fires once.
    fn deliver_prompt(&self, app: &AppHandle, prompt: AutoLoggerPrompt, focus: bool) {
        *self.pending_prompt.lock().unwrap() = None;
        desktop::request_auto_logger_prompt(app, prompt, focus);
    }

    async fn run_full_auto(&self, app: &AppHandle, date: &str, config: &AppConfig) -> AppResult<(usize, i64)> {
        let selections = self.pick_selections(date, config).await;
        if selections.is_empty() {
            return Err(AppError::unknown("No recent project selection is available for the scheduled run"));
        }
        let request = SuggestionRequest { dates: vec![date.to_string()], selections };
        logger::info("auto-logger", "full-auto generation started", Some(json!({ "date": date, "projects": request.selections.len() })));
        let groups = self.llm.generate_suggestions(&request).await?;
        let (count, seconds) = self.submit(&groups, config).await?;
        if count > 0 {
            telemetry::track_worklogs_created(count, seconds as f64 / 3600.0);
        }
        let polish = config.language == "pl";
        let hours = (seconds as f64 / 3600.0 * 100.0).round() / 100.0;
        let hours = if polish { hours.to_string().replace('.', ",") } else { hours.to_string() };
        let body = match (count > 0, polish) {
            (true, true) => format!("Zalogowano {count} wpisów ({hours} h)."),
            (true, false) => format!("Logged {count} entries ({hours} h)."),
            (false, true) => "Dzień jest już uzupełniony — nie dodano nowych wpisów.".into(),
            (false, false) => "The day is already complete — no new entries were added.".into(),
        };
        self.notify(app, if polish { "Autologger zakończony" } else { "Auto logger finished" }, &body);
        logger::info("auto-logger", "full-auto run completed", Some(json!({ "date": date, "count": count, "seconds": seconds })));
        Ok((count, seconds))
    }

    /// Projects for the day: what the activity scan found (evidence or
    /// likely), with its hours hint; the last manual selection when the scan
    /// finds nothing. Settings of a project the user picked before (note,
    /// commits, new issues) carry over.
    async fn pick_selections(&self, date: &str, config: &AppConfig) -> Vec<ProjectSelection> {
        let scan = self.activity.scan(&ActivityScanRequest { dates: vec![date.to_string()] }).await;
        let scanned = selections_from_scan(&scan, config);
        logger::info("auto-logger", "projects picked", Some(json!({ "fromScan": scanned.len() })));
        if !scanned.is_empty() {
            return scanned;
        }
        config
            .last_used
            .selections
            .iter()
            .filter(|s| config.projects.iter().any(|p| p.id == s.project_id && !p.archived))
            .cloned()
            .map(|s| ProjectSelection { hours_hint: Default::default(), ..s })
            .collect()
    }

    async fn submit(&self, groups: &[ProjectSuggestions], config: &AppConfig) -> AppResult<(usize, i64)> {
        let (mut count, mut seconds) = (0, 0);
        for group in groups.iter().filter(|g| !g.suggestions.is_empty()) {
            let fields: Vec<&CustomFieldConfig> = config.custom_fields.iter().filter(|f| f.connection_id == group.connection_id).collect();
            let mut worklogs = Vec::new();
            for s in &group.suggestions {
                let issue_key = s.issue_key.trim().to_uppercase();
                if issue_key.is_empty() {
                    return Err(AppError::unknown(format!("Generated entry for {} has no issue key", group.project_name)));
                }
                let attributes = fields
                    .iter()
                    .map(|f| Attribute {
                        key: f.key.clone(),
                        value: s.custom_fields.get(&f.key).cloned().unwrap_or_else(|| {
                            if f.field_type == "boolean" { AttrValue::Bool(false) } else { AttrValue::Text(String::new()) }
                        }),
                    })
                    .filter(|a| matches!(a.value, AttrValue::Bool(_)) || a.value != AttrValue::Text(String::new()))
                    .collect();
                worklogs.push(NewWorklog {
                    issue_key,
                    description: s.description.trim().to_string(),
                    time_spent_seconds: (s.hours * 3600.0).round() as i64,
                    start_date: s.date.clone(),
                    attributes,
                });
            }
            let account = self.connections.account_id(&group.connection_id).await?;
            let created = self.connections.tempo(&group.connection_id).create_worklogs(&account, &worklogs).await?;
            count += created.len();
            seconds += created.iter().map(|w| w.time_spent_seconds).sum::<i64>();
        }
        Ok((count, seconds))
    }

    fn notify(&self, app: &AppHandle, title: &str, body: &str) {
        if let Err(e) = app.notification().builder().title(title).body(body).show() {
            logger::info("auto-logger", "could not show a notification", Some(json!(e.to_string())));
        }
    }

    fn mark_attempt(&self, key: &str) {
        *self.last_attempt_key.lock().unwrap() = key.to_string();
        if let Err(e) = std::fs::write(state_path(), json!({ "lastScheduledAttemptKey": key }).to_string()) {
            logger::info("auto-logger", "could not persist scheduler state", Some(json!(e.to_string())));
        }
    }
}

/// Selections for every project the scan marked as worked on (evidence or
/// likely) on any date, carrying the per-date hours hint.
fn selections_from_scan(scan: &ActivityScanResult, config: &AppConfig) -> Vec<ProjectSelection> {
    scan.projects
        .iter()
        .filter(|p| p.status == activity::EVIDENCE || p.status == activity::LIKELY)
        .filter_map(|p| {
            let project = config.projects.iter().find(|c| c.id == p.project_id && !c.archived)?;
            let previous = config.last_used.selections.iter().find(|s| s.project_id == p.project_id);
            let hours_hint = p.days.iter().filter(|d| d.status != activity::NONE && d.hours_hint > 0.0).map(|d| (d.date.clone(), d.hours_hint)).collect();
            Some(ProjectSelection {
                project_id: p.project_id.clone(),
                note: previous.map(|s| s.note.clone()).unwrap_or_default(),
                use_commits: previous.map_or(!project.git_folders.is_empty(), |s| s.use_commits),
                allow_new_issues: previous.is_some_and(|s| s.allow_new_issues),
                hours_hint,
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn project(id: &str, folders: usize) -> ProjectConfig {
        ProjectConfig {
            id: id.into(),
            git_folders: (0..folders).map(|i| GitFolder { path: format!("/r{i}"), ..Default::default() }).collect(),
            ..Default::default()
        }
    }

    fn row(id: &str, status: &str, hint: f64) -> ProjectActivity {
        ProjectActivity {
            project_id: id.into(),
            status: status.into(),
            days: vec![ProjectDayActivity { date: "2026-11-18".into(), status: status.into(), hours_hint: hint, ..Default::default() }],
            ..Default::default()
        }
    }

    #[test]
    fn scheduler_takes_evidence_and_likely_with_hints() {
        let mut config = AppConfig { projects: vec![project("a", 1), project("b", 0), project("c", 1)], ..Default::default() };
        config.last_used.selections.push(ProjectSelection { project_id: "a".into(), note: "keep".into(), use_commits: false, ..Default::default() });
        let scan = ActivityScanResult { days: vec![], projects: vec![row("a", "evidence", 5.0), row("b", "likely", 3.0), row("c", "none", 0.0)] };
        let picked = selections_from_scan(&scan, &config);
        assert_eq!(picked.iter().map(|s| s.project_id.as_str()).collect::<Vec<_>>(), vec!["a", "b"]);
        assert_eq!(picked[0].note, "keep");
        assert!(!picked[0].use_commits);
        assert_eq!(picked[0].hours_hint.get("2026-11-18"), Some(&5.0));
        assert!(!picked[1].use_commits);
    }
}

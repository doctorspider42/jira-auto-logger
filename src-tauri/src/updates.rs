//! Drives auto-update through the Tauri updater against the public GitHub
//! releases on every platform - the macOS build is Developer ID signed, so
//! it installs its own updates like the others. A build that cannot
//! self-install only compares the version and links to the releases page.
//! Every state change is pushed to the renderer (`updates:stateChange`).
//! Port of `UpdateService.ts`.

use crate::config::ConfigService;
use crate::domain::{ReleaseNote, UpdateState};
use crate::{logger, paths};
use serde_json::{json, Value};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};
use tauri_plugin_updater::{Update, UpdaterExt};

const REPO: &str = "doctorspider42/jira-auto-logger";
const RELEASES_URL: &str = "https://github.com/doctorspider42/jira-auto-logger/releases/latest";
pub const UPDATES_STATE_EVENT: &str = "updates:stateChange";
/// How long a fetched release history stays fresh, to avoid hammering the API.
const HISTORY_CACHE: Duration = Duration::from_secs(5 * 60);
/// Transient failures (network not up yet at launch, a GitHub hiccup) are
/// retried with exponential backoff before the error banner is shown.
const MAX_RETRIES: u32 = 4;
const RETRY_BASE: Duration = Duration::from_secs(5);

#[derive(Clone, Copy, PartialEq)]
enum Op {
    Check,
    Download,
}

pub struct UpdateService {
    config: Arc<ConfigService>,
    http: reqwest::Client,
    state: Mutex<UpdateState>,
    /// Found update and, once downloaded, its installer bytes.
    update: Mutex<Option<(Update, Option<Vec<u8>>)>>,
    history: Mutex<Option<(Instant, Vec<ReleaseNote>)>>,
    retries: Mutex<u32>,
}

/// True when dotted version `a` is strictly newer than `b`.
fn is_newer(a: &str, b: &str) -> bool {
    let parse = |v: &str| v.split('.').map(|n| n.parse::<u64>().unwrap_or(0)).collect::<Vec<_>>();
    let (pa, pb) = (parse(a), parse(b));
    for i in 0..pa.len().max(pb.len()) {
        let (x, y) = (pa.get(i).copied().unwrap_or(0), pb.get(i).copied().unwrap_or(0));
        if x != y {
            return x > y;
        }
    }
    false
}

impl UpdateService {
    pub fn new(config: Arc<ConfigService>, http: reqwest::Client, version: String) -> Self {
        Self {
            config,
            http,
            state: Mutex::new(UpdateState {
                status: "idle".into(),
                current_version: version,
                available_version: String::new(),
                progress_percent: 0.0,
                release_url: String::new(),
                can_auto_update: Self::can_auto_update(),
                error_message: String::new(),
            }),
            update: Mutex::new(None),
            history: Mutex::new(None),
            retries: Mutex::new(0),
        }
    }

    /// Self-install works on installed builds.
    fn can_auto_update() -> bool {
        !cfg!(debug_assertions)
    }

    /// Whether the updater does anything at all (never in dev or mock mode).
    fn enabled() -> bool {
        !cfg!(debug_assertions) && !paths::is_mock_mode()
    }

    fn mode(&self) -> String {
        self.config.get().updates.mode
    }

    pub fn get_state(&self) -> UpdateState {
        self.state.lock().unwrap().clone()
    }

    fn set_state(&self, app: &AppHandle, patch: impl FnOnce(&mut UpdateState)) {
        let snapshot = {
            let mut state = self.state.lock().unwrap();
            patch(&mut state);
            state.clone()
        };
        logger::info(
            "update",
            &format!("state {}", snapshot.status),
            Some(json!({ "version": snapshot.available_version, "percent": snapshot.progress_percent })),
        );
        let _ = app.emit(UPDATES_STATE_EVENT, &snapshot);
    }

    /// Kicks off the initial check shortly after launch, unless mode is `off`.
    pub fn start(self: &Arc<Self>, app: AppHandle) {
        if !Self::enabled() {
            logger::info("update", "Updater disabled (dev or mock mode)", None);
            return;
        }
        if self.mode() == "off" {
            return;
        }
        let this = self.clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(Duration::from_secs(4)).await;
            this.check(&app).await;
        });
    }

    /// Re-reads the mode after a config change and checks if it was just enabled.
    pub fn on_config_changed(self: &Arc<Self>, app: &AppHandle) {
        if !Self::enabled() {
            return;
        }
        let status = self.get_state().status;
        if self.mode() != "off" && (status == "idle" || status == "not-available") {
            let (this, app) = (self.clone(), app.clone());
            tauri::async_runtime::spawn(async move { this.check(&app).await });
        }
    }

    pub async fn check(self: &Arc<Self>, app: &AppHandle) {
        if !Self::enabled() {
            return;
        }
        *self.retries.lock().unwrap() = 0;
        self.run(app, Op::Check).await;
    }

    pub async fn download(self: &Arc<Self>, app: &AppHandle) {
        if !Self::enabled() || !Self::can_auto_update() {
            return;
        }
        *self.retries.lock().unwrap() = 0;
        self.run(app, Op::Download).await;
    }

    /// One attempt; failures feed the retry loop, not the error banner.
    async fn run(self: &Arc<Self>, app: &AppHandle, op: Op) {
        let result = match op {
            Op::Check if Self::can_auto_update() => self.check_with_updater(app).await,
            Op::Check => self.check_via_github(app).await,
            Op::Download => self.download_update(app).await,
        };
        if let Err(error) = result {
            self.on_failed(app, op, error);
        }
    }

    async fn check_with_updater(self: &Arc<Self>, app: &AppHandle) -> Result<(), String> {
        self.set_state(app, |s| {
            s.status = "checking".into();
            s.error_message.clear();
        });
        let updater = app.updater().map_err(|e| e.to_string())?;
        match updater.check().await.map_err(|e| e.to_string())? {
            Some(update) => {
                let version = update.version.clone();
                *self.update.lock().unwrap() = Some((update, None));
                self.set_state(app, |s| {
                    s.status = "available".into();
                    s.available_version = version;
                    s.release_url = RELEASES_URL.into();
                });
                // Auto mode downloads in the background and installs on quit.
                if self.mode() == "auto" {
                    self.download_update(app).await?;
                }
            }
            None => self.set_state(app, |s| s.status = "not-available".into()),
        }
        Ok(())
    }

    async fn download_update(self: &Arc<Self>, app: &AppHandle) -> Result<(), String> {
        let Some(update) = self.update.lock().unwrap().as_ref().map(|(u, _)| u.clone()) else {
            return Err("No update to download".into());
        };
        self.set_state(app, |s| {
            s.status = "downloading".into();
            s.progress_percent = 0.0;
        });
        let (this, progress_app) = (self.clone(), app.clone());
        let mut received: usize = 0;
        let bytes = update
            .download(
                move |chunk, total| {
                    received += chunk;
                    if let Some(total) = total.filter(|t| *t > 0) {
                        let percent = (received as f64 / total as f64 * 100.0).round();
                        *this.retries.lock().unwrap() = 0;
                        this.set_state(&progress_app, |s| s.progress_percent = percent);
                    }
                },
                || {},
            )
            .await
            .map_err(|e| e.to_string())?;
        let version = update.version.clone();
        *self.update.lock().unwrap() = Some((update, Some(bytes)));
        self.set_state(app, |s| {
            s.status = "downloaded".into();
            s.available_version = version;
            s.progress_percent = 100.0;
        });
        Ok(())
    }

    /// Installs a downloaded update and restarts into it.
    pub fn quit_and_install(&self, app: &AppHandle) -> Result<(), String> {
        if !Self::enabled() || !Self::can_auto_update() {
            return Ok(());
        }
        let taken = self.update.lock().unwrap().take();
        if let Some((update, Some(bytes))) = taken {
            update.install(bytes).map_err(|e| e.to_string())?;
            app.restart();
        }
        Ok(())
    }

    /// Auto mode: a downloaded update is installed when the app quits.
    pub fn install_on_quit(&self) {
        if self.mode() != "auto" {
            return;
        }
        if let Some((update, Some(bytes))) = self.update.lock().unwrap().take() {
            if let Err(e) = update.install(bytes) {
                logger::error("update", "install on quit failed", Some(json!(e.to_string())));
            }
        }
    }

    fn on_failed(self: &Arc<Self>, app: &AppHandle, op: Op, error: String) {
        let attempt = {
            let mut retries = self.retries.lock().unwrap();
            *retries += 1;
            *retries
        };
        if attempt <= MAX_RETRIES {
            let delay = RETRY_BASE * 2u32.pow(attempt - 1);
            let name = if op == Op::Check { "check" } else { "download" };
            logger::info("update", &format!("{name} failed, retry {attempt}/{MAX_RETRIES} in {}ms", delay.as_millis()), Some(json!({ "error": error })));
            self.set_state(app, |s| {
                if op == Op::Download {
                    s.status = "downloading".into();
                } else {
                    s.status = "checking".into();
                    s.error_message.clear();
                }
            });
            let (this, app) = (self.clone(), app.clone());
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(delay).await;
                this.run(&app, op).await;
            });
            return;
        }
        *self.retries.lock().unwrap() = 0;
        self.set_state(app, |s| {
            s.status = "error".into();
            s.error_message = error;
        });
    }

    /// Builds that cannot self-install: version-only check against the public releases API.
    async fn check_via_github(self: &Arc<Self>, app: &AppHandle) -> Result<(), String> {
        self.set_state(app, |s| {
            s.status = "checking".into();
            s.error_message.clear();
        });
        let release = self.github_get("releases/latest").await?;
        let latest = release["tag_name"].as_str().unwrap_or_default().trim_start_matches('v').to_string();
        let current = self.get_state().current_version;
        if !latest.is_empty() && is_newer(&latest, &current) {
            let url = release["html_url"].as_str().unwrap_or(RELEASES_URL).to_string();
            self.set_state(app, |s| {
                s.status = "available".into();
                s.available_version = latest;
                s.release_url = url;
            });
        } else {
            self.set_state(app, |s| s.status = "not-available".into());
        }
        Ok(())
    }

    /// Published releases newest-first for the "what's new" view. Cached
    /// briefly so reopening the view does not re-hit the API. No drafts.
    pub async fn release_history(&self) -> Result<Vec<ReleaseNote>, String> {
        if let Some((at, releases)) = self.history.lock().unwrap().as_ref() {
            if at.elapsed() < HISTORY_CACHE {
                return Ok(releases.clone());
            }
        }
        let raw = self.github_get("releases?per_page=30").await?;
        let releases: Vec<ReleaseNote> = raw
            .as_array()
            .cloned()
            .unwrap_or_default()
            .into_iter()
            .filter(|r| r["draft"].as_bool() != Some(true))
            .map(|r| {
                let tag = r["tag_name"].as_str().unwrap_or_default();
                ReleaseNote {
                    version: tag.trim_start_matches('v').to_string(),
                    name: r["name"].as_str().filter(|n| !n.is_empty()).unwrap_or(tag).to_string(),
                    notes: r["body"].as_str().unwrap_or_default().trim().to_string(),
                    url: r["html_url"].as_str().filter(|u| !u.is_empty()).unwrap_or(RELEASES_URL).to_string(),
                    published_at: r["published_at"].as_str().unwrap_or_default().to_string(),
                    prerelease: r["prerelease"].as_bool().unwrap_or(false),
                }
            })
            .collect();
        *self.history.lock().unwrap() = Some((Instant::now(), releases.clone()));
        Ok(releases)
    }

    async fn github_get(&self, path: &str) -> Result<Value, String> {
        let response = self
            .http
            .get(format!("https://api.github.com/repos/{REPO}/{path}"))
            .header("Accept", "application/vnd.github+json")
            .send()
            .await
            .map_err(|e| e.to_string())?;
        if !response.status().is_success() {
            return Err(format!("GitHub API returned {}", response.status().as_u16()));
        }
        response.json().await.map_err(|e| e.to_string())
    }
}

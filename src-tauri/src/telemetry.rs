//! Anonymous, opt-out usage telemetry via Aptabase's HTTP API. Aptabase
//! attributes sessions, app version, OS and locale; on top of that the app
//! sends only coarse events: `app_started` (with the theme), `worklogs_created`
//! (count and hours) and a bare `report_generated`. Never issue keys,
//! descriptions, credentials, paths or notes. Mock mode never phones home.

use crate::config::ConfigService;
use crate::{logger, paths};
use serde_json::{json, Map, Value};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

/// Write-only app key, meant to ship inside the client. The region is encoded
/// in it (`A-EU-…`). Override with `JAL_APTABASE_KEY`; a self-hosted instance
/// (`A-SH-…` keys) is reached through `JAL_APTABASE_HOST`.
const APTABASE_APP_KEY: &str = "A-EU-3600777036";
/// A session ends after an hour without events, like the Aptabase SDKs.
const SESSION_TIMEOUT: Duration = Duration::from_secs(60 * 60);

struct Telemetry {
    config: Arc<ConfigService>,
    http: reqwest::Client,
    version: String,
    session: Mutex<(String, Instant)>,
}

static TELEMETRY: OnceLock<Telemetry> = OnceLock::new();

fn new_session_id() -> String {
    let secs = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    format!("{secs}{:08}", rand::random::<u32>() % 100_000_000)
}

fn app_key() -> String {
    std::env::var("JAL_APTABASE_KEY").ok().filter(|k| !k.trim().is_empty()).unwrap_or_else(|| APTABASE_APP_KEY.into())
}

fn host(key: &str) -> Option<String> {
    match key.split('-').nth(1) {
        Some("EU") => Some("https://eu.aptabase.com".into()),
        Some("US") => Some("https://us.aptabase.com".into()),
        Some("SH") => std::env::var("JAL_APTABASE_HOST").ok().filter(|h| !h.trim().is_empty()),
        _ => None,
    }
}

pub fn init(config: Arc<ConfigService>, http: reqwest::Client, version: String) {
    let _ = TELEMETRY.set(Telemetry { config, http, version, session: Mutex::new((new_session_id(), Instant::now())) });
}

/// `env` rides on every event so dev and test traffic filters out of real
/// stats: `development` in debug builds, `production` otherwise, overridable
/// with `JAL_TELEMETRY_ENV`.
fn env_prop() -> String {
    std::env::var("JAL_TELEMETRY_ENV")
        .ok()
        .filter(|e| !e.trim().is_empty())
        .unwrap_or_else(|| if cfg!(debug_assertions) { "development".into() } else { "production".into() })
}

fn track(name: &'static str, props: Map<String, Value>) {
    let Some(t) = TELEMETRY.get() else { return };
    // Gated per event so the opt-out applies at once, without a restart.
    if paths::is_mock_mode() || !t.config.get().telemetry.enabled {
        return;
    }
    let key = app_key();
    let Some(host) = host(&key) else { return };
    let session_id = {
        let mut session = t.session.lock().unwrap();
        if session.1.elapsed() > SESSION_TIMEOUT {
            session.0 = new_session_id();
        }
        session.1 = Instant::now();
        session.0.clone()
    };
    let mut all = Map::new();
    all.insert("env".into(), json!(env_prop()));
    all.extend(props);
    let event = json!([{
        "timestamp": chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
        "sessionId": session_id,
        "eventName": name,
        "systemProps": {
            "isDebug": cfg!(debug_assertions),
            "locale": sys_locale(),
            "osName": os_name(),
            "osVersion": "",
            "appVersion": t.version,
            "sdkVersion": concat!("jira-auto-logger-rust@", env!("CARGO_PKG_VERSION")),
        },
        "props": all,
    }]);
    let request = t.http.post(format!("{host}/api/v0/events")).header("App-Key", key).json(&event);
    // Best-effort and off the caller's path: telemetry must never affect the app.
    tauri::async_runtime::spawn(async move {
        if let Err(e) = request.send().await {
            logger::debug("telemetry", &format!("event \"{name}\" failed"), Some(json!(e.to_string())));
        }
    });
}

fn os_name() -> &'static str {
    match std::env::consts::OS {
        "windows" => "Windows",
        "macos" => "macOS",
        "linux" => "Linux",
        other => other,
    }
}

fn sys_locale() -> String {
    std::env::var("LANG").ok().and_then(|l| l.split('.').next().map(|s| s.replace('_', "-"))).unwrap_or_default()
}

/// Fired once on launch so users who never log time still count as active.
pub fn track_app_started(theme: &str) {
    let mut props = Map::new();
    props.insert("theme".into(), json!(theme));
    track("app_started", props);
}

/// One event per successful worklog submission; hours rounded to stay coarse.
pub fn track_worklogs_created(count: usize, hours: f64) {
    let mut props = Map::new();
    props.insert("count".into(), json!(count));
    props.insert("hours".into(), json!((hours * 100.0).round() / 100.0));
    track("worklogs_created", props);
}

/// One bare event per generated PDF report.
pub fn track_report_generated() {
    track("report_generated", Map::new());
}

//! Minimal file logger for debugging, at the same path the Electron app used
//! (userData/logs/main.log). Never log secrets or full prompts - lengths and
//! identifiers are enough to trace a problem.

use crate::paths;
use serde_json::Value;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;

const DETAILS_LIMIT: usize = 4000;

static LOCK: Mutex<()> = Mutex::new(());

pub fn file_path() -> PathBuf {
    paths::user_data_dir().join("logs").join("main.log")
}

pub fn debug(scope: &str, message: &str, details: Option<Value>) {
    write("DEBUG", scope, message, details);
}

pub fn info(scope: &str, message: &str, details: Option<Value>) {
    write("INFO", scope, message, details);
}

pub fn error(scope: &str, message: &str, details: Option<Value>) {
    write("ERROR", scope, message, details);
}

fn write(level: &str, scope: &str, message: &str, details: Option<Value>) {
    let suffix = details
        .map(|d| {
            let text = d.to_string();
            if text.len() > DETAILS_LIMIT {
                let cut = (0..=DETAILS_LIMIT).rev().find(|i| text.is_char_boundary(*i)).unwrap_or(0);
                format!(" {}…(truncated)", &text[..cut])
            } else {
                format!(" {text}")
            }
        })
        .unwrap_or_default();
    let now = chrono::Utc::now().format("%Y-%m-%dT%H:%M:%S%.3fZ");
    let line = format!("{now} [{level}] [{scope}] {message}{suffix}");
    if cfg!(debug_assertions) {
        println!("{line}");
    }
    // Logging must never break the app.
    let _guard = LOCK.lock();
    let path = file_path();
    if let Some(dir) = path.parent() {
        let _ = fs::create_dir_all(dir);
    }
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(file, "{line}");
    }
}

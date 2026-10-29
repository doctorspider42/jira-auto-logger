//! Where the app keeps its files. The folder is the one Electron used
//! (`<appData>/jira-auto-logger`), so the Tauri build picks up existing
//! settings, logs and auto logger state.

use std::path::PathBuf;

pub fn user_data_dir() -> PathBuf {
    dirs::config_dir()
        .unwrap_or_else(std::env::temp_dir)
        .join("jira-auto-logger")
}

/// Mock mode: run on deterministic fake data, offline, never touching the real config.
pub fn is_mock_mode() -> bool {
    std::env::var("JAL_MOCK").as_deref() == Ok("1") || std::env::args().any(|a| a == "--mock")
}

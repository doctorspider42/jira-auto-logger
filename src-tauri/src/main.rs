// Release builds run without a console window on Windows.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod config;

use serde_json::Value;
use std::sync::Mutex;
use tauri::{Manager, State};

/// Config saved during this session. The trial never writes the real config
/// file: Electron would lose the tokens it stores there, encrypted.
struct SavedConfig(Mutex<Option<Value>>);

/// Which window background effect was applied, for the renderer to style itself.
struct Backdrop(&'static str);

fn is_mock() -> bool {
    std::env::var("JAL_MOCK").as_deref() == Ok("1") || std::env::args().any(|a| a == "--mock")
}

#[tauri::command]
fn config_get(saved: State<SavedConfig>) -> Value {
    if let Some(config) = saved.0.lock().unwrap().clone() {
        return config;
    }
    config::load()
}

#[tauri::command]
fn config_set(config: Value, saved: State<SavedConfig>) {
    *saved.0.lock().unwrap() = Some(config);
}

#[tauri::command]
fn config_file_path() -> String {
    config::file_path().map(|p| p.display().to_string()).unwrap_or_default()
}

#[tauri::command]
fn runtime_info(app: tauri::AppHandle, backdrop: State<Backdrop>) -> Value {
    serde_json::json!({
        "version": app.package_info().version.to_string(),
        "mock": is_mock(),
        "backdrop": backdrop.0,
    })
}

/// Applies the background effect named by `JAL_BACKDROP` (mica, acrylic, blur,
/// none), or the best one the system supports. Mica needs Windows 11; Windows
/// 10 falls back to acrylic, which is known to lag while the window is resized.
#[cfg(target_os = "windows")]
fn apply_backdrop(window: &tauri::WebviewWindow) -> &'static str {
    use window_vibrancy::{apply_acrylic, apply_blur, apply_mica};
    let tint = Some((16, 17, 20, 140));
    match std::env::var("JAL_BACKDROP").as_deref() {
        Ok("none") => "none",
        Ok("blur") => apply_blur(window, tint).map(|_| "blur").unwrap_or("none"),
        Ok("acrylic") => apply_acrylic(window, tint).map(|_| "acrylic").unwrap_or("none"),
        _ => apply_mica(window, None)
            .map(|_| "mica")
            .or_else(|_| apply_acrylic(window, tint).map(|_| "acrylic"))
            .unwrap_or("none"),
    }
}

#[cfg(target_os = "macos")]
fn apply_backdrop(window: &tauri::WebviewWindow) -> &'static str {
    use window_vibrancy::{apply_vibrancy, NSVisualEffectMaterial};
    apply_vibrancy(window, NSVisualEffectMaterial::Sidebar, None, None)
        .map(|_| "vibrancy")
        .unwrap_or("none")
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
fn apply_backdrop(_window: &tauri::WebviewWindow) -> &'static str {
    "none"
}

fn main() {
    tauri::Builder::default()
        .manage(SavedConfig(Mutex::new(None)))
        .setup(|app| {
            let window = app.get_webview_window("main").expect("main window");
            app.manage(Backdrop(apply_backdrop(&window)));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            config_get,
            config_set,
            config_file_path,
            runtime_info
        ])
        .run(tauri::generate_context!())
        .expect("error while running the app");
}

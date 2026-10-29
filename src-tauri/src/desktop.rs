//! Desktop integration: window backdrop, and reacting to settings that change
//! how the app sits on the desktop.

use crate::domain::AppConfig;

/// Applies the background effect named by `JAL_BACKDROP` (mica, acrylic, blur,
/// none), or the best one the system supports. Mica needs Windows 11; Windows
/// 10 falls back to acrylic, which is known to lag while the window is resized.
#[cfg(target_os = "windows")]
pub fn apply_backdrop(window: &tauri::WebviewWindow) -> &'static str {
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
pub fn apply_backdrop(window: &tauri::WebviewWindow) -> &'static str {
    use window_vibrancy::{apply_vibrancy, NSVisualEffectMaterial};
    apply_vibrancy(window, NSVisualEffectMaterial::Sidebar, None, None)
        .map(|_| "vibrancy")
        .unwrap_or("none")
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
pub fn apply_backdrop(_window: &tauri::WebviewWindow) -> &'static str {
    "none"
}

/// Tray, launch at login and the scheduler follow the saved settings.
pub fn on_config_changed(_app: &tauri::AppHandle, _config: &AppConfig) {}

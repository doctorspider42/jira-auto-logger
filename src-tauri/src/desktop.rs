//! Desktop integration: the main window's show/hide behaviour, the tray icon,
//! launch at login and the window backdrop. Port of the window and tray parts
//! of the Electron `main/index.ts`.

use crate::auto_logger::AutoLogger;
use crate::commands::AppState;
use crate::domain::{AppConfig, AutoLoggerPrompt};
use crate::logger;
use serde_json::json;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, WebviewWindow, WindowEvent};

pub const AUTO_LOGGER_PROMPT_EVENT: &str = "autoLogger:promptRequested";

#[derive(Default)]
pub struct Desktop {
    /// Set when the user really quits, so closing stops hiding to the tray.
    quitting: AtomicBool,
    tray: Mutex<Option<TrayIcon>>,
}

fn main_window(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window("main")
}

pub fn show_main_window(app: &AppHandle) {
    if let Some(window) = main_window(app) {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
    // Opening the app is exactly the moment a notify-only reminder waits for.
    app.state::<Arc<AutoLogger>>().flush_pending_prompt(app);
}

/// True when the user can already see the app, i.e. it is not hidden in the tray.
pub fn is_main_window_visible(app: &AppHandle) -> bool {
    main_window(app).is_some_and(|w| w.is_visible().unwrap_or(false) && !w.is_minimized().unwrap_or(false))
}

/// Hands one day over to the renderer's wizard. `focus` is false only for a
/// notify-only reminder landing in a window the user already has open.
pub fn request_auto_logger_prompt(app: &AppHandle, prompt: AutoLoggerPrompt, focus: bool) {
    if focus || !is_main_window_visible(app) {
        if let Some(window) = main_window(app) {
            let _ = window.unminimize();
            let _ = window.show();
            let _ = window.set_focus();
        }
    }
    app.state::<Arc<AutoLogger>>().send_to_renderer(app, prompt);
}

/// The renderer is listening: deliver what arrived while it was loading.
pub fn emit_prompt(app: &AppHandle, prompt: &AutoLoggerPrompt) {
    let _ = app.emit(AUTO_LOGGER_PROMPT_EVENT, prompt);
}

pub fn on_window_event(window: &tauri::Window, event: &WindowEvent) {
    if window.label() != "main" {
        return;
    }
    let app = window.app_handle();
    let minimize_to_tray = app.state::<AppState>().config.get().auto_logger.minimize_to_tray;
    match event {
        WindowEvent::CloseRequested { api, .. } => {
            if minimize_to_tray && !app.state::<Desktop>().quitting.load(Ordering::SeqCst) {
                api.prevent_close();
                let _ = window.hide();
            } else {
                app.exit(0);
            }
        }
        WindowEvent::Resized(_) => {
            if minimize_to_tray && window.is_minimized().unwrap_or(false) {
                let _ = window.hide();
            }
        }
        _ => {}
    }
}

fn configure_tray(app: &AppHandle, config: &AppConfig) {
    let desktop = app.state::<Desktop>();
    let mut tray = desktop.tray.lock().unwrap();
    if !config.auto_logger.minimize_to_tray {
        if let Some(icon) = tray.take() {
            let _ = icon.set_visible(false);
        }
        return;
    }
    let polish = config.language == "pl";
    let build_menu = || -> tauri::Result<Menu<tauri::Wry>> {
        let show = MenuItem::with_id(app, "show", if polish { "Pokaż Jira Auto Logger" } else { "Show Jira Auto Logger" }, true, None::<&str>)?;
        let quit = MenuItem::with_id(app, "quit", if polish { "Zakończ" } else { "Quit" }, true, None::<&str>)?;
        Menu::with_items(app, &[&show, &PredefinedMenuItem::separator(app)?, &quit])
    };
    let Ok(menu) = build_menu() else { return };
    if let Some(icon) = tray.as_ref() {
        let _ = icon.set_menu(Some(menu));
        let _ = icon.set_visible(true);
        return;
    }
    let built = TrayIconBuilder::with_id("main")
        .tooltip("Jira Auto Logger")
        .icon(app.default_window_icon().cloned().expect("app icon"))
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => show_main_window(app),
            "quit" => {
                app.state::<Desktop>().quitting.store(true, Ordering::SeqCst);
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::DoubleClick { button: MouseButton::Left, .. }
            | TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event
            {
                show_main_window(tray.app_handle());
            }
        })
        .build(app);
    match built {
        Ok(icon) => *tray = Some(icon),
        Err(e) => logger::error("desktop", "could not create the tray icon", Some(json!(e.to_string()))),
    }
}

fn configure_launch_at_login(app: &AppHandle, enabled: bool) {
    // Only installed builds register themselves; a dev run would point the
    // login item at a throwaway debug binary.
    if cfg!(debug_assertions) {
        return;
    }
    use tauri_plugin_autostart::ManagerExt;
    let launcher = app.autolaunch();
    let result = if enabled { launcher.enable() } else { launcher.disable() };
    if let Err(e) = result {
        logger::error("desktop", "could not update launch-at-login setting", Some(json!(e.to_string())));
    }
}

pub fn apply_desktop_config(app: &AppHandle, config: &AppConfig) {
    configure_tray(app, config);
    configure_launch_at_login(app, config.auto_logger.launch_at_login);
}

/// Tray, launch at login, updates and the scheduler follow the saved settings.
pub fn on_config_changed(app: &AppHandle, config: &AppConfig) {
    apply_desktop_config(app, config);
    app.state::<Arc<crate::updates::UpdateService>>().on_config_changed(app);
    app.state::<Arc<AutoLogger>>().on_config_changed(config);
}

/// Launched by the login item with `--hidden` and set to live in the tray:
/// start without showing the window.
pub fn start_hidden(config: &AppConfig) -> bool {
    !cfg!(debug_assertions) && config.auto_logger.minimize_to_tray && std::env::args().any(|a| a == "--hidden")
}

/// Applies the background effect named by `JAL_BACKDROP` (mica, acrylic, blur,
/// none), or the best one the system supports. Mica needs Windows 11; Windows
/// 10 falls back to acrylic, which is known to lag while the window is resized.
#[cfg(target_os = "windows")]
pub fn apply_backdrop(window: &WebviewWindow) -> &'static str {
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
pub fn apply_backdrop(window: &WebviewWindow) -> &'static str {
    use window_vibrancy::{apply_vibrancy, NSVisualEffectMaterial};
    apply_vibrancy(window, NSVisualEffectMaterial::Sidebar, None, None)
        .map(|_| "vibrancy")
        .unwrap_or("none")
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
pub fn apply_backdrop(_window: &WebviewWindow) -> &'static str {
    "none"
}

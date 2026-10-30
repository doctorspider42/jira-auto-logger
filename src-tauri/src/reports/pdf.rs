//! Prints report HTML to a PDF file through the system webview. On Windows
//! that is WebView2 (Chromium, like Electron's printToPDF), driven by a hidden
//! window: load the HTML, wait for the navigation, print.

use crate::error::{AppError, AppResult, ErrorCode};
use std::path::Path;

#[cfg(windows)]
pub async fn print(app: &tauri::AppHandle, html: &str, path: &Path, landscape: bool) -> AppResult<()> {
    use std::sync::{Arc, Mutex};
    use tauri::{WebviewUrl, WebviewWindowBuilder};
    use tokio::sync::oneshot;
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2Environment6, ICoreWebView2_7, COREWEBVIEW2_PRINT_ORIENTATION_LANDSCAPE,
        COREWEBVIEW2_PRINT_ORIENTATION_PORTRAIT,
    };
    use webview2_com::{NavigationCompletedEventHandler, PrintToPdfCompletedHandler};
    use windows::core::{Interface, HSTRING};

    let failed = |message: &str, details: String| AppError::with_details(ErrorCode::Unknown, message, details);
    let label = format!("report-{}", uuid::Uuid::new_v4().simple());
    let blank: tauri::Url = "about:blank".parse().expect("valid url");
    let window = WebviewWindowBuilder::new(app, &label, WebviewUrl::External(blank))
        .visible(false)
        .build()
        .map_err(|e| failed("Could not prepare the report.", e.to_string()))?;

    let result = async {
        // 1. Load the HTML and wait until it has rendered.
        let (loaded_tx, loaded_rx) = oneshot::channel::<bool>();
        let loaded_tx = Arc::new(Mutex::new(Some(loaded_tx)));
        let page = html.to_string();
        window
            .with_webview(move |webview| {
                let run = || -> windows::core::Result<()> {
                    let core = unsafe { webview.controller().CoreWebView2()? };
                    let handler = NavigationCompletedEventHandler::create(Box::new(move |_, args| {
                        let ok = match args {
                            Some(args) => {
                                let mut success = windows::core::BOOL::default();
                                unsafe { args.IsSuccess(&mut success)? };
                                success.as_bool()
                            }
                            None => false,
                        };
                        if let Some(tx) = loaded_tx.lock().unwrap().take() {
                            let _ = tx.send(ok);
                        }
                        Ok(())
                    }));
                    let mut token = Default::default();
                    unsafe {
                        core.add_NavigationCompleted(&handler, &mut token)?;
                        core.NavigateToString(&HSTRING::from(page))?;
                    }
                    Ok(())
                };
                if let Err(e) = run() {
                    crate::logger::error("reports", "could not load the report page", Some(serde_json::json!(e.to_string())));
                }
            })
            .map_err(|e| failed("Could not prepare the report.", e.to_string()))?;
        if !loaded_rx.await.unwrap_or(false) {
            return Err(failed("Could not render the report.", "navigation failed".into()));
        }

        // 2. Print. A4, margins matching the page CSS so its footer boxes fit.
        let (printed_tx, printed_rx) = oneshot::channel::<Result<bool, String>>();
        let printed_tx = Arc::new(Mutex::new(Some(printed_tx)));
        let target = path.display().to_string();
        window
            .with_webview(move |webview| {
                let send = {
                    let printed_tx = printed_tx.clone();
                    move |result: Result<bool, String>| {
                        if let Some(tx) = printed_tx.lock().unwrap().take() {
                            let _ = tx.send(result);
                        }
                    }
                };
                let run = || -> windows::core::Result<()> {
                    let core: ICoreWebView2_7 = unsafe { webview.controller().CoreWebView2()? }.cast()?;
                    let environment: ICoreWebView2Environment6 = webview.environment().cast()?;
                    let settings = unsafe { environment.CreatePrintSettings()? };
                    unsafe {
                        settings.SetOrientation(if landscape {
                            COREWEBVIEW2_PRINT_ORIENTATION_LANDSCAPE
                        } else {
                            COREWEBVIEW2_PRINT_ORIENTATION_PORTRAIT
                        })?;
                        settings.SetPageWidth(8.27)?;
                        settings.SetPageHeight(11.69)?;
                        settings.SetMarginTop(14.0 / 25.4)?;
                        settings.SetMarginLeft(14.0 / 25.4)?;
                        settings.SetMarginRight(14.0 / 25.4)?;
                        settings.SetMarginBottom(18.0 / 25.4)?;
                        settings.SetShouldPrintBackgrounds(true)?;
                        settings.SetShouldPrintHeaderAndFooter(false)?;
                    }
                    let done = send.clone();
                    let handler = PrintToPdfCompletedHandler::create(Box::new(move |status, ok| {
                        done(status.map(|_| ok).map_err(|e| e.to_string()));
                        Ok(())
                    }));
                    unsafe { core.PrintToPdf(&HSTRING::from(target), &settings, &handler)? };
                    Ok(())
                };
                if let Err(e) = run() {
                    send(Err(e.to_string()));
                }
            })
            .map_err(|e| failed("Could not print the report.", e.to_string()))?;
        match printed_rx.await {
            Ok(Ok(true)) => Ok(()),
            Ok(Ok(false)) => Err(failed("Could not write the PDF file.", "PrintToPdf reported failure".into())),
            Ok(Err(e)) => Err(failed("Could not write the PDF file.", e)),
            Err(_) => Err(failed("Could not write the PDF file.", "print was cancelled".into())),
        }
    }
    .await;

    let _ = window.destroy();
    result
}

/// macOS (WKWebView) and Linux (WebKitGTK) printing is not implemented yet.
#[cfg(not(windows))]
pub async fn print(_app: &tauri::AppHandle, _html: &str, _path: &Path, _landscape: bool) -> AppResult<()> {
    Err(AppError::new(ErrorCode::Unknown, "PDF reports are not available on this system yet."))
}

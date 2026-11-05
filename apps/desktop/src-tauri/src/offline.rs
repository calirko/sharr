// When the server can't be reached, the window shows our own page (placeholder/offline.html)
// instead of Chromium's error page, and goes back once the server answers again.
//
// A failed load isn't enough on its own (CEF also reports cancelled navigations), and a
// Cloudflare 502 loads fine, so every failed or finished load of the app is followed by a
// health check.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use tauri::{AppHandle, Manager, State, Url};

use crate::login::AppUrl;

// CEF serves bundled files from http://tauri.localhost
const PAGE: &str = "http://tauri.localhost/offline.html";

#[derive(Default)]
pub struct Offline {
    // Where to go back to
    target: Mutex<Option<Url>>,
    checking: AtomicBool,
}

pub fn page() -> Url {
    PAGE.parse().unwrap()
}

async fn reachable(app: &Url) -> bool {
    let _ = rustls::crypto::ring::default_provider().install_default();
    let Ok(url) = app.join("/api/health") else { return false };
    let client = match reqwest::Client::builder().timeout(Duration::from_secs(8)).build() {
        Ok(c) => c,
        Err(e) => {
            log::warn!("health check client: {e}");
            return true;
        }
    };
    match client.get(url).send().await {
        Ok(r) if r.status().is_success() => true,
        Ok(r) => {
            log::info!("server answered {}", r.status());
            false
        }
        Err(e) => {
            log::info!("server unreachable: {e}");
            false
        }
    }
}

/// A load of `url` in the main window failed or finished: show the offline page if the server is down
///
/// `failed`: Chromium itself gave up on the load (DNS, TLS, refused). Our own check can disagree
/// with it, so the offline page is shown anyway and its retry loop brings the app back.
pub fn check(app: &AppHandle, url: Url, failed: bool) {
    let app_url = app.state::<AppUrl>().0.clone();
    // Chromium's own error page
    let chrome_error = url.scheme() == "chrome-error";
    let url = if chrome_error { app_url.clone() } else { url };
    if url.origin() != app_url.origin() {
        return;
    }
    let failed = failed || chrome_error;
    let state = app.state::<Offline>();
    if state.checking.swap(true, Ordering::SeqCst) {
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let up = !failed && reachable(&app_url).await;
        let state = app.state::<Offline>();
        state.checking.store(false, Ordering::SeqCst);
        if up {
            return;
        }
        *state.target.lock().unwrap() = Some(url);
        if let Some(w) = app.get_webview_window("main") {
            let _ = w.navigate(page());
        }
    });
}

/// Called by the offline page: goes back to the app if the server answers
#[tauri::command]
pub async fn offline_retry(app: AppHandle, app_url: State<'_, AppUrl>, state: State<'_, Offline>) -> Result<bool, ()> {
    if !reachable(&app_url.0).await {
        return Ok(false);
    }
    let target = state.target.lock().unwrap().take().unwrap_or_else(|| app_url.0.clone());
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.navigate(target);
    }
    Ok(true)
}

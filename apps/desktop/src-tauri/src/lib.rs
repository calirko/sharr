mod update;

use tauri::ipc::CapabilityBuilder;
use tauri::webview::{PermissionKind, PermissionResponse};
use tauri::{Manager, Url, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_opener::OpenerExt;

const APP_URL: &str = "https://sharr.calirko.com";

// Debug builds can point at a local server, e.g. SHARR_URL=http://localhost:5173
fn app_url() -> Url {
    let url = if cfg!(debug_assertions) {
        std::env::var("SHARR_URL").unwrap_or_else(|_| APP_URL.into())
    } else {
        APP_URL.into()
    };
    url.parse().expect("invalid app url")
}

// Discord's login page has to open in the app so the session cookie lands here
fn allowed_in_app(url: &Url, app: &Url) -> bool {
    url.origin() == app.origin()
        || url.host_str() == Some("discord.com")
        || url.scheme() == "about"
}

#[derive(serde::Serialize)]
struct DesktopInfo {
    version: String,
    os: &'static str,
}

#[tauri::command]
fn desktop_info(app: tauri::AppHandle) -> DesktopInfo {
    DesktopInfo {
        version: app.package_info().version.to_string(),
        os: std::env::consts::OS,
    }
}

fn cef() -> tauri_runtime_cef::Cef {
    let cef = tauri_runtime_cef::Cef::default().persist_session_cookies(true);
    // For driving the app from tests: SHARR_DEVTOOLS_PORT=9222
    #[cfg(debug_assertions)]
    if let Some(port) = std::env::var("SHARR_DEVTOOLS_PORT").ok().and_then(|p| p.parse().ok()) {
        return cef.remote_debugging(tauri_runtime_cef::RemoteDebugging::Port { port, allowed_origins: vec![] });
    }
    cef
}

pub fn run() {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("sharr_lib=info")).init();
    let url = app_url();

    tauri::Builder::default()
        .runtime(cef())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .manage(update::Pending::default())
        .invoke_handler(tauri::generate_handler![
            desktop_info,
            update::update_pending,
            update::update_install,
        ])
        .on_permission_request({
            let url = url.clone();
            move |webview, kind| {
                let ours = webview.url().map(|u| u.origin() == url.origin()).unwrap_or(false);
                match kind {
                    // System audio comes in as a microphone (see sysaudio)
                    PermissionKind::Microphone if ours => PermissionResponse::Allow,
                    _ => PermissionResponse::Default,
                }
            }
        })
        .setup(move |app| {
            // Only the app's own origin gets IPC
            let origin = url.origin().ascii_serialization();
            app.add_capability(
                CapabilityBuilder::new("app")
                    .remote(format!("{origin}/*"))
                    .window("main")
                    .permission("core:event:default")
                    .permission("allow-desktop-info")
                    .permission("allow-update-pending")
                    .permission("allow-update-install"),
            )?;

            let handle = app.handle().clone();
            let app_origin = url.clone();
            WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url.clone()))
                .title("sharr")
                .inner_size(1280.0, 800.0)
                .min_inner_size(360.0, 480.0)
                .on_navigation(move |to| {
                    if allowed_in_app(to, &app_origin) {
                        return true;
                    }
                    let _ = handle.opener().open_url(to.as_str(), None::<&str>);
                    false
                })
                .build()?;

            update::spawn_check(app.handle().clone());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running sharr");
}

#[cfg(target_os = "linux")]
mod idlefix;
#[cfg(target_os = "linux")]
mod sysaudio;
mod single;
mod update;

// Other platforms get system audio from the browser engine itself
#[cfg(not(target_os = "linux"))]
mod sysaudio {
    #[tauri::command(rename_all = "snake_case")]
    pub fn system_audio_start(include_discord: bool) -> Result<String, String> {
        let _ = include_discord;
        Err("unsupported".into())
    }

    #[tauri::command(rename_all = "snake_case")]
    pub fn system_audio_include_discord(include: bool) {
        let _ = include;
    }

    #[tauri::command]
    pub fn system_audio_stop() {}

    pub fn is_running() -> bool {
        false
    }
}

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

fn cef() -> tauri_runtime_cef::Cef {
    let cef = tauri_runtime_cef::Cef::default()
        .persist_session_cookies(true)
        // The window only shows our own pages, and room audio should play without a click first
        .autoplay(tauri_runtime_cef::AutoplayPolicy::NoUserGestureRequired);
    // With a locked keyring Chromium shows nothing but an unlock prompt until it gets the key.
    // Skip the keyring: the cookie store is then only protected by file permissions, as in most
    // Electron apps. Windows is unaffected and keeps DPAPI.
    let cef = cef.secret_storage(tauri_runtime_cef::SecretStorage::Mock);
    // For driving the app from tests: SHARR_DEVTOOLS_PORT=9222
    #[cfg(debug_assertions)]
    if let Some(port) = std::env::var("SHARR_DEVTOOLS_PORT").ok().and_then(|p| p.parse().ok()) {
        return cef.remote_debugging(tauri_runtime_cef::RemoteDebugging::Port { port, allowed_origins: vec![] });
    }
    cef
}

pub fn run() {
    // CEF runs its helper processes from this binary too
    let helper = std::env::args().any(|a| a.starts_with("--type="));
    if !helper && !single::acquire() {
        return;
    }
    #[cfg(target_os = "linux")]
    sysaudio::use_bundled_pipewire();
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("sharr_lib=info")).init();
    let url = app_url();

    tauri::Builder::default()
        .runtime(cef())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .manage(update::Pending::default())
        .invoke_handler(tauri::generate_handler![
            update::update_pending,
            update::update_install,
            sysaudio::system_audio_start,
            sysaudio::system_audio_stop,
            sysaudio::system_audio_include_discord,
        ])
        // Only our origin can start system audio (IPC is scoped to it), so this lets in just that capture.
        // Don't touch the webview in here: this runs on the main thread and webview getters wait on it.
        .on_permission_request(|_, kind| match kind {
            PermissionKind::Microphone if sysaudio::is_running() => PermissionResponse::Allow,
            _ => PermissionResponse::Default,
        })
        .setup(move |app| {
            log::info!("sharr {}", app.package_info().version);
            #[cfg(target_os = "linux")]
            if idlefix::destroy_chromium_work_source() == 0 {
                log::warn!("Chromium's idle GLib source not found, the main thread may spin");
            }
            // Only the app's own origin gets IPC
            let origin = url.origin().ascii_serialization();
            app.add_capability(
                CapabilityBuilder::new("app")
                    .remote(format!("{origin}/*"))
                    .window("main")
                    .permission("core:event:default")
                    .permission("allow-update-pending")
                    .permission("allow-update-install")
                    .permission("allow-system-audio-start")
                    .permission("allow-system-audio-stop")
                    .permission("allow-system-audio-include-discord"),
            )?;

            update::spawn_check(app.handle().clone());

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

            // For testing a bundle without devtools: SHARR_SYSAUDIO_TEST=1
            #[cfg(all(debug_assertions, target_os = "linux"))]
            if std::env::var_os("SHARR_SYSAUDIO_TEST").is_some() {
                tauri::async_runtime::spawn(async {
                    log::info!("system audio test: {:?}", sysaudio::system_audio_start(true).await);
                });
            }

            single::set_app(app.handle().clone());
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building sharr")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                update::install_on_exit(app);
            }
        });
}

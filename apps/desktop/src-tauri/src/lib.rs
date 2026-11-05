#[cfg(target_os = "linux")]
mod idlefix;
#[cfg(target_os = "linux")]
mod sysaudio;
#[cfg(windows)]
#[path = "sysaudio_windows.rs"]
mod sysaudio;
mod link;
mod login;
mod offline;
mod picker;
mod sharebar;
mod single;
mod update;

// Other platforms get system audio from the browser engine itself
#[cfg(not(any(target_os = "linux", windows)))]
mod sysaudio {
    #[tauri::command]
    pub fn system_audio_available() -> bool {
        false
    }

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
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_opener::OpenerExt;
use tauri_runtime_cef::{FrameEventKind, WebviewWindowBuilderCefExt};

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

// Everything else, Discord login included, opens in the system browser (see login.rs)
fn allowed_in_app(url: &Url, app: &Url) -> bool {
    url.origin() == app.origin() || url.origin() == offline::page().origin() || url.scheme() == "about"
}

// For the small version label in the page
#[tauri::command]
fn app_version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

fn cef() -> tauri_runtime_cef::Cef {
    let cef = tauri_runtime_cef::Cef::default()
        .persist_session_cookies(true)
        // The window only shows our own pages, and room audio should play without a click first
        .autoplay(tauri_runtime_cef::AutoplayPolicy::NoUserGestureRequired)
        // Only our own pages load here, so no Safe Browsing list updates, and no print preview
        .safe_browsing(false)
        .profile_preference("printing.enabled", false);
    // Chromium encodes WebRTC video in software on Linux unless VA-API encoding is turned on.
    // Windows uses Media Foundation's hardware H.264 encoder by default.
    #[cfg(target_os = "linux")]
    let cef = cef.enable_features(["AcceleratedVideoEncoder", "VaapiVideoEncoder", "VaapiOnNvidiaGPUs"]);
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
    // The system audio probe, run by the app itself in a child process (sysaudio_windows.rs)
    #[cfg(windows)]
    if std::env::args().any(|a| a == sysaudio::PROBE_ARG) {
        sysaudio::probe_main();
    }
    // CEF runs its helper processes from this binary too
    let helper = std::env::args().any(|a| a.starts_with("--type="));
    let link = if helper { None } else { link::from_args() };
    if !helper && !single::acquire(link.as_deref()) {
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
        // Replaces the page's window.Notification with the platform's own notifications
        .plugin(tauri_plugin_notification::init())
        .manage(update::Pending::default())
        .manage(login::AppUrl(url.clone()))
        .manage(offline::Offline::default())
        .invoke_handler(tauri::generate_handler![
            update::update_pending,
            update::update_install,
            login::browser_login,
            offline::offline_retry,
            offline::offline_check,
            app_version,
            sharebar::hide_share_bar,
            picker::capture_picker_available,
            picker::capture_sources,
            picker::capture_arm,
            picker::capture_disarm,
            sysaudio::system_audio_available,
            sysaudio::system_audio_start,
            sysaudio::system_audio_stop,
            sysaudio::system_audio_include_discord,
        ])
        // Only our origin can start system audio (IPC is scoped to it), so this lets in just that capture.
        // Don't touch the webview in here: this runs on the main thread and webview getters wait on it.
        .on_permission_request(|_, kind| match kind {
            PermissionKind::Microphone if sysaudio::is_running() => PermissionResponse::Allow,
            // The source the user just picked in our picker (picker.rs)
            PermissionKind::DisplayCapture if picker::armed() => PermissionResponse::Allow,
            // Chat and join notifications, opt in from the settings dialog
            PermissionKind::Notifications => PermissionResponse::Allow,
            _ => PermissionResponse::Default,
        })
        .setup(move |app| {
            log::info!("sharr {}", app.package_info().version);
            #[cfg(target_os = "linux")]
            if idlefix::destroy_chromium_work_source() == 0 {
                log::warn!("Chromium's idle GLib source not found, the main thread may spin");
            }
            // Only the app's own origin gets IPC, plus our bundled pages (local, the default)
            let origin = url.origin().ascii_serialization();
            app.add_capability(
                CapabilityBuilder::new("app")
                    .remote(format!("{origin}/*"))
                    .window("main")
                    .permission("core:event:default")
                    .permission("allow-update-pending")
                    .permission("allow-update-install")
                    .permission("allow-browser-login")
                    .permission("allow-offline-retry")
                    .permission("allow-hide-share-bar")
                    .permission("allow-capture-picker-available")
                    .permission("allow-capture-sources")
                    .permission("allow-capture-arm")
                    .permission("allow-capture-disarm")
                    .permission("allow-system-audio-available")
                    .permission("allow-system-audio-start")
                    .permission("allow-system-audio-stop")
                    .permission("allow-system-audio-include-discord")
                    .permission("notification:allow-notify")
                    .permission("notification:allow-is-permission-granted")
                    .permission("notification:allow-request-permission")
                    // The page draws the title bar (TitleBar.tsx)
                    .permission("core:window:allow-is-decorated")
                    .permission("core:window:allow-is-maximized")
                    .permission("core:window:allow-minimize")
                    .permission("core:window:allow-toggle-maximize")
                    .permission("core:window:allow-internal-toggle-maximize")
                    .permission("core:window:allow-close")
                    .permission("core:window:allow-start-dragging")
                    .permission("core:window:allow-start-resize-dragging"),
            )?;

            // A click on a notification brings the window back, like the page's own did
            let handle = app.handle().clone();
            app.notification().on_action(move |_| {
                if let Some(w) = handle.get_webview_window("main") {
                    let _ = w.unminimize();
                    let _ = w.show();
                    let _ = w.set_focus();
                }
            })?;

            update::spawn_check(app.handle().clone());
            // Debug builds would take the links away from the installed app
            if !cfg!(debug_assertions) {
                link::register();
            }

            let handle = app.handle().clone();
            let failed = app.handle().clone();
            let loaded = app.handle().clone();
            let app_origin = url.clone();
            let start = link::target(&url, link.as_deref());
            WebviewWindowBuilder::new(app, "main", WebviewUrl::External(start))
                .title("sharr")
                .inner_size(1280.0, 800.0)
                .min_inner_size(360.0, 480.0)
                // The page draws its own title bar
                .decorations(false)
                // winit fakes the shadow on Windows by moving the client area 1px down, which
                // leaves a black line along the top
                .shadow(!cfg!(windows))
                .on_navigation(move |to| {
                    if allowed_in_app(to, &app_origin) {
                        return true;
                    }
                    let _ = handle.opener().open_url(to.as_str(), None::<&str>);
                    false
                })
                // Chromium's error page and Cloudflare's 5xx pages give way to offline.html
                .on_frame_event(move |e| {
                    if let (true, FrameEventKind::NavigationFailed { url }) = (e.is_main, e.kind) {
                        offline::check(&failed, url, true);
                    }
                })
                .on_page_load(move |_, p| {
                    if p.event() == tauri::webview::PageLoadEvent::Finished {
                        offline::check(&loaded, p.url().clone(), false);
                    }
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

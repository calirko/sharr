// One app at a time. Chromium refuses a second browser process on the same profile anyway,
// so a second launch just wakes the first one up and exits.

use std::sync::OnceLock;

use interprocess::local_socket::{prelude::*, GenericNamespaced, ListenerOptions, Stream};
use tauri::{AppHandle, Manager};

static APP: OnceLock<AppHandle> = OnceLock::new();

fn name() -> String {
    let user = std::env::var("USER").or_else(|_| std::env::var("USERNAME")).unwrap_or_default();
    format!("com.calirko.sharr-{user}.sock")
}

/// Returns false when another instance is running (and has been told to show itself)
pub fn acquire() -> bool {
    let Ok(name) = name().to_ns_name::<GenericNamespaced>() else { return true };
    let listener = match ListenerOptions::new().name(name.clone()).create_sync() {
        Ok(l) => l,
        Err(e) if e.kind() == std::io::ErrorKind::AddrInUse => {
            let _ = Stream::connect(name);
            return false;
        }
        // No socket, no guard. Chromium still stops a second instance.
        Err(_) => return true,
    };
    std::thread::spawn(move || {
        for conn in listener.incoming() {
            drop(conn);
            if let Some(win) = APP.get().and_then(|a| a.get_webview_window("main")) {
                let _ = win.unminimize();
                let _ = win.show();
                let _ = win.set_focus();
            }
        }
    });
    true
}

pub fn set_app(app: AppHandle) {
    let _ = APP.set(app);
}

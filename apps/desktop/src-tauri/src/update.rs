use std::sync::Mutex;

use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_updater::{Update, UpdaterExt};

// A downloaded update waits here until the user restarts from the web app's toast, or quits
#[derive(Default)]
pub struct Pending(Mutex<Option<(Update, Vec<u8>)>>);

pub fn spawn_check(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        if let Err(err) = check(&app).await {
            log::warn!("update check failed: {err}");
        }
    });
}

async fn check(app: &AppHandle) -> tauri_plugin_updater::Result<()> {
    let Some(update) = app.updater()?.check().await? else {
        log::info!("no update");
        return Ok(());
    };
    log::info!("downloading update {}", update.version);
    let bytes = update.download(|_, _| {}, || {}).await?;
    let version = update.version.clone();
    *app.state::<Pending>().0.lock().unwrap() = Some((update, bytes));
    log::info!("update {version} ready");
    let _ = app.emit("update-ready", &version);
    Ok(())
}

#[tauri::command]
pub fn update_pending(pending: State<Pending>) -> Option<String> {
    pending.0.lock().unwrap().as_ref().map(|(u, _)| u.version.clone())
}

#[tauri::command]
pub fn update_install(app: AppHandle, pending: State<Pending>) -> Result<(), String> {
    let Some((update, bytes)) = pending.0.lock().unwrap().take() else {
        return Err("no_update".into());
    };
    update.install(bytes).map_err(|e| e.to_string())?;
    app.restart();
}

// Quitting with an update downloaded applies it, so the next start is up to date
pub fn install_on_exit(app: &AppHandle) {
    let Some((update, bytes)) = app.state::<Pending>().0.lock().unwrap().take() else { return };
    log::info!("installing update {} on exit", update.version);
    if let Err(err) = update.install(bytes) {
        log::warn!("update install failed: {err}");
    }
}

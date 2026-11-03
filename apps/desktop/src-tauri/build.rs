fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&["update_pending", "update_install", "browser_login", "hide_share_bar", "system_audio_available", "system_audio_start", "system_audio_stop", "system_audio_include_discord"]),
    ))
    .expect("failed to run tauri-build");
}

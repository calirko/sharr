fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&["update_pending", "update_install", "system_audio_start", "system_audio_stop", "system_audio_include_discord"]),
    ))
    .expect("failed to run tauri-build");
}

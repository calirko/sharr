fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&["desktop_info", "update_pending", "update_install", "system_audio_start", "system_audio_stop"]),
    ))
    .expect("failed to run tauri-build");
}

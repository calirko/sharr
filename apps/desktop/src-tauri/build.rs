fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&["desktop_info", "update_pending", "update_install"]),
    ))
    .expect("failed to run tauri-build");
}

// sharr:// links, so a browser can hand a room over to the app. "Open in app" on the web links to
// sharr://r/<room id>. The scheme is registered for the current user on every launch, since an
// AppImage has no installer and may have moved since the last run.

use tauri::Url;

const SCHEME: &str = "sharr";

/// The app path a sharr:// link points at: "/r/<id>" for a room, "/" for anything else
pub fn path_from_link(link: &str) -> Option<String> {
    let rest = link.strip_prefix("sharr://")?;
    let mut parts = rest.trim_matches('/').split('/');
    match (parts.next(), parts.next(), parts.next()) {
        (Some("r"), Some(id), None) if valid_id(id) => Some(format!("/r/{id}")),
        _ => Some("/".into()),
    }
}

// Room ids are short base64url strings (randomId in apps/server)
fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 32 && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

/// The first sharr:// link among the command line arguments
pub fn from_args() -> Option<String> {
    std::env::args().skip(1).find(|a| a.starts_with("sharr://"))
}

/// The app url for a link, or the app's start page
pub fn target(app: &Url, link: Option<&str>) -> Url {
    link.and_then(path_from_link).and_then(|p| app.join(&p).ok()).unwrap_or_else(|| app.clone())
}

pub fn register() {
    std::thread::spawn(|| {
        if let Err(e) = register_os() {
            log::warn!("could not register {SCHEME}:// links: {e}");
        }
    });
}

#[cfg(target_os = "linux")]
fn register_os() -> Result<(), String> {
    use std::path::PathBuf;
    use std::process::Command;

    let exe = match std::env::var_os("APPIMAGE") {
        Some(p) => PathBuf::from(p),
        None => std::env::current_exe().map_err(|e| e.to_string())?,
    };
    let data = std::env::var_os("XDG_DATA_HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".local/share")))
        .ok_or("no data dir")?;
    let dir = data.join("applications");
    let name = "sharr-url-handler.desktop";
    let file = dir.join(name);

    // Desktop entry quoting: wrap in quotes, backslash the few special characters
    let mut quoted = String::from("\"");
    for c in exe.to_string_lossy().chars() {
        if matches!(c, '"' | '`' | '$' | '\\') {
            quoted.push('\\');
        }
        quoted.push(c);
    }
    quoted.push('"');
    let entry = format!(
        "[Desktop Entry]\nType=Application\nName=sharr\nExec={quoted} %u\nIcon=sharr\nNoDisplay=true\nTerminal=false\nMimeType=x-scheme-handler/{SCHEME};\n"
    );
    if std::fs::read_to_string(&file).ok().as_deref() == Some(entry.as_str()) {
        return Ok(());
    }
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    std::fs::write(&file, entry).map_err(|e| e.to_string())?;

    // The AppImage's own libraries must not leak into the system tools
    let run = |cmd: &str, args: &[&str]| {
        Command::new(cmd).args(args).env_remove("LD_LIBRARY_PATH").env_remove("LD_PRELOAD").status()
    };
    let mime = format!("x-scheme-handler/{SCHEME}");
    let status = run("xdg-mime", &["default", name, &mime]).map_err(|e| format!("xdg-mime: {e}"))?;
    if !status.success() {
        return Err(format!("xdg-mime: {status}"));
    }
    let _ = run("update-desktop-database", &[&dir.to_string_lossy()]);
    log::info!("registered {SCHEME}:// links");
    Ok(())
}

#[cfg(windows)]
fn register_os() -> Result<(), String> {
    use windows_registry::CURRENT_USER;

    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let exe = exe.to_string_lossy();
    fn e(err: impl std::fmt::Display) -> String {
        err.to_string()
    }
    let root = CURRENT_USER.create(format!("Software\\Classes\\{SCHEME}")).map_err(e)?;
    root.set_string("", "URL:sharr").map_err(e)?;
    root.set_string("URL Protocol", "").map_err(e)?;
    root.create("DefaultIcon").map_err(e)?.set_string("", format!("\"{exe}\",0")).map_err(e)?;
    root.create("shell\\open\\command").map_err(e)?.set_string("", format!("\"{exe}\" \"%1\"")).map_err(e)?;
    Ok(())
}

#[cfg(not(any(target_os = "linux", windows)))]
fn register_os() -> Result<(), String> {
    Ok(())
}

// Discord login happens in the system browser, not in the app window. The browser, logged in
// to sharr, sends a one-time code to a listener on 127.0.0.1 (see /desktop-login in apps/web),
// and the page in the app trades it for its own session.

use std::time::Duration;

use tauri::{AppHandle, Manager, State, Url};
use tauri_plugin_opener::OpenerExt;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

const WAIT: Duration = Duration::from_secs(300);

/// The web app's URL, for building the browser link
pub struct AppUrl(pub Url);

#[tauri::command]
pub async fn browser_login(app: AppHandle, url: State<'_, AppUrl>) -> Result<String, String> {
    let listener = TcpListener::bind("127.0.0.1:0").await.map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let state = random_state();

    let mut link = url.0.join("/desktop-login").map_err(|e| e.to_string())?;
    link.query_pairs_mut().append_pair("port", &port.to_string()).append_pair("state", &state);
    app.opener().open_url(link.as_str(), None::<&str>).map_err(|e| e.to_string())?;

    let mut done = url.0.join("/desktop-login").map_err(|e| e.to_string())?;
    done.set_query(Some("done=1"));
    let code = tokio::time::timeout(WAIT, wait_for_code(&listener, &state, done.as_str()))
        .await
        .map_err(|_| "timeout".to_string())?;

    if let Some(win) = app.get_webview_window("main") {
        let _ = win.unminimize();
        let _ = win.set_focus();
    }
    Ok(code)
}

// Answers requests until one carries our state and a code, and sends that one back to the web
// app's "you're logged in" page. Anything else (favicon, a stray request, a code meant for
// another attempt) gets a 404 and is ignored.
async fn wait_for_code(listener: &TcpListener, state: &str, done: &str) -> String {
    loop {
        let Ok((mut conn, _)) = listener.accept().await else { continue };
        let Ok(Some(head)) = tokio::time::timeout(Duration::from_secs(5), read_head(&mut conn)).await else {
            continue;
        };
        let request = String::from_utf8_lossy(&head);
        let code = request
            .lines()
            .next()
            .and_then(|line| line.split_whitespace().nth(1))
            .and_then(|path| Url::parse(&format!("http://127.0.0.1{path}")).ok())
            .and_then(|u| {
                let get = |k: &str| u.query_pairs().find(|(key, _)| key == k).map(|(_, v)| v.into_owned());
                (get("state").as_deref() == Some(state)).then(|| get("code")).flatten()
            });
        let response = match &code {
            Some(_) => format!("HTTP/1.1 302 Found\r\nLocation: {done}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"),
            None => "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".into(),
        };
        let _ = conn.write_all(response.as_bytes()).await;
        if let Some(code) = code {
            return code;
        }
    }
}

// Reads up to the end of the headers. Answering before that and closing would reset the
// connection while the browser is still sending.
async fn read_head(conn: &mut tokio::net::TcpStream) -> Option<Vec<u8>> {
    let mut head = Vec::new();
    let mut buf = [0u8; 1024];
    while !head.windows(4).any(|w| w == b"\r\n\r\n") {
        let n = conn.read(&mut buf).await.ok()?;
        if n == 0 || head.len() > 16 * 1024 {
            return None;
        }
        head.extend_from_slice(&buf[..n]);
    }
    Some(head)
}

fn random_state() -> String {
    let mut bytes = [0u8; 16];
    getrandom::fill(&mut bytes).expect("no randomness");
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};

    fn get(port: u16, path: &str) -> String {
        let mut s = std::net::TcpStream::connect(("127.0.0.1", port)).unwrap();
        write!(s, "GET {path} HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n").unwrap();
        let mut out = String::new();
        s.read_to_string(&mut out).unwrap();
        out.lines().next().unwrap_or("").to_owned()
    }

    #[test]
    fn takes_only_the_matching_state() {
        tauri::async_runtime::block_on(async {
            let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
            let port = listener.local_addr().unwrap().port();
            let client = std::thread::spawn(move || {
                [
                    get(port, "/favicon.ico"),
                    get(port, "/?code=evil&state=nope"),
                    get(port, "/?code=good&state=abc"),
                ]
            });
            assert_eq!(wait_for_code(&listener, "abc", "https://example.invalid/done").await, "good");
            let statuses = client.join().unwrap();
            assert!(statuses[0].contains("404") && statuses[1].contains("404") && statuses[2].contains("302"));
        });
    }
}

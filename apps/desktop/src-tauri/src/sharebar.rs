// Chromium shows a "<host> is sharing your screen" bar for every capture, and only skips it when
// it skips the source picker too. The room has its own Stop button, so on Windows we hide the bar:
// it's a top-level window of ours whose title holds the app's host in every language.

#[cfg(windows)]
#[tauri::command]
pub async fn hide_share_bar(window: tauri::WebviewWindow) {
    use windows::core::BOOL;
    use windows::Win32::Foundation::{HWND, LPARAM};
    use windows::Win32::System::Threading::GetCurrentProcessId;
    use windows::Win32::UI::WindowsAndMessaging::{
        EnumWindows, GetClassNameW, GetWindowTextW, GetWindowThreadProcessId, IsWindowVisible, ShowWindow, SW_HIDE,
    };

    struct Search {
        main: isize,
        host: Vec<u16>,
        found: bool,
    }

    unsafe extern "system" fn visit(hwnd: HWND, data: LPARAM) -> BOOL {
        let search = unsafe { &mut *(data.0 as *mut Search) };
        let mut pid = 0;
        unsafe { GetWindowThreadProcessId(hwnd, Some(&mut pid)) };
        if pid != unsafe { GetCurrentProcessId() } || hwnd.0 as isize == search.main || !unsafe { IsWindowVisible(hwnd) }.as_bool() {
            return true.into();
        }
        let mut class = [0u16; 64];
        let n = unsafe { GetClassNameW(hwnd, &mut class) } as usize;
        if !String::from_utf16_lossy(&class[..n]).starts_with("Chrome_WidgetWin") {
            return true.into();
        }
        let mut title = [0u16; 512];
        let n = unsafe { GetWindowTextW(hwnd, &mut title) } as usize;
        if title[..n].windows(search.host.len()).any(|w| w == search.host.as_slice()) {
            let _ = unsafe { ShowWindow(hwnd, SW_HIDE) };
            search.found = true;
        }
        true.into()
    }

    let Ok(main) = window.hwnd() else { return };
    let Some(host) = window.url().ok().and_then(|u| u.host_str().map(str::to_owned)) else { return };
    let mut search = Search { main: main.0 as isize, host: host.encode_utf16().collect(), found: false };
    // The bar shows up around when the capture starts, give it a few seconds
    for _ in 0..40 {
        let _ = unsafe { EnumWindows(Some(visit), LPARAM(&mut search as *mut Search as isize)) };
        if search.found {
            return;
        }
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    }
}

#[cfg(not(windows))]
#[tauri::command]
pub async fn hide_share_bar() {}

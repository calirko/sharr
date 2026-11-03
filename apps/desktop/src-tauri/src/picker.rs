// Our own screen and window picker in place of Chromium's (Windows only, Linux keeps the portal's).
//
// The page lists the sources from here and draws the dialog. After a pick it arms the grant and
// calls getUserMedia with chromeMediaSource "desktop" and the source's id, which CEF hands to
// the permission handler as desktop capture (lib.rs). That grant only holds while armed, so the
// page can't capture without a pick. The ids are Chromium's DesktopMediaID strings: screens by
// their EnumDisplayDevices index (what WebRTC's screen capturers use), windows by HWND.

use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Serialize;

#[derive(Serialize)]
pub struct Source {
    id: String,
    kind: &'static str,
    name: String,
    // JPEG data URL, none for minimized windows
    thumb: Option<String>,
}

static ARMED: Mutex<Option<Instant>> = Mutex::new(None);

// Long enough for getUserMedia to reach the permission handler
const ARM_FOR: Duration = Duration::from_secs(10);

/// Whether desktop capture may be granted right now
pub fn armed() -> bool {
    ARMED.lock().unwrap().is_some_and(|until| Instant::now() < until)
}

#[tauri::command]
pub fn capture_arm() {
    *ARMED.lock().unwrap() = Some(Instant::now() + ARM_FOR);
}

#[tauri::command]
pub fn capture_disarm() {
    *ARMED.lock().unwrap() = None;
}

#[tauri::command]
pub fn capture_picker_available() -> bool {
    cfg!(windows)
}

#[tauri::command]
pub async fn capture_sources() -> Result<Vec<Source>, String> {
    #[cfg(windows)]
    return tauri::async_runtime::spawn_blocking(win::sources).await.map_err(|e| e.to_string());
    #[cfg(not(windows))]
    Err("unsupported".into())
}

#[cfg(windows)]
mod win {
    use super::Source;
    use base64::Engine;
    use windows::core::{BOOL, PCWSTR};
    use windows::Win32::Foundation::{HWND, LPARAM, RECT};
    use windows::Win32::Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_CLOAKED, DWMWA_EXTENDED_FRAME_BOUNDS};
    use windows::Win32::Graphics::Gdi::*;
    use windows::Win32::Storage::Xps::{PrintWindow, PRINT_WINDOW_FLAGS};
    use windows::Win32::System::Threading::GetCurrentProcessId;
    use windows::Win32::UI::WindowsAndMessaging::*;

    // Thumbnails fit in this box
    const THUMB_W: i32 = 320;
    const THUMB_H: i32 = 180;

    pub fn sources() -> Vec<Source> {
        let mut out = screens();
        let windows = windows();
        // PrintWindow waits on each window's own thread, so ask them all at once
        let thumbs: Vec<Option<String>> = std::thread::scope(|s| {
            let jobs: Vec<_> = windows
                .iter()
                .map(|&(hwnd, _, minimized)| s.spawn(move || if minimized { None } else { window_thumb(hwnd) }))
                .collect();
            jobs.into_iter().map(|j| j.join().ok().flatten()).collect()
        });
        for ((hwnd, name, _), thumb) in windows.into_iter().zip(thumbs) {
            out.push(Source { id: format!("window:{hwnd}:0"), kind: "window", name, thumb });
        }
        out
    }

    fn screens() -> Vec<Source> {
        let mut out = Vec::new();
        let screen = unsafe { GetDC(None) };
        for index in 0.. {
            let mut dev = DISPLAY_DEVICEW { cb: size_of::<DISPLAY_DEVICEW>() as u32, ..Default::default() };
            if !unsafe { EnumDisplayDevicesW(PCWSTR::null(), index, &mut dev, 0) }.as_bool() {
                break;
            }
            if dev.StateFlags.0 & DISPLAY_DEVICE_ATTACHED_TO_DESKTOP.0 == 0 {
                continue;
            }
            let mut mode = DEVMODEW { dmSize: size_of::<DEVMODEW>() as u16, ..Default::default() };
            let thumb = if unsafe { EnumDisplaySettingsW(PCWSTR(dev.DeviceName.as_ptr()), ENUM_CURRENT_SETTINGS, &mut mode) }.as_bool() {
                let pos = unsafe { mode.Anonymous1.Anonymous2.dmPosition };
                thumb(screen, pos.x, pos.y, mode.dmPelsWidth as i32, mode.dmPelsHeight as i32)
            } else {
                None
            };
            let n = out.len() + 1;
            out.push(Source { id: format!("screen:{index}:0"), kind: "screen", name: format!("Screen {n}"), thumb });
        }
        unsafe { ReleaseDC(None, screen) };
        out
    }

    // (hwnd, title, minimized), front to back, roughly the windows a taskbar would show
    fn windows() -> Vec<(isize, String, bool)> {
        unsafe extern "system" fn visit(hwnd: HWND, data: LPARAM) -> BOOL {
            let list = unsafe { &mut *(data.0 as *mut Vec<(isize, String, bool)>) };
            if let Some(name) = shareable(hwnd) {
                list.push((hwnd.0 as isize, name, unsafe { IsIconic(hwnd) }.as_bool()));
            }
            true.into()
        }
        let mut list = Vec::new();
        let _ = unsafe { EnumWindows(Some(visit), LPARAM(&mut list as *mut _ as isize)) };
        list
    }

    fn shareable(hwnd: HWND) -> Option<String> {
        unsafe {
            if !IsWindowVisible(hwnd).as_bool() || IsHungAppWindow(hwnd).as_bool() {
                return None;
            }
            let mut pid = 0;
            GetWindowThreadProcessId(hwnd, Some(&mut pid));
            if pid == GetCurrentProcessId() {
                return None;
            }
            let ex = WINDOW_EX_STYLE(GetWindowLongPtrW(hwnd, GWL_EXSTYLE) as u32);
            if ex.contains(WS_EX_TOOLWINDOW) {
                return None;
            }
            let owned = GetWindow(hwnd, GW_OWNER).is_ok_and(|o| !o.is_invalid());
            if owned && !ex.contains(WS_EX_APPWINDOW) {
                return None;
            }
            // Suspended store apps and windows on other virtual desktops
            let mut cloaked = 0u32;
            let _ = DwmGetWindowAttribute(hwnd, DWMWA_CLOAKED, &mut cloaked as *mut _ as _, 4);
            if cloaked != 0 {
                return None;
            }
            let mut class = [0u16; 64];
            let n = GetClassNameW(hwnd, &mut class) as usize;
            if matches!(String::from_utf16_lossy(&class[..n]).as_str(), "Progman" | "WorkerW" | "Shell_TrayWnd") {
                return None;
            }
            let mut title = [0u16; 512];
            let n = GetWindowTextW(hwnd, &mut title) as usize;
            let title = String::from_utf16_lossy(&title[..n]).trim().to_owned();
            (!title.is_empty()).then_some(title)
        }
    }

    fn window_thumb(hwnd: isize) -> Option<String> {
        let hwnd = HWND(hwnd as _);
        unsafe {
            let mut rect = RECT::default();
            GetWindowRect(hwnd, &mut rect).ok()?;
            // The window rect includes invisible resize borders, the frame bounds don't
            let mut frame = rect;
            let _ = DwmGetWindowAttribute(hwnd, DWMWA_EXTENDED_FRAME_BOUNDS, &mut frame as *mut _ as _, size_of::<RECT>() as u32);
            let (w, h) = (rect.right - rect.left, rect.bottom - rect.top);
            if w <= 0 || h <= 0 {
                return None;
            }
            let screen = GetDC(None);
            let dc = CreateCompatibleDC(Some(screen));
            let bmp = CreateCompatibleBitmap(screen, w, h);
            let old = SelectObject(dc, bmp.into());
            let ok = PrintWindow(hwnd, dc, PRINT_WINDOW_FLAGS(PW_RENDERFULLCONTENT)).as_bool();
            let out = ok
                .then(|| {
                    let (x, y) = (frame.left - rect.left, frame.top - rect.top);
                    let (fw, fh) = (frame.right - frame.left, frame.bottom - frame.top);
                    if fw > 0 && fh > 0 && x >= 0 && y >= 0 && x + fw <= w && y + fh <= h {
                        thumb(dc, x, y, fw, fh)
                    } else {
                        thumb(dc, 0, 0, w, h)
                    }
                })
                .flatten();
            SelectObject(dc, old);
            let _ = DeleteObject(bmp.into());
            let _ = DeleteDC(dc);
            ReleaseDC(None, screen);
            out
        }
    }

    // Scales the area of `src` down into a JPEG data URL
    fn thumb(src: HDC, x: i32, y: i32, w: i32, h: i32) -> Option<String> {
        if w <= 0 || h <= 0 {
            return None;
        }
        let scale = (THUMB_W as f64 / w as f64).min(THUMB_H as f64 / h as f64).min(1.0);
        let (tw, th) = (((w as f64 * scale) as i32).max(1), ((h as f64 * scale) as i32).max(1));
        unsafe {
            let info = BITMAPINFO {
                bmiHeader: BITMAPINFOHEADER {
                    biSize: size_of::<BITMAPINFOHEADER>() as u32,
                    biWidth: tw,
                    // Top-down rows
                    biHeight: -th,
                    biPlanes: 1,
                    biBitCount: 32,
                    biCompression: BI_RGB.0,
                    ..Default::default()
                },
                ..Default::default()
            };
            let mut bits = std::ptr::null_mut();
            let dib = CreateDIBSection(Some(src), &info, DIB_RGB_COLORS, &mut bits, None, 0).ok()?;
            let dc = CreateCompatibleDC(Some(src));
            let old = SelectObject(dc, dib.into());
            SetStretchBltMode(dc, HALFTONE);
            let _ = SetBrushOrgEx(dc, 0, 0, None);
            let ok = StretchBlt(dc, 0, 0, tw, th, Some(src), x, y, w, h, SRCCOPY).as_bool();
            let out = ok
                .then(|| {
                    let pixels = std::slice::from_raw_parts(bits as *const u8, (tw * th * 4) as usize);
                    let mut jpeg = Vec::new();
                    jpeg_encoder::Encoder::new(&mut jpeg, 80)
                        .encode(pixels, tw as u16, th as u16, jpeg_encoder::ColorType::Bgra)
                        .ok()?;
                    Some(format!("data:image/jpeg;base64,{}", base64::engine::general_purpose::STANDARD.encode(jpeg)))
                })
                .flatten();
            SelectObject(dc, old);
            let _ = DeleteObject(dib.into());
            let _ = DeleteDC(dc);
            out
        }
    }
}

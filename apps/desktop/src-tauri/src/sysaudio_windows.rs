// System audio for screen shares on Windows, without Discord when asked.
//
// Chromium's picker captures the whole mix minus our own process, and can't leave out anything
// else. WASAPI process loopback (Windows 10 2004+) captures one process tree, and its exclude mode
// only takes one tree, so we capture every other app that has an audio session in include mode
// and mix them here. sharr's own tree (the room's playback) and Discord, when turned off, are
// left out. The mix goes to the page over a channel as 48 kHz stereo s16, where an AudioWorklet
// turns it into a track (see apps/web/public/sysaudio-worklet.js).
//
// Without process loopback the page falls back to the picker's audio (system_audio_available).

use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::{mpsc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use tauri::ipc::{Channel, InvokeResponseBody};
use windows::core::{implement, Interface, Ref, Result as WinResult, HRESULT, IUnknown};
use windows::Win32::Foundation::{CloseHandle, S_OK};
use windows::Win32::Media::Audio::*;
use windows::Win32::System::Com::StructuredStorage::{PROPVARIANT, PROPVARIANT_0, PROPVARIANT_0_0, PROPVARIANT_0_0_0};
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CoUninitialize, IAgileObject, IAgileObject_Impl, BLOB, CLSCTX_ALL,
    COINIT_MULTITHREADED,
};
use windows::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS,
};
use windows::Win32::System::Threading::GetCurrentProcessId;
use windows::Win32::System::Variant::VT_BLOB;

const RATE: usize = 48000;
const CHANNELS: usize = 2;
// Frames per message to the page (20 ms)
const CHUNK: usize = RATE / 50;
// A source plays once it has this much buffered (20 ms), so its jitter doesn't click
const PRIME: usize = RATE / 50;
// and never holds more than this (100 ms)
const MAX_FIFO: usize = RATE / 10;

// Desktop Discord clients, matched on the exe name (lowercased)
const DISCORD: &[&str] = &[
    "discord.exe",
    "discordptb.exe",
    "discordcanary.exe",
    "vesktop.exe",
    "legcord.exe",
    "webcord.exe",
    "armcord.exe",
];

enum Msg {
    Quit,
    IncludeDiscord(bool),
}

struct Running {
    tx: mpsc::Sender<Msg>,
    thread: std::thread::JoinHandle<()>,
}

static RUNNING: Mutex<Option<Running>> = Mutex::new(None);
static SUPPORTED: OnceLock<bool> = OnceLock::new();

/// Runs the loopback probe in a child process (see probe_main)
pub const PROBE_ARG: &str = "--sharr-probe-loopback";

/// Whether this Windows has process loopback. Tried once per launch, in a child process: on some
/// machines (VMs without a real audio device, for one) opening the client corrupted the heap and
/// took the whole app down. A crashed child only turns the feature off. Named apart from
/// 0.1.9/0.1.10's system_audio_supported, whose probe crashed, so the page never calls that one.
#[tauri::command]
pub async fn system_audio_available() -> bool {
    if let Some(ok) = SUPPORTED.get() {
        return *ok;
    }
    if cfg!(debug_assertions) && std::env::var_os("SHARR_NO_LOOPBACK").is_some() {
        return *SUPPORTED.get_or_init(|| false);
    }
    let ok = tauri::async_runtime::spawn_blocking(probe).await.unwrap_or(false);
    *SUPPORTED.get_or_init(|| ok)
}

fn probe() -> bool {
    use std::os::windows::process::CommandExt;
    use std::process::{Command, Stdio};
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;

    let child = std::env::current_exe().and_then(|exe| {
        Command::new(exe)
            .arg(PROBE_ARG)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            // Debug builds show the probe's steps in the console
            .stderr(if cfg!(debug_assertions) { Stdio::inherit() } else { Stdio::null() })
            .creation_flags(if cfg!(debug_assertions) { 0 } else { CREATE_NO_WINDOW })
            .spawn()
    });
    let mut child = match child {
        Ok(c) => c,
        Err(e) => {
            log::warn!("loopback probe didn't start ({e}), system audio comes from the picker");
            return false;
        }
    };
    // Activation itself gives up after 3s. Starting the exe (CEF and all) can take a while too.
    let started = Instant::now();
    let deadline = started + Duration::from_secs(15);
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break Some(status),
            Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(20)),
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                break None;
            }
        }
    };
    let ms = started.elapsed().as_millis();
    match status {
        Some(s) if s.success() => {
            log::info!("process loopback available ({ms} ms)");
            true
        }
        Some(s) => {
            // The probe exits with the failing HRESULT. Anything else (0xc0000374, say) is a crash.
            let code = s.code().map(|c| format!("{:#010x}", c as u32)).unwrap_or_else(|| "none".into());
            log::warn!("process loopback unavailable (exit {code}, {ms} ms), system audio comes from the picker");
            false
        }
        None => {
            log::warn!("loopback probe timed out ({ms} ms), system audio comes from the picker");
            false
        }
    }
}

/// The probe child: exits 0 when a process loopback client opens, else with the failing HRESULT
pub fn probe_main() -> ! {
    let code = {
        let _com = Com::init();
        // Released before CoUninitialize. As a tail expression the client outlived _com,
        // which crashed 0.1.9 and 0.1.10.
        let source = Source::open(unsafe { GetCurrentProcessId() });
        if cfg!(debug_assertions) {
            match &source {
                Ok(_) => eprintln!("[probe] process loopback client opened"),
                Err(e) => eprintln!("[probe] failed: {:#010x} {}", e.code().0 as u32, e.message()),
            }
        }
        let code = match &source {
            Ok(_) => 0,
            Err(e) if e.code().0 == 0 => 1,
            Err(e) => e.code().0,
        };
        drop(source);
        code
    };
    std::process::exit(code)
}

#[tauri::command(rename_all = "snake_case")]
pub async fn system_audio_start(include_discord: bool, on_audio: Channel<InvokeResponseBody>) -> Result<String, String> {
    let mut running = RUNNING.lock().unwrap();
    // A share that wasn't stopped cleanly: the page has a new channel, so start over
    if let Some(r) = running.take() {
        let _ = r.tx.send(Msg::Quit);
        let _ = r.thread.join();
    }
    let (tx, rx) = mpsc::channel();
    let (ready_tx, ready_rx) = mpsc::channel();
    let thread = std::thread::spawn(move || {
        if let Err(err) = run(rx, ready_tx.clone(), include_discord, on_audio) {
            log::warn!("system audio stopped: {err}");
            let _ = ready_tx.send(Err(err.to_string()));
        }
    });
    match ready_rx.recv_timeout(Duration::from_secs(5)) {
        Ok(Ok(())) => {
            *running = Some(Running { tx, thread });
            Ok(String::new())
        }
        Ok(Err(err)) => Err(err),
        Err(_) => {
            let _ = tx.send(Msg::Quit);
            Err("timeout".into())
        }
    }
}

#[tauri::command]
pub async fn system_audio_stop() {
    if let Some(r) = RUNNING.lock().unwrap().take() {
        let _ = r.tx.send(Msg::Quit);
        let _ = r.thread.join();
    }
}

/// Changes the Discord setting while sharing
#[tauri::command(rename_all = "snake_case")]
pub async fn system_audio_include_discord(include: bool) {
    if let Some(r) = RUNNING.lock().unwrap().as_ref() {
        let _ = r.tx.send(Msg::IncludeDiscord(include));
    }
}

/// The page doesn't capture a microphone on Windows, so no permission to grant
pub fn is_running() -> bool {
    false
}

struct Com;

impl Com {
    fn init() -> Self {
        let _ = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) };
        Com
    }
}

impl Drop for Com {
    fn drop(&mut self) {
        unsafe { CoUninitialize() };
    }
}

fn run(
    rx: mpsc::Receiver<Msg>,
    ready: mpsc::Sender<Result<(), String>>,
    mut include_discord: bool,
    out: Channel<InvokeResponseBody>,
) -> WinResult<()> {
    let _com = Com::init();
    let own = unsafe { GetCurrentProcessId() };
    let devices: IMMDeviceEnumerator = unsafe { CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)? };

    let mut sources: HashMap<u32, Source> = HashMap::new();
    // Pids that failed to open, retried when their session list entry changes
    let mut failed: HashSet<u32> = HashSet::new();
    let mut last_scan: Option<Instant> = None;
    let mut ready = Some(ready);

    let start = Instant::now();
    let mut emitted = 0usize;
    let mut mix = vec![0f32; CHUNK * CHANNELS];
    let mut pending: Vec<i16> = Vec::with_capacity(CHUNK * CHANNELS * 2);

    loop {
        let mut rescan = last_scan.is_none_or(|t| t.elapsed() >= Duration::from_secs(1));
        while let Ok(msg) = rx.try_recv() {
            match msg {
                Msg::Quit => return Ok(()),
                Msg::IncludeDiscord(v) => {
                    include_discord = v;
                    rescan = true;
                }
            }
        }

        if rescan {
            last_scan = Some(Instant::now());
            match wanted(&devices, own, include_discord) {
                Ok(want) => {
                    sources.retain(|pid, _| want.contains(pid));
                    failed.retain(|pid| want.contains(pid));
                    for pid in want {
                        if sources.contains_key(&pid) || failed.contains(&pid) {
                            continue;
                        }
                        match Source::open(pid) {
                            Ok(s) => {
                                log::info!("system audio: capturing pid {pid}");
                                sources.insert(pid, s);
                            }
                            Err(err) => {
                                log::warn!("system audio: can't capture pid {pid}: {err}");
                                failed.insert(pid);
                            }
                        }
                    }
                }
                Err(err) => log::warn!("system audio: listing sessions failed: {err}"),
            }
            if let Some(r) = ready.take() {
                let _ = r.send(Ok(()));
            }
        }

        for s in sources.values_mut() {
            if let Err(err) = s.drain() {
                log::warn!("system audio: capture failed: {err}");
                s.dead = true;
            }
        }
        // Dropped here, opened again on the next scan if the app is still there
        sources.retain(|_, s| !s.dead);

        // The wall clock decides how much to send, so the page gets a steady rate
        let mut due = (start.elapsed().as_micros() as usize * RATE / 1_000_000).saturating_sub(emitted);
        // After a stall, skip ahead instead of sending a burst
        if due > RATE / 5 {
            emitted += due - CHUNK;
            due = CHUNK;
        }
        while due > 0 {
            let n = due.min(CHUNK);
            let buf = &mut mix[..n * CHANNELS];
            buf.fill(0.0);
            for s in sources.values_mut() {
                s.mix_into(buf);
            }
            pending.extend(buf.iter().map(|v| (v.clamp(-1.0, 1.0) * 32767.0) as i16));
            emitted += n;
            due -= n;
        }
        while pending.len() >= CHUNK * CHANNELS {
            let bytes: Vec<u8> = pending.drain(..CHUNK * CHANNELS).flat_map(i16::to_le_bytes).collect();
            if out.send(InvokeResponseBody::Raw(bytes)).is_err() {
                // The page is gone
                return Ok(());
            }
        }

        std::thread::sleep(Duration::from_millis(10));
    }
}

/// Pids to capture: every app with an audio session, minus sharr's tree and Discord when off.
/// Include mode takes a whole tree, so a pid whose tree holds one of those is left out too
/// (explorer.exe, say, which launched sharr), as is one whose ancestor is already captured.
fn wanted(devices: &IMMDeviceEnumerator, own: u32, include_discord: bool) -> WinResult<HashSet<u32>> {
    let procs = processes()?;
    let parent = |pid: u32| procs.get(&pid).map(|p| p.0);
    // Ancestors of pid, closest first. Parent pids can be stale, so the walk is bounded.
    let ancestors = |pid: u32| {
        let mut out = Vec::new();
        let mut cur = pid;
        while let Some(p) = parent(cur) {
            if p == 0 || p == pid || out.len() >= 64 {
                break;
            }
            out.push(p);
            cur = p;
        }
        out
    };

    let mut excluded: HashSet<u32> = HashSet::from([own]);
    if !include_discord {
        excluded.extend(procs.iter().filter(|(_, p)| DISCORD.contains(&p.1.as_str())).map(|(pid, _)| *pid));
    }
    let in_excluded_tree = |pid: u32| excluded.contains(&pid) || ancestors(pid).iter().any(|a| excluded.contains(a));
    // Pids with an excluded process below them
    let holds_excluded: HashSet<u32> = excluded.iter().flat_map(|&e| ancestors(e)).collect();

    let candidates: HashSet<u32> = session_pids(devices)?
        .into_iter()
        .filter(|&pid| pid != 0 && !in_excluded_tree(pid) && !holds_excluded.contains(&pid))
        .collect();
    Ok(candidates
        .iter()
        .copied()
        .filter(|&pid| !ancestors(pid).iter().any(|a| candidates.contains(a)))
        .collect())
}

/// Pids of the audio sessions on every active output device
fn session_pids(devices: &IMMDeviceEnumerator) -> WinResult<HashSet<u32>> {
    let mut pids = HashSet::new();
    unsafe {
        let list = devices.EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE)?;
        for i in 0..list.GetCount()? {
            let Ok(device) = list.Item(i) else { continue };
            let Ok(manager) = device.Activate::<IAudioSessionManager2>(CLSCTX_ALL, None) else { continue };
            let Ok(sessions) = manager.GetSessionEnumerator() else { continue };
            for j in 0..sessions.GetCount().unwrap_or(0) {
                let Ok(control) = sessions.GetSession(j) else { continue };
                let Ok(control) = control.cast::<IAudioSessionControl2>() else { continue };
                if control.IsSystemSoundsSession() == S_OK {
                    continue;
                }
                if let Ok(pid) = control.GetProcessId() {
                    pids.insert(pid);
                }
            }
        }
    }
    Ok(pids)
}

/// pid -> (parent pid, lowercased exe name)
fn processes() -> WinResult<HashMap<u32, (u32, String)>> {
    let mut out = HashMap::new();
    unsafe {
        let snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0)?;
        let mut entry = PROCESSENTRY32W { dwSize: size_of::<PROCESSENTRY32W>() as u32, ..Default::default() };
        let mut ok = Process32FirstW(snap, &mut entry).is_ok();
        while ok {
            let len = entry.szExeFile.iter().position(|&c| c == 0).unwrap_or(entry.szExeFile.len());
            let name = String::from_utf16_lossy(&entry.szExeFile[..len]).to_lowercase();
            out.insert(entry.th32ProcessID, (entry.th32ParentProcessID, name));
            ok = Process32NextW(snap, &mut entry).is_ok();
        }
        let _ = CloseHandle(snap);
    }
    Ok(out)
}

/// One app's capture
struct Source {
    client: IAudioClient,
    capture: IAudioCaptureClient,
    fifo: VecDeque<f32>,
    primed: bool,
    dead: bool,
}

impl Source {
    fn open(pid: u32) -> WinResult<Self> {
        let client = activate(pid)?;
        let format = WAVEFORMATEX {
            // WAVE_FORMAT_IEEE_FLOAT
            wFormatTag: 3,
            nChannels: CHANNELS as u16,
            nSamplesPerSec: RATE as u32,
            nAvgBytesPerSec: (RATE * CHANNELS * 4) as u32,
            nBlockAlign: (CHANNELS * 4) as u16,
            wBitsPerSample: 32,
            cbSize: 0,
        };
        unsafe {
            // 200 ms buffer, drained every 10 ms
            client.Initialize(
                AUDCLNT_SHAREMODE_SHARED,
                AUDCLNT_STREAMFLAGS_LOOPBACK | AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM | AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY,
                2_000_000,
                0,
                &format,
                None,
            )?;
            let capture: IAudioCaptureClient = client.GetService()?;
            client.Start()?;
            Ok(Source { client, capture, fifo: VecDeque::new(), primed: false, dead: false })
        }
    }

    fn drain(&mut self) -> WinResult<()> {
        unsafe {
            while self.capture.GetNextPacketSize()? > 0 {
                let mut data = std::ptr::null_mut();
                let mut frames = 0u32;
                let mut flags = 0u32;
                self.capture.GetBuffer(&mut data, &mut frames, &mut flags, None, None)?;
                let n = frames as usize * CHANNELS;
                if flags & AUDCLNT_BUFFERFLAGS_SILENT.0 as u32 != 0 || data.is_null() {
                    self.fifo.extend(std::iter::repeat_n(0.0, n));
                } else {
                    self.fifo.extend(std::slice::from_raw_parts(data as *const f32, n));
                }
                self.capture.ReleaseBuffer(frames)?;
            }
        }
        let max = MAX_FIFO * CHANNELS;
        if self.fifo.len() > max {
            self.fifo.drain(..self.fifo.len() - max);
        }
        Ok(())
    }

    fn mix_into(&mut self, buf: &mut [f32]) {
        if !self.primed {
            if self.fifo.len() < PRIME * CHANNELS {
                return;
            }
            self.primed = true;
        }
        let n = buf.len().min(self.fifo.len());
        for (o, v) in buf.iter_mut().zip(self.fifo.drain(..n)) {
            *o += v;
        }
        // Ran dry: wait for a fresh buffer instead of clicking on every packet
        if self.fifo.is_empty() {
            self.primed = false;
        }
    }
}

impl Drop for Source {
    fn drop(&mut self) {
        let _ = unsafe { self.client.Stop() };
    }
}

#[implement(IActivateAudioInterfaceCompletionHandler, IAgileObject)]
struct Activated(Mutex<Option<mpsc::Sender<()>>>);

impl IActivateAudioInterfaceCompletionHandler_Impl for Activated_Impl {
    fn ActivateCompleted(&self, _op: Ref<IActivateAudioInterfaceAsyncOperation>) -> WinResult<()> {
        if let Some(tx) = self.0.lock().unwrap().take() {
            let _ = tx.send(());
        }
        Ok(())
    }
}

impl IAgileObject_Impl for Activated_Impl {}

/// An audio client for pid's process tree
fn activate(pid: u32) -> WinResult<IAudioClient> {
    let step = |s: &str| {
        if cfg!(debug_assertions) {
            eprintln!("[probe] {s}");
        }
    };
    step(&format!("activating loopback for pid {pid}"));
    let mut params = AUDIOCLIENT_ACTIVATION_PARAMS {
        ActivationType: AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK,
        Anonymous: AUDIOCLIENT_ACTIVATION_PARAMS_0 {
            ProcessLoopbackParams: AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS {
                TargetProcessId: pid,
                ProcessLoopbackMode: PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE,
            },
        },
    };
    let prop = PROPVARIANT {
        Anonymous: PROPVARIANT_0 {
            Anonymous: std::mem::ManuallyDrop::new(PROPVARIANT_0_0 {
                vt: VT_BLOB,
                Anonymous: PROPVARIANT_0_0_0 {
                    blob: BLOB {
                        cbSize: size_of::<AUDIOCLIENT_ACTIVATION_PARAMS>() as u32,
                        pBlobData: &mut params as *mut _ as *mut u8,
                    },
                },
                ..Default::default()
            }),
        },
    };
    let (tx, rx) = mpsc::channel();
    let handler: IActivateAudioInterfaceCompletionHandler = Activated(Mutex::new(Some(tx))).into();
    unsafe {
        let op = ActivateAudioInterfaceAsync(
            VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK,
            &IAudioClient::IID,
            Some(&prop),
            &handler,
        )
        .inspect_err(|e| step(&format!("ActivateAudioInterfaceAsync: {:#010x} {}", e.code().0 as u32, e.message())))?;
        step("waiting for activation");
        rx.recv_timeout(Duration::from_secs(3)).map_err(|_| windows::core::Error::from(HRESULT(0x8000_000Au32 as i32)))?;
        let mut hr = HRESULT(0);
        let mut unknown: Option<IUnknown> = None;
        op.GetActivateResult(&mut hr, &mut unknown)?;
        step(&format!("activate result {:#010x}", hr.0 as u32));
        hr.ok()?;
        unknown.ok_or_else(|| windows::core::Error::from(HRESULT(0x8000_4003u32 as i32)))?.cast()
    }
}


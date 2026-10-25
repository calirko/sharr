// System audio for screen shares on Linux, where browsers can't capture it.
//
// Creates a virtual PipeWire source and links every app's audio output into it, except sharr's
// own playback (the room's audio), so viewers don't hear themselves back. The page captures the
// source as a microphone and publishes it as the share's audio. Same idea as Vesktop's venmic.
// Discord can be left out too, so a call doesn't end up in the share.

use std::cell::RefCell;
use std::collections::HashMap;
use std::rc::Rc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Mutex};
use std::time::Duration;

use pipewire as pw;
use pw::types::ObjectType;

/// What the page looks for in enumerateDevices()
pub const LABEL: &str = "sharr system audio";

enum Msg {
    Quit,
    IncludeDiscord(bool),
}

struct Running {
    tx: pw::channel::Sender<Msg>,
    thread: std::thread::JoinHandle<()>,
}

// Desktop Discord clients, matched on application.process.binary (lowercased)
const DISCORD: &[&str] = &["discord", "discordcanary", "discordptb", "vesktop", "legcord", "webcord", "armcord"];

static RUNNING: Mutex<Option<Running>> = Mutex::new(None);
// Read from the permission handler on the main thread, which must never wait on RUNNING
static ACTIVE: AtomicBool = AtomicBool::new(false);

// Async so the wait for PipeWire runs off the main thread
#[tauri::command(rename_all = "snake_case")]
pub async fn system_audio_start(include_discord: bool) -> Result<String, String> {
    let mut running = RUNNING.lock().unwrap();
    if let Some(r) = running.as_ref() {
        let _ = r.tx.send(Msg::IncludeDiscord(include_discord));
        return Ok(LABEL.into());
    }
    let (tx, rx) = pw::channel::channel();
    let (ready_tx, ready_rx) = mpsc::channel();
    let thread = std::thread::spawn(move || {
        if let Err(err) = run(rx, ready_tx.clone(), include_discord) {
            log::warn!("system audio stopped: {err}");
            let _ = ready_tx.send(Err(err.to_string()));
        }
    });
    match ready_rx.recv_timeout(Duration::from_secs(5)) {
        Ok(Ok(())) => {
            *running = Some(Running { tx, thread });
            ACTIVE.store(true, Ordering::Relaxed);
            Ok(LABEL.into())
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
    ACTIVE.store(false, Ordering::Relaxed);
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

/// The AppImage ships its own libpipewire. Point it at the modules bundled with it
/// (scripts/appimage-libs.sh), the host's may not match its version. Call before any threads start.
pub fn use_bundled_pipewire() {
    let Some(dir) = std::env::var_os("APPDIR").map(|d| std::path::PathBuf::from(d).join("pipewire")) else {
        return;
    };
    if dir.is_dir() {
        std::env::set_var("SPA_PLUGIN_DIR", dir.join("spa-0.2"));
        std::env::set_var("PIPEWIRE_MODULE_DIR", dir.join("pipewire-0.3"));
        std::env::set_var("PIPEWIRE_CONFIG_DIR", dir.join("config"));
    }
}

pub fn is_running() -> bool {
    ACTIVE.load(Ordering::Relaxed)
}

#[derive(Clone)]
struct Port {
    node: u32,
    output: bool,
    channel: String,
}

#[derive(Default)]
struct State {
    sink: Option<u32>,
    // Nodes whose output goes into the sink, and whether each is Discord
    sources: HashMap<u32, bool>,
    include_discord: bool,
    bound: HashMap<u32, (pw::node::Node, pw::node::NodeListener)>,
    ports: HashMap<u32, Port>,
    // Keyed by (output port, input port)
    links: HashMap<(u32, u32), pw::link::Link>,
}

fn run(
    rx: pw::channel::Receiver<Msg>,
    ready: mpsc::Sender<Result<(), String>>,
    include_discord: bool,
) -> Result<(), pw::Error> {
    pw::init();
    let mainloop = pw::main_loop::MainLoopRc::new(None)?;
    let context = pw::context::ContextRc::new(&mainloop, None)?;
    let core = context.connect_rc(None)?;
    let registry = core.get_registry_rc()?;

    let node_name = format!("sharr-system-audio-{}", std::process::id());
    let _sink: pw::node::Node = core.create_object(
        "adapter",
        &pw::properties::properties! {
            "factory.name" => "support.null-audio-sink",
            "node.name" => node_name.as_str(),
            "node.description" => LABEL,
            "media.class" => "Audio/Source/Virtual",
            "audio.position" => "FL,FR",
            "object.linger" => "false",
        },
    )?;

    let state = Rc::new(RefCell::new(State { include_discord, ..Default::default() }));
    let ready = RefCell::new(Some(ready));

    let _listener = registry
        .add_listener_local()
        .global({
            let state = state.clone();
            let core = core.clone();
            let registry = registry.clone();
            move |global| {
                let Some(props) = global.props else { return };
                let mut s = state.borrow_mut();
                match global.type_ {
                    ObjectType::Node => {
                        if props.get("node.name") == Some(node_name.as_str()) {
                            s.sink = Some(global.id);
                        } else if props.get("media.class") == Some("Stream/Output/Audio") {
                            // The registry leaves out the app's pid, the full node info has it
                            let Ok(node) = registry.bind::<pw::node::Node, _>(global) else { return };
                            let id = global.id;
                            let listener = node
                                .add_listener_local()
                                .info({
                                    let state = state.clone();
                                    let core = core.clone();
                                    move |info| {
                                        // Later events only carry what changed
                                        if !info.change_mask().contains(pw::node::NodeChangeMask::PROPS) {
                                            return;
                                        }
                                        let props = info.props();
                                        let pid = props
                                            .and_then(|p| p.get("application.process.id"))
                                            .and_then(|p| p.parse().ok());
                                        let discord = props
                                            .and_then(|p| p.get("application.process.binary"))
                                            .is_some_and(|b| DISCORD.contains(&b.to_lowercase().as_str()));
                                        let mut s = state.borrow_mut();
                                        if pid.is_some_and(is_ours) {
                                            s.sources.remove(&id);
                                        } else if s.sources.insert(id, discord).is_none() {
                                            link_all(&mut s, &core);
                                        }
                                    }
                                })
                                .register();
                            s.bound.insert(id, (node, listener));
                        }
                    }
                    ObjectType::Port => {
                        if props.get("port.monitor") == Some("true") {
                            return;
                        }
                        let (Some(node), Some(dir)) = (props.get("node.id"), props.get("port.direction")) else {
                            return;
                        };
                        let Ok(node) = node.parse() else { return };
                        let port = Port {
                            node,
                            output: dir == "out",
                            channel: props.get("audio.channel").unwrap_or("MONO").to_owned(),
                        };
                        s.ports.insert(global.id, port);
                        link_all(&mut s, &core);
                        if s.sink_inputs().len() == 2 {
                            if let Some(tx) = ready.borrow_mut().take() {
                                let _ = tx.send(Ok(()));
                            }
                        }
                    }
                    _ => {}
                }
            }
        })
        .global_remove({
            let state = state.clone();
            move |id| {
                let mut s = state.borrow_mut();
                s.sources.remove(&id);
                s.bound.remove(&id);
                s.ports.remove(&id);
                s.links.retain(|(out, inp), _| *out != id && *inp != id);
            }
        })
        .register();

    let _rx = rx.attach(mainloop.loop_(), {
        let mainloop = mainloop.clone();
        let state = state.clone();
        move |msg| match msg {
            Msg::Quit => mainloop.quit(),
            Msg::IncludeDiscord(include) => {
                let mut s = state.borrow_mut();
                s.include_discord = include;
                if include {
                    link_all(&mut s, &core);
                } else {
                    unlink_discord(&mut s, &core);
                }
            }
        }
    });

    mainloop.run();
    // The info listeners hold the state that holds them. Break that so the connection closes,
    // which takes the virtual source and its links with it.
    let mut s = state.borrow_mut();
    s.bound.clear();
    s.links.clear();
    Ok(())
}

impl State {
    fn captured(&self, node: u32) -> bool {
        self.sources.get(&node).is_some_and(|&discord| self.include_discord || !discord)
    }

    fn sink_inputs(&self) -> Vec<(u32, Port)> {
        let Some(sink) = self.sink else { return vec![] };
        self.ports
            .iter()
            .filter(|(_, p)| p.node == sink && !p.output)
            .map(|(id, p)| (*id, p.clone()))
            .collect()
    }
}

// Links every source output port to the matching sink input. Cheap enough to redo on every new port.
fn link_all(s: &mut State, core: &pw::core::CoreRc) {
    let Some(sink) = s.sink else { return };
    let inputs = s.sink_inputs();
    let outputs: Vec<(u32, Port)> = s
        .ports
        .iter()
        .filter(|(_, p)| p.output && s.captured(p.node))
        .map(|(id, p)| (*id, p.clone()))
        .collect();

    for (out_id, out) in outputs {
        for (in_id, inp) in &inputs {
            if !channel_matches(&out.channel, &inp.channel) || s.links.contains_key(&(out_id, *in_id)) {
                continue;
            }
            let link = core.create_object::<pw::link::Link>(
                "link-factory",
                &pw::properties::properties! {
                    "link.output.node" => out.node.to_string(),
                    "link.output.port" => out_id.to_string(),
                    "link.input.node" => sink.to_string(),
                    "link.input.port" => in_id.to_string(),
                    "object.linger" => "false",
                },
            );
            match link {
                Ok(link) => {
                    s.links.insert((out_id, *in_id), link);
                }
                Err(err) => log::warn!("link failed: {err}"),
            }
        }
    }
}

fn unlink_discord(s: &mut State, core: &pw::core::CoreRc) {
    let drop: Vec<(u32, u32)> = s
        .links
        .keys()
        .filter(|(out, _)| s.ports.get(out).is_some_and(|p| s.sources.get(&p.node) == Some(&true)))
        .copied()
        .collect();
    for key in drop {
        if let Some(link) = s.links.remove(&key) {
            let _ = core.destroy_object(link);
        }
    }
}

// Left channels go left, right go right, everything else (mono, center, LFE) to both
fn channel_matches(out: &str, sink: &str) -> bool {
    let side = |c: &str| match c {
        "FL" | "RL" | "SL" | "FLC" | "RLC" | "TFL" | "TRL" => Some("FL"),
        "FR" | "RR" | "SR" | "FRC" | "RRC" | "TFR" | "TRR" => Some("FR"),
        _ => None,
    };
    side(out).is_none_or(|s| s == sink)
}

// Our own playback runs in a Chromium child process
fn is_ours(mut pid: u32) -> bool {
    let me = std::process::id();
    for _ in 0..32 {
        if pid == me {
            return true;
        }
        if pid <= 1 {
            return false;
        }
        let Ok(stat) = std::fs::read_to_string(format!("/proc/{pid}/stat")) else { return false };
        // The command name can hold spaces, so read past its closing paren
        let Some(ppid) = stat.rsplit_once(')').and_then(|(_, rest)| rest.split_whitespace().nth(1)) else {
            return false;
        };
        let Ok(ppid) = ppid.parse() else { return false };
        pid = ppid;
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    // Needs a PipeWire session. Plays nothing: watch the links from outside (pw-dump) while it runs.
    #[test]
    #[ignore]
    fn discord_toggle() {
        tauri::async_runtime::block_on(async {
            assert_eq!(system_audio_start(false).await.as_deref(), Ok(LABEL));
            std::thread::sleep(Duration::from_secs(3));
            system_audio_include_discord(true).await;
            std::thread::sleep(Duration::from_secs(3));
            system_audio_include_discord(false).await;
            std::thread::sleep(Duration::from_secs(3));
            system_audio_stop().await;
        });
    }
}

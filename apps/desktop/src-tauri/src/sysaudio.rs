// System audio for screen shares on Linux, where browsers can't capture it.
//
// Creates a virtual PipeWire source and links every app's audio output into it, except sharr's
// own playback (the room's audio), so viewers don't hear themselves back. The page captures the
// source as a microphone and publishes it as the share's audio. Same idea as Vesktop's venmic.

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

struct Running {
    quit: pw::channel::Sender<()>,
    thread: std::thread::JoinHandle<()>,
}

static RUNNING: Mutex<Option<Running>> = Mutex::new(None);
// Read from the permission handler on the main thread, which must never wait on RUNNING
static ACTIVE: AtomicBool = AtomicBool::new(false);

// Async so the wait for PipeWire runs off the main thread
#[tauri::command]
pub async fn system_audio_start() -> Result<String, String> {
    let mut running = RUNNING.lock().unwrap();
    if running.is_some() {
        return Ok(LABEL.into());
    }
    let (quit_tx, quit_rx) = pw::channel::channel();
    let (ready_tx, ready_rx) = mpsc::channel();
    let thread = std::thread::spawn(move || {
        if let Err(err) = run(quit_rx, ready_tx.clone()) {
            log::warn!("system audio stopped: {err}");
            let _ = ready_tx.send(Err(err.to_string()));
        }
    });
    match ready_rx.recv_timeout(Duration::from_secs(5)) {
        Ok(Ok(())) => {
            *running = Some(Running { quit: quit_tx, thread });
            ACTIVE.store(true, Ordering::Relaxed);
            Ok(LABEL.into())
        }
        Ok(Err(err)) => Err(err),
        Err(_) => {
            let _ = quit_tx.send(());
            Err("timeout".into())
        }
    }
}

#[tauri::command]
pub async fn system_audio_stop() {
    ACTIVE.store(false, Ordering::Relaxed);
    if let Some(r) = RUNNING.lock().unwrap().take() {
        let _ = r.quit.send(());
        let _ = r.thread.join();
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
    // Nodes whose output goes into the sink
    sources: HashMap<u32, ()>,
    bound: HashMap<u32, (pw::node::Node, pw::node::NodeListener)>,
    ports: HashMap<u32, Port>,
    // Keyed by (output port, input port)
    links: HashMap<(u32, u32), pw::link::Link>,
}

fn run(quit: pw::channel::Receiver<()>, ready: mpsc::Sender<Result<(), String>>) -> Result<(), pw::Error> {
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

    let state = Rc::new(RefCell::new(State::default()));
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
                                        let pid = info
                                            .props()
                                            .and_then(|p| p.get("application.process.id"))
                                            .and_then(|p| p.parse().ok());
                                        let mut s = state.borrow_mut();
                                        if pid.is_some_and(is_ours) {
                                            s.sources.remove(&id);
                                        } else if s.sources.insert(id, ()).is_none() {
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

    let _quit = quit.attach(mainloop.loop_(), {
        let mainloop = mainloop.clone();
        move |_| mainloop.quit()
    });

    mainloop.run();
    Ok(())
}

impl State {
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
        .filter(|(_, p)| p.output && s.sources.contains_key(&p.node))
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

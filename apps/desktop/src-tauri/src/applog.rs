//! Logs to stderr as before, and keeps recent lines for the page to upload to the server
//! (`app_logs`), since release builds on Windows have no console to read them from.

use std::collections::VecDeque;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use log::{Log, Metadata, Record};
use serde::{Deserialize, Serialize};

// Lines kept until the page collects them. Older ones go first.
const KEEP: usize = 500;

#[derive(Serialize, Deserialize)]
pub struct Line {
    ts: u64,
    level: String,
    target: String,
    msg: String,
}

static LINES: Mutex<VecDeque<Line>> = Mutex::new(VecDeque::new());

struct Logger(env_logger::Logger);

impl Log for Logger {
    fn enabled(&self, m: &Metadata) -> bool {
        self.0.enabled(m)
    }

    fn log(&self, r: &Record) {
        if !self.0.matches(r) {
            return;
        }
        self.0.log(r);
        let ts = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0);
        let line = Line { ts, level: r.level().to_string(), target: r.target().into(), msg: r.args().to_string() };
        let mut lines = LINES.lock().unwrap();
        if lines.len() >= KEEP {
            lines.pop_front();
        }
        lines.push_back(line);
    }

    fn flush(&self) {
        self.0.flush();
    }
}

pub fn init() {
    let inner = env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("sharr_lib=info")).build();
    let max = inner.filter();
    if log::set_boxed_logger(Box::new(Logger(inner))).is_ok() {
        log::set_max_level(max);
    }
}

/// Takes the lines logged since the last call
#[tauri::command]
pub fn app_logs() -> Vec<Line> {
    LINES.lock().unwrap().drain(..).collect()
}

/// Puts back lines the page couldn't upload, ahead of newer ones
#[tauri::command]
pub fn app_logs_return(lines: Vec<Line>) {
    let mut kept = LINES.lock().unwrap();
    for l in lines.into_iter().rev() {
        if kept.len() >= KEEP {
            break;
        }
        kept.push_front(l);
    }
}

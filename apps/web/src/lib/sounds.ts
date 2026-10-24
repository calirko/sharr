// Short tones made with Web Audio, so there are no sound files to host or license.

export type SoundPrefs = { chat: boolean; share: boolean; presence: boolean };
type Sound = "message" | "shareStart" | "shareStop" | "join" | "leave";

const STORAGE_KEY = "sharr.sounds";
const VOLUME = 0.12;

// [frequency Hz, start s, duration s]
const notes: Record<Sound, [number, number, number][]> = {
  message: [[880, 0, 0.15]],
  shareStart: [
    [660, 0, 0.12],
    [990, 0.1, 0.18],
  ],
  shareStop: [
    [990, 0, 0.12],
    [660, 0.1, 0.18],
  ],
  // Lower than the share chime so the two are easy to tell apart
  join: [
    [440, 0, 0.1],
    [587, 0.08, 0.2],
  ],
  leave: [
    [587, 0, 0.1],
    [440, 0.08, 0.2],
  ],
};

const prefKey: Record<Sound, keyof SoundPrefs> = {
  message: "chat",
  shareStart: "share",
  shareStop: "share",
  join: "presence",
  leave: "presence",
};

const DEFAULT_PREFS: SoundPrefs = { chat: true, share: true, presence: true };

let prefs: SoundPrefs = load();
let ctx: AudioContext | null = null;

function load(): SoundPrefs {
  try {
    return { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") };
  } catch {
    return DEFAULT_PREFS;
  }
}

export const getSoundPrefs = () => prefs;

export function setSoundPrefs(next: SoundPrefs) {
  prefs = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {}
}

export function playSound(sound: Sound) {
  if (!prefs[prefKey[sound]]) return;
  ctx ??= new AudioContext();
  // Browsers start it suspended until the page has had a click
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  const now = ctx.currentTime;
  for (const [freq, start, dur] of notes[sound]) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    // Quick fade in and out so it doesn't click
    gain.gain.setValueAtTime(0, now + start);
    gain.gain.linearRampToValueAtTime(VOLUME, now + start + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + start + dur);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now + start);
    osc.stop(now + start + dur);
  }
}

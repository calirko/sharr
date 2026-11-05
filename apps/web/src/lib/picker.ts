// The desktop app's own screen and window picker (components/SourcePicker.tsx), in place of
// Chromium's. share.ts asks for a pick, the dialog answers.

export type CaptureSource = {
  id: string;
  kind: "screen" | "window";
  name: string;
  thumb: string | null;
};

// `audio`: the "Share system audio" switch, only offered without the app's own system audio
export type Pick = { source: CaptureSource; audio: boolean };

let pending: ((pick: Pick | null) => void) | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((cb) => cb());

export const isPicking = () => pending !== null;

export function subscribePicker(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

// Resolves with null when the dialog is closed without a pick
export function pickSource() {
  pending?.(null);
  return new Promise<Pick | null>((resolve) => {
    pending = resolve;
    emit();
  });
}

export function finishPick(pick: Pick | null) {
  const resolve = pending;
  pending = null;
  emit();
  resolve?.(pick);
}

const AUDIO_KEY = "sharr.picker_audio";

export function getPickerAudio() {
  try {
    return localStorage.getItem(AUDIO_KEY) === "1";
  } catch {
    return false;
  }
}

export function setPickerAudio(on: boolean) {
  try {
    localStorage.setItem(AUDIO_KEY, on ? "1" : "0");
  } catch {}
}

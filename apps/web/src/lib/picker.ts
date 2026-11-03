// The desktop app's own screen and window picker (components/SourcePicker.tsx), in place of
// Chromium's. share.ts asks for a pick, the dialog answers.

export type CaptureSource = {
  id: string;
  kind: "screen" | "window";
  name: string;
  thumb: string | null;
};

let pending: ((source: CaptureSource | null) => void) | null = null;
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
  return new Promise<CaptureSource | null>((resolve) => {
    pending = resolve;
    emit();
  });
}

export function finishPick(source: CaptureSource | null) {
  const resolve = pending;
  pending = null;
  emit();
  resolve?.(source);
}

// Bridge to the desktop app (apps/desktop). The same web build runs in the browser and in the app;
// the app injects window.__TAURI__ for this origin only.
import { toast } from "sonner";

type Tauri = {
  core: { invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> };
  event: { listen<T>(event: string, cb: (e: { payload: T }) => void): Promise<() => void> };
};

const tauri = (window as unknown as { __TAURI__?: Tauri }).__TAURI__;

export const isDesktop = !!tauri;

export type DesktopInfo = { version: string; os: string };

let info: Promise<DesktopInfo> | undefined;
export const desktopInfo = () => (info ??= tauri!.core.invoke<DesktopInfo>("desktop_info"));

// Browsers can't capture system audio on Linux. There the app mixes every other app's output
// into a virtual source, which we capture like a microphone.
export const hasNativeSystemAudio = async () => isDesktop && (await desktopInfo()).os === "linux";

export async function systemAudioTrack() {
  const label = await tauri!.core.invoke<string>("system_audio_start");
  const find = async () =>
    (await navigator.mediaDevices.enumerateDevices()).find((d) => d.kind === "audioinput" && d.label === label);

  let device = await find();
  if (!device) {
    // Device labels stay empty until the page has had a capture grant
    const s = await navigator.mediaDevices.getUserMedia({ audio: true });
    s.getTracks().forEach((t) => t.stop());
  }
  // Chromium's device list can lag behind PipeWire a little
  for (let i = 0; !device && i < 10; i++) {
    device = await find();
    if (!device) await new Promise((r) => setTimeout(r, 200));
  }
  if (!device) throw new Error("no_system_audio");

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      deviceId: { exact: device.deviceId },
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      channelCount: 2,
      sampleRate: 48000,
    },
  });
  return stream.getAudioTracks()[0];
}

export const stopSystemAudio = () => tauri?.core.invoke("system_audio_stop").catch(() => {});

function showUpdate(version: string) {
  toast(`sharr ${version} is ready`, {
    id: "update",
    duration: Infinity,
    action: {
      label: "Restart",
      onClick: () => {
        tauri!.core.invoke("update_install").catch(() => toast.error("Update failed. Try again later."));
      },
    },
  });
}

// The app downloads updates in the background. It may be done before the page loads.
export function watchUpdates() {
  if (!tauri) return;
  tauri.core.invoke<string | null>("update_pending").then((v) => v && showUpdate(v), () => {});
  tauri.event.listen<string>("update-ready", (e) => showUpdate(e.payload));
}

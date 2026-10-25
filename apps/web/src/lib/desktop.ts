// Bridge to the desktop app (apps/desktop). The same web build runs in the browser and in the app;
// the app injects window.__TAURI__ for this origin only.
import { toast } from "sonner";
import { api } from "./api";

type Tauri = {
  core: { invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> };
  event: { listen<T>(event: string, cb: (e: { payload: T }) => void): Promise<() => void> };
};

const tauri = (window as unknown as { __TAURI__?: Tauri }).__TAURI__;

export const isDesktop = !!tauri;

// Browsers can't capture system audio on Linux. There the app mixes every other app's output
// into a virtual source, which we capture like a microphone.
export const hasNativeSystemAudio = isDesktop && navigator.userAgent.includes("Linux");

const DISCORD_KEY = "sharr.share_discord";

// Whether Discord's audio (a call, say) goes into the share. On unless turned off.
export function getIncludeDiscord() {
  try {
    return localStorage.getItem(DISCORD_KEY) !== "0";
  } catch {
    return true;
  }
}

// Also applies right away when sharing
export function setIncludeDiscord(include: boolean) {
  try {
    localStorage.setItem(DISCORD_KEY, include ? "1" : "0");
  } catch {}
  tauri?.core.invoke("system_audio_include_discord", { include }).catch(() => {});
}

export async function systemAudioTrack() {
  const label = await tauri!.core.invoke<string>("system_audio_start", { include_discord: getIncludeDiscord() });
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

// Discord login runs in the system browser, which sends the app a one-time code (/desktop-login)
export async function browserLogin() {
  const code = await tauri!.core.invoke<string>("browser_login");
  return (await api.desktopRedeem(code)).user;
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

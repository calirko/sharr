// Bridge to the desktop app (apps/desktop). The same web build runs in the browser and in the app;
// the app injects window.__TAURI__ for this origin only.
import { toast } from "sonner";
import { api } from "./api";

type Channel = { onmessage: (data: ArrayBuffer) => void };

type Tauri = {
  core: {
    invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T>;
    Channel: new () => Channel;
  };
  event: { listen<T>(event: string, cb: (e: { payload: T }) => void): Promise<() => void> };
};

const tauri = (window as unknown as { __TAURI__?: Tauri }).__TAURI__;

export const isDesktop = !!tauri;

const isLinux = navigator.userAgent.includes("Linux");

// Browsers can't capture system audio on Linux. There the app mixes every other app's output
// into a virtual source, which we capture like a microphone. On Windows the app captures each
// app with process loopback and streams the mix to the page, so Discord can be left out. Windows
// without process loopback keeps the picker's audio. Set once nativeAudioReady resolves.
export let hasNativeSystemAudio = isDesktop && isLinux;

export const nativeAudioReady: Promise<void> =
  isDesktop && !isLinux
    ? tauri!.core.invoke<boolean>("system_audio_supported").then(
        (v) => void (hasNativeSystemAudio = v),
        () => {},
      )
    : Promise.resolve();

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
  return isLinux ? linuxAudioTrack() : windowsAudioTrack();
}

let audioCtx: AudioContext | null = null;

// The app sends the mix in 20 ms chunks, the worklet plays them into a track
async function windowsAudioTrack() {
  audioCtx?.close();
  const ctx = (audioCtx = new AudioContext({ sampleRate: 48000 }));
  await ctx.audioWorklet.addModule("/sysaudio-worklet.js");
  const node = new AudioWorkletNode(ctx, "sysaudio", { numberOfInputs: 0, outputChannelCount: [2] });
  const dest = ctx.createMediaStreamDestination();
  dest.channelCount = 2;
  node.connect(dest);
  // Nothing plays here, the context may start suspended
  await ctx.resume().catch(() => {});

  const channel = new tauri!.core.Channel();
  channel.onmessage = (data) => node.port.postMessage(data, [data]);
  await tauri!.core.invoke("system_audio_start", { include_discord: getIncludeDiscord(), on_audio: channel });
  return dest.stream.getAudioTracks()[0];
}

async function linuxAudioTrack() {
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

// Hides Chromium's "sharing your screen" bar, the room has its own Stop button (Windows only)
export const hideShareBar = () => tauri?.core.invoke("hide_share_bar").catch(() => {});

export async function stopSystemAudio() {
  audioCtx?.close();
  audioCtx = null;
  await tauri?.core.invoke("system_audio_stop").catch(() => {});
}

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

export type ResizeEdge = "North" | "South" | "East" | "West" | "NorthEast" | "NorthWest" | "SouthEast" | "SouthWest";

// The app draws its own title bar when the window has no system one. Apps from before 0.1.10
// keep the system's and don't allow is_decorated, so this resolves false there.
export const ownTitleBar: Promise<boolean> = isDesktop
  ? tauri!.core.invoke<boolean>("plugin:window|is_decorated").then(
      (d) => !d,
      () => false,
    )
  : Promise.resolve(false);

export const appWindow = {
  minimize: () => tauri!.core.invoke("plugin:window|minimize"),
  toggleMaximize: () => tauri!.core.invoke("plugin:window|toggle_maximize"),
  close: () => tauri!.core.invoke("plugin:window|close"),
  isMaximized: () => tauri!.core.invoke<boolean>("plugin:window|is_maximized"),
  startResize: (value: ResizeEdge) => tauri!.core.invoke("plugin:window|start_resize_dragging", { value }),
};

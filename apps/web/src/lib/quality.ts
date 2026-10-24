// Everything is capped at 1080p60. Tiers only change the bitrate, fps is picked separately.
export const MAX_WIDTH = 1920;
export const MAX_HEIGHT = 1080;
export const MAX_FPS = 60;

export const qualityTiers = [
  { id: "low", label: "Low", bitrate: 2_500_000 },
  { id: "standard", label: "Standard", bitrate: 5_000_000 },
  { id: "high", label: "High", bitrate: 8_000_000 },
  { id: "max", label: "Max", bitrate: 12_000_000 },
] as const;

export type QualityId = (typeof qualityTiers)[number]["id"];

const STORAGE_KEY = "sharr.quality";

export function loadQuality(): QualityId {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (qualityTiers.some((t) => t.id === v)) return v as QualityId;
  } catch {}
  return "standard";
}

export function saveQuality(id: QualityId) {
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {}
}

export const fpsOptions = [30, 60] as const;
export type Fps = (typeof fpsOptions)[number];

const FPS_KEY = "sharr.fps";

export function loadFps(): Fps {
  try {
    const v = Number(localStorage.getItem(FPS_KEY));
    if (fpsOptions.some((f) => f === v)) return v as Fps;
  } catch {}
  return MAX_FPS;
}

export function saveFps(fps: Fps) {
  try {
    localStorage.setItem(FPS_KEY, String(fps));
  } catch {}
}

export const canCaptureScreen = () => typeof navigator.mediaDevices?.getDisplayMedia === "function";

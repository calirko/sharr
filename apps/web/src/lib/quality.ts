// Capped at 1440p60. Each tier sets the capture height and the bitrate, fps is picked separately.
export const MAX_FPS = 60;

export const qualityTiers = [
  { id: "lowest", label: "Lowest", height: 480, bitrate: 1_500_000 },
  { id: "low", label: "Low", height: 720, bitrate: 3_000_000 },
  { id: "standard", label: "Standard", height: 1080, bitrate: 6_000_000 },
  { id: "high", label: "High", height: 1080, bitrate: 10_000_000 },
  { id: "max", label: "Max", height: 1440, bitrate: 16_000_000 },
] as const;

export type QualityTier = (typeof qualityTiers)[number];
export type TierId = QualityTier["id"];
// Auto moves between the tiers based on the sharer's connection and encoder load
export type QualityId = TierId | "auto";

export const AUTO_START: TierId = "standard";

export const tierIndex = (id: TierId) => qualityTiers.findIndex((t) => t.id === id);

// New key so the old saved default ("standard") doesn't hide Auto
const STORAGE_KEY = "sharr.share_quality";

export function loadQuality(): QualityId {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "auto" || qualityTiers.some((t) => t.id === v)) return v as QualityId;
  } catch {}
  return "auto";
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

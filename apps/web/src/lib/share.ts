import {
  AudioPresets,
  LocalAudioTrack,
  LocalVideoTrack,
  type LocalTrack,
  Track,
  type AudioCaptureOptions,
  type LocalParticipant,
} from "livekit-client";
import { toast } from "sonner";
import {
  captureSource,
  hasNativeSystemAudio,
  hasOwnPicker,
  hideShareBar,
  nativeAudioReady,
  stopSystemAudio,
  systemAudioTrack,
} from "./desktop";
import { pickSource } from "./picker";
import { AUTO_START, qualityTiers, tierIndex, type Fps, type QualityId, type QualityTier, type TierId } from "./quality";

// One share per page at most, so the share's settings live here
type Share = {
  lp: LocalParticipant;
  quality: QualityId;
  fps: Fps;
  tier: TierId;
  timer?: ReturnType<typeof setInterval>;
  // Consecutive auto samples for each condition
  limited: number;
  starved: number;
  room: number;
  last_down: number;
};
let share: Share | null = null;

// The tier Auto is on right now, for the share dialog
let autoTier: TierId | null = null;
const listeners = new Set<() => void>();
export const getAutoTier = () => autoTier;
export function subscribeAutoTier(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
function setAutoTier(t: TierId | null) {
  autoTier = t;
  listeners.forEach((cb) => cb());
}

const tierOf = (id: TierId) => qualityTiers[tierIndex(id)];
const widthOf = (t: QualityTier) => Math.round((t.height * 16) / 9);

// Auto lets the encoder go up to the next tier's bitrate, so the bandwidth estimate can show
// whether there is room for it. Without that headroom the estimate stays near the cap.
function maxBitrate(quality: QualityId, tier: TierId) {
  if (quality !== "auto") return tierOf(tier).bitrate;
  return (qualityTiers[tierIndex(tier) + 1] ?? tierOf(tier)).bitrate;
}

// Voice processing is on by default and wrecks music and game audio.
// restrictOwnAudio keeps the room's own playback out of system audio where Chrome supports it.
async function captureTracks(lp: LocalParticipant, tier: QualityTier, fps: Fps): Promise<LocalTrack[]> {
  if (await hasOwnPicker()) {
    const pick = await pickSource();
    // Same as closing the browser's picker
    if (!pick) throw new DOMException("No source picked", "NotAllowedError");
    const { video, audio } = await captureSource(pick.source.id, widthOf(tier), tier.height, fps, pick.audio);
    video.contentHint = "motion";
    hideShareBar();
    const tracks: LocalTrack[] = [new LocalVideoTrack(video, undefined, true)];
    if (audio) tracks.push(new LocalAudioTrack(audio, undefined, true));
    return tracks;
  }
  await nativeAudioReady;
  const tracks = await lp.createScreenTracks({
    audio: hasNativeSystemAudio
      ? false
      : ({
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          channelCount: 2,
          restrictOwnAudio: true,
        } as AudioCaptureOptions),
    systemAudio: "include",
    selfBrowserSurface: "exclude",
    surfaceSwitching: "include",
    resolution: { width: widthOf(tier), height: tier.height, frameRate: fps },
    contentHint: "motion",
  });
  hideShareBar();
  return tracks;
}

function publishAudio(lp: LocalParticipant, track: LocalAudioTrack) {
  return lp.publishTrack(track, {
    source: Track.Source.ScreenShareAudio,
    audioPreset: AudioPresets.musicHighQualityStereo,
    forceStereo: true,
    dtx: false,
    red: false,
  });
}

// Stopping from the system's share indicator only ends the video, so the native audio has to go too
function stopWithVideo(lp: LocalParticipant, track: MediaStreamTrack) {
  if (hasNativeSystemAudio) track.addEventListener("ended", () => stopShare(lp));
}

// Firefox keeps the capture pending until its prompt is answered, which can wait for the window
// to get focus. Without this, starting again meanwhile published both captures at once.
let starting: Promise<void> | null = null;

export function startShare(lp: LocalParticipant, quality: QualityId, fps: Fps) {
  starting ??= doStartShare(lp, quality, fps).finally(() => (starting = null));
  return starting;
}

async function doStartShare(lp: LocalParticipant, quality: QualityId, fps: Fps) {
  const tierId = quality === "auto" ? AUTO_START : quality;
  const tier = tierOf(tierId);
  const tracks = await captureTracks(lp, tier, fps);
  if (lp.getTrackPublication(Track.Source.ScreenShare)) {
    tracks.forEach((t) => t.stop());
    return;
  }
  stopAuto();

  if (hasNativeSystemAudio) {
    try {
      tracks.push(new LocalAudioTrack(await systemAudioTrack()));
    } catch {
      await stopSystemAudio();
      toast.error("Could not capture system audio. Sharing without it.");
    }
    stopWithVideo(lp, tracks[0].mediaStreamTrack);
  }

  try {
    for (const track of tracks) {
      if (track.kind === Track.Kind.Video) {
        await capCapture(track.mediaStreamTrack, tier, fps);
        await lp.publishTrack(track, {
          source: Track.Source.ScreenShare,
          screenShareEncoding: { maxBitrate: maxBitrate(quality, tierId), maxFramerate: fps },
          // VP8, not H.264: the desktop app's CEF has no software H.264, so H.264 depends on the GPU
          // there. LiveKit then fell back to a VP8 backup for every share, encoding the screen twice.
          // One layer and no backup codec: one encode only.
          videoCodec: "vp8",
          backupCodec: false,
          simulcast: false,
        });
      } else {
        await publishAudio(lp, track as LocalAudioTrack);
      }
    }
  } catch (err) {
    await stopShare(lp);
    tracks.forEach((t) => t.stop());
    throw err;
  }
  share = { lp, quality, fps, tier: tierId, limited: 0, starved: 0, room: 0, last_down: 0 };
  setMode();
}

// Pick another screen or window while sharing. The new capture goes into the published tracks,
// so viewers keep watching without a new share showing up.
export async function switchShare(lp: LocalParticipant, fps: Fps) {
  const video = lp.getTrackPublication(Track.Source.ScreenShare)?.track;
  if (!(video instanceof LocalVideoTrack)) return;
  const tier = tierOf(share?.tier ?? AUTO_START);
  const tracks = await captureTracks(lp, tier, fps);
  const newVideo = tracks.find((t) => t.kind === Track.Kind.Video);
  const newAudio = tracks.find((t) => t.kind === Track.Kind.Audio) as LocalAudioTrack | undefined;
  if (!newVideo) {
    tracks.forEach((t) => t.stop());
    return;
  }

  await capCapture(newVideo.mediaStreamTrack, tier, fps);
  stopWithVideo(lp, newVideo.mediaStreamTrack);
  await video.replaceTrack(newVideo.mediaStreamTrack, false);

  // The desktop app's system audio doesn't depend on the capture, it stays as is
  if (hasNativeSystemAudio) return;
  const audio = lp.getTrackPublication(Track.Source.ScreenShareAudio)?.track;
  if (audio && newAudio) await audio.replaceTrack(newAudio.mediaStreamTrack, false);
  else if (audio) await lp.unpublishTrack(audio, true);
  else if (newAudio) await publishAudio(lp, newAudio);
}

// Browsers treat the capture size as a hint. Hard cap it so big monitors get scaled down.
function capCapture(track: MediaStreamTrack, tier: QualityTier, fps: Fps) {
  return track
    .applyConstraints({
      width: { max: widthOf(tier) },
      height: { max: tier.height },
      frameRate: { ideal: fps, max: fps },
    })
    .catch(() => {});
}

function videoTrack(lp: LocalParticipant) {
  const track = lp.getTrackPublication(Track.Source.ScreenShare)?.track;
  return track instanceof LocalVideoTrack && track.sender ? track : null;
}

async function applyTier(s: Share) {
  const track = videoTrack(s.lp);
  if (!track) return;
  await capCapture(track.mediaStreamTrack, tierOf(s.tier), s.fps);
  const params = track.sender!.getParameters();
  for (const e of params.encodings) {
    e.maxBitrate = maxBitrate(s.quality, s.tier);
    e.maxFramerate = s.fps;
  }
  await track.sender!.setParameters(params);
}

// Change quality while sharing, without asking for the screen again
export async function updateShare(lp: LocalParticipant, quality: QualityId, fps: Fps) {
  if (!share) share = { lp, quality, fps, tier: AUTO_START, limited: 0, starved: 0, room: 0, last_down: 0 };
  // Switching to Auto starts from the tier in use
  if (quality !== "auto") share.tier = quality;
  share.quality = quality;
  share.fps = fps;
  await applyTier(share);
  setMode();
}

function setMode() {
  if (!share) return;
  clearInterval(share.timer);
  share.timer = undefined;
  if (share.quality === "auto") {
    share.limited = share.starved = share.room = 0;
    share.timer = setInterval(autoTick, AUTO_INTERVAL);
    setAutoTier(share.tier);
  } else {
    setAutoTier(null);
  }
}

const AUTO_INTERVAL = 2000;
// Samples in a row before moving: down after ~6s of limits (~4s when far below), up after ~10s of room
const DOWN_LIMITED = 3;
const DOWN_STARVED = 2;
const UP_ROOM = 5;
// No step up this soon after a step down, so it doesn't bounce
const UP_HOLD = 30_000;

async function autoTick() {
  const s = share;
  if (!s || s.quality !== "auto") return;
  const track = videoTrack(s.lp);
  if (!track) return stopAuto();

  let reason: string | undefined;
  let available: number | undefined;
  let pairId: string | undefined;
  const pairs = new Map<string, RTCIceCandidatePairStats>();
  try {
    const stats = await track.sender!.getStats();
    stats.forEach((r) => {
      if (r.type === "outbound-rtp" && r.kind === "video") reason = r.qualityLimitationReason;
      else if (r.type === "transport") pairId = r.selectedCandidatePairId;
      else if (r.type === "candidate-pair") pairs.set(r.id, r);
    });
    const pair = (pairId && pairs.get(pairId)) || [...pairs.values()].find((p) => p.nominated && p.state === "succeeded");
    available = pair?.availableOutgoingBitrate;
  } catch {
    return;
  }
  if (share !== s || s.quality !== "auto") return;

  const i = tierIndex(s.tier);
  const next = qualityTiers[i + 1];
  // cpu: the encoder can't keep up, a smaller frame helps there too
  const limited = reason === "bandwidth" || reason === "cpu";
  const starved = available !== undefined && available < tierOf(s.tier).bitrate * 0.6;
  const room = !!next && !limited && available !== undefined && available >= next.bitrate * 0.9;
  s.limited = limited ? s.limited + 1 : 0;
  s.starved = starved ? s.starved + 1 : 0;
  s.room = room ? s.room + 1 : 0;

  let to: TierId | undefined;
  if (i > 0 && (s.limited >= DOWN_LIMITED || s.starved >= DOWN_STARVED)) {
    to = qualityTiers[i - 1].id;
    s.last_down = Date.now();
  } else if (next && s.room >= UP_ROOM && Date.now() - s.last_down > UP_HOLD) {
    to = next.id;
  }
  if (!to) return;

  s.tier = to;
  s.limited = s.starved = s.room = 0;
  setAutoTier(to);
  await applyTier(s).catch(() => {});
}

// Our share is running, even if LiveKit already took its tracks away
export const isSharing = () => share !== null;

function stopAuto() {
  if (share) clearInterval(share.timer);
  share = null;
  setAutoTier(null);
}

export async function stopShare(lp: LocalParticipant) {
  stopAuto();
  const pubs = [...lp.trackPublications.values()].filter(
    (p) => p.source === Track.Source.ScreenShare || p.source === Track.Source.ScreenShareAudio,
  );
  await Promise.all(pubs.map((p) => p.track && lp.unpublishTrack(p.track, true)));
  await stopSystemAudio();
}

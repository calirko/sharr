import {
  AudioPresets,
  LocalAudioTrack,
  LocalVideoTrack,
  Track,
  type AudioCaptureOptions,
  type LocalParticipant,
} from "livekit-client";
import { toast } from "sonner";
import { hasNativeSystemAudio, stopSystemAudio, systemAudioTrack } from "./desktop";
import { MAX_HEIGHT, MAX_WIDTH, qualityTiers, type Fps, type QualityId } from "./quality";

export async function startShare(lp: LocalParticipant, quality: QualityId, fps: Fps) {
  const tier = qualityTiers.find((t) => t.id === quality) ?? qualityTiers[1];
  const native = await hasNativeSystemAudio();
  const tracks = await lp.createScreenTracks({
    // Voice processing is on by default and wrecks music and game audio.
    // restrictOwnAudio keeps the room's own playback out of system audio where Chrome supports it.
    audio: native
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
    resolution: { width: MAX_WIDTH, height: MAX_HEIGHT, frameRate: fps },
    contentHint: "motion",
  });

  if (native) {
    try {
      tracks.push(new LocalAudioTrack(await systemAudioTrack()));
    } catch {
      await stopSystemAudio();
      toast.error("Could not capture system audio. Sharing without it.");
    }
    // Stopping from the system's share indicator only ends the video
    tracks[0].mediaStreamTrack.addEventListener("ended", () => stopShare(lp));
  }

  try {
    for (const track of tracks) {
      if (track.kind === Track.Kind.Video) {
        await capCapture(track.mediaStreamTrack, fps);
        await lp.publishTrack(track, {
          source: Track.Source.ScreenShare,
          screenShareEncoding: { maxBitrate: tier.bitrate, maxFramerate: fps },
          simulcast: true,
        });
      } else {
        await lp.publishTrack(track, {
          source: Track.Source.ScreenShareAudio,
          audioPreset: AudioPresets.musicHighQualityStereo,
          forceStereo: true,
          dtx: false,
          red: false,
        });
      }
    }
  } catch (err) {
    await stopShare(lp);
    tracks.forEach((t) => t.stop());
    throw err;
  }
}

// Browsers treat the capture size as a hint. Hard cap it so big monitors get scaled down.
function capCapture(track: MediaStreamTrack, fps: Fps) {
  return track
    .applyConstraints({ width: { max: MAX_WIDTH }, height: { max: MAX_HEIGHT }, frameRate: { ideal: fps, max: fps } })
    .catch(() => {});
}

// Change quality while sharing, without asking for the screen again
export async function updateShare(lp: LocalParticipant, quality: QualityId, fps: Fps) {
  const tier = qualityTiers.find((t) => t.id === quality) ?? qualityTiers[1];
  const track = lp.getTrackPublication(Track.Source.ScreenShare)?.track;
  if (!(track instanceof LocalVideoTrack) || !track.sender) return;
  await capCapture(track.mediaStreamTrack, fps);

  const params = track.sender.getParameters();
  // The full size layer gets the tier bitrate. Simulcast layers below it keep theirs, capped at the new fps.
  const top = params.encodings.reduce((a, b) => ((b.scaleResolutionDownBy ?? 1) < (a.scaleResolutionDownBy ?? 1) ? b : a));
  for (const e of params.encodings) {
    if (e === top) {
      e.maxBitrate = tier.bitrate;
      e.maxFramerate = fps;
    } else if (e.maxFramerate === undefined || e.maxFramerate > fps) {
      e.maxFramerate = fps;
    }
  }
  await track.sender.setParameters(params);
}

export async function stopShare(lp: LocalParticipant) {
  const pubs = [...lp.trackPublications.values()].filter(
    (p) => p.source === Track.Source.ScreenShare || p.source === Track.Source.ScreenShareAudio,
  );
  await Promise.all(pubs.map((p) => p.track && lp.unpublishTrack(p.track, true)));
  await stopSystemAudio();
}

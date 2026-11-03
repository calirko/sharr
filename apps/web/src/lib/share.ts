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

// Voice processing is on by default and wrecks music and game audio.
// restrictOwnAudio keeps the room's own playback out of system audio where Chrome supports it.
function captureTracks(lp: LocalParticipant, fps: Fps) {
  return lp.createScreenTracks({
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
    resolution: { width: MAX_WIDTH, height: MAX_HEIGHT, frameRate: fps },
    contentHint: "motion",
  });
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

export async function startShare(lp: LocalParticipant, quality: QualityId, fps: Fps) {
  const tier = qualityTiers.find((t) => t.id === quality) ?? qualityTiers[1];
  const tracks = await captureTracks(lp, fps);

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
        await capCapture(track.mediaStreamTrack, fps);
        await lp.publishTrack(track, {
          source: Track.Source.ScreenShare,
          screenShareEncoding: { maxBitrate: tier.bitrate, maxFramerate: fps },
          // H.264 is hardware encoded on most machines, VP8 (the default) never is.
          // One layer instead of simulcast: encoding the screen two or three times costs too much CPU.
          videoCodec: "h264",
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
}

// Pick another screen or window while sharing. The new capture goes into the published tracks,
// so viewers keep watching without a new share showing up.
export async function switchShare(lp: LocalParticipant, fps: Fps) {
  const video = lp.getTrackPublication(Track.Source.ScreenShare)?.track;
  if (!(video instanceof LocalVideoTrack)) return;
  const tracks = await captureTracks(lp, fps);
  const newVideo = tracks.find((t) => t.kind === Track.Kind.Video);
  const newAudio = tracks.find((t) => t.kind === Track.Kind.Audio) as LocalAudioTrack | undefined;
  if (!newVideo) {
    tracks.forEach((t) => t.stop());
    return;
  }

  await capCapture(newVideo.mediaStreamTrack, fps);
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
  for (const e of params.encodings) {
    e.maxBitrate = tier.bitrate;
    e.maxFramerate = fps;
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

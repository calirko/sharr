import { AudioPresets, Track, type LocalParticipant } from "livekit-client";
import { MAX_HEIGHT, MAX_WIDTH, qualityTiers, type Fps, type QualityId } from "./quality";

export async function startShare(lp: LocalParticipant, quality: QualityId, fps: Fps) {
  const tier = qualityTiers.find((t) => t.id === quality) ?? qualityTiers[1];
  const tracks = await lp.createScreenTracks({
    // Voice processing is on by default and wrecks music and game audio
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 2 },
    systemAudio: "include",
    selfBrowserSurface: "exclude",
    surfaceSwitching: "include",
    resolution: { width: MAX_WIDTH, height: MAX_HEIGHT, frameRate: fps },
    contentHint: "motion",
  });

  try {
    for (const track of tracks) {
      if (track.kind === Track.Kind.Video) {
        // Browsers treat the capture size as a hint. Hard cap it so big monitors get scaled down.
        await track.mediaStreamTrack
          .applyConstraints({ width: { max: MAX_WIDTH }, height: { max: MAX_HEIGHT }, frameRate: { max: fps } })
          .catch(() => {});
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

export async function stopShare(lp: LocalParticipant) {
  const pubs = [...lp.trackPublications.values()].filter(
    (p) => p.source === Track.Source.ScreenShare || p.source === Track.Source.ScreenShareAudio,
  );
  await Promise.all(pubs.map((p) => p.track && lp.unpublishTrack(p.track, true)));
}

import { AudioTrack, useTracks, VideoTrack, type TrackReference } from "@livekit/components-react";
import { Track } from "livekit-client";
import { Maximize, MonitorUp, Volume1, Volume2, VolumeX } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";

type Volume = { level: number; muted: boolean };
const DEFAULT_VOLUME: Volume = { level: 1, muted: false };

export function ScreenGrid({ tracks }: { tracks: TrackReference[] }) {
  const [focusSid, setFocusSid] = useState<string | null>(null);
  // Per sharer, kept here so it survives tiles remounting when the layout changes
  const [volumes, setVolumes] = useState<Record<string, Volume>>({});
  const audio = useTracks([Track.Source.ScreenShareAudio]).filter((t) => !t.participant.isLocal);

  const volumeOf = (identity: string) => volumes[identity] ?? DEFAULT_VOLUME;
  const setVolume = (identity: string, v: Volume) => setVolumes((all) => ({ ...all, [identity]: v }));

  const tile = (t: TrackReference, className: string, onClick?: () => void) => {
    const identity = t.participant.identity;
    const hasAudio = audio.some((a) => a.participant.identity === identity);
    return (
      <Tile
        key={t.publication.trackSid}
        trackRef={t}
        className={className}
        onClick={onClick}
        volume={hasAudio ? volumeOf(identity) : undefined}
        onVolume={(v) => setVolume(identity, v)}
      />
    );
  };

  let content;
  const focused = tracks.find((t) => t.publication.trackSid === focusSid);
  if (tracks.length === 0) {
    content = (
      <div className="text-muted-foreground flex flex-1 flex-col items-center justify-center gap-2 text-sm">
        <MonitorUp className="size-8" />
        Nobody is sharing yet.
      </div>
    );
  } else if (focused && tracks.length > 1) {
    content = (
      <div className="flex min-h-0 flex-1 flex-col gap-2">
        {tile(focused, "min-h-0 flex-1", () => setFocusSid(null))}
        <div className="flex h-24 shrink-0 gap-2 overflow-x-auto">
          {tracks
            .filter((t) => t !== focused)
            .map((t) => tile(t, "aspect-video h-full", () => setFocusSid(t.publication.trackSid)))}
        </div>
      </div>
    );
  } else {
    content = (
      <div className={cn("grid min-h-0 flex-1 gap-2", tracks.length > 1 && "md:grid-cols-2")}>
        {tracks.map((t) =>
          tile(t, "min-h-0", tracks.length > 1 ? () => setFocusSid(t.publication.trackSid) : undefined),
        )}
      </div>
    );
  }

  return (
    <>
      {audio.map((a) => {
        const v = volumeOf(a.participant.identity);
        return <AudioTrack key={a.publication.trackSid} trackRef={a} volume={v.level} muted={v.muted || v.level === 0} />;
      })}
      {content}
    </>
  );
}

type TileProps = {
  trackRef: TrackReference;
  className?: string;
  onClick?: () => void;
  volume?: Volume;
  onVolume: (v: Volume) => void;
};

function Tile({ trackRef, className, onClick, volume, onVolume }: TileProps) {
  const ref = useRef<HTMLDivElement>(null);
  const local = trackRef.participant.isLocal;

  function fullscreen(e: React.MouseEvent) {
    e.stopPropagation();
    const el = ref.current;
    if (!el) return;
    if (document.fullscreenElement) document.exitFullscreen();
    else if (el.requestFullscreen) el.requestFullscreen();
    // iOS Safari only allows fullscreen on the video element
    else (el.querySelector("video") as { webkitEnterFullscreen?: () => void } | null)?.webkitEnterFullscreen?.();
  }

  const silent = volume && (volume.muted || volume.level === 0);
  const VolumeIcon = silent ? VolumeX : volume && volume.level < 0.5 ? Volume1 : Volume2;

  return (
    <div
      ref={ref}
      className={cn("group relative overflow-hidden rounded-md bg-black", onClick && "cursor-pointer", className)}
      onClick={onClick}
    >
      <VideoTrack trackRef={trackRef} className="size-full object-contain" />
      <div className="absolute inset-x-2 bottom-2 flex items-center gap-1">
        <span className="truncate rounded bg-black/60 px-2 py-0.5 text-xs text-white">
          {local ? "You" : trackRef.participant.name || trackRef.participant.identity}
        </span>
        <div className="flex-1" />
        {volume && (
          // Clicks here shouldn't toggle focus on the tile
          <div className="group/vol flex items-center rounded-lg bg-black/60" onClick={(e) => e.stopPropagation()}>
            <Button
              variant="ghost"
              size="icon-sm"
              title={silent ? "Unmute" : "Mute"}
              className="text-white hover:bg-white/20 hover:text-white"
              onClick={() => onVolume({ level: volume.level || 1, muted: !silent })}
            >
              <VolumeIcon />
            </Button>
            {/* Slides out on hover or keyboard focus. Touch screens have no hover, so it stays open there. */}
            <div className="w-0 overflow-hidden opacity-0 transition-all group-hover/vol:w-28 group-hover/vol:opacity-100 group-has-[:focus-visible]/vol:w-28 group-has-[:focus-visible]/vol:opacity-100 pointer-coarse:w-28 pointer-coarse:opacity-100">
              <Slider
                className="mx-2 w-24 py-2"
                min={0}
                max={100}
                step={1}
                value={[silent ? 0 : Math.round(volume.level * 100)]}
                onValueChange={([v]) => onVolume({ level: v / 100, muted: false })}
                aria-label="Volume"
              />
            </div>
          </div>
        )}
        <Button
          variant="ghost"
          size="icon-sm"
          title="Fullscreen"
          className="text-white hover:bg-white/20 hover:text-white"
          onClick={fullscreen}
        >
          <Maximize />
        </Button>
      </div>
    </div>
  );
}

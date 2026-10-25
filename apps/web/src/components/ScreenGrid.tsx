import { AudioTrack, useTracks, VideoTrack, type TrackReference } from "@livekit/components-react";
import { RemoteTrackPublication, Track, VideoQuality } from "livekit-client";
import { Maximize, MonitorUp, Play, Settings, Volume1, Volume2, VolumeX } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ParticipantAvatar } from "@/components/UserAvatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";

type Volume = { level: number; muted: boolean };
const DEFAULT_VOLUME: Volume = { level: 1, muted: false };

// A cap on the simulcast layer we receive. Auto leaves it to the tile size and the SFU.
const viewQualities = [
  { id: "auto", label: "Auto", layer: VideoQuality.HIGH },
  { id: "low", label: "Low", layer: VideoQuality.LOW },
] as const;
type ViewQuality = (typeof viewQualities)[number]["id"];

export function ScreenGrid({ tracks, emptyAction }: { tracks: TrackReference[]; emptyAction?: ReactNode }) {
  const [focusSid, setFocusSid] = useState<string | null>(null);
  // Per sharer, kept here so it survives tiles remounting when the layout changes
  const [volumes, setVolumes] = useState<Record<string, Volume>>({});
  const [qualities, setQualities] = useState<Record<string, ViewQuality>>({});
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
        quality={qualities[identity] ?? "auto"}
        onQuality={(q) => setQualities((all) => ({ ...all, [identity]: q }))}
      />
    );
  };

  let content;
  const focused = tracks.find((t) => t.publication.trackSid === focusSid);
  if (tracks.length === 0) {
    content = (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
        <div className="bg-foreground/5 text-muted-foreground flex size-14 items-center justify-center rounded-full">
          <MonitorUp className="size-6" />
        </div>
        <p className="text-muted-foreground text-sm">Nobody is sharing yet.</p>
        {emptyAction}
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
      <div className={cn("grid min-h-0 flex-1 gap-2", tracks.length > 1 && "side:grid-cols-2")}>
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
  quality: ViewQuality;
  onQuality: (q: ViewQuality) => void;
};

function Tile({ trackRef, className, onClick, volume, onVolume, quality, onQuality }: TileProps) {
  const ref = useRef<HTMLDivElement>(null);
  const local = trackRef.participant.isLocal;
  const paused = useVideoPaused(ref);
  const [menuOpen, setMenuOpen] = useState(false);
  // Touch screens have no hover: a tap toggles the controls, and they hide again after a while
  const [touchedAt, setTouchedAt] = useState(0);
  useEffect(() => {
    if (!touchedAt || menuOpen) return;
    const t = setTimeout(() => setTouchedAt(0), 3000);
    return () => clearTimeout(t);
  }, [touchedAt, menuOpen]);

  const pub = trackRef.publication;
  const subscribed = !!pub.track;
  useEffect(() => {
    if (!subscribed || !(pub instanceof RemoteTrackPublication)) return;
    pub.setVideoQuality(viewQualities.find((q) => q.id === quality)!.layer);
  }, [pub, subscribed, quality]);

  function click() {
    if (matchMedia("(pointer: coarse)").matches) {
      if (!touchedAt) return setTouchedAt(Date.now());
      setTouchedAt(0);
    }
    onClick?.();
  }

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
      onClick={click}
      onPointerDownCapture={(e) => e.pointerType !== "mouse" && touchedAt && setTouchedAt(Date.now())}
    >
      <VideoTrack trackRef={trackRef} className="size-full object-contain" />
      {paused && (
        <button
          className="absolute inset-0 flex items-center justify-center bg-black/40 text-white"
          title="Play"
          onClick={(e) => {
            e.stopPropagation();
            ref.current?.querySelector("video")?.play();
          }}
        >
          <Play className="size-12" />
        </button>
      )}
      <div
        className={cn(
          "absolute inset-x-2 bottom-2 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-has-[:focus-visible]:opacity-100",
          touchedAt || menuOpen ? "opacity-100" : "pointer-coarse:pointer-events-none",
        )}
      >
        <span className="flex h-8 min-w-0 items-center gap-2 rounded-lg bg-black/60 pr-2.5 pl-1.5 text-xs text-white">
          <ParticipantAvatar participant={trackRef.participant} className="size-5 bg-white/20 text-[0.625rem] text-white" />
          <span className="truncate">{local ? "You" : trackRef.participant.name || trackRef.participant.identity}</span>
        </span>
        <div className="flex-1" />
        {volume && (
          // Clicks here shouldn't toggle focus on the tile
          <div className="group/vol flex items-center rounded-lg bg-black/60" onClick={(e) => e.stopPropagation()}>
            <Button
              variant="ghost"
              size="icon-sm"
              title={silent ? "Unmute" : "Mute"}
              className="rounded-lg text-white hover:bg-white/20 hover:text-white"
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
        {!local && (
          <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                title="Settings"
                className="rounded-lg bg-black/60 text-white hover:bg-white/20 hover:text-white"
                onClick={(e) => e.stopPropagation()}
              >
                <Settings />
              </Button>
            </DropdownMenuTrigger>
            {/* Rendered inside the tile so it still shows in fullscreen */}
            <DropdownMenuContent
              container={ref.current}
              align="end"
              side="top"
              onClick={(e) => e.stopPropagation()}
            >
              <DropdownMenuLabel>Quality</DropdownMenuLabel>
              <DropdownMenuRadioGroup value={quality} onValueChange={(v) => onQuality(v as ViewQuality)}>
                {viewQualities.map((q) => (
                  <DropdownMenuRadioItem key={q.id} value={q.id}>
                    {q.label}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        <Button
          variant="ghost"
          size="icon-sm"
          title="Fullscreen"
          className="rounded-lg bg-black/60 text-white hover:bg-white/20 hover:text-white"
          onClick={fullscreen}
        >
          <Maximize />
        </Button>
      </div>
    </div>
  );
}

// iOS (e.g. Low Power Mode) can leave the video paused without livekit-client noticing,
// so watch the element itself and let a tap start it
function useVideoPaused(ref: React.RefObject<HTMLDivElement | null>) {
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = (e: Event) => {
      if (e.target instanceof HTMLVideoElement) setPaused(e.target.paused);
    };
    // Media events don't bubble, so listen in the capture phase
    const events = ["play", "playing", "pause", "loadeddata"];
    for (const name of events) el.addEventListener(name, update, true);
    return () => {
      for (const name of events) el.removeEventListener(name, update, true);
    };
  }, [ref]);
  return paused;
}

import { DiscordSDK } from "@discord/embedded-app-sdk";
import { Link2Off, MonitorUp, Unplug } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { CenterStack, TopBar } from "@/components/Layout";
import { LogoMark } from "@/components/Logo";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { UserAvatar } from "@/components/UserAvatar";
import { cn } from "@/lib/utils";

// Discord Activity test (calico app, URL mapping `/` to this server). `/sharr <link>` in the bot
// links the channel to a room. Discord blocks WebRTC here, so sharr-relay (apps/relay) sends the
// shares' encoded frames over a websocket and we decode the one we watch with WebCodecs.

type Share = { id: number; name: string; codec: string; avatar_url: string };

// The page can only load from its own origin, so Discord avatars go through the sharr server
function avatarUrl(url: string) {
  const m = url.match(/^https:\/\/cdn\.discordapp\.com\/avatars\/(\d+)\/([0-9a-z_]+)\.png/);
  return m ? `/api/activity/avatars/${m[1]}/${m[2]}` : undefined;
}

type State =
  | { kind: "connecting" }
  | { kind: "no_link" }
  | { kind: "offline"; room: string }
  | { kind: "live"; room: string; shares: Share[]; selected: number };

export function ActivityPage() {
  const [state, setState] = useState<State>({ kind: "connecting" });
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    let stopped = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const send = (text: string) => wsRef.current?.readyState === WebSocket.OPEN && wsRef.current.send(text);
    const player = new Player(canvasRef, () => send("key"));

    async function start() {
      // Activities run on <client_id>.discordsays.com
      const sdk = new DiscordSDK(location.hostname.split(".")[0]);
      await sdk.ready();
      const channelId = sdk.channelId;
      if (!channelId) return setState({ kind: "no_link" });
      const res = await fetch(`/api/activity/${channelId}`);
      if (res.status === 404) return setState({ kind: "no_link" });
      if (!res.ok) throw new Error(`Could not reach sharr (${res.status})`);
      const { room } = (await res.json()) as { room: { name: string } };
      connect(channelId, room.name);
    }

    function connect(channelId: string, room: string) {
      if (stopped) return;
      const ws = new WebSocket(`wss://${location.host}/api/activity/${channelId}/stream`);
      wsRef.current = ws;
      ws.binaryType = "arraybuffer";
      ws.onmessage = (e) => {
        if (typeof e.data !== "string") return player.frame(e.data as ArrayBuffer);
        const msg = JSON.parse(e.data) as { type: "tracks"; tracks: Share[]; selected: number };
        if (msg.type !== "tracks") return;
        const share = msg.tracks.find((s) => s.id === msg.selected);
        player.watch(share && (share.codec === "vp8" || share.codec === "h264") ? share : null);
        setState({ kind: "live", room, shares: msg.tracks, selected: msg.selected });
      };
      ws.onclose = () => {
        player.watch(null);
        if (stopped) return;
        setState({ kind: "offline", room });
        // The sharr server answers 404 once the room is closed, which ends up here again
        retry = setTimeout(async () => {
          const res = await fetch(`/api/activity/${channelId}`).catch(() => null);
          if (res?.status === 404) setState({ kind: "no_link" });
          else connect(channelId, room);
        }, 3000);
      };
    }

    start().catch((err) => {
      toast.error(err instanceof Error ? err.message : String(err));
      setState({ kind: "no_link" });
    });
    return () => {
      stopped = true;
      clearTimeout(retry);
      wsRef.current?.close();
      player.watch(null);
    };
  }, []);

  const room = state.kind === "live" || state.kind === "offline" ? state.room : null;
  const shares = state.kind === "live" ? state.shares : [];
  const selected = state.kind === "live" ? shares.find((s) => s.id === state.selected) : undefined;
  const playable = selected && (selected.codec === "vp8" || selected.codec === "h264");

  let content;
  if (state.kind === "connecting") {
    content = <CenterStack icon={MonitorUp} text="Connecting..." className="flex-1 justify-center" />;
  } else if (state.kind === "no_link") {
    content = (
      <CenterStack
        icon={Link2Off}
        text="No room is linked to this channel. Run /sharr with a room link."
        className="flex-1 justify-center"
      />
    );
  } else if (state.kind === "offline") {
    content = <CenterStack icon={Unplug} text="Lost the connection. Reconnecting..." className="flex-1 justify-center" />;
  } else if (!selected) {
    content = <CenterStack icon={MonitorUp} text="Nobody is sharing yet." className="flex-1 justify-center" />;
  } else if (!playable) {
    content = (
      <CenterStack
        icon={MonitorUp}
        text={`${selected.name} is sharing in a format this can't play yet (${selected.codec}).`}
        className="flex-1 justify-center"
      />
    );
  }

  return (
    <div className="flex h-dvh flex-col">
      <TopBar>
        <LogoMark />
        <h1 className="font-display min-w-0 flex-1 truncate text-lg font-semibold">{room ?? "sharr"}</h1>
        {shares.length > 1 && selected && (
          <Select value={String(selected.id)} onValueChange={(id) => wsRef.current?.send(`select:${id}`)}>
            <SelectTrigger size="sm" className="max-w-48 min-w-0 shrink">
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper" align="end">
              {shares.map((s) => (
                <SelectItem key={s.id} value={String(s.id)}>
                  <UserAvatar name={s.name} url={avatarUrl(s.avatar_url)} className="size-5 text-[0.625rem]" />
                  <span className="truncate">{s.name}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </TopBar>
      <main className="flex min-h-0 flex-1 flex-col p-2">
        {content}
        <div className={cn("group relative min-h-0 flex-1 overflow-hidden rounded-md bg-black", content && "hidden")}>
          <canvas ref={canvasRef} className="size-full object-contain" />
          {selected && (
            <div className="absolute inset-x-2 bottom-2 flex items-center opacity-0 transition-opacity group-hover:opacity-100 pointer-coarse:opacity-100">
              <span className="flex h-8 min-w-0 items-center gap-2 rounded-lg bg-black/60 pr-2.5 pl-1.5 text-xs text-white">
                <UserAvatar
                  name={selected.name}
                  url={avatarUrl(selected.avatar_url)}
                  className="size-5 bg-white/20 text-[0.625rem] text-white"
                />
                <span className="truncate">{selected.name}</span>
              </span>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

// Frames: 1 byte flags (1 = keyframe), 2 bytes share id, 8 bytes timestamp in microseconds
// (float64), then the frame
class Player {
  private decoder: VideoDecoder | null = null;
  private share: Share | null = null;
  private waitKey = true;

  constructor(
    private canvas: React.RefObject<HTMLCanvasElement | null>,
    private requestKey: () => void,
  ) {}

  watch(share: Share | null) {
    if (share?.id === this.share?.id && share?.codec === this.share?.codec) return;
    this.share = share;
    this.reset();
  }

  frame(buf: ArrayBuffer) {
    if (!this.share || buf.byteLength < 12) return;
    const view = new DataView(buf);
    // Frames of the share we just switched away from can still be on the way
    if (view.getUint16(1) !== this.share.id) return;
    const key = (view.getUint8(0) & 1) === 1;
    const timestamp = view.getFloat64(3);
    const data = new Uint8Array(buf, 11);
    if (this.waitKey && !key) return;

    if (!this.decoder || this.decoder.state !== "configured") {
      if (!key) return;
      const codec = this.share.codec === "vp8" ? "vp8" : h264Codec(data);
      if (!codec) return;
      this.decoder = new VideoDecoder({ output: (f) => this.draw(f), error: () => this.broken() });
      this.decoder.configure({ codec, optimizeForLatency: true });
    }
    // Falling behind: skip to the next keyframe instead of queueing up delay
    if (this.decoder.decodeQueueSize > 30) return this.broken();
    this.waitKey = false;
    try {
      this.decoder.decode(new EncodedVideoChunk({ type: key ? "key" : "delta", timestamp, data }));
    } catch {
      this.broken();
    }
  }

  private draw(frame: VideoFrame) {
    const canvas = this.canvas.current;
    if (canvas) {
      if (canvas.width !== frame.displayWidth) canvas.width = frame.displayWidth;
      if (canvas.height !== frame.displayHeight) canvas.height = frame.displayHeight;
      canvas.getContext("2d")?.drawImage(frame, 0, 0);
    }
    frame.close();
  }

  private broken() {
    this.reset();
    this.requestKey();
  }

  private reset() {
    if (this.decoder && this.decoder.state !== "closed") this.decoder.close();
    this.decoder = null;
    this.waitKey = true;
  }
}

// avc1.PPCCLL from the SPS (profile, constraints, level). Annex B, so no description needed.
function h264Codec(data: Uint8Array) {
  for (let i = 0; i + 6 < data.length; i++) {
    if (data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 1 && (data[i + 3] & 0x1f) === 7) {
      const hex = (n: number) => n.toString(16).padStart(2, "0");
      return `avc1.${hex(data[i + 4])}${hex(data[i + 5])}${hex(data[i + 6])}`;
    }
  }
  return null;
}

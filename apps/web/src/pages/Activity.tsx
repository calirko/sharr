import { DiscordSDK } from "@discord/embedded-app-sdk";
import { CircleAlert, Link2Off, MonitorPlay } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { CenterStack } from "@/components/Layout";

// Discord Activity test (calico app, URL mapping `/` to this server). `/sharr <link>` in the bot
// links the channel to a room. Discord blocks WebRTC here, so sharr-relay (apps/relay) sends the
// share's encoded frames over a websocket and we decode them with WebCodecs.

type State =
  | { kind: "connecting" }
  | { kind: "no_link" }
  | { kind: "waiting"; room: string }
  | { kind: "watching"; room: string; name: string }
  | { kind: "error"; text: string };

type Control = { type: "none" } | { type: "track"; codec: "vp8" | "h264"; name: string } | { type: "unsupported"; codec: string };

export function ActivityPage() {
  const [state, setState] = useState<State>({ kind: "connecting" });
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let stopped = false;
    let ws: WebSocket | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const player = new Player(canvasRef, () => ws?.readyState === WebSocket.OPEN && ws.send("key"));

    async function start() {
      // Activities run on <client_id>.discordsays.com
      const sdk = new DiscordSDK(location.hostname.split(".")[0]);
      await sdk.ready();
      const channelId = sdk.channelId;
      if (!channelId) return setState({ kind: "no_link" });
      const res = await fetch(`/api/activity/${channelId}`);
      if (res.status === 404) return setState({ kind: "no_link" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { room } = (await res.json()) as { room: { name: string } };
      setState({ kind: "waiting", room: room.name });
      connect(channelId, room.name);
    }

    function connect(channelId: string, room: string) {
      if (stopped) return;
      ws = new WebSocket(`wss://${location.host}/api/activity/${channelId}/stream`);
      ws.binaryType = "arraybuffer";
      ws.onmessage = (e) => {
        if (typeof e.data !== "string") return player.frame(e.data as ArrayBuffer);
        const msg = JSON.parse(e.data) as Control;
        if (msg.type === "track") {
          player.setCodec(msg.codec);
          setState({ kind: "watching", room, name: msg.name });
        } else if (msg.type === "unsupported") {
          player.setCodec(null);
          setState({ kind: "error", text: `The share uses ${msg.codec}, which this test can't play yet.` });
        } else {
          player.setCodec(null);
          setState({ kind: "waiting", room });
        }
      };
      ws.onclose = () => {
        player.setCodec(null);
        if (!stopped) retry = setTimeout(() => connect(channelId, room), 3000);
      };
    }

    start().catch((err) => setState({ kind: "error", text: err instanceof Error ? err.message : String(err) }));
    return () => {
      stopped = true;
      clearTimeout(retry);
      ws?.close();
      player.setCodec(null);
    };
  }, []);

  return (
    <main className="relative flex h-dvh items-center justify-center bg-black p-4 text-white">
      <canvas
        ref={canvasRef}
        className={state.kind === "watching" ? "absolute inset-0 size-full object-contain" : "hidden"}
      />
      {state.kind === "watching" && (
        <p className="absolute top-2 left-2 rounded bg-black/60 px-2 py-1 text-sm">
          {state.name} in <span className="font-display">{state.room}</span>
        </p>
      )}
      {state.kind === "connecting" && <CenterStack icon={MonitorPlay} text="Connecting..." />}
      {state.kind === "no_link" && (
        <CenterStack icon={Link2Off} text="No room linked to this channel. Run /sharr with a room link first." />
      )}
      {state.kind === "waiting" && (
        <CenterStack icon={MonitorPlay} text={`Nobody is sharing in ${state.room} yet.`} />
      )}
      {state.kind === "error" && <CenterStack icon={CircleAlert} text={state.text} />}
    </main>
  );
}

// Frames: 1 byte flags (1 = keyframe), 8 bytes timestamp in microseconds (float64), then the frame
class Player {
  private decoder: VideoDecoder | null = null;
  private codec: "vp8" | "h264" | null = null;
  private waitKey = true;

  constructor(
    private canvas: React.RefObject<HTMLCanvasElement | null>,
    private requestKey: () => void,
  ) {}

  setCodec(codec: "vp8" | "h264" | null) {
    this.codec = codec;
    this.reset();
  }

  frame(buf: ArrayBuffer) {
    if (!this.codec || buf.byteLength < 10) return;
    const view = new DataView(buf);
    const key = (view.getUint8(0) & 1) === 1;
    const timestamp = view.getFloat64(1);
    const data = new Uint8Array(buf, 9);
    if (this.waitKey && !key) return;

    if (!this.decoder || this.decoder.state !== "configured") {
      if (!key) return;
      const codec = this.codec === "vp8" ? "vp8" : h264Codec(data);
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

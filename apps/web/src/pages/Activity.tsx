import { DiscordSDK } from "@discord/embedded-app-sdk";
import { MonitorPlay } from "lucide-react";
import { useEffect, useState } from "react";
import { CenterStack } from "@/components/Layout";

// Test page for running inside a Discord Activity (calico app, URL mapping `/` to this server).
// Checks the SDK handshake and whether WebRTC can get out of Discord's proxy.
export function ActivityPage() {
  const [info, setInfo] = useState<Record<string, string>>({ status: "connecting", webrtc: "testing" });
  const set = (key: string, value: string) => setInfo((prev) => ({ ...prev, [key]: value }));

  useEffect(() => {
    const onError = (e: ErrorEvent) => set("page error", e.message);
    window.addEventListener("error", onError);

    try {
      // Activities run on <client_id>.discordsays.com
      const sdk = new DiscordSDK(location.hostname.split(".")[0]);
      sdk
        .ready()
        .then(() => {
          set("status", "ok");
          set("platform", sdk.platform);
          set("instance", sdk.instanceId);
          set("channel", sdk.channelId ?? "-");
        })
        .catch((err) => set("status", `error: ${err?.message ?? err}`));
    } catch (err) {
      set("status", `error: ${errText(err)}`);
    }

    // A server reflexive candidate means STUN over UDP reached the internet
    let pc: RTCPeerConnection | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const conn = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
      pc = conn;
      const types = new Set<string>();
      conn.onicecandidate = (e) => {
        if (e.candidate?.type) types.add(e.candidate.type);
      };
      conn.createDataChannel("probe");
      conn
        .createOffer()
        .then((offer) => conn.setLocalDescription(offer))
        .catch((err) => set("webrtc", `error: ${errText(err)}`));
      timer = setTimeout(() => {
        const found = [...types].join(", ") || "none";
        set("webrtc", types.has("srflx") ? `ok (${found})` : `blocked? (${found})`);
        conn.close();
      }, 5000);
    } catch (err) {
      set("webrtc", `error: ${errText(err)}`);
    }

    return () => {
      window.removeEventListener("error", onError);
      clearTimeout(timer);
      pc?.close();
    };
  }, []);

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center p-4">
      <CenterStack icon={MonitorPlay} text="sharr activity test">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-left text-sm">
          {Object.entries(info).map(([key, value]) => (
            <div key={key} className="contents">
              <dt className="text-muted-foreground">{key}</dt>
              <dd className="break-all">{value}</dd>
            </div>
          ))}
        </dl>
      </CenterStack>
    </main>
  );
}

function errText(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}

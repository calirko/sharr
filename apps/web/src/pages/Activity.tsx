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

    // A server reflexive candidate means STUN over UDP reached the internet
    const pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
    const types = new Set<string>();
    pc.onicecandidate = (e) => {
      if (e.candidate?.type) types.add(e.candidate.type);
    };
    pc.createDataChannel("probe");
    pc.createOffer()
      .then((offer) => pc.setLocalDescription(offer))
      .catch((err) => set("webrtc", `error: ${err?.message ?? err}`));
    const timer = setTimeout(() => {
      const found = [...types].join(", ") || "none";
      set("webrtc", types.has("srflx") ? `ok (${found})` : `blocked? (${found})`);
      pc.close();
    }, 5000);
    return () => {
      clearTimeout(timer);
      pc.close();
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

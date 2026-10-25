import { useParticipants } from "@livekit/components-react";
import { Crown, MonitorUp } from "lucide-react";
import { DiscordIcon } from "@/components/DiscordIcon";
import { ParticipantAvatar } from "@/components/UserAvatar";
import { Badge } from "@/components/ui/badge";

export function ParticipantList({ creatorId }: { creatorId: string }) {
  const participants = useParticipants();
  // Owner first, then everyone in join order
  const sorted = [...participants].sort((a, b) => Number(b.identity === creatorId) - Number(a.identity === creatorId));

  return (
    <section className="flex max-h-32 shrink-0 flex-col border-b side:max-h-[40%]">
      <h2 className="text-muted-foreground px-3 pt-3 pb-1 text-xs font-bold">In the room ({participants.length})</h2>
      <ul className="flex flex-col gap-1.5 overflow-y-auto px-3 pb-3 text-sm">
        {sorted.map((p) => (
          <li key={p.identity} className="flex items-center gap-2">
            <ParticipantAvatar participant={p} />
            <span className="min-w-0 truncate">
              {p.name || p.identity}

              {p.isLocal && <span className="text-muted-foreground"> (you)</span>}
            </span>
            {p.attributes.discord_username && (
              <span title={`Discord: ${p.attributes.discord_username}`} className="text-[#5865F2]">
                <DiscordIcon className="size-3.5" />
              </span>
            )}
            {p.identity === creatorId && (
              <Badge>
                <Crown /> Owner
              </Badge>
            )}
            {p.isScreenShareEnabled && (
              <Badge variant="secondary">
                <MonitorUp /> Sharing
              </Badge>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

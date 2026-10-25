import { useParticipants } from "@livekit/components-react";
import { Crown, MonitorUp } from "lucide-react";
import { DiscordIcon } from "@/components/DiscordIcon";
import { ParticipantAvatar } from "@/components/UserAvatar";

export function ParticipantList({ creatorId }: { creatorId: string }) {
  const participants = useParticipants();
  // Owner first, then everyone in join order
  const sorted = [...participants].sort((a, b) => Number(b.identity === creatorId) - Number(a.identity === creatorId));

  return (
    <section className="flex h-full flex-col">
      <h2 className="text-muted-foreground shrink-0 px-3 pt-3 pb-1.5 text-xs font-medium">People</h2>
      <ul className="flex min-h-0 flex-col gap-0.5 overflow-y-auto px-1.5 pb-2 text-sm">
        {sorted.map((p) => (
          <li key={p.identity} className="flex h-8 items-center gap-2 rounded-md px-1.5">
            <span className="relative">
              <ParticipantAvatar participant={p} />
              {p.attributes.discord_username && (
                <span
                  title={`Discord: ${p.attributes.discord_username}`}
                  className="bg-background absolute -right-1 -bottom-1 flex rounded-full p-px text-[#5865F2]"
                >
                  <DiscordIcon className="size-2.5" />
                </span>
              )}
            </span>
            <span className="min-w-0 flex-1 truncate">
              {p.name || p.identity}
              {p.isLocal && <span className="text-muted-foreground"> (you)</span>}
            </span>
            {p.isScreenShareEnabled && (
              <span title="Sharing" className="text-primary">
                <MonitorUp className="size-3.5" />
              </span>
            )}
            {p.identity === creatorId && (
              <span title="Owner" className="text-amber-400">
                <Crown className="size-3.5" />
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

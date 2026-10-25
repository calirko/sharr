import type { Participant } from "livekit-client";
import { useState } from "react";
import { cn } from "@/lib/utils";

// Discord avatar when there is one, else the first letter of the name
export function UserAvatar({ name, url, className }: { name: string; url?: string; className?: string }) {
  const [broken, setBroken] = useState(false);
  const letter = [...name.trim()][0]?.toUpperCase() ?? "?";
  return (
    <span
      className={cn(
        "bg-muted text-muted-foreground flex size-6 shrink-0 items-center justify-center overflow-hidden rounded-full text-xs font-bold select-none",
        className,
      )}
    >
      {url && !broken ? (
        <img src={url} alt="" className="size-full object-cover" onError={() => setBroken(true)} />
      ) : (
        letter
      )}
    </span>
  );
}

export function ParticipantAvatar({ participant, className }: { participant: Participant; className?: string }) {
  return (
    <UserAvatar
      name={participant.name || participant.identity}
      url={participant.attributes.avatar_url}
      className={className}
    />
  );
}

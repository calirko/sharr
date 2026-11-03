import { Check, Link, Share2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";

const roomUrl = (id: string) => `${window.location.origin}/r/${id}`;

// Phones get the system share sheet, everything else copies to the clipboard
const canNativeShare = () => typeof navigator.share === "function" && window.matchMedia("(pointer: coarse)").matches;

// True when the link went to the clipboard
export async function shareRoomLink(roomId: string, roomName: string) {
  const url = roomUrl(roomId);
  if (canNativeShare()) {
    await navigator.share({ title: roomName, url }).catch(() => {});
    return false;
  }
  await navigator.clipboard.writeText(url);
  return true;
}

export const RoomLinkIcon = () => (canNativeShare() ? <Share2 /> : <Link />);

// Rooms aren't listed for other people, so the link is how they get in
export function CopyLinkButton({ roomId, roomName, compact }: { roomId: string; roomName: string; compact?: boolean }) {
  const [copied, setCopied] = useState(false);

  async function share() {
    if (!(await shareRoomLink(roomId, roomName))) return;
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const Icon = copied ? Check : canNativeShare() ? Share2 : Link;

  if (compact) {
    return (
      <Button variant="ghost" size="icon" title="Copy room link" onClick={share}>
        <Icon />
      </Button>
    );
  }
  return (
    <Button variant="ghost" size="sm" title="Copy room link" onClick={share}>
      <Icon /> <span className="hidden sm:inline">{copied ? "Copied" : "Invite"}</span>
    </Button>
  );
}

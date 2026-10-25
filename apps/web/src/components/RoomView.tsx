import {
  useAudioPlayback,
  useLocalParticipantPermissions,
  useParticipants,
  useRoomContext,
  useTracks,
} from "@livekit/components-react";
import { Crown, LogOut, MessageSquare, Settings, Users } from "lucide-react";
import { RoomEvent, Track, type RemoteParticipant, type RemoteTrackPublication } from "livekit-client";
import { useEffect, useState } from "react";
import { ChatPanel } from "@/components/ChatPanel";
import { CopyLinkButton } from "@/components/CopyLinkButton";
import { ParticipantList } from "@/components/ParticipantList";
import { RoomSettingsDialog } from "@/components/RoomSettingsDialog";
import { ScreenGrid } from "@/components/ScreenGrid";
import { ShareButton } from "@/components/ShareButton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { JoinInfo, Room } from "@/lib/api";
import { playSound } from "@/lib/sounds";
import { cn } from "@/lib/utils";

type Props = { room: Room; info: JoinInfo; onRoomChange: (room: Room) => void };

export function RoomView({ room, info, onRoomChange }: Props) {
  const lkRoom = useRoomContext();
  const participants = useParticipants();
  const screens = useTracks([Track.Source.ScreenShare]);
  const permissions = useLocalParticipantPermissions();
  const { canPlayAudio, startAudio } = useAudioPlayback();
  const canPlayVideo = useVideoPlayback();
  const [chatOpen, setChatOpen] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Remote only: you already know when you start or stop your own share, or join
  useEffect(() => {
    // Someone leaving while sharing unpublishes first, then disconnects. Hold the stop
    // chime briefly so they get only the leave sound.
    const pendingStops = new Map<string, number>();
    const onPublished = (pub: RemoteTrackPublication) => {
      if (pub.source === Track.Source.ScreenShare) playSound("shareStart");
    };
    const onUnpublished = (pub: RemoteTrackPublication, p: RemoteParticipant) => {
      if (pub.source !== Track.Source.ScreenShare) return;
      const timer = window.setTimeout(() => {
        pendingStops.delete(p.identity);
        playSound("shareStop");
      }, 300);
      pendingStops.set(p.identity, timer);
    };
    // Only fires for people arriving after us, not for whoever was already here
    const onJoin = () => playSound("join");
    const onLeave = (p: RemoteParticipant) => {
      clearTimeout(pendingStops.get(p.identity));
      pendingStops.delete(p.identity);
      playSound("leave");
    };
    lkRoom
      .on(RoomEvent.TrackPublished, onPublished)
      .on(RoomEvent.TrackUnpublished, onUnpublished)
      .on(RoomEvent.ParticipantConnected, onJoin)
      .on(RoomEvent.ParticipantDisconnected, onLeave);
    return () => {
      pendingStops.forEach((t) => clearTimeout(t));
      lkRoom
        .off(RoomEvent.TrackPublished, onPublished)
        .off(RoomEvent.TrackUnpublished, onUnpublished)
        .off(RoomEvent.ParticipantConnected, onJoin)
        .off(RoomEvent.ParticipantDisconnected, onLeave);
    };
  }, [lkRoom]);

  // Permissions change live when the creator edits who can share
  const canShare = permissions?.canPublish ?? info.can_share;

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-2 border-b px-3 py-2">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <h1 className="truncate text-lg font-extrabold tracking-tight">{room.name}</h1>
          {info.is_creator && (
            <Badge>
              <Crown /> Owner
            </Badge>
          )}
        </div>
        <Badge variant="secondary">
          <Users /> {participants.length}
        </Badge>
        {canShare && <ShareButton />}
        <CopyLinkButton roomId={room.id} roomName={room.name} />
        <Button
          variant={chatOpen ? "secondary" : "ghost"}
          size="icon"
          title="Chat"
          onClick={() => setChatOpen(!chatOpen)}
        >
          <MessageSquare />
        </Button>
        <Button variant="ghost" size="icon" title="Settings" onClick={() => setSettingsOpen(true)}>
          <Settings />
        </Button>
        <Button variant="destructive" size="icon" title="Leave" onClick={() => lkRoom.disconnect()}>
          <LogOut />
        </Button>
      </header>

      {(!canPlayAudio || !canPlayVideo) && (
        // Both must start from a user gesture. iOS can block even muted video (e.g. Low Power Mode).
        <button
          className="bg-primary/12 text-primary py-2 text-sm font-medium"
          onClick={() => {
            startAudio();
            lkRoom.startVideo();
          }}
        >
          {canPlayVideo ? "Click to enable audio" : "Tap to start playback"}
        </button>
      )}

      <div className="flex min-h-0 flex-1 flex-col side:flex-row">
        <section className="flex min-h-0 flex-1 p-2">
          <ScreenGrid tracks={screens} />
        </section>
        <aside
          className={cn(
            "side:w-[min(20rem,40vw)] side:border-t-0 side:border-l flex min-h-0 flex-col border-t",
            screens.length > 0 ? "side:h-auto h-2/5" : "side:flex-none flex-1",
            !chatOpen && "hidden",
          )}
        >
          <ParticipantList creatorId={room.creator_id} />
          <ChatPanel />
        </aside>
      </div>

      <RoomSettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        room={room}
        isCreator={info.is_creator}
        onRoomChange={onRoomChange}
      />
    </div>
  );
}

// components-react has useAudioPlayback but nothing for video
function useVideoPlayback() {
  const room = useRoomContext();
  const [canPlay, setCanPlay] = useState(room.canPlaybackVideo);
  useEffect(() => {
    const update = () => setCanPlay(room.canPlaybackVideo);
    room.on(RoomEvent.VideoPlaybackStatusChanged, update);
    return () => {
      room.off(RoomEvent.VideoPlaybackStatusChanged, update);
    };
  }, [room]);
  return canPlay;
}

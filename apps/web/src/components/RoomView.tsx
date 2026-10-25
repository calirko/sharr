import {
  useAudioPlayback,
  useLocalParticipantPermissions,
  useParticipants,
  useRoomContext,
  useTracks,
} from "@livekit/components-react";
import { LogOut, MessageSquare, Settings } from "lucide-react";
import { RoomEvent, Track, type RemoteParticipant, type RemoteTrackPublication } from "livekit-client";
import { useEffect, useState } from "react";
import { useDefaultLayout } from "react-resizable-panels";
import { ChatPanel } from "@/components/ChatPanel";
import { CopyLinkButton } from "@/components/CopyLinkButton";
import { ParticipantList } from "@/components/ParticipantList";
import { RoomSettingsDialog } from "@/components/RoomSettingsDialog";
import { ScreenGrid } from "@/components/ScreenGrid";
import { ShareButton } from "@/components/ShareButton";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { Button } from "@/components/ui/button";
import type { JoinInfo, Room } from "@/lib/api";
import { playSound } from "@/lib/sounds";
import { cn } from "@/lib/utils";

// Same as the `side` variant in index.css
const SIDE_QUERY = "(width >= 48rem), (orientation: landscape)";

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
  const side = useMediaQuery(SIDE_QUERY);
  // Sizes are remembered per layout, and with or without the sidebar
  const mainLayout = useDefaultLayout({
    id: side ? "room-side" : "room-stacked",
    panelIds: chatOpen ? ["screens", "sidebar"] : ["screens"],
  });
  const sidebarLayout = useDefaultLayout({ id: "room-sidebar" });

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
      <header className="flex h-13 shrink-0 items-center gap-2 border-b px-3">
        <h1 className="min-w-0 flex-1 truncate font-semibold">{room.name}</h1>
        <div className="flex items-center gap-2">
          {canShare && screens.length > 0 && <ShareButton />}
          <CopyLinkButton roomId={room.id} roomName={room.name} />
        </div>
        <div className="bg-border mx-1 h-5 w-px" />
        <div className="flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="sm"
            title="People and chat"
            className={cn("tabular-nums", chatOpen && "bg-foreground/7 text-foreground")}
            onClick={() => setChatOpen(!chatOpen)}
          >
            <MessageSquare /> {participants.length}
          </Button>
          <Button variant="ghost" size="icon-sm" title="Settings" onClick={() => setSettingsOpen(true)}>
            <Settings />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            title="Leave"
            className="hover:bg-destructive/12 hover:text-destructive"
            onClick={() => lkRoom.disconnect()}
          >
            <LogOut />
          </Button>
        </div>
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

      <ResizablePanelGroup
        key={side ? "side" : "stacked"}
        orientation={side ? "horizontal" : "vertical"}
        className="min-h-0 flex-1"
        {...mainLayout}
      >
        <ResizablePanel id="screens" minSize="20%" className="flex p-2">
          <ScreenGrid tracks={screens} emptyAction={canShare && <ShareButton large />} />
        </ResizablePanel>
        {chatOpen && (
          <>
            <ResizableHandle withHandle />
            <ResizablePanel
              id="sidebar"
              defaultSize={side ? "20rem" : "40%"}
              minSize={side ? "14rem" : "20%"}
              maxSize="70%"
              groupResizeBehavior={side ? "preserve-pixel-size" : "preserve-relative-size"}
            >
              <ResizablePanelGroup orientation="vertical" {...sidebarLayout}>
                <ResizablePanel id="people" defaultSize="30%" minSize="3rem">
                  <ParticipantList creatorId={room.creator_id} />
                </ResizablePanel>
                <ResizableHandle withHandle />
                <ResizablePanel id="chat" minSize="6rem" className="flex flex-col">
                  <ChatPanel />
                </ResizablePanel>
              </ResizablePanelGroup>
            </ResizablePanel>
          </>
        )}
      </ResizablePanelGroup>

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

function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mql = window.matchMedia(query);
    const update = () => setMatches(mql.matches);
    mql.addEventListener("change", update);
    return () => mql.removeEventListener("change", update);
  }, [query]);
  return matches;
}

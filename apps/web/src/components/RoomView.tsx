import {
  useAudioPlayback,
  useLocalParticipantPermissions,
  useParticipants,
  useRoomContext,
  useTracks,
} from "@livekit/components-react";
import { Ellipsis, LogOut, MessageSquare, Settings } from "lucide-react";
import {
  RoomEvent,
  Track,
  type Participant,
  type RemoteParticipant,
  type RemoteTrackPublication,
} from "livekit-client";
import { useEffect, useRef, useState } from "react";
import { useDefaultLayout } from "react-resizable-panels";
import { ChatPanel } from "@/components/ChatPanel";
import { CopyLinkButton, RoomLinkIcon, shareRoomLink } from "@/components/CopyLinkButton";
import { ParticipantList } from "@/components/ParticipantList";
import { RoomSettingsDialog } from "@/components/RoomSettingsDialog";
import { UserMenu } from "@/components/UserMenu";
import { ScreenGrid } from "@/components/ScreenGrid";
import { ShareButton } from "@/components/ShareButton";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import type { JoinInfo, Room } from "@/lib/api";
import { notify } from "@/lib/notify";
import { isSharing, stopShare } from "@/lib/share";
import { playSound } from "@/lib/sounds";
import { useUser } from "@/lib/user";
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
  // The sidebar moved to the left, so side by side sizes are saved under a new id
  const mainLayout = useDefaultLayout({
    id: side ? "room-side-left" : "room-stacked",
    panelIds: !chatOpen ? ["screens"] : side ? ["sidebar", "screens"] : ["screens", "sidebar"],
  });
  const sidebarLayout = useDefaultLayout({ id: "room-sidebar" });
  const { user } = useUser();
  // Read from the event handlers without re-subscribing
  const latest = useRef({ roomName: room.name, userKind: user?.kind });
  latest.current = { roomName: room.name, userKind: user?.kind };

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
    const presence = (p: RemoteParticipant, verb: string) => {
      const { roomName, userKind } = latest.current;
      notify("presence", userKind, {
        title: roomName,
        body: `${p.name || p.identity} ${verb}`,
        tag: `presence:${lkRoom.name}`,
        url: `/r/${lkRoom.name}`,
        icon: p.attributes.avatar_url,
      });
    };
    // Only fires for people arriving after us, not for whoever was already here
    const onJoin = (p: RemoteParticipant) => {
      playSound("join");
      presence(p, "joined");
    };
    const onLeave = (p: RemoteParticipant) => {
      clearTimeout(pendingStops.get(p.identity));
      pendingStops.delete(p.identity);
      playSound("leave");
      presence(p, "left");
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

  // LiveKit drops the tracks when the creator takes sharing away, but the capture, Auto and the
  // app's system audio are ours to stop
  useEffect(() => {
    const onPermissions = (_prev: unknown, p: Participant) => {
      if (p !== lkRoom.localParticipant || p.permissions?.canPublish !== false) return;
      if (!isSharing() && !p.getTrackPublication(Track.Source.ScreenShare)) return;
      stopShare(lkRoom.localParticipant);
      toast("The room creator turned off sharing.");
    };
    lkRoom.on(RoomEvent.ParticipantPermissionsChanged, onPermissions);
    return () => {
      lkRoom.off(RoomEvent.ParticipantPermissionsChanged, onPermissions);
    };
  }, [lkRoom]);

  // Permissions change live when the creator edits who can share
  const canShare = permissions?.canPublish ?? info.can_share;

  const sidebar = chatOpen && (
    <ResizablePanel
      id="sidebar"
      defaultSize={side ? "20rem" : "40%"}
      minSize={side ? "14rem" : "20%"}
      maxSize="70%"
      groupResizeBehavior={side ? "preserve-pixel-size" : "preserve-relative-size"}
    >
      <ResizablePanelGroup orientation="vertical" {...sidebarLayout}>
        <ResizablePanel id="people" defaultSize="30%" minSize="3rem">
          <ParticipantList roomId={room.id} creatorId={room.creator_id} canKick={info.is_creator} />
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel id="chat" minSize="6rem" className="flex flex-col">
          <ChatPanel roomName={room.name} />
        </ResizablePanel>
      </ResizablePanelGroup>
    </ResizablePanel>
  );

  return (
    <div className="flex h-full flex-col">
      {/* Room controls sit right after the name, the user menu stays on the far right */}
      <header className="flex h-13 shrink-0 items-center gap-1 border-b px-2 sm:gap-2 sm:px-3">
        <h1 className="font-display min-w-0 shrink truncate text-lg font-semibold">{room.name}</h1>
        {canShare && screens.length > 0 && (
          <div className="flex shrink-0 items-center gap-1 sm:gap-2">
            <ShareButton />
          </div>
        )}
        <div className="bg-border mx-1 h-5 w-px shrink-0 max-sm:hidden" />
        <div className="flex shrink-0 items-center gap-0.5">
          <Button
            variant="ghost"
            size="sm"
            title="People and chat"
            className={cn("tabular-nums", chatOpen && "bg-foreground/7 text-foreground")}
            onClick={() => setChatOpen(!chatOpen)}
          >
            <MessageSquare /> {participants.length}
          </Button>
          <div className="max-sm:hidden">
            <CopyLinkButton roomId={room.id} roomName={room.name} />
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            title="Settings"
            className="max-sm:hidden"
            onClick={() => setSettingsOpen(true)}
          >
            <Settings />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            title="Leave"
            className="hover:bg-destructive/12 hover:text-destructive max-sm:hidden"
            onClick={() => lkRoom.disconnect()}
          >
            <LogOut />
          </Button>
          {/* Narrow screens: invite, settings and leave go in a menu */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" title="More" className="sm:hidden">
                <Ellipsis />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem
                onSelect={async () => {
                  if (await shareRoomLink(room.id, room.name)) toast("Link copied");
                }}
              >
                <RoomLinkIcon /> Invite
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setSettingsOpen(true)}>
                <Settings /> Settings
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => lkRoom.disconnect()}>
                <LogOut /> Leave
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <div className="min-w-0 flex-1" />
        <UserMenu compact />
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
        {/* Side by side the sidebar goes left, stacked (phones) the screens stay on top */}
        {side && sidebar}
        {side && chatOpen && <ResizableHandle withHandle />}
        <ResizablePanel id="screens" minSize="20%" className="flex p-2">
          <ScreenGrid tracks={screens} emptyAction={canShare && <ShareButton large />} />
        </ResizablePanel>
        {!side && chatOpen && <ResizableHandle withHandle />}
        {!side && sidebar}
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

import { useState } from "react";
import { ShareModeSelect } from "@/components/ShareModeSelect";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { api, type Room, type ShareMode } from "@/lib/api";
import { getIncludeDiscord, hasNativeSystemAudio, setIncludeDiscord } from "@/lib/desktop";
import { errorText } from "@/lib/errors";
import { getSoundPrefs, setSoundPrefs, type SoundPrefs } from "@/lib/sounds";
import { toast } from "sonner";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  room: Room;
  isCreator: boolean;
  onRoomChange: (room: Room) => void;
};

// Sounds are per person and shown to everyone. Room options are for the creator only.
export function RoomSettingsDialog({ open, onOpenChange, room, isCreator, onRoomChange }: Props) {
  const [sounds, setSounds] = useState<SoundPrefs>(getSoundPrefs);
  const [includeDiscord, setDiscord] = useState(getIncludeDiscord);
  const [confirmClose, setConfirmClose] = useState(false);

  function setSound(key: keyof SoundPrefs, on: boolean) {
    const next = { ...sounds, [key]: on };
    setSounds(next);
    setSoundPrefs(next);
  }

  async function setShareMode(share_mode: ShareMode) {
    try {
      onRoomChange((await api.updateRoom(room.id, { share_mode })).room);
    } catch (err) {
      toast.error(errorText(err));
    }
  }

  // The server deletes the LiveKit room, which disconnects everyone including us
  async function close() {
    try {
      await api.closeRoom(room.id);
    } catch (err) {
      toast.error(errorText(err));
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setConfirmClose(false);
        onOpenChange(v);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
        </DialogHeader>

        <section className="flex flex-col gap-3">
          <h3 className="text-muted-foreground text-xs font-bold">Sounds</h3>
          <div className="flex items-center justify-between gap-4">
            <Label htmlFor="sound-chat">New chat messages</Label>
            <Switch id="sound-chat" checked={sounds.chat} onCheckedChange={(v) => setSound("chat", v)} />
          </div>
          <div className="flex items-center justify-between gap-4">
            <Label htmlFor="sound-share">Someone starts or stops sharing</Label>
            <Switch id="sound-share" checked={sounds.share} onCheckedChange={(v) => setSound("share", v)} />
          </div>
          <div className="flex items-center justify-between gap-4">
            <Label htmlFor="sound-presence">Someone joins or leaves</Label>
            <Switch id="sound-presence" checked={sounds.presence} onCheckedChange={(v) => setSound("presence", v)} />
          </div>
        </section>

        {hasNativeSystemAudio && (
          <section className="flex flex-col gap-3 border-t pt-4">
            <h3 className="text-muted-foreground text-xs font-bold">Share audio</h3>
            <div className="flex items-center justify-between gap-4">
              <Label htmlFor="share-discord">Include Discord audio</Label>
              <Switch
                id="share-discord"
                checked={includeDiscord}
                onCheckedChange={(v) => {
                  setDiscord(v);
                  setIncludeDiscord(v);
                }}
              />
            </div>
          </section>
        )}

        {isCreator && (
          <section className="flex flex-col gap-3 border-t pt-4">
            <h3 className="text-muted-foreground text-xs font-bold">Room</h3>
            <div className="flex flex-col gap-2">
              <Label>Who can share</Label>
              <ShareModeSelect value={room.share_mode} onChange={setShareMode} />
            </div>
            <div className="flex justify-end">
              {confirmClose ? (
                <Button variant="destructive" onClick={close}>
                  Close room for everyone
                </Button>
              ) : (
                <Button variant="outline" onClick={() => setConfirmClose(true)}>
                  Close room
                </Button>
              )}
            </div>
          </section>
        )}
      </DialogContent>
    </Dialog>
  );
}

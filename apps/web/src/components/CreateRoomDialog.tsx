import { Plus } from "lucide-react";
import { useState, type FormEvent } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ShareModeSelect } from "@/components/ShareModeSelect";
import { api, type ShareMode } from "@/lib/api";
import { errorText } from "@/lib/errors";
import { toast } from "sonner";

export function CreateRoomDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [, navigate] = useLocation();
  const [name, setName] = useState("");
  const [pin, setPin] = useState("");
  const [shareMode, setShareMode] = useState<ShareMode>("creator");
  const [busy, setBusy] = useState(false);

  const pinValid = pin === "" || /^\d{4,12}$/.test(pin);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const { room } = await api.createRoom({ name: name.trim(), pin: pin || undefined, share_mode: shareMode });
      navigate(`/r/${room.id}`);
    } catch (err) {
      toast.error(errorText(err));
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>New room</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Label htmlFor="room-name">Name</Label>
            <Input id="room-name" autoFocus maxLength={48} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="room-pin">PIN (optional)</Label>
            <Input
              id="room-pin"
              inputMode="numeric"
              placeholder="4 to 12 digits"
              maxLength={12}
              value={pin}
              aria-invalid={!pinValid}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label>Who can share</Label>
            <ShareModeSelect value={shareMode} onChange={setShareMode} />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={busy || !name.trim() || !pinValid}>
              <Plus /> Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

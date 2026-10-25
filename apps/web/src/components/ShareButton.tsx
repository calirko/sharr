import { useLocalParticipant } from "@livekit/components-react";
import { Check, MonitorOff, MonitorUp, SlidersHorizontal } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { errorText } from "@/lib/errors";
import {
  canCaptureScreen,
  fpsOptions,
  loadFps,
  loadQuality,
  qualityTiers,
  saveFps,
  saveQuality,
  type Fps,
  type QualityId,
} from "@/lib/quality";
import { startShare, stopShare, updateShare } from "@/lib/share";
import { toast } from "sonner";

// `large` is the call to action in the empty room, with the label always shown
export function ShareButton({ large }: { large?: boolean }) {
  const { localParticipant, isScreenShareEnabled } = useLocalParticipant();
  const [open, setOpen] = useState(false);
  const [quality, setQuality] = useState<QualityId>(loadQuality);
  const [fps, setFps] = useState<Fps>(loadFps);
  const [busy, setBusy] = useState(false);

  // Phones can watch but not share
  if (!canCaptureScreen()) return null;

  async function submit() {
    setBusy(true);
    saveQuality(quality);
    saveFps(fps);
    try {
      if (isScreenShareEnabled) await updateShare(localParticipant, quality, fps);
      else await startShare(localParticipant, quality, fps);
      setOpen(false);
    } catch (err) {
      // Closing the browser picker is not an error worth showing
      if (!(err instanceof Error && err.name === "NotAllowedError")) toast.error(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {isScreenShareEnabled ? (
        <>
          <Button variant="ghost" size="icon" title="Share quality" onClick={() => setOpen(true)}>
            <SlidersHorizontal />
          </Button>
          <Button variant="destructive" size="sm" onClick={() => stopShare(localParticipant)}>
            <MonitorOff /> <span className="hidden sm:inline">Stop</span>
          </Button>
        </>
      ) : (
        <Button size={large ? "lg" : "sm"} onClick={() => setOpen(true)}>
          <MonitorUp /> <span className={large ? undefined : "hidden sm:inline"}>{large ? "Share your screen" : "Share"}</span>
        </Button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{isScreenShareEnabled ? "Share quality" : "Share screen"}</DialogTitle>
            <DialogDescription>
              {isScreenShareEnabled
                ? "Applies right away, no need to stop sharing."
                : "Up to 1080p. Tab or system audio is shared if you allow it."}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Label>Quality</Label>
            <Select value={quality} onValueChange={(v) => setQuality(v as QualityId)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {qualityTiers.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.label} ({t.bitrate / 1_000_000} Mbps)
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-2">
            <Label>Frame rate</Label>
            <Select value={String(fps)} onValueChange={(v) => setFps(Number(v) as Fps)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {fpsOptions.map((f) => (
                  <SelectItem key={f} value={String(f)}>
                    {f} fps
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button onClick={submit} disabled={busy}>
              {isScreenShareEnabled ? (
                <>
                  <Check /> Apply
                </>
              ) : (
                <>
                  <MonitorUp /> Start sharing
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

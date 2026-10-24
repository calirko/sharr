import { useLocalParticipant } from "@livekit/components-react";
import { MonitorOff, MonitorUp } from "lucide-react";
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
import { startShare, stopShare } from "@/lib/share";

export function ShareButton() {
  const { localParticipant, isScreenShareEnabled } = useLocalParticipant();
  const [open, setOpen] = useState(false);
  const [quality, setQuality] = useState<QualityId>(loadQuality);
  const [fps, setFps] = useState<Fps>(loadFps);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Phones can watch but not share
  if (!canCaptureScreen()) return null;

  if (isScreenShareEnabled) {
    return (
      <Button variant="destructive" size="sm" onClick={() => stopShare(localParticipant)}>
        <MonitorOff /> <span className="hidden sm:inline">Stop</span>
      </Button>
    );
  }

  async function start() {
    setBusy(true);
    setError("");
    saveQuality(quality);
    saveFps(fps);
    try {
      await startShare(localParticipant, quality, fps);
      setOpen(false);
    } catch (err) {
      // Closing the browser picker is not an error worth showing
      if (!(err instanceof Error && err.name === "NotAllowedError")) setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <MonitorUp /> <span className="hidden sm:inline">Share</span>
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Share screen</DialogTitle>
            <DialogDescription>Up to 1080p. Tab or system audio is shared if you allow it.</DialogDescription>
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
          {error && <p className="text-destructive text-sm">{error}</p>}
          <DialogFooter>
            <Button onClick={start} disabled={busy}>
              Start sharing
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

import { AppWindow, LoaderCircle, Monitor, MonitorUp } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { captureSources, hasNativeSystemAudio } from "@/lib/desktop";
import {
  finishPick,
  getPickerAudio,
  isPicking,
  setPickerAudio,
  subscribePicker,
  type CaptureSource,
} from "@/lib/picker";
import { cn } from "@/lib/utils";

// Windows come and go and their contents change, so the list refreshes while open
const REFRESH = 3000;

type Kind = CaptureSource["kind"];

// The desktop app's screen and window picker, opened by share.ts through pickSource()
export function SourcePicker() {
  const open = useSyncExternalStore(subscribePicker, isPicking);
  const [sources, setSources] = useState<CaptureSource[] | null>(null);
  const [kind, setKind] = useState<Kind>("screen");
  const [selected, setSelected] = useState<string | null>(null);
  const [audio, setAudio] = useState(getPickerAudio);

  useEffect(() => {
    if (!open) return;
    setSources(null);
    setKind("screen");
    setSelected(null);
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      try {
        const list = await captureSources();
        if (!alive) return;
        setSources(list);
        // First screen by default, and forget a window that closed
        setSelected((s) => (s && list.some((x) => x.id === s) ? s : (list.find((x) => x.kind === "screen")?.id ?? null)));
        timer = setTimeout(load, REFRESH);
      } catch {
        if (!alive) return;
        toast.error("Could not list screens and windows.");
        finishPick(null);
      }
    };
    load();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [open]);

  const shown = sources?.filter((s) => s.kind === kind) ?? [];
  const count = (k: Kind) => sources?.filter((s) => s.kind === k).length ?? 0;

  function share(id = selected) {
    const source = sources?.find((s) => s.id === id);
    // The app's own system audio is added by share.ts, the switch is only shown without it
    if (source) finishPick({ source, audio: !hasNativeSystemAudio && audio });
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && finishPick(null)}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Choose what to share</DialogTitle>
        </DialogHeader>
        <div className="flex gap-1">
          <KindButton active={kind === "screen"} onClick={() => setKind("screen")}>
            <Monitor /> Screens {sources && <span className="text-muted-foreground">{count("screen")}</span>}
          </KindButton>
          <KindButton active={kind === "window"} onClick={() => setKind("window")}>
            <AppWindow /> Windows {sources && <span className="text-muted-foreground">{count("window")}</span>}
          </KindButton>
        </div>
        <div className="-mx-1 h-[min(60vh,28rem)] overflow-y-auto px-1 py-1">
          {!sources ? (
            <div className="flex h-full items-center justify-center text-muted-foreground">
              <LoaderCircle className="size-5 animate-spin" />
            </div>
          ) : shown.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              {kind === "screen" ? "No screens found." : "No windows to share."}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {shown.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setSelected(s.id)}
                  onDoubleClick={() => share(s.id)}
                  className={cn(
                    "flex min-w-0 flex-col gap-1.5 rounded-lg p-1.5 text-left outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring",
                    selected === s.id && "bg-accent ring-2 ring-primary",
                  )}
                >
                  <div className="flex aspect-video w-full items-center justify-center overflow-hidden rounded-md bg-muted">
                    {s.thumb ? (
                      <img src={s.thumb} alt="" draggable={false} className="size-full object-contain" />
                    ) : s.kind === "screen" ? (
                      <Monitor className="size-6 text-muted-foreground" />
                    ) : (
                      <AppWindow className="size-6 text-muted-foreground" />
                    )}
                  </div>
                  <span className="truncate px-0.5 text-sm" title={s.name}>
                    {s.name}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
        <DialogFooter className="sm:items-center">
          {!hasNativeSystemAudio && (
            <div className="flex items-center gap-2 max-sm:justify-between sm:mr-auto">
              <Label htmlFor="picker-audio">Share system audio</Label>
              <Switch
                id="picker-audio"
                checked={audio}
                onCheckedChange={(v) => {
                  setAudio(v);
                  setPickerAudio(v);
                }}
              />
            </div>
          )}
          <Button variant="outline" onClick={() => finishPick(null)}>
            Cancel
          </Button>
          <Button disabled={!sources?.some((s) => s.id === selected)} onClick={() => share()}>
            <MonitorUp /> Share
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function KindButton({ active, ...props }: { active: boolean } & React.ComponentProps<typeof Button>) {
  return <Button size="sm" variant={active ? "secondary" : "ghost"} {...props} />;
}

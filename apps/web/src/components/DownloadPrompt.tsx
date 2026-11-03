import { Download, ExternalLink, X } from "lucide-react";
import { useState } from "react";
import { LogoMark } from "@/components/Logo";
import { REPO_URL } from "@/components/GitHubIcon";
import { LinuxIcon, WindowsIcon } from "@/components/OsIcons";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { isDesktop } from "@/lib/desktop";
import { cn } from "@/lib/utils";

const KEY = "sharr.hide_download";

// Unversioned copies of the latest release's files (see .github/workflows/desktop.yml)
const BASE = `${REPO_URL}/releases/latest/download`;
const builds = [
  { os: "windows", label: "Windows", file: "Installer (.exe)", icon: WindowsIcon, url: `${BASE}/sharr_x64-setup.exe` },
  { os: "linux", label: "Linux", file: "AppImage", icon: LinuxIcon, url: `${BASE}/sharr_amd64.AppImage` },
] as const;

function detectOs() {
  const ua = navigator.userAgent;
  if (ua.includes("Windows")) return "windows";
  if (ua.includes("Linux") && !ua.includes("Android")) return "linux";
  return null;
}

// The app handles sharr:// links (apps/desktop/src-tauri/src/link.rs). Nothing happens without it.
function appLink() {
  const room = location.pathname.match(/^\/r\/([\w-]+)\/?$/);
  return room ? `sharr://r/${room[1]}` : "sharr://";
}

function hidden() {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

// Offers the desktop app to browsers on Linux and Windows
export function DownloadPrompt() {
  const [show, setShow] = useState(() => !isDesktop && !hidden());
  const [picking, setPicking] = useState(false);
  const os = detectOs();
  if (!show || !os) return null;

  function close() {
    setShow(false);
    try {
      localStorage.setItem(KEY, "1");
    } catch {}
  }

  return (
    <>
      <div className="bg-popover text-popover-foreground fixed bottom-4 left-1/2 z-40 flex w-max max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-3 rounded-xl border p-2 pl-3 shadow-lg">
        <LogoMark />
        <p className="text-sm">Get the sharr app</p>
        <Button size="sm" variant="secondary" asChild>
          <a href={appLink()}>
            <ExternalLink /> Open in app
          </a>
        </Button>
        <Button size="sm" onClick={() => setPicking(true)}>
          <Download /> Download
        </Button>
        <Button variant="ghost" size="icon" className="size-8" title="Hide" onClick={close}>
          <X />
        </Button>
      </div>

      <Dialog open={picking} onOpenChange={setPicking}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Download sharr</DialogTitle>
            <DialogDescription>The desktop app needs a Discord login.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            {builds.map((b) => (
              <a
                key={b.os}
                href={b.url}
                onClick={() => setPicking(false)}
                className={cn(
                  "hover:bg-foreground/4 flex flex-col items-center gap-2 rounded-lg border-2 p-4 transition-colors",
                  b.os === os && "border-primary",
                )}
              >
                <b.icon className="size-8" />
                <span className="font-medium">{b.label}</span>
                <span className="text-muted-foreground text-center text-xs">
                  {b.file}
                  {b.os === os && <span className="text-foreground block font-medium">Recommended</span>}
                </span>
              </a>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

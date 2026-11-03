import { Copy, Minus, Square, X } from "lucide-react";
import { useEffect, useState } from "react";
import { LogoMark } from "@/components/Logo";
import { appWindow, ownTitleBar, type ResizeEdge } from "@/lib/desktop";
import { cn } from "@/lib/utils";

const HEIGHT = "2.25rem";

// The desktop app's window has no system title bar: this one drags the window (double click
// maximizes, through Tauri's data-tauri-drag-region), and the edges resize it.
export function TitleBar() {
  const [shown, setShown] = useState(false);
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    let gone = false;
    // The runtime doesn't send window events to the page, but maximizing resizes the viewport
    const check = () => appWindow.isMaximized().then((m) => !gone && setMaximized(m), () => {});
    ownTitleBar.then((own) => {
      if (!own || gone) return;
      document.documentElement.style.setProperty("--titlebar-h", HEIGHT);
      setShown(true);
      check();
      window.addEventListener("resize", check);
    });
    return () => {
      gone = true;
      window.removeEventListener("resize", check);
    };
  }, []);

  if (!shown) return null;
  return (
    <>
      <div style={{ height: HEIGHT }} className="shrink-0" />
      <header
        data-tauri-drag-region="deep"
        style={{ height: HEIGHT }}
        className="bg-background fixed inset-x-0 top-0 z-[60] flex items-center border-b pl-3 select-none"
      >
        <LogoMark className="size-5 rounded-[5px]" />
        <span className="font-display ml-2 text-sm font-bold tracking-tight">sharr</span>
        <div className="ml-auto flex h-full">
          <Control label="Minimize" onClick={appWindow.minimize}>
            <Minus />
          </Control>
          <Control
            label={maximized ? "Restore" : "Maximize"}
            onClick={() =>
              appWindow
                .toggleMaximize()
                .then(appWindow.isMaximized)
                .then(setMaximized)
            }
          >
            {maximized ? <Copy className="-scale-x-100" /> : <Square />}
          </Control>
          <Control label="Close" onClick={appWindow.close} className="hover:bg-destructive hover:text-white">
            <X />
          </Control>
        </div>
      </header>
      {!maximized && <ResizeEdges />}
    </>
  );
}

function Control({
  label,
  onClick,
  className,
  children,
}: {
  label: string;
  onClick: () => Promise<unknown>;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={() => onClick().catch(() => {})}
      className={cn(
        "text-muted-foreground hover:bg-foreground/10 hover:text-foreground flex w-11 items-center justify-center transition-colors [&_svg]:size-3.5",
        className,
      )}
    >
      {children}
    </button>
  );
}

const EDGES: { edge: ResizeEdge; className: string }[] = [
  { edge: "North", className: "inset-x-2 top-0 h-1 cursor-n-resize" },
  { edge: "South", className: "inset-x-2 bottom-0 h-1 cursor-s-resize" },
  { edge: "West", className: "inset-y-2 left-0 w-1 cursor-w-resize" },
  { edge: "East", className: "inset-y-2 right-0 w-1 cursor-e-resize" },
  { edge: "NorthWest", className: "top-0 left-0 size-2 cursor-nw-resize" },
  { edge: "NorthEast", className: "top-0 right-0 size-2 cursor-ne-resize" },
  { edge: "SouthWest", className: "bottom-0 left-0 size-2 cursor-sw-resize" },
  { edge: "SouthEast", className: "right-0 bottom-0 size-2 cursor-se-resize" },
];

// Neither OS gives an undecorated window resize borders here, so thin strips on the edges start
// a native resize
function ResizeEdges() {
  return EDGES.map(({ edge, className }) => (
    <div
      key={edge}
      className={cn("fixed z-[70]", className)}
      onMouseDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        appWindow.startResize(edge).catch(() => {});
      }}
    />
  ));
}

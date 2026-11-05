import { useEffect, useState } from "react";
import { appVersion } from "@/lib/desktop";

// The desktop app's version, small in the bottom right corner
export function VersionTag() {
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => {
    appVersion.then(setVersion);
  }, []);
  if (!version) return null;
  return (
    <div className="text-muted-foreground/50 pointer-events-none fixed bottom-0.5 right-1.5 z-40 text-[10px] tabular-nums select-none">
      v{version}
    </div>
  );
}

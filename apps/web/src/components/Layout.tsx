import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

// Same bar as the room header
export function TopBar({ children }: { children: ReactNode }) {
  return <header className="flex h-13 shrink-0 items-center gap-2 border-b px-3">{children}</header>;
}

export function IconCircle({ icon: Icon, className }: { icon: LucideIcon; className?: string }) {
  return (
    <div
      className={cn(
        "bg-foreground/5 text-muted-foreground flex size-14 shrink-0 items-center justify-center rounded-full [&_svg]:size-[43%]",
        className,
      )}
    >
      <Icon />
    </div>
  );
}

// Icon, short text, then whatever comes next, stacked in the middle. The empty room uses it too.
export function CenterStack({
  icon,
  text,
  children,
  className,
}: {
  icon: LucideIcon;
  text: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center gap-4 text-center", className)}>
      <IconCircle icon={icon} />
      <p className="text-muted-foreground text-sm">{text}</p>
      {children}
    </div>
  );
}

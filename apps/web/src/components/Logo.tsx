import { MonitorUp } from "lucide-react";
import { cn } from "@/lib/utils";

export function LogoMark({ className }: { className?: string }) {
  return (
    <span className={cn("bg-primary text-primary-foreground flex size-8 shrink-0 items-center justify-center rounded-lg", className)}>
      <MonitorUp className="size-[60%]" />
    </span>
  );
}

export function Logo({ className, textClassName }: { className?: string; textClassName?: string }) {
  return (
    <span className={cn("flex items-center gap-2", className)}>
      <LogoMark />
      <span className={cn("text-xl font-extrabold tracking-tight", textClassName)}>sharr</span>
    </span>
  );
}

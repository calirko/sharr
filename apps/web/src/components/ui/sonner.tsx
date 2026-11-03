import { CircleCheck, Info, LoaderCircle, OctagonX, TriangleAlert } from "lucide-react";
import { Toaster as Sonner, type ToasterProps } from "sonner";
import { useTheme } from "@/lib/theme";

// Unstyled so Sonner's own background doesn't wipe the grain (index.css).
// Expanded: toasts line up instead of stacking behind each other.
function Toaster(props: ToasterProps) {
  const theme = useTheme();
  return (
    <Sonner
      theme={theme}
      position="bottom-center"
      expand
      gap={8}
      className="toaster group"
      icons={{
        success: <CircleCheck className="size-4" />,
        info: <Info className="size-4" />,
        warning: <TriangleAlert className="size-4" />,
        error: <OctagonX className="text-destructive size-4" />,
        loading: <LoaderCircle className="size-4 animate-spin" />,
      }}
      toastOptions={{
        unstyled: true,
        classNames: {
          toast:
            "flex w-(--width) items-center gap-3 rounded-lg border bg-popover px-4 py-3 text-sm text-popover-foreground shadow-lg",
          icon: "flex shrink-0 items-center",
          content: "flex min-w-0 flex-1 flex-col gap-0.5",
          title: "font-medium leading-snug",
          description: "text-muted-foreground",
          actionButton:
            "h-8 shrink-0 cursor-pointer rounded-md bg-primary/12 px-3 text-sm font-medium text-primary hover:bg-primary/20",
          cancelButton:
            "h-8 shrink-0 cursor-pointer rounded-md border px-3 text-sm font-medium hover:bg-foreground/6",
        },
      }}
      {...props}
    />
  );
}

export { Toaster };

import { LogIn } from "lucide-react";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

const ID = /^[\w-]{1,32}$/;

// Takes a room link (any host, so localhost and prod links both work) or a bare room id
function roomId(text: string) {
  const s = text.trim();
  if (ID.test(s)) return s;
  try {
    const m = new URL(s.includes("://") ? s : `https://${s}`).pathname.match(/^\/r\/([\w-]{1,32})\/?$/);
    return m?.[1] ?? null;
  } catch {
    return null;
  }
}

export function JoinLinkDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [, navigate] = useLocation();
  const [link, setLink] = useState("");

  function submit(e: FormEvent) {
    e.preventDefault();
    const id = roomId(link);
    if (!id) return toast.error("That isn't a room link.");
    onOpenChange(false);
    navigate(`/r/${id}`);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Join with link</DialogTitle>
          </DialogHeader>
          <Input
            autoFocus
            placeholder={`${location.origin}/r/…`}
            value={link}
            onChange={(e) => setLink(e.target.value)}
          />
          <DialogFooter>
            <Button type="submit" disabled={!link.trim()}>
              <LogIn /> Join
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

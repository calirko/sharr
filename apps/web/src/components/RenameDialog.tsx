import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { errorText } from "@/lib/errors";
import { useUser } from "@/lib/user";

export function RenameDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { user, setUser } = useUser();
  const [nickname, setNickname] = useState(user?.nickname ?? "");
  const [error, setError] = useState("");

  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      setUser((await api.rename(nickname.trim())).user);
      onOpenChange(false);
    } catch (err) {
      setError(errorText(err));
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Change nickname</DialogTitle>
          </DialogHeader>
          <Input autoFocus maxLength={32} value={nickname} onChange={(e) => setNickname(e.target.value)} />
          {error && <p className="text-destructive text-sm">{error}</p>}
          <DialogFooter>
            <Button type="submit" disabled={!nickname.trim()}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

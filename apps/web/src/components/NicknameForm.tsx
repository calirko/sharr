import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import { errorText } from "@/lib/errors";
import { useUser } from "@/lib/user";

export function NicknameForm() {
  const { setUser } = useUser();
  const [nickname, setNickname] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      setUser((await api.guest(nickname.trim())).user);
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <form onSubmit={submit} className="flex w-full max-w-xs flex-col gap-4">
        <h1 className="text-2xl font-semibold">sharr</h1>
        <div className="flex flex-col gap-2">
          <Label htmlFor="nickname">Nickname</Label>
          <Input
            id="nickname"
            autoFocus
            maxLength={32}
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
          />
        </div>
        {error && <p className="text-destructive text-sm">{error}</p>}
        <Button type="submit" disabled={busy || !nickname.trim()}>
          Continue as guest
        </Button>
      </form>
    </main>
  );
}

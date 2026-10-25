import { Logo } from "@/components/Logo";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LogIn } from "lucide-react";
import { api, discordLoginUrl } from "@/lib/api";
import { errorText } from "@/lib/errors";
import { useUser } from "@/lib/user";

export function NicknameForm() {
  const { setUser, discordEnabled } = useUser();
  const [nickname, setNickname] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(() =>
    new URLSearchParams(location.search).get("login") === "failed" ? "Discord login failed. Try again." : "",
  );

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
        <Logo className="gap-3" textClassName="text-3xl" />
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
        {discordEnabled && (
          <Button variant="outline" asChild>
            <a href={discordLoginUrl()}>
              <LogIn /> Log in with Discord
            </a>
          </Button>
        )}
      </form>
    </main>
  );
}

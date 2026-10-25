import { Logo } from "@/components/Logo";
import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DiscordIcon } from "@/components/DiscordIcon";
import { api, discordLoginUrl } from "@/lib/api";
import { isDesktop } from "@/lib/desktop";
import { errorText } from "@/lib/errors";
import { useUser } from "@/lib/user";
import { toast } from "sonner";

export function NicknameForm() {
  const { setUser, discordEnabled } = useUser();
  const [nickname, setNickname] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (new URLSearchParams(location.search).get("login") === "failed") {
      toast.error("Discord login failed. Try again.", { id: "login_failed" });
    }
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      setUser((await api.guest(nickname.trim())).user);
    } catch (err) {
      toast.error(errorText(err));
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <form onSubmit={submit} className="flex w-full max-w-xs flex-col gap-4">
        <Logo className="gap-3" textClassName="text-3xl" />
        {/* The desktop app is for Discord users only */}
        {!isDesktop && (
          <>
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
            <Button type="submit" disabled={busy || !nickname.trim()}>
              Continue as guest
            </Button>
          </>
        )}
        {isDesktop && !discordEnabled && (
          <p className="text-muted-foreground text-sm">Discord login is not set up on this server.</p>
        )}
        {discordEnabled && (
          <Button asChild variant="outline">
            <a href={discordLoginUrl()}>
              <DiscordIcon /> Log in with Discord
            </a>
          </Button>
        )}
      </form>
    </main>
  );
}

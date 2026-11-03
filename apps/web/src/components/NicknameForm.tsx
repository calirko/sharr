import { LogIn } from "lucide-react";
import { Logo } from "@/components/Logo";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DiscordIcon } from "@/components/DiscordIcon";
import { DownloadPrompt } from "@/components/DownloadPrompt";
import { RepoLink } from "@/components/GitHubIcon";
import { api, discordLoginUrl } from "@/lib/api";
import { browserLogin, isDesktop } from "@/lib/desktop";
import { errorText } from "@/lib/errors";
import { useUser } from "@/lib/user";
import { toast } from "sonner";

const AUTO_KEY = "sharr.auto_login";

// The app opens the browser login by itself once per launch, not again after logging out
function firstAutoLogin() {
  try {
    if (sessionStorage.getItem(AUTO_KEY)) return false;
    sessionStorage.setItem(AUTO_KEY, "1");
  } catch {}
  return true;
}

export function NicknameForm() {
  const { setUser, discordEnabled } = useUser();
  const [nickname, setNickname] = useState("");
  const [busy, setBusy] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const attempt = useRef(0);

  useEffect(() => {
    if (new URLSearchParams(location.search).get("login") === "failed") {
      toast.error("Discord login failed. Try again.", { id: "login_failed" });
    }
  }, []);

  useEffect(() => {
    if (isDesktop && discordEnabled && firstAutoLogin()) desktopLogin();
  }, [discordEnabled]);

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

  // Clicking again starts over, in case the browser tab was closed
  // Only the latest attempt counts, an older one may still time out later
  async function desktopLogin() {
    const id = ++attempt.current;
    setWaiting(true);
    try {
      const user = await browserLogin();
      if (id === attempt.current) setUser(user);
    } catch (err) {
      if (id !== attempt.current) return;
      toast.error(errorText(err));
      setWaiting(false);
    }
  }

  return (
    <main className="flex min-h-app items-center justify-center p-4">
      <RepoLink className="fixed top-2 right-3" />
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
              <LogIn /> Continue as guest
            </Button>
          </>
        )}
        {isDesktop && !discordEnabled && (
          <p className="text-muted-foreground text-sm">Discord login is not set up on this server.</p>
        )}
        {discordEnabled && isDesktop && (
          <>
            <Button type="button" variant="outline" onClick={desktopLogin}>
              <DiscordIcon /> Log in with Discord
            </Button>
            {waiting && (
              <p className="text-muted-foreground text-sm">
                Finish logging in in your browser. Click the button to open it again.
              </p>
            )}
          </>
        )}
        {discordEnabled && !isDesktop && (
          <Button asChild variant="outline">
            <a href={discordLoginUrl()}>
              <DiscordIcon /> Log in with Discord
            </a>
          </Button>
        )}
      </form>
      <DownloadPrompt />
    </main>
  );
}

import { AppWindow, LogIn, Unlink, X } from "lucide-react";
import { useState } from "react";
import { Link } from "wouter";
import { DiscordIcon } from "@/components/DiscordIcon";
import { CenterStack } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { api, discordLoginUrl } from "@/lib/api";
import { errorText } from "@/lib/errors";
import { useUser } from "@/lib/user";
import { toast } from "sonner";

// Opened in the system browser by the desktop app (apps/desktop/src-tauri/src/login.rs). Hands
// the app a one-time code through its listener on 127.0.0.1, which it trades for a session.
export function DesktopLoginPage() {
  const { user, discordEnabled } = useUser();
  const [busy, setBusy] = useState(false);
  const params = new URLSearchParams(location.search);
  const port = Number(params.get("port"));
  const state = params.get("state") ?? "";
  const valid = Number.isInteger(port) && port >= 1024 && port <= 65535 && /^[0-9a-f]{32}$/.test(state);

  async function proceed() {
    setBusy(true);
    try {
      const { code } = await api.desktopCode();
      location.href = `http://127.0.0.1:${port}/?code=${encodeURIComponent(code)}&state=${state}`;
    } catch (err) {
      toast.error(errorText(err));
      setBusy(false);
    }
  }

  let content;
  if (!valid) {
    content = <CenterStack icon={Unlink} text="This login link is broken. Start again from the app." />;
  } else if (!discordEnabled) {
    content = <CenterStack icon={AppWindow} text="Discord login is not set up on this server." />;
  } else if (user?.kind !== "discord") {
    content = (
      <CenterStack icon={AppWindow} text="Log in with Discord to use the sharr app.">
        <Button asChild variant="outline">
          <a href={discordLoginUrl(location.pathname + location.search)}>
            <DiscordIcon /> Log in with Discord
          </a>
        </Button>
      </CenterStack>
    );
  } else {
    content = (
      <CenterStack icon={AppWindow} text={`Log in to the sharr app as ${user.nickname}?`}>
        <div className="flex gap-2">
          <Button onClick={proceed} disabled={busy}>
            <LogIn /> Continue
          </Button>
          <Button variant="outline" asChild>
            <Link href="/">
              <X /> Cancel
            </Link>
          </Button>
        </div>
      </CenterStack>
    );
  }

  return <main className="flex min-h-dvh flex-col items-center justify-center p-4">{content}</main>;
}

import {
  Bell,
  BellRing,
  Globe,
  LogOut,
  Monitor,
  Smartphone,
  Trash2,
  User as UserIcon,
  X,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { DiscordIcon } from "@/components/DiscordIcon";
import { UserAvatar } from "@/components/UserAvatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { api, type SessionInfo } from "@/lib/api";
import { errorText } from "@/lib/errors";
import {
  getNotifyPrefs,
  notifyState,
  requestNotifyPermission,
  setNotifyPrefs,
  testNotification,
  type NotifyPrefs,
} from "@/lib/notify";
import { useUser } from "@/lib/user";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const TABS = [
  { id: "account", label: "Account", icon: UserIcon },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "sessions", label: "Sessions", icon: Monitor },
] as const;

type TabId = (typeof TABS)[number]["id"];

// Discord users only. Guests have nothing here to manage.
export function SettingsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [tab, setTab] = useState<TabId>("account");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[min(36rem,calc(100dvh-2rem))] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl sm:flex-row">
        <nav className="bg-muted/50 flex shrink-0 flex-col gap-2 border-b p-3 max-sm:pr-12 sm:w-44 sm:border-r sm:border-b-0">
          <DialogTitle className="font-display px-1 pb-1">Settings</DialogTitle>
          <div className="flex gap-1 overflow-x-auto sm:flex-col">
            {TABS.map(({ id, label, icon: Icon }) => (
              <Button
                key={id}
                size="sm"
                variant={tab === id ? "outline" : "ghost"}
                className={cn("justify-start", tab !== id && "text-muted-foreground")}
                onClick={() => setTab(id)}
              >
                <Icon /> {label}
              </Button>
            ))}
          </div>
        </nav>
        <div className="flex min-h-0 flex-1 flex-col">
          {/* Leaves room for the dialog's close button */}
          <h2 className="flex h-12 shrink-0 items-center border-b px-4 pr-12 text-sm font-medium max-sm:hidden">
            {TABS.find((t) => t.id === tab)?.label}
          </h2>
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
            {tab === "account" && <AccountPanel />}
            {tab === "notifications" && <NotificationsPanel />}
            {tab === "sessions" && <SessionsPanel />}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Row({ title, text, children }: { title: ReactNode; text?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <div className="text-sm font-medium">{title}</div>
        {text && <p className="text-muted-foreground mt-0.5 text-xs">{text}</p>}
      </div>
      {children}
    </div>
  );
}

function AccountPanel() {
  const { user, setUser } = useUser();
  const [confirming, setConfirming] = useState(false);
  if (!user) return null;

  return (
    <>
      <Card>
        <CardContent className="flex items-center gap-3">
          <UserAvatar name={user.nickname} url={user.avatar_url} className="size-10 text-base" />
          <div className="min-w-0">
            <p className="truncate font-medium">{user.nickname}</p>
            <p className="text-muted-foreground flex items-center gap-1.5 truncate text-xs">
              <DiscordIcon className="size-3" /> {user.discord_username}
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="border-b">
          <CardTitle>Delete account</CardTitle>
        </CardHeader>
        <CardContent>
          <Row
            title="Delete your account"
            text="Closes your rooms, removes your chat history and logs you out everywhere."
          >
            <Button variant="destructive" size="sm" className="shrink-0" onClick={() => setConfirming(true)}>
              <Trash2 /> Delete
            </Button>
          </Row>
        </CardContent>
      </Card>

      {confirming && (
        <ConfirmDialog
          open
          onOpenChange={setConfirming}
          title="Delete account"
          description="Your rooms close, your chat history is removed and every session is logged out. This can't be undone."
          confirmLabel="Delete account"
          confirmIcon={Trash2}
          onConfirm={async () => {
            await api.deleteAccount();
            toast.success("Account deleted.");
            setUser(null);
          }}
        />
      )}
    </>
  );
}

function NotificationsPanel() {
  const [prefs, setPrefs] = useState<NotifyPrefs>(getNotifyPrefs);
  const [state, setState] = useState(notifyState);
  const active = prefs.enabled && state === "granted";

  function update(next: NotifyPrefs) {
    setPrefs(next);
    setNotifyPrefs(next);
  }

  async function toggle(on: boolean) {
    if (!on) return update({ ...prefs, enabled: false });
    const granted = await requestNotifyPermission();
    setState(notifyState());
    if (granted) update({ ...prefs, enabled: true });
    else toast.error("Notifications are blocked for this site.");
  }

  async function test() {
    try {
      await testNotification();
    } catch {
      toast.error("Couldn't show a notification.");
    }
  }

  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle>Desktop notifications</CardTitle>
        <CardDescription>Shown while sharr is open but not focused. Saved on this device only.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Row
          title={<Label htmlFor="notify-enabled">Enable on this device</Label>}
          text={
            state === "unsupported"
              ? "This browser doesn't support notifications."
              : state === "denied"
                ? "Blocked. Allow notifications for this site in your browser settings."
                : undefined
          }
        >
          <Switch
            id="notify-enabled"
            checked={active}
            disabled={state === "unsupported" || state === "denied"}
            onCheckedChange={toggle}
          />
        </Row>
        <Row title={<Label htmlFor="notify-messages">New chat messages</Label>}>
          <Switch
            id="notify-messages"
            checked={prefs.messages}
            disabled={!active}
            onCheckedChange={(v) => update({ ...prefs, messages: v })}
          />
        </Row>
        <Row title={<Label htmlFor="notify-presence">Someone joins or leaves</Label>}>
          <Switch
            id="notify-presence"
            checked={prefs.presence}
            disabled={!active}
            onCheckedChange={(v) => update({ ...prefs, presence: v })}
          />
        </Row>
      </CardContent>
      <CardFooter className="justify-end">
        <Button variant="outline" size="sm" disabled={!active} onClick={test}>
          <BellRing /> Send test notification
        </Button>
      </CardFooter>
    </Card>
  );
}

function SessionsPanel() {
  const [sessions, setSessions] = useState<SessionInfo[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    api.sessions().then(
      (r) => setSessions(r.sessions),
      (err) => toast.error(errorText(err)),
    );
  }, []);

  async function revoke(id: string) {
    setBusy(id);
    try {
      await api.revokeSession(id);
      setSessions((s) => s && s.filter((x) => x.id !== id));
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setBusy(null);
    }
  }

  async function revokeOthers() {
    setBusy("others");
    try {
      await api.revokeOtherSessions();
      setSessions((s) => s && s.filter((x) => x.is_current));
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setBusy(null);
    }
  }

  if (!sessions) return <p className="text-muted-foreground text-sm">Loading sessions...</p>;
  const others = sessions.some((s) => !s.is_current);

  return (
    <>
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm font-medium sm:invisible">Sessions</p>
        {others && (
          <Button variant="outline" size="sm" disabled={busy !== null} onClick={revokeOthers}>
            <LogOut /> Log out other sessions
          </Button>
        )}
      </div>
      {sessions.map((s) => {
        const { label, icon: Icon } = describe(s);
        return (
          <Card key={s.id}>
            <CardContent className="flex items-center gap-3">
              <span className="bg-muted flex shrink-0 items-center justify-center rounded-md p-2">
                <Icon className="size-5" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium">{label}</span>
                  {s.is_current && <Badge variant="secondary">This device</Badge>}
                </div>
                <p className="text-muted-foreground text-xs">
                  Signed in {new Date(s.created_at).toLocaleDateString([], { dateStyle: "medium" })} · active{" "}
                  {s.is_current ? "now" : ago(s.last_seen)}
                </p>
              </div>
              {!s.is_current && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  title="Log out"
                  className="hover:bg-destructive/12 hover:text-destructive shrink-0"
                  disabled={busy !== null}
                  onClick={() => revoke(s.id)}
                >
                  <X />
                </Button>
              )}
            </CardContent>
          </Card>
        );
      })}
    </>
  );
}

function describe(s: SessionInfo): { label: string; icon: LucideIcon } {
  const ua = s.user_agent;
  const os = /Android/.test(ua)
    ? "Android"
    : /iPhone|iPad|iPod/.test(ua)
      ? "iOS"
      : /Windows/.test(ua)
        ? "Windows"
        : /Mac OS X|Macintosh/.test(ua)
          ? "macOS"
          : /CrOS/.test(ua)
            ? "ChromeOS"
            : /Linux/.test(ua)
              ? "Linux"
              : "";
  if (s.client === "desktop") return { label: os ? `sharr app on ${os}` : "sharr app", icon: Monitor };
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /OPR\//.test(ua)
      ? "Opera"
      : /Firefox\/|FxiOS/.test(ua)
        ? "Firefox"
        : /Chrome\/|CriOS/.test(ua)
          ? "Chrome"
          : /Safari\//.test(ua)
            ? "Safari"
            : "Browser";
  const mobile = os === "Android" || os === "iOS";
  return { label: os ? `${browser} on ${os}` : browser, icon: mobile ? Smartphone : Globe };
}

const rtf = new Intl.RelativeTimeFormat([], { numeric: "auto" });

function ago(ms: number) {
  const min = Math.round((Date.now() - ms) / 60_000);
  if (min < 5) return "now";
  if (min < 60) return rtf.format(-min, "minute");
  const hours = Math.round(min / 60);
  if (hours < 24) return rtf.format(-hours, "hour");
  return rtf.format(-Math.round(hours / 24), "day");
}

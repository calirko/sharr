// Desktop notifications while the app is open but not focused. Shown by the page itself
// through the service worker, so there is no push server. Discord users only.

export type NotifyPrefs = { enabled: boolean; messages: boolean; presence: boolean };
export type NotifyState = "unsupported" | "denied" | "granted" | "default";
type Kind = "messages" | "presence";

const STORAGE_KEY = "sharr.notifications";
const DEFAULT_PREFS: NotifyPrefs = { enabled: false, messages: true, presence: true };
const MAX_BODY = 200;

let prefs: NotifyPrefs = load();

function load(): NotifyPrefs {
  try {
    return { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") };
  } catch {
    return DEFAULT_PREFS;
  }
}

export const getNotifyPrefs = () => prefs;

export function setNotifyPrefs(next: NotifyPrefs) {
  prefs = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {}
}

export function notifyState(): NotifyState {
  if (!("Notification" in window)) return "unsupported";
  return Notification.permission;
}

// Asks for permission if needed. Returns whether notifications can be shown.
export async function requestNotifyPermission() {
  if (notifyState() === "unsupported") return false;
  if (Notification.permission === "default") await Notification.requestPermission();
  return Notification.permission === "granted";
}

export function registerServiceWorker() {
  if (!("serviceWorker" in navigator) || location.hostname.endsWith(".discordsays.com")) return;
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}

type Message = { title: string; body: string; tag: string; url: string; icon?: string };

async function show({ title, body, tag, url, icon }: Message) {
  const options = {
    body: body.length > MAX_BODY ? `${body.slice(0, MAX_BODY)}...` : body,
    tag,
    // A new message with the same tag still alerts, instead of replacing the old one silently
    renotify: true,
    icon: icon || "/icon.png",
    data: { url },
  } as NotificationOptions;
  const reg = await navigator.serviceWorker?.getRegistration().catch(() => undefined);
  if (reg) return reg.showNotification(title, options);
  const n = new Notification(title, options);
  n.onclick = () => {
    window.focus();
    n.close();
  };
}

export function notify(kind: Kind, userKind: string | undefined, msg: Message) {
  if (userKind !== "discord" || !prefs.enabled || !prefs[kind]) return;
  if (notifyState() !== "granted" || document.hasFocus()) return;
  show(msg).catch(() => {});
}

// From the settings dialog, so it shows even while the window is focused
export function testNotification() {
  return show({ title: "sharr", body: "Notifications are working.", tag: "test", url: location.pathname });
}

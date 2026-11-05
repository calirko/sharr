// Desktop app: when the page loses the server while running, the app checks the server and, if
// it's down, shows its offline page, which comes back to this URL later (src-tauri/src/offline.rs).
// Its own module so api.ts can use it without importing desktop.ts.

type Invoke = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
const invoke = (window as unknown as { __TAURI__?: { core: { invoke: Invoke } } }).__TAURI__?.core.invoke;

let last = 0;

// `failed`: we know the connection is gone, skip the app's health check
export function reportOffline(failed = false) {
  if (!invoke) return;
  // A burst of failed requests needs one check
  const now = Date.now();
  if (!failed && now - last < 3000) return;
  last = now;
  invoke("offline_check", { url: location.href, failed }).catch(() => {});
}

export function watchOffline() {
  if (!invoke) return;
  window.addEventListener("offline", () => reportOffline(true));
}

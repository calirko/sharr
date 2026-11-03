// Only here so the page can show notifications. No caching, no push.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || "/", self.location.origin).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      // Focus only. Navigating would drop whoever is in a call in that window.
      const target = windows.find((w) => w.url === url) || windows[0];
      if (target) return target.focus();
      await self.clients.openWindow(url);
    })(),
  );
});

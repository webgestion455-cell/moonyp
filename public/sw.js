// BNP PARIBAS service worker — Web Push only (no offline caching to avoid stale UI)
self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (_) {
    data = { title: "BNP PARIBAS", body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "BNP PARIBAS";
  const options = {
    body: data.body || data.message || "",
    icon: "/icon-512.png",
    badge: "/icon-512.png",
    tag: data.tag || data.title || "bnp paribas",
    data: { url: data.link || data.url || "/" },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ("focus" in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    }),
  );
});

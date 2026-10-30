// MOONYP service worker — Web Push only (no offline caching to avoid stale UI)
self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

function cleanPushText(value): string {
  if (typeof value !== "string") return "";
  return value.replace(/<\\s*br\\s*\\/?\\s*>|<\\s*\\/(p|div|li|h[1-6]|tr)\\s*>/gi, " ")
    .replace(/<[^>]*>/g, " ").replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/\\s+/g, " ").trim();
}

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (_) {
    data = { title: "MOONYP", body: event.data ? event.data.text() : "" };
  }
  const title = cleanPushText(data.title) || "MOONYP";
  const bodyText = cleanPushText(data.body || data.message || "");
  const options = {
    body: bodyText,
    icon: "/icon-512.png",
    badge: "/icon-512.png",
    tag: data.tag || data.title || "MOONYP-support",
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

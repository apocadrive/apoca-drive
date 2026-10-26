// Apoca Drive service worker: offline cache + push notifications.
// Push messages are displayed here directly (always), which is the reliable path on iPhone.
const CACHE = "apoca-v5";
self.addEventListener("install", (e) => { self.skipWaiting(); e.waitUntil(caches.open(CACHE).then((c) => c.addAll(["/", "/fb.js", "/manifest.json"]))); });
self.addEventListener("activate", (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin || u.pathname.startsWith("/__/")) return;
  e.respondWith(fetch(e.request).then((r) => { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return r; }).catch(() => caches.match(e.request).then((m) => m || caches.match("/"))));
});

self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { notification: { body: e.data ? e.data.text() : "" } }; }
  const n = d.notification || {};
  const data = d.data || {};
  const title = n.title || data.title || "Apoca Drive";
  const link = (d.fcmOptions && d.fcmOptions.link) || n.click_action || data.link || "/";
  e.waitUntil(self.registration.showNotification(title, {
    body: n.body || data.body || "",
    icon: n.icon || "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    tag: data.tag || undefined,
    data: { link }
  }));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const link = (e.notification.data && e.notification.data.link) || "/";
  e.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true }).then((ws) => {
    for (const w of ws) { if ("focus" in w){ try { w.postMessage({ type: "open", link }); } catch (err) {} return w.focus(); } }
    return clients.openWindow(link);
  }));
});

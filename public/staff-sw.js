// New Wave Staff app (10 Nov 2026). Scope: /portal only. Pages always come from the network;
// only when there is no connection does it show the saved "No Connection" page.
// Nothing else is cached: records, payments and API calls are never served from storage.
const CACHE = "nw-staff-v1";
const OFFLINE = "/staff-offline.html";
self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll([OFFLINE, "/icons/staff-192.png"])).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (event) => {
  if (event.request.mode !== "navigate") return;
  event.respondWith(fetch(event.request).catch(() => caches.match(OFFLINE)));
});

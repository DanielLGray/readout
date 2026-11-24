/* Readout service worker: app shell from cache, data from network (cache as fallback).
   On each app change, bump BUILD here and the ?v= numbers in index.html together. */
const BUILD = "16";
const VERSION = `readout-v${BUILD}`;
const DATA = "readout-data";        // last copy of each data file; kept across app updates (the app reads it too)
const SHELL = [
  "./", "index.html", `app.css?v=${BUILD}`, `app.js?v=${BUILD}`, `tune.js?v=${BUILD}`, "manifest.webmanifest",
  "icons/icon-192.png", "icons/icon-512.png", "icons/apple-touch-icon.png",
  "fonts/literata-latin-opsz-normal.woff2", "fonts/literata-latin-ext-opsz-normal.woff2",
  "fonts/atkinson-hyperlegible-next-latin-wght-normal.woff2", "fonts/atkinson-hyperlegible-next-latin-ext-wght-normal.woff2",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    const data = await caches.open(DATA);
    for (const k of await caches.keys()) {
      if (k === VERSION || k === DATA) continue;
      const old = await caches.open(k);           // older builds kept data in the app cache: move it over
      for (const req of await old.keys()) {
        if (!new URL(req.url).pathname.includes("/data/") || await data.match(req)) continue;
        const res = await old.match(req);
        if (res) await data.put(req, res);
      }
      await caches.delete(k);
    }
    await self.clients.claim();
  })());
});

// the saved copy, marked so the app can say it's offline instead of "up to date"
function offlineCopy(res) {
  if (!res) return res;
  const headers = new Headers(res.headers);
  headers.set("x-readout-offline", "1");
  return res.blob().then((body) => new Response(body, { status: res.status, statusText: res.statusText, headers }));
}

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  if (url.pathname.includes("/data/")) {
    // newest data when online, last copy when offline
    e.respondWith(fetch(e.request).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(DATA).then((c) => c.put(e.request, copy)); }
      return res;
    }).catch(() => caches.open(DATA).then((c) => c.match(e.request, { ignoreSearch: true })).then(offlineCopy)));
    return;
  }
  // app shell: cache first, refresh in the background
  e.respondWith(caches.match(e.request).then((hit) => {
    const net = fetch(e.request).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(e.request, copy)); }
      return res;
    }).catch(() => hit);
    return hit || net;
  }));
});

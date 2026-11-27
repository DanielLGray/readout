/* Readout service worker: app shell from cache, data from network (cache as fallback).
   On each app change, bump BUILD here and the ?v= numbers in index.html together. */
const BUILD = "58";
const VERSION = `readout-v${BUILD}`;
const DATA = "readout-data";        // last copy of each data file; kept across app updates (the app reads it too)
const FIGS = "readout-figs";        // pictures from papers: kept once fetched, the newest 400 or so
const MAX_FIGS = 400;
const SHELL = [
  "./", "index.html", `app.css?v=${BUILD}`, `filters.js?v=${BUILD}`, `app.js?v=${BUILD}`, `learn.js?v=${BUILD}`, `tune.js?v=${BUILD}`, `horizon.js?v=${BUILD}`, `radar.js?v=${BUILD}`, `watch.js?v=${BUILD}`, `week.js?v=${BUILD}`, `cites.js?v=${BUILD}`, `push.js?v=${BUILD}`, `jobset.js?v=${BUILD}`, `local.js?v=${BUILD}`, `near.js?v=${BUILD}`, "manifest.webmanifest",
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
      if (k === VERSION || k === DATA || k === FIGS) continue;
      const old = await caches.open(k);           // older builds kept data in the app cache: move it over
      for (const req of await old.keys()) {
        const path = new URL(req.url).pathname;
        if (!path.includes("/data/") || path.includes("/data/figs/") || await data.match(req)) continue;
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

// Notifications (alerts, from the notify job through the phone's push service): show each one;
// a tap opens Readout at this week's alerts. Only Readout's own pages are ever opened.
self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data ? e.data.text() : "" }; }
  const title = String(d.title || "Readout").slice(0, 120);
  const body = String(d.body || "").slice(0, 300);
  const url = new URL(typeof d.url === "string" && /^\.\/(#[a-z]+)?$/.test(d.url) ? d.url : "./", self.registration.scope).href;
  e.waitUntil(self.registration.showNotification(title, { body, tag: String(d.tag || "readout").slice(0, 64), data: { url },
    icon: "icons/icon-192.png", badge: "icons/icon-192.png" }));
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = e.notification.data?.url || self.registration.scope;
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const mine = wins.find((c) => c.url.startsWith(self.registration.scope));
    if (mine) { await mine.focus(); if (mine.navigate) await mine.navigate(url).catch(() => {}); return; }
    await self.clients.openWindow(url);
  })());
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  if (url.pathname.includes("/data/figs/")) {
    // a paper's picture never changes: from the phone once fetched; only the newest few hundred are kept
    e.respondWith(caches.open(FIGS).then(async (c) => {
      const hit = await c.match(e.request, { ignoreSearch: true });
      if (hit) return hit;
      const res = await fetch(e.request);
      if (res.ok) {
        await c.put(e.request, res.clone());
        const keys = await c.keys();
        for (const k of keys.slice(0, Math.max(0, keys.length - MAX_FIGS))) await c.delete(k);
      }
      return res;
    }));
    return;
  }
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

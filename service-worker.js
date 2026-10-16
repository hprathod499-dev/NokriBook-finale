// Service worker for Nokri Book.
//
// Built for speed: the app opens straight from what is kept on the device, and
// checks for a newer version in the background.
//
//  - Page (index.html, any /app/... URL): served from the device at once
//    ("stale-while-revalidate"). A fresh copy is fetched in the background; if it
//    is different, it is kept for next time and the open page is told
//    ("nb-update") so it can switch to it — straight away while it is still
//    starting, or the next time it goes to the background, or by a tap.
//    With nothing kept yet (first visit) the network is used.
//  - App code /assets/app-<hash>.js and images in /assets/: the name changes
//    whenever the content changes, so they are kept forever and never re-checked.
//  - CDN libraries (React, Firebase, pako, jsPDF, fonts): from the device first.
//    Google Fonts CSS too (refreshed in the background) — it used to wait for
//    the network on every open, holding back the first paint.
//  - Icons/manifest: from the device, refreshed in the background.
const CACHE_NAME = "nokri-book-shell-v7";
const ASSET_CACHE = "nokri-book-assets-v1";
const CDN_CACHE = "nokri-book-cdn-v1";
const CDN_HOSTS = ["unpkg.com", "cdn.jsdelivr.net", "cdnjs.cloudflare.com", "fonts.googleapis.com", "fonts.gstatic.com"];
function isCdnAsset(url) {
  if (CDN_HOSTS.indexOf(url.hostname) !== -1) return true;
  return url.hostname === "www.gstatic.com" && url.pathname.indexOf("/firebasejs/") === 0;
}
const SHELL_URL = "/index.html";
const APP_SHELL = ["/manifest.json", "/favicon-16-v3.png", "/favicon-32-v3.png", "/icon-192-v3.png", "/icon-512-v3.png", "/apple-touch-icon-v3.png", "/profile-icon.png", "/welcome-banner.png"];
const appScriptsIn = (html) => (String(html).match(/\/assets\/app-[0-9a-f]+\.js/g) || []);

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await Promise.all(APP_SHELL.map((u) => cache.add(u).catch(() => {})));
    // the page itself, and the app code it uses, so the very next open is instant
    try {
      const res = await fetch(SHELL_URL, { cache: "no-store" });
      if (res.ok) {
        const html = await res.text();
        await cache.put(SHELL_URL, new Response(html, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } }));
        const ac = await caches.open(ASSET_CACHE);
        await Promise.all(appScriptsIn(html).map((u) => ac.match(u).then((hit) => hit || ac.add(u)).catch(() => {})));
      }
    } catch (e) {}
  })());
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME && k !== CDN_CACHE && k !== ASSET_CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

async function tellPages(msg) {
  const list = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  list.forEach((c) => { try { c.postMessage(msg); } catch (e) {} });
}

// Fetch the newest page; keep it (and its app code) if it changed, then tell the open pages.
let refreshing = null;
function refreshShell() {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    const res = await fetch(SHELL_URL, { cache: "no-store", credentials: "same-origin" });
    if (!res.ok) return null;
    const html = await res.text();
    const cache = await caches.open(CACHE_NAME);
    const old = await cache.match(SHELL_URL);
    const oldHtml = old ? await old.text() : null;
    if (oldHtml === html) return null;
    // download the new app code first, so switching to it is instant and works offline
    const ac = await caches.open(ASSET_CACHE);
    const want = appScriptsIn(html);
    await Promise.all(want.map((u) => ac.match(u).then((hit) => hit || ac.add(u))));
    await cache.put(SHELL_URL, new Response(html, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } }));
    // keep only the app code of this version and the one before it
    const keep = new Set([...want, ...appScriptsIn(oldHtml || "")]);
    const keys = await ac.keys();
    await Promise.all(keys.filter((r) => /\/assets\/app-[0-9a-f]+\.js$/.test(new URL(r.url).pathname) && !keep.has(new URL(r.url).pathname)).map((r) => ac.delete(r)));
    if (oldHtml) await tellPages({ type: "nb-update" });
    return html;
  })().catch(() => null).finally(() => { setTimeout(() => { refreshing = null; }, 0); });
  return refreshing;
}

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "nb-check-update") event.waitUntil(refreshShell());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) {
    if (!isCdnAsset(url)) return; // Firebase / Google sign-in / EmailJS calls: always live
    const revalidate = url.hostname === "fonts.googleapis.com";
    event.respondWith(caches.open(CDN_CACHE).then((cache) => cache.match(req).then((hit) => {
      const fromNet = fetch(req).then((res) => {
        if (res && (res.ok || res.type === "opaque")) cache.put(req, res.clone()).catch(() => {});
        return res;
      });
      if (hit) { if (revalidate) event.waitUntil(fromNet.catch(() => {})); return hit; }
      return fromNet;
    })));
    return;
  }

  // App code and images: content-named, kept forever.
  if (url.pathname.indexOf("/assets/") === 0) {
    event.respondWith(caches.open(ASSET_CACHE).then((cache) => cache.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res && res.ok) cache.put(req, res.clone()).catch(() => {});
      return res;
    }))));
    return;
  }

  // Opening / reloading / deep-linking to any page.
  if (req.mode === "navigate" || url.pathname.endsWith("/index.html") || url.pathname === "/") {
    event.respondWith(caches.match(SHELL_URL).then((cached) => {
      if (cached) {
        event.waitUntil(refreshShell());
        return cached;
      }
      // first visit: network, and keep it
      return fetch(req.url, { cache: "no-store", credentials: "same-origin" }).then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          event.waitUntil(copy.text().then(async (html) => {
            const cache = await caches.open(CACHE_NAME);
            await cache.put(SHELL_URL, new Response(html, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } }));
          }).catch(() => {}));
        }
        return res;
      }).catch(() => fetch(req));
    }));
    return;
  }

  // Icons, manifest and other files: from the device, refreshed in the background.
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req).then((res) => {
        if (res && res.ok) { const clone = res.clone(); caches.open(CACHE_NAME).then((cache) => cache.put(req, clone)); }
        return res;
      }).catch(() => cached);
      if (cached) { event.waitUntil(network.catch(() => {})); return cached; }
      return network;
    })
  );
});

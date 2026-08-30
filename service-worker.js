// Minimal service worker for Nokri Book. Its main job for install
// purposes is simply existing and successfully registering — Chrome
// requires an active service worker before it will offer "Install app"
// on both Android and desktop. Beyond that, it caches the app shell
// (this page plus its icons/manifest) so the app still opens even with
// no connection, falling back to the network for anything not cached
// (e.g. the Firebase/Google/EmailJS scripts, which need to be live
// anyway for the app to actually do anything once open).
//
// IMPORTANT — this used to be stale-while-revalidate for EVERYTHING,
// including index.html itself: always serve whatever's cached
// immediately, and only update the cache in the background for next
// time. That's fine for icons that basically never change, but for the
// actual app code (index.html), it meant that if a cache was ever
// populated from a broken/half-deployed moment, the app would keep
// serving that exact broken snapshot on every single load — even after
// the real site was completely fixed — because a cached response was
// always available and always preferred, with no reason to ever prefer
// the network instead. That's exactly the "worked on X, but stuck
// broken on Y until Chrome data was wiped" bug. Fixed below by giving
// the actual page content (any navigation request, i.e. loading
// index.html) a NETWORK-FIRST strategy instead: always try to get the
// current version first, and only fall back to the cached copy if
// there's truly no connection at all. Static assets (icons, manifest)
// keep cache-first, since being briefly one version behind on an icon
// is harmless and this keeps things fast.
const CACHE_NAME = "nokri-book-shell-v2";
const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.json",
  "./favicon-16.png",
  "./favicon-32.png",
  "./icon-192.png",
  "./icon-512.png",
  "./apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  // Only handle GET requests for same-origin app-shell files — anything
  // else (Firebase, Google APIs, EmailJS, cross-origin CDN scripts)
  // passes straight through to the network untouched.
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Any request for the page itself (opening/reloading the app) — always
  // prefer a fresh copy from the network. Only reach for the cached
  // version if the network request genuinely fails, i.e. actually
  // offline — that's the one case this cache exists for.
  if (req.mode === "navigate" || url.pathname.endsWith("/index.html") || url.pathname === "/") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
          }
          return res;
        })
        .catch(() => caches.match(req).then((cached) => cached || caches.match("./index.html")))
    );
    return;
  }

  // Everything else in the app shell (icons, manifest) — cache-first is
  // fine, these change rarely and being briefly stale is harmless.
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});

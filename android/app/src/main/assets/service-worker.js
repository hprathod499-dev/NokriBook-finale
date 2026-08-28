// Nokri Book — service worker
//
// Strategy: cache-first for the app shell (this file, index.html, icons,
// manifest), network-first for everything else (Firebase/Firestore calls
// are never intercepted — Firebase's own SDK already handles its offline
// persistence and sync, and this worker staying out of the way is what
// keeps that working correctly).
//
// Bump CACHE_VERSION any time you deploy a new build of index.html so
// returning visitors (and the installed Android app) pick up the update
// instead of being served a stale cached shell indefinitely.
const CACHE_VERSION = "nokri-book-v1";
const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png",
  "./icon-512-maskable.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Never intercept anything cross-origin (Firebase Auth, Firestore,
  // Google Identity Services, Drive API, fonts, etc.) — only cache this
  // app's own same-origin shell files.
  if (url.origin !== self.location.origin) return;
  if (event.request.method !== "GET") return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request)
        .then((response) => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => caches.match("./index.html"));
    })
  );
});

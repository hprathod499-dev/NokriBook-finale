// Minimal service worker for Nokri Book. Its main job for install
// purposes is simply existing and successfully registering — Chrome
// requires an active service worker before it will offer "Install app"
// on both Android and desktop. Beyond that, it caches the app shell
// (this page plus its icons/manifest) so the app still opens even with
// no connection, falling back to the network for anything not cached
// (e.g. the Firebase/Google/EmailJS scripts, which need to be live
// anyway for the app to actually do anything once open).

const CACHE_NAME = "nokri-book-shell-v1";
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
      // Stale-while-revalidate: serve the cached copy immediately if
      // there is one (fast, works offline), while still fetching a
      // fresh copy in the background to keep the cache current for
      // next time.
      return cached || network;
    })
  );
});

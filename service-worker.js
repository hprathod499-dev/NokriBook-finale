// Service worker for Nokri Book.
//
// Two jobs:
//  1. Exist and register, so Chrome offers "Install app" (Android + desktop).
//  2. Cache the app shell so the app still opens with no connection,
//     falling back to the network for anything not cached (Firebase /
//     Google / EmailJS scripts must be live anyway).
//
// Strategy (unchanged in spirit from v2):
//  - Page navigations (opening/reloading any URL): NETWORK-FIRST. Always try
//    the current version; use the cached copy only when genuinely offline.
//    This is what prevents a broken snapshot from being served forever.
//  - Icons/manifest and other same-origin static files: cache-first with a
//    background refresh (being briefly stale is harmless).
//
// v3 — URL routing support (/app/staff, /app/duties/new, ...):
//  - The app is a single-page app: EVERY page URL is the same index.html and
//    the in-page router picks the screen. So the shell is cached under ONE
//    key ("/index.html") and used as the offline fallback for every
//    navigation, whatever its path.
//  - On GitHub Pages, /app/... has no real file, so Pages answers with its
//    404.html (an exact copy of index.html) using HTTP status 404. That
//    response is a perfectly good app shell, so it is accepted and used to
//    refresh the cached shell instead of being discarded for "not ok".
//  - Precaching adds files one at a time, so one missing file can no longer
//    stop index.html itself from being cached.
const CACHE_NAME = "nokri-book-shell-v3";
const SHELL_URL = "/index.html";
const APP_SHELL = [
  "/",
  SHELL_URL,
  "/manifest.json",
  "/favicon-16.png",
  "/favicon-32.png",
  "/icon-192.png",
  "/icon-512.png",
  "/apple-touch-icon.png",
  "/profile-icon.png",
  "/welcome-banner.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.all(APP_SHELL.map((url) => cache.add(url).catch(() => {})))
    )
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

// True for a response that is the HTML app shell: a normal 200, or the
// GitHub Pages 404.html fallback (status 404 + HTML body) that serves it
// for /app/... deep links.
function isShellResponse(res) {
  if (!res) return false;
  if (res.ok) return true;
  const type = res.headers && res.headers.get("content-type");
  return res.status === 404 && !!type && type.indexOf("text/html") !== -1;
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  // Only handle GET requests for same-origin files — everything else
  // (Firebase, Google APIs, EmailJS, cross-origin CDN scripts) passes
  // straight through to the network untouched.
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Opening / reloading / deep-linking to any page.
  if (req.mode === "navigate" || url.pathname.endsWith("/index.html") || url.pathname === "/") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          // Keep ONE fresh copy of the shell, no matter which URL was opened.
          if (isShellResponse(res)) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((cache) =>
              // Re-wrap as a 200 so it is always a valid shell for any URL later.
              cache.put(SHELL_URL, new Response(copy.body, {
                status: 200,
                headers: { "Content-Type": "text/html; charset=utf-8" },
              }))
            ).catch(() => {});
          }
          // Return the network response as-is (a 404-status shell still
          // renders the app; the in-page router takes over).
          return res;
        })
        .catch(() =>
          // Offline: serve the shell for ANY path (/app/staff/123 included).
          caches.match(SHELL_URL).then((cached) => cached || caches.match("/"))
        )
    );
    return;
  }

  // Everything else in the app shell (icons, manifest) — cache-first.
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

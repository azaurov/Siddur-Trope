// Siddur & Trope service worker.
// Minimal installability worker — doesn't aggressively cache the JS bundle
// (we want users to always get the freshest code, not stale lessons), but
// does cache the navigation request so the app shell loads even when the
// network is flaky.
//
// Caching strategy:
//   - Navigation requests (HTML): network-first, fall back to cached index.html
//   - JS/CSS bundles: network-first (cache is incidental, mainly for retries)
//   - Everything else: network-only
//
// This is intentionally NOT a full offline-first cache. The app is already
// designed to work offline-first on mobile (data lives in AsyncStorage), but
// the web PWA's first launch still requires a network round-trip to fetch
// the JS bundle. That's fine — PWA "Add to Home Screen" on iOS only requires
// the manifest + service worker, not full offline support.

const CACHE_NAME = "siddur-trope-v1";
const APP_SHELL = ["/", "/index.html", "/manifest.json", "/favicon.ico"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  // Navigation request: try network, fall back to cached index.html.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          // Opportunistically cache the latest index.html.
          const copy = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put("/", copy));
          return res;
        })
        .catch(() => caches.match("/index.html").then((r) => r || new Response("Offline", { status: 503 })))
    );
    return;
  }

  // For everything else (JS, CSS, images), just go to network.
  // If the user wants offline support later, this is where you'd add
  // cache-first/stale-while-revalidate logic per asset type.
});
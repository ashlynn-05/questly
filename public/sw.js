/**
 * Questly's service worker.
 *
 * It does one thing: when a page navigation fails because the phone has no
 * network, it serves /offline instead of the browser's dinosaur. Nothing else
 * is cached, deliberately -- every screen in this app is a live Convex
 * subscription, and a room served from cache is a room showing a vote that has
 * already been overtaken. A stale plan is worse than a spinner.
 *
 * The fetch handler is also not optional. Chrome still requires a service
 * worker WITH a fetch handler before it will offer to install a site, and it
 * ignores handlers it can see are no-ops, so a bare pass-through would not
 * count: https://developer.chrome.com/blog/update-install-criteria
 *
 * Push and notificationclick belong to the push work (#5) and are not here
 * yet. This file is what that work extends.
 *
 * Plain JS in public/ rather than TypeScript through the bundler: it has to be
 * served from the origin root to claim the whole scope, and it is small enough
 * that a build step would buy nothing.
 */

// Bump this when the file changes: the name is what makes the old cache
// collectable in `activate` below.
const CACHE = "questly-offline-v1";
const OFFLINE_URL = "/offline";

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      // `reload` so installing a new worker cannot pick the offline page up
      // out of the HTTP cache and freeze an old copy into the new cache.
      await cache.add(new Request(OFFLINE_URL, { cache: "reload" }));
      // The only asset is a fallback nobody sees while online, so there is
      // nothing for the old worker to be protecting -- waiting a whole page
      // lifetime to activate would just delay the fix.
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names.map((name) => (name.startsWith("questly-") && name !== CACHE ? caches.delete(name) : null)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  // Navigations only. Convex traffic, the auth routes and every static asset
  // fall straight through to the network untouched -- not respondWith'd at
  // all, so they keep the browser's own handling rather than a worse copy of
  // it.
  if (event.request.mode !== "navigate") return;

  event.respondWith(
    (async () => {
      try {
        return await fetch(event.request);
      } catch {
        // The only case this catches is a network failure. A 404 or a 500 is a
        // real answer from the server and belongs on screen as itself.
        const cached = await caches.match(OFFLINE_URL);
        return (
          cached ??
          new Response("You are offline.", {
            status: 503,
            headers: { "Content-Type": "text/plain; charset=utf-8" },
          })
        );
      }
    })(),
  );
});

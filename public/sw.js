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
 * It also receives push notifications and opens the room one was about. Those
 * two handlers are at the bottom and share nothing with the offline cache
 * above -- a service worker is simply the only place a browser will run either.
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


/**
 * A notification arrived.
 *
 * IT ALWAYS SHOWS ONE, whatever the payload turns out to be. This is not
 * defensive coding, it is the platform rule: the subscription was created with
 * `userVisibleOnly: true`, Chrome shows its own "this site was updated in the
 * background" notice if a push produces nothing visible, and iOS REVOKES a
 * subscription that receives a silent push. A malformed payload therefore has
 * to end in a real notification, so the fallback below is a valid outcome and
 * not an error path.
 *
 * `event.waitUntil` because `showNotification` is a promise and the worker is
 * killed the moment the handler returns without one.
 */
self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    // A payload we cannot read is still a push we must answer. Falls through
    // to the defaults below.
  }

  const title = payload.title || "Questly";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: payload.body || "Something happened in your room.",
      icon: "/icon-192.png",
      // No `badge`. Android wants a monochrome silhouette, generating one would
      // add `rsvg-convert` to `scripts/generate-icons.sh` as a build
      // dependency, and Android's default glyph is not worth that.
      //
      // `tag` collapses rather than stacks: a second notification with the same
      // tag REPLACES the first in the tray. One room's five moments are five
      // different tags, so none of them hides another, but a duplicate of any
      // one of them -- a retry, two devices racing -- replaces itself instead
      // of queueing a second buzz for the same news.
      tag: payload.url || title,
      // The url travels on the notification because `notificationclick` fires
      // in a worker that may have been started from cold for this event alone,
      // with no memory of the push that created it.
      data: { url: payload.url || "/" },
    }),
  );
});

/**
 * The notification was tapped: open what it was about.
 *
 * FOCUS BEFORE OPEN. `openWindow` unconditionally would leave someone with the
 * room in two tabs -- and on Android, a second copy of the installed app -- so
 * an existing client wins whenever there is one. `navigate()` on it moves that
 * window to the right room in the case where the app is open on a different
 * screen.
 *
 * `close()` first, because a notification the tap did not dismiss stays in the
 * tray looking unread.
 *
 * The url is always same-origin: it is built by `notificationFor` in the
 * backend and is always a `/room/<code>` path or `/settings`. It is resolved
 * against the worker's own scope here so that stays true regardless.
 */
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || "/", self.location.origin);

  event.waitUntil(
    (async () => {
      // `includeUncontrolled` because a tab opened before this worker took
      // control is still a window the person is looking at.
      const clients = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      for (const client of clients) {
        if (new URL(client.url).origin !== url.origin) continue;
        await client.focus();
        if (client.url !== url.href && "navigate" in client) await client.navigate(url.href);
        return;
      }
      await self.clients.openWindow(url.href);
    })(),
  );
});

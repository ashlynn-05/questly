import { expect, test, vi } from "vitest";

/**
 * `public/sw.js` decides one thing: which requests it answers, and with what.
 *
 * It cannot be exercised from the app's own tests through a browser -- a
 * service worker's `fetch()` runs on its own thread and DevTools' offline
 * emulation does not reach it, so "pull the network and reload" checks the
 * page, not this file. So the worker is loaded here with a fake `self` and its
 * three listeners are called directly.
 *
 * The assertions are about the two decisions that are user-visible and easy to
 * get subtly wrong: a failed NAVIGATION becomes the offline page, and
 * everything else -- every Convex call, every asset -- is not touched at all.
 * The second is the one that matters most: `respondWith` on a request this
 * worker has no better answer for would put a worse copy of the browser's own
 * networking in front of a live app.
 */
type Listener = (event: FakeEvent) => void;
type FakeEvent = {
  request: { url: string; mode: string };
  waitUntil: (p: unknown) => void;
  respondWith: (r: unknown) => void;
};

async function loadWorker(fetchImpl: typeof fetch) {
  const listeners = new Map<string, Listener>();
  const cacheStore = new Map<string, Response>();

  const cache = {
    add: async (request: Request) => {
      const response = await fetchImpl(request);
      cacheStore.set(new URL(request.url, "https://questly.test").pathname, response);
    },
  };

  const globals = globalThis as Record<string, unknown>;
  // A worker resolves a root-relative URL against its own scope. There is no
  // scope in `edge-runtime`, so the platform `Request` rejects "/offline"
  // outright -- this stub supplies the origin the browser would have.
  globals.Request = class {
    url: string;
    mode = "navigate";
    constructor(input: string) {
      this.url = new URL(input, "https://questly.test").toString();
    }
  };
  globals.self = {
    addEventListener: (type: string, listener: Listener) => listeners.set(type, listener),
    skipWaiting: async () => {},
    clients: { claim: async () => {} },
    registration: {},
  };
  globals.caches = {
    open: async () => cache,
    keys: async () => [...cacheStore.keys()],
    delete: async () => true,
    match: async (url: string) => cacheStore.get(url),
  };
  globals.fetch = fetchImpl;

  // Each test needs its own listener set, and the worker registers them at
  // module evaluation -- so the registry is cleared first. (A cache-busting
  // query on the specifier does not work: Vite refuses a dynamic import whose
  // path is not statically analysable.)
  vi.resetModules();
  // TS2306: `public/sw.js` has no import or export, because a classic service
  // worker script cannot have one -- `export {}` at the bottom to placate the
  // compiler would make it an ES module, and a module worker has to be
  // REGISTERED as one (`{ type: "module" }`), which not every browser this app
  // targets supports. So the file stays a script and the type error is
  // declared expected here, in the one place that imports it.
  // @ts-expect-error -- see above
  await import("../../public/sw.js");
  return listeners;
}

/** Runs `install`, then hands back the `fetch` listener it registered. */
async function installed(fetchImpl: typeof fetch) {
  const listeners = await loadWorker(fetchImpl);
  const waits: Array<unknown> = [];
  listeners.get("install")!({
    request: { url: "", mode: "" },
    waitUntil: (p) => waits.push(p),
    respondWith: () => {},
  });
  await Promise.all(waits);
  return listeners.get("fetch")!;
}

/** Drives one request through the fetch listener. */
function handle(listener: Listener, url: string, mode: string) {
  let answered: unknown;
  let respondWithCalled = false;
  listener({
    request: { url, mode },
    waitUntil: () => {},
    respondWith: (r) => {
      respondWithCalled = true;
      answered = r;
    },
  });
  return { respondWithCalled, answered };
}

const OFFLINE_BODY = "<!doctype html><title>Offline</title>";

/** Online: everything resolves. */
const online: typeof fetch = async (input) => {
  const url = typeof input === "string" ? input : (input as Request).url;
  return new Response(url.includes("/offline") ? OFFLINE_BODY : "<!doctype html><title>Room</title>", {
    headers: { "Content-Type": "text/html" },
  });
};

test("the offline page is precached on install", async () => {
  const spy = vi.fn(online);
  await installed(spy);
  const requested = spy.mock.calls.map(([input]) =>
    typeof input === "string" ? input : (input as Request).url,
  );
  expect(requested.some((url) => url.endsWith("/offline"))).toBe(true);
});

test("a navigation that reaches the network is served by the network", async () => {
  const listener = await installed(online);
  const { respondWithCalled, answered } = handle(listener, "https://questly.test/room/ABCD", "navigate");
  expect(respondWithCalled).toBe(true);
  expect(await (await (answered as Promise<Response>)).text()).toContain("Room");
});

test("a navigation with no network falls back to the cached offline page", async () => {
  // Installs while the network is up, then loses it -- which is the real
  // sequence: nobody installs a service worker offline.
  let up = true;
  const flaky: typeof fetch = async (input) => {
    if (!up) throw new TypeError("Failed to fetch");
    return online(input);
  };
  const listener = await installed(flaky);
  up = false;

  const { answered } = handle(listener, "https://questly.test/room/ABCD", "navigate");
  expect(await (await (answered as Promise<Response>)).text()).toBe(OFFLINE_BODY);
});

test("everything that is not a navigation is left to the browser", async () => {
  const listener = await installed(online);
  // A Convex call, a font, an image. `respondWith` is never called for these,
  // so the browser handles them exactly as it would with no worker installed.
  for (const url of [
    "https://questly.convex.cloud/api/query",
    "https://questly.test/icon-192.png",
    "https://questly.test/_next/static/chunks/main.js",
  ]) {
    expect(handle(listener, url, "cors").respondWithCalled).toBe(false);
    expect(handle(listener, url, "no-cors").respondWithCalled).toBe(false);
  }
});

/**
 * A guest's proof that they belong to a room. Stored per-room so one device can
 * hold two rooms at once -- which is exactly what happens when the app is
 * demoed on a laptop and a phone side by side.
 *
 * The STORE only. The hook that reads it on mount is `@/hooks/useSessionKey`,
 * which is where every hook in this app lives; both halves of the round trip
 * still go through the two functions below, so the in-memory fallback closes
 * the loop for the hook and for `rooms.create`'s direct write alike.
 */
const PREFIX = "questly-session-";

const keyFor = (code: string) => `${PREFIX}${code}`;

/**
 * The same keys, in memory, for the browsers that refuse to keep them.
 *
 * `localStorage` THROWS in Safari's "Block All Cookies", in some embedded
 * webviews and in a few private-browsing modes -- and /join and /room are two
 * separate page loads that talk to each other through this store and nothing
 * else. Swallowing that throw silently used to mean the guest was bounced
 * straight back to /join, where `rooms.join` -- correctly unable to recognise
 * an accountless guest who arrives with no key -- inserts ANOTHER member row.
 * Every retry permanently raised the unanimity denominator, so the room could
 * never match again: the exact phantom member the join flow's other guards
 * exist to prevent.
 *
 * A module-level Map survives a client-side navigation within one tab, which
 * is what /join -> /room is, so the key is readable for this session even when
 * nothing can be persisted. It does not survive a reload, and it is not meant
 * to: it closes the round trip, it does not pretend to be storage.
 */
const inMemory = new Map<string, string>();

/**
 * Store a key for a room the caller has just been let into.
 *
 * The hook below cannot serve that case: the room code does not exist until
 * `rooms.create` resolves, and a hook cannot be called once it does. So the
 * write lives here instead of being retyped at each call site -- one key
 * format, and one try/catch for private browsing, where `localStorage` throws
 * rather than returning null.
 */
export function storeSessionKey(code: string, key: string) {
  // Memory first, and unconditionally: it is the half that cannot fail, and
  // the persisted half is the bonus.
  inMemory.set(keyFor(code), key);
  try {
    localStorage.setItem(keyFor(code), key);
  } catch {
    // Only survival is lost -- `readSessionKey` still finds it this session.
  }
}

/**
 * Read back the key this device holds for one room, or null.
 *
 * Memory wins over the store, because memory is only ever written by a
 * `storeSessionKey` in this page's lifetime and is therefore the newer of the
 * two whenever they disagree -- a write that hit the quota wall would
 * otherwise leave a stale persisted key answering for a fresh membership.
 */
export function readSessionKey(code: string): string | null {
  const remembered = inMemory.get(keyFor(code));
  if (remembered !== undefined) return remembered;
  try {
    return localStorage.getItem(keyFor(code));
  } catch {
    return null; // no store, and nothing stored this session either
  }
}

/**
 * Drop every room key this device holds. What signing out has to do beyond
 * signing out.
 *
 * A `sessionKey` is a capability, not a session cookie: the two stores are
 * independent, and clearing only the auth session would leave a shared laptop
 * holding working keys to every room the last person was in -- keys that
 * `rooms.get` accepts on their own, with no identity involved at all. So sign
 * out clears both, and this is the half the auth library cannot know about.
 *
 * Both stores, and in that order. The in-memory Map is the one that cannot
 * fail, and it is also the one `readSessionKey` consults first -- clearing
 * `localStorage` alone would leave the next read answering out of memory with a
 * key that is supposedly gone.
 *
 * The persisted half is enumerated rather than derived from the Map, because
 * the Map only knows what THIS page load wrote. A key persisted last Tuesday is
 * exactly the one that most needs to go, and the only way to find it is to walk
 * the store. Backwards, because removing an item reindexes everything after it.
 */
export function clearSessionKeys() {
  inMemory.clear();
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key?.startsWith(PREFIX)) localStorage.removeItem(key);
    }
  } catch {
    // A browser that refuses site storage has nothing persisted to clear, and
    // the half that mattered -- the in-memory Map -- is already gone.
  }
}

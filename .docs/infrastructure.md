# Questly infrastructure

This is the current runtime map. The limits below are product and safety policy;
they are not a production-capacity claim. Start with [setup](./setup.md), then
use the [task workflow](./task-workflow.md) for changes.

## Runtime boundaries

- The web app is Next.js 16.3.4 App Router code under [`src/app`](../src/app).
  Routes own the URL, page-level state, Convex subscriptions, and mutations;
  route-private UI lives in each route's `_components` directory.
- The root layout gets a Better Auth token on the server and passes it to
  [`ConvexBetterAuthProvider`](../src/app/_components/ConvexClientProvider.tsx).
  `src/app/api/auth/[...all]/route.ts` forwards Better Auth GET/POST requests to
  Convex. No auth secret is needed in the Next process.
- Convex owns the database, realtime queries, actions, mutations, HTTP routes,
  file storage, and cron. Registered functions are in [`convex`](../convex);
  [`convex/http.ts`](../convex/http.ts) mounts Better Auth and the photo route.
- [`convex/convex.config.ts`](../convex/convex.config.ts) mounts the Better Auth,
  rate-limiter, and Workpool components. `_generated` files are generated
  outputs: change source and run supported Convex codegen instead of editing
  them by hand.

## Better Auth and ownership

Better Auth runs inside Convex through [`convex/auth.ts`](../convex/auth.ts) and
`@convex-dev/better-auth`; email/username/password is enabled and Google or
Discord is registered only when its deployment credentials exist. Convex gets
the JWT provider from [`convex/auth.config.ts`](../convex/auth.config.ts).

The current ownership key is `identity.subject`, resolved in
[`convex/lib/access.ts`](../convex/lib/access.ts) and stored as `profiles.userId`
and `rooms.hostUserId`. Preserve that mapping when changing auth: replacing it
with another identity field without a migration can strand existing ownership
rows. A signed-in identity and a room capability are separate concerns. Guests
use a server-issued `sessionKey` checked against the room's member row; this is
why room functions still require `sessionKey` even when public/authenticated
builders are used.

## Storage

Avatars use Convex file storage directly. An authenticated mutation returns an
upload URL, the browser uploads bytes to storage, and `setAvatar` reads the
server metadata before adopting the `_storage` id in `profiles.avatarId`. Reads
resolve a signed URL with `ctx.storage.getUrl`; a signed URL is never stored in
a table. The current file policy is PNG, JPEG, WebP, or GIF under 2 MiB. An
abandoned or refused upload may leave an orphan blob; sweeping those blobs is a
separate lifecycle job.

## Providers

Google Places is called only from Convex actions with
`GOOGLE_MAPS_SERVER_KEY`. Nearby search clamps the radius to 50 km and asks for
at most 20 results; text search asks for at most 8. Quest payloads retain an
opaque Places `photoName`, never a Google media URL or API key.

The unauthenticated [`/places/photo`](../convex/places.ts) HTTP route exists for
`<img>` tags. It accepts the allowlisted Places name shape, canonicalizes
`maxWidthPx` to 1–800 (800 by default), verifies the name exists in `quests`,
and reserves Google quota before resolving a signed, keyless Google URI for the
302 the browser follows. Redirects use `Cache-Control: no-store`; no persistent
photo-name/URI content cache or provider TTL is assumed. Same-isolate requests
coalesce in memory; cross-isolate coordination stores only a hash, token, and
expiry in `photoLeases`. Invalid input is 400,
unknown photos 404, a busy/exhausted request 429 with `Retry-After`, and an
unavailable lease store 503. Upstream failures can surface as 502.

OpenAI is also Convex-only. [`convex/lib/openai.ts`](../convex/lib/openai.ts)
uses `gpt-4o-mini`, JSON mode, a 512-token completion cap, and a 15-second
timeout. Embeddings use `text-embedding-3-small`; the SDK timeout is 10 seconds
and its one retry is a separate provider attempt. Missing or failed provider
calls use the existing fallback paths where the feature has one.

## Async work and idempotency

Deck building remains a synchronous action: its room lease and token-checked
writes prevent a stale build from replacing a newer deck. Only plan generation
uses [`convex/lib/planQueue.ts`](../convex/lib/planQueue.ts): one named
`planGeneration` Workpool, `maxParallelism: 8`, and retries disabled both by
default and at enqueue.

Workpool has no dedupe key. A queued duplicate is therefore made harmless at
execution: check for an existing plan, acquire the room's generation lease,
check again, then reserve generation/provider quota only for the winner. The
plan write is an upsert guarded by that lease token. This is the idempotency
boundary; do not add a queue-marker table unless a reproduced gap requires it.

## Quota policy

The current [`convex/lib/rateLimits.ts`](../convex/lib/rateLimits.ts) policy is:

| Scope | Policy |
| --- | --- |
| Signed-in search/suggest | 20 requests/minute per user and family |
| Guest room search/suggest | 10/minute per member and 40/minute per room, per family |
| Deck or plan generation | 3 per room and family per 10 minutes |
| Google provider attempts | 120/minute and 1,000/UTC day |
| OpenAI provider attempts | 30/minute and 200/UTC day |

`rateLimiter.check` is read-only. `rateLimiter.limit` through the reservation
mutations consumes a token. Actions and HTTP work reserve immediately before
the upstream attempt; every retry consumes another attempt, and timeouts are
not refunded. Multiple policy reservations are transactional: a denied policy
rolls back partial consumption. These defaults bound this deployment's current
behavior; they are not spend authorization or measured capacity.

## Bounded reads and lifecycle

- `rooms.openRoomsPage` uses the visibility/status/mood index and accepts at
  most 20 rows per page (the start flow asks for 8). Full rooms are filtered
  after each page, so an empty filtered page is not exhaustion; the client keeps
  loading while the cursor says more exists. The compatibility `openRooms` read
  keeps a 100-room discovery ceiling and fails explicitly above it.
- Active partner venues are read in 32-row pages, with a 33-row lookahead and a
  32 KiB page budget. The action refuses a catalogue above 256 active rows or a
  required split rather than ranking a silently truncated prefix.
- A room moves `lobby → building → swiping → matched → booked`. It has a hard
  12-member ceiling and keeps four-digit join codes. Booking freezes the plan;
  roster changes still clean up their own swipes and votes.
- Account deletion is a soft tombstone: memberships detach immediately,
  profiles remain restorable for 14 days, and a daily 15:00 UTC cron purges at
  most 100 expired profiles per run. Restore clears the tombstone and preserves
  profile history, but detached room seats are not recreated.

See [coding conventions](./coding-conventions.md), [handbook index](./index.md), and
the repository's [Convex guidelines](../convex/_generated/ai/guidelines.md).

# Questly coding conventions

These conventions describe the current tree. Keep changes small, preserve
existing behavior, and use the [infrastructure map](./infrastructure.md) for
runtime limits. Project entry points are [handbook index](./index.md), [setup](./setup.md),
and the [task workflow](./task-workflow.md).

## Where code lives

- `src/app/<route>/page.tsx` owns the route's state, subscriptions, mutations,
  navigation, and loading/error behavior. Put route-only components in that
  route's `_components`; do not create a second subscription in an extracted
  child. `src/app/_components` is for app-shell owners such as the Convex
  provider and service worker.
- `src/components/questly` and the other `src/components` files are shared
  primitives. A component belongs there only when more than one route owns the
  same behavior or visual contract. Keep pure browser/domain helpers in
  `src/lib`; keep Convex-only helpers in `convex/lib`.
- **Every React hook lives in `src/hooks`, one hook per file named after it.**
  A hook is never defined in the component or route that happens to use it
  first: two screens asking the same question is how a multi-step browser
  negotiation ends up written twice with one copy subtly wrong. Compose rather
  than grow -- `usePush` is the shape to copy, split into `usePushBrowser`
  (device facts, no server) and `usePushSeat` (server identity, no DOM) so a
  screen that wants only one half does not mount the other.
- **`convex/lib` and `src/lib` are grouped by feature, one folder per feature.**
  `convex/lib/{account,deck,plans,push,rooms}` and
  `src/lib/{account,pwa,room,start}`. A helper goes in the folder of the
  feature it serves, and the folder is the unit somebody reads to understand
  that feature.
- **The root of each `lib` is for cross-cutting plumbing only**, not for a
  feature that has not earned a folder: `convex/lib` keeps `customFunctions.ts`,
  `errors.ts`, `openai.ts` and `rateLimits.ts` there; `src/lib` keeps
  `errors.ts`, `help.ts`, `menu.ts` and `theme.ts`. If a new root file is about
  one feature, it is in the wrong place.
- Tests mirror production paths under root `tests/`: backend tests are in
  `tests/convex`, client/helper tests in `tests/src`, and both mirror the
  feature folders above. `import.meta.glob` module maps in a Convex test are
  relative paths, not import specifiers, so moving a test file a level deeper
  means fixing its glob by hand. Shared setup is in
  `tests/setup.ts` and `tests/globalsetup.ts`. Preserve the offline network
  guard. Convex tests use the repository's `convex-test` module map and the
  edge-runtime Vitest configuration.

## Convex boundaries

- Read [`convex/_generated/ai/guidelines.md`](../convex/_generated/ai/guidelines.md)
  before editing Convex code. Use object-form registered functions with `args`
  and `returns` validators, correct generated `api`/`internal` references, and
  `withIndex` for indexed reads. Use pagination or a deliberate `take` ceiling
  instead of an unbounded `collect` on growing data.
- Compose [`convex/schema.ts`](../convex/schema.ts) from the table modules in
  `convex/tables`. Keep cross-domain validators in [`convex/validators.ts`](../convex/validators.ts).
  Use `v.id(...)` and `Doc`/`Id` types instead of stringly-typed database ids.
  Generated files are codegen output and are never hand-edited.
- User-facing failures use the stable codes and sentences in
  [`convex/lib/errors.ts`](../convex/lib/errors.ts); internal/provider failures
  may remain internal when the caller already owns the fallback behavior.
  Preserve endpoint-specific membership, host, active-account, and booked-state
  guards when extracting helpers.

## Authorization and identity

`publicQuery`, `publicMutation`, and `publicAction` inject optional identity;
the authenticated builders require and inject the server-derived current user.
“Public” means the endpoint may be used by a guest, not that it may read or
write arbitrary documents. A builder does not replace resource authorization:
room operations still resolve the `sessionKey` capability with
`requireMember`, and a `memberId` argument names a target to remove, never the
caller.

The persisted ownership contract currently uses Better Auth `identity.subject`
through [`convex/lib/rooms/access.ts`](../convex/lib/rooms/access.ts). Do not switch a single
call site to `tokenIdentifier` or accept a client `userId`; an identity-key
change needs an explicit compatibility migration. Deleted-account checks are
intentionally endpoint-specific: hosting and account actions use live-account
guards, while joining, deletion status, and restoration retain their own rules.

## Quotas, queues, and provider calls

Do not use a read-only quota check as if it consumed capacity. `check` is for
UI/preflight information; reservation mutations call `limit` and are the only
admission boundary. Reserve all applicable policies atomically before the
upstream call, fail closed when the limiter store is unavailable, and reserve
once per physical provider attempt. A timeout or retry has already spent its
reservation.

Plan generation is the one Workpool path. Keep duplicate protection at actual
execution: existing-plan check, lease acquisition, second check, then quota and
provider work. Use token-checked writes and the existing fallback plan. Do not
add a generic retrier, dedupe abstraction, or queue schema for a hypothetical
case.

## Photos and storage

Store Convex storage ids, never signed URLs. Preserve the existing Google Places
opaque `photoName` and partner-hosted `photoUrl` fields; the browser uses the
photo proxy, which redirects to a keyless signed Google URI. Do not add stored
media URLs, API keys, or a persistent provider-content/URI cache. Keep the
source-index check, name/width validation, hashed cross-isolate photo lease,
same-isolate coalescing, no-store redirect, and explicit 400/404/429/503/502
outcomes together at the HTTP boundary.

## Change discipline

Prefer an existing helper over a new wrapper. Add a tiny abstraction only when
multiple callers share one invariant; keep one-off logic local. When moving a
component, keep its owner of state and callbacks, preserve imports and focus/
error/loading behavior, and remove the old path only after a whole-repo caller
search. For non-trivial branches, leave one focused regression test at the
smallest boundary that would fail if the behavior regressed.

Preserve the room lifecycle, four-digit links, guest capability access, soft
delete/restore semantics, and current bounded reads unless the task explicitly
changes product policy. Verify with the smallest targeted test first, then the
repository lint/typecheck/build checks described in [setup](./setup.md).

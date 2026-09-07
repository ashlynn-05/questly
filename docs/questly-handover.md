# Questly — handover for review

Branch `questly`, built from `docs/superpowers/plans/2026-09-06-questly.md`
(19 tasks) against `docs/superpowers/specs/2026-09-06-questly-design.md`.

Every task was implemented by a fresh agent and reviewed by a separate one,
then the whole branch went through three independent final reviews — backend,
frontend, and tests/integration — followed by one fix round. This document is
the honest version: what is verified, what is not, and what was deliberately
left undone.

---

## 1. What it does

A group opens a room, everyone swipes the same deck of Melbourne venues, a
**unanimous** yes on one card matches the room, an LLM turns that into a
multi-stop night (meet / main / after), the group edits it by vote, and the
booking is simulated. Personalisation comes from an onboarding quiz.

Business model context: venues would pay per filled booking; users pay nothing.
Nothing in this branch charges anyone or contacts a venue.

## 2. Honesty constraints, and where they are enforced

These were treated as hard product constraints, not nice-to-haves, because the
app shows prices and bookings that came from a third-party API rather than from
a venue:

- No testimonials, no customer logos, no "trusted by", no named partner venue
  presented as real, no fabricated booking/user/venue counts.
- Seeded demonstration data announces itself as demonstration data.
- Any price derived from Google Places renders as an **estimate**, never as a
  price a venue quoted.
- A simulated booking never reads as a confirmed reservation.

Three defects in this area were caught by the final backend review and fixed in
the last round: a missing Google price level defaulted to $35/head (so a free
park was priced and would have been "booked" at $35 × the group); `FREE_TYPES`
contained `tourist_attraction`, so Eureka Skydeck rendered "Free" at
`totalCents: 0`; and the fallback plan priced its anchor venue at 70% of the
group's budget instead of the venue's actual price, with that invented number
becoming the booking total. Worth re-checking this area specifically.

## 3. Authorization model — the thing to review hardest

**No function anywhere accepts a `userId` or any user identifier as an argument
for authorization purposes.** Identity is always derived server-side from the
Better Auth session (`identity.subject`).

The one deliberate exception is `sessionKey`. It is a **capability token
proving membership of one specific room** — never an identity claim. It is what
lets a guest who tapped a group-chat link act in a room without an account. It
is generated server-side, stored per-room on the client, and never returned to
any member other than its owner. `convex/rooms.test.ts` asserts it does not
leak from `rooms.get`.

**Two places look like exceptions and are not — I checked both myself rather
than taking the reviewer's word for it:**

- `convex/profiles.ts:37` — `write` takes a `userId` argument, but it is an
  `internalMutation`, so no client can reach it. Its only caller is `saveQuiz`,
  which derives the id from the authenticated identity. The code says so at
  `:31-35`. `saveQuiz` also refuses to accept `displayName` as an argument, for
  the same reason: a client-supplied name is spoofable, and a roomful of members
  all claiming one name is the exact confusion that field exists to prevent.
- `convex/rooms.ts:478` — `removeMember` takes a `memberId`, but that is the
  *target* of the removal, not a claim about who is calling. The caller is
  authorized by their own `sessionKey` plus a host check, and the named row must
  belong to the room that `sessionKey` proves membership of.

The final backend review ran a table-by-table enumeration — for every table, it
enumerated *every* function that writes it, rather than the functions anyone
remembered — and its **authorization sweep came back clean**. That method is
what caught the two most serious defects earlier in the build, so it was
mandated for the final pass.

## 4. Verification status at HEAD `17bfaf8`

Run by the controller directly, not taken from any implementer's report:

| Gate | Result |
|---|---|
| `npm run build` | exit 0, 9 routes, after `rm -rf .next` |
| `npx tsc --noEmit` | exit 0 |
| `npm run lint` | 0 errors, 6 warnings (unchanged baseline) |
| `npm test` | **346 passed / 21 files** (was 259 / 17) |
| `git status --porcelain` | empty |

The build's route list is itself the proof that the scaffold deletion is real:
`/`, `/_not-found`, `/api/auth/[...all]`, `/direction`, `/join/[code]`,
`/room/[code]`, `/sign-in`, `/sign-up`, `/start`. No `/dashboard`, no `/demo/*`.

## 5. What is verified, and how

- `npm test` — the suite drives real Convex functions through `convex-test`.
- `npx tsc --noEmit`, `npm run build`, `npm run lint`.
- **Mutation testing.** The tests/integration reviewer did not take the suite's
  word for its own coverage. It made temporary source mutations and confirmed
  the tests caught them:
  - `members.every` → `members.some` in the match resolver: **7 failures**
  - deleting the re-resolve call after a roster change: **3 failures**
  - making the booked-room freeze a no-op: **5 failures**
  - disabling the room-rejoin short-circuit: **4 failures**
  It also independently reproduced three mutations a previous author had
  claimed, and reverted every change by hand.

Six invariants are protected and mutation-confirmed: a match requires every
member to say yes to the same venue; a room can never hang (every roster change
and swipe re-resolves); a booked room's plan is frozen; no duplicate member row;
`sessionKey` never leaks; a member of room A cannot act on room B.

## 6. What is NOT verified — read this before trusting the demo

- **The realtime story itself has never been observed.** No test in this repo
  opens two subscriptions, so "a swipe on one phone updates the other" rests on
  Convex's guarantees plus a smoke test — not on an observed two-client run.
  The Claude-in-Chrome extension was disconnected for this entire session, so
  there was no manual run either. This is the single largest gap.
- **"Geolocation denied still reaches a CBD-centred deck"** has no automated
  test and, for the same reason, no manual one. (The other two checks in that
  plan step *are* automated.)
- No test asserts anything about React component behaviour. This is deliberate:
  vitest runs a single global `edge-runtime` environment with no DOM, and no
  jsdom/happy-dom/testing-library is installed. Where component logic mattered,
  it was extracted into pure functions and tested there instead.

## 7. Environment variables the deployment still needs

`GOOGLE_MAPS_SERVER_KEY` and `OPENAI_API_KEY` are not set on the Convex
deployment (`dev/le-thao-linh`). Without them the app degrades to its fallback
paths rather than breaking — a matched room still gets a usable plan — but the
deck will not be personalised and venue search will not run.

## 8. Deliberately deferred, with reasons

Each of these was found, judged, and left undone on purpose:

- **`openRooms` scans every open lobby room ever created**, then issues one
  member query per room. Correct today, will not scale. Needs an index and a
  bounded query.
- **4-digit room codes are never freed**, so the product runs out of rooms at
  10,000 and degrades well before that through collision retries.
- **No rate limit on the billed actions** (OpenAI, Google Places). A signed-in
  user can drive spend.
- **The client still authors part of a plan `Stop`.** The last round forced
  `source` server-side and range-checked the price, which closes the fake
  "partner discount" badge and the fake price. The full fix — server-stored
  candidates the client references by id — is a schema change too large for a
  fix round.
- **"Add to calendar" on the booked screen** is in the design spec but appears
  in no task, no code and no test. This is spec-vs-plan drift, i.e. a scope
  decision, not a defect.

## 9. One open question for the product owner

The landing page says the app works **"in two taps"** (`src/app/page.tsx:15`,
`src/app/layout.tsx:18`). Actual counts:

| Who | Taps |
|---|---|
| Guest joining a group-chat link | **2** |
| Returning host | **4** |
| New visitor, already signed in | **12** |
| New visitor, signed out (the real first run) | **~28** before the last fix round |

"Two taps" is literally true for exactly one person — the guest who joins a link
— and that person is the only one who never sees the landing page it is printed
on. The last fix round removed the sign-in dead end that caused the signed-out
visitor to redo the whole funnel, which cuts that ~28 substantially, but it does
not make it two. This is a copy decision, so it was escalated rather than
changed unilaterally.

---

## 10. What the final fix round changed

Three independent whole-branch reviews (backend, frontend, tests) each returned
"ship with fixes". Their findings were fixed in 13 commits, `af2847e..81eb423`.
The ones that matter to a reviewer:

- **Prices are no longer invented.** A venue Google has no price for is now
  honestly unpriced rather than defaulted to $35/head and charged at
  $35 × the group. `tourist_attraction` left the free-types list, so a paid
  attraction no longer renders "Free" at `totalCents: 0`. The fallback plan
  prices its anchor at the venue's actual price rather than at 70% of the
  group's wallet. A `$0` room in a fully-priced neighbourhood now returns an
  honest empty state instead of a deck of paid venues mislabelled free.
- **Two hang-forever states got an exit.** A killed plan generation now holds a
  bounded lease and the host has a retry; a room stuck behind an absent member
  can now remove them from the screen where the problem is visible.
- **Three unauthenticated public surfaces were deleted**, not patched — they
  were Create-Next-App leftovers that spent OpenAI money with no product
  function. The page they were reachable from was also the accidental
  post-sign-in destination, so deleting it closed the sign-in dead end too.
- **The test suite can no longer reach the network at all.** It had been making
  a live billable OpenAI call on any machine with the key set, and swallowing
  the result so nobody noticed. The first fix round fixed the file that was
  named and missed the real site; a second round replaced the patch with a
  suite-wide guard, and proved the guard *detects* — with the defect restored it
  exits 1 with `NETWORK GUARD FAILED`. Two things had to be discovered by
  measurement rather than assumed, and both are documented in the code: a
  `setupFiles` hook alone is not enough (an undrained scheduled job fires after
  the file's own `afterAll`, so the run stays green while the guard records the
  attempt), and a `throw` from a vitest 4.1.11 globalSetup teardown still exits
  **0**, so the teardown sets `process.exitCode` explicitly.
- **The deck-cache test suite was type-blind** — it used a harness type that
  dropped the schema parameter, so its seeds could write row shapes the real
  deployment would reject and stay green. Proven by probe, then fixed.
- **Nineteen contrast ratios written in code comments were wrong.** Three
  materially, including one rounded *up* across the 3:1 line it exists to
  document. All recomputed from token values.

## 11. Known process notes

- Two agents were killed mid-work by transient network errors and one by
  memory pressure. Each was resumed rather than restarted, and no work was lost.
- **This machine is tight on memory.** Running `next dev` and `npx convex dev`
  simultaneously alongside other work ran it out of RAM three times. Both were
  stopped for the final verification; restart them as needed.
- `npx convex dev` must be running to push schema changes; it is currently
  stopped.

---

## 12. Two rulings a reviewer should sanity-check

Both were decided during the build rather than escalated, and both are the kind
of call a product owner might make differently.

**A booking stays frozen; the screen shows both numbers.** When someone leaves
after the group has booked, the booking row is not recomputed. `Going` shows the
live roster, and when it differs the screen also says "4 were in when the group
booked" and "Split between 4 when this was booked". The two rejected
alternatives, and why: recomputing would put "$37 each between 3" on screen — a
figure nobody agreed to — and blocking `rooms.leave` in a booked room would trap
someone in a night they cannot attend. The reasoning is written into
`src/lib/booking.ts`'s module doc, pointed at from the `headcount` field in
`convex/bookings.ts`.

**A half-finished funnel is `sessionStorage`, not `localStorage`.** So signing in
*in a new tab* loses the draft. Deliberate: a draft that outlives the browser
session would resurrect a stale plan days later, which is worse than retyping.
Say if you want it to survive.

## 13. Follow-ups worth doing first, in order

1. **Narrow the `rooms.get` projection.** It currently ships commercial detail
   (`partnerTier`, `score`) to anyone already in the room. Not a member-data
   leak and no `sessionKey` is projected — that is now asserted by value, not by
   field name. Deferred only because it narrows the contract of the one
   subscription both implementers were editing.
2. **Have `rooms.get` project member ids alongside names.** The deck's
   remove-a-stuck-member fix currently matches by name, so duplicate names give
   a row each. Correct today, cleaner with ids. Pairs naturally with (1).
3. **Assert the contrast ratios in a test.** All 102 written ratios in `src/`
   are now correct and independently verified, but nothing stops the 103rd from
   being wrong. Nineteen were wrong before this round; that is the argument.
4. Then the scale items in §8.

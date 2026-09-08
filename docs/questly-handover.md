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

---

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
4. **Purge the Better Auth user record too**, via the `admin` plugin — see
   §14. Today the 14-day job erases our profile row and leaves the signup
   credential behind.
5. **Sweep `_storage` for orphaned avatar uploads.** A refused upload (wrong
   type, over 2MB) leaves its blob behind, because the refusal throws and a
   Convex transaction rolls the cleanup back with it — see §14. Bounded by the
   2MB cap and by needing an account to get an upload URL, so it is a tidiness
   job, not a leak.
6. Then the scale items in §8.

---

## 14. The account surface (issue #2)

Added on branch `cobeo2004/clarify-the-authentication-onboarding-and-user-s`,
after the review this document was written for. Closes ashlynn-05/questly#2.

**What the issue understated.** The quiz answers were never stored at all. The
`profiles` row held only the derived artefacts — `tasteVector`, `tasteSentence`,
`moodAffinity`, `goals` — and none is invertible: `moodAffinity` sums two cards
per mood, so `0` means "one more, one less" and "neither answered" alike. So
"answers are viewable and re-answerable" was a schema change
(`profiles.answers`), not a screen.

### Guest access — ruled, not changed

`PRODUCT.md:52` already decided this and the code already agreed: **guests join
with a first name only, no account and no quiz, and their swipes count.** An
account is required only to *host*, because `rooms.create` is the one function
in the join path that calls `requireUserId`. This is recorded here because the
ruling existed in the product doc and nowhere in the handover, which made it
look like an oversight to every reviewer who read the code first.

### Deletion is a recycle bin, not a redaction

`account.deleteAccount` does three things, and they have deliberately different
lifetimes:

| What | When | Why |
|---|---|---|
| `profiles.deletedAt` set | immediately | `profiles.me` returns null from the next render, so every other screen behaves as though the account is gone without knowing this state exists |
| every seat detached | immediately, **irreversibly** | a room waits on every member it has; one that keeps waiting on somebody who left is the deadlock `lib/roster.ts` exists to prevent |
| the row erased | after **14 days**, by `crons.ts` → `account.purgeExpired` | a restore with nothing to restore is not a restore |

The cost is stated on the screen rather than buried in the code: for fourteen
days the taste vector still exists. A delete that erases everything at the tap
and a delete that can be undone are different products, and this one was asked
for the second.

**Deletion is refused while hosting a room that is not `booked` *and* whose
night is still ahead** (`HOSTING_LIVE_ROOM`, naming the codes). `deck.build` is
host-only, so a `lobby` or `building` room whose host has gone can never start.
A `booked` room is settled, so its host may leave — the same ruling as §12's
first entry.

The date bound is load-bearing, and review caught its absence as a blocker.
**Nothing in this product can close a room:** `rooms.leave` throws
`HOST_CANNOT_LEAVE` for the host, and there is no cancel or delete. So a
refusal on status alone means one abandoned `lobby` room — a mistyped date, a
plan that fell through — refuses that person's deletion *permanently*, and the
first draft of the message told them to "close the room", which is not a thing
they can do. A night in the past is not a night anyone can still lose, so the
host seat is given up and the dead room is left empty. The longest anyone can
now be held is until a date they chose themselves. **The guard reads `members.isHost`, not `rooms.hostUserId`.** A second review
finding, and a griefing vector in the first draft: the two can disagree.
`rooms.join` hands the host seat of an *empty demo room* to whoever walks in
first (`claimsHostSeat`, `convex/rooms.ts`), setting `isHost: true` while
`hostUserId` keeps pointing at the synthetic seed id. So somebody could take a
demo room's host seat, let a group gather, then delete their account — the
`hostUserId` guard saw no rooms they "hosted", detached the only host row, and
left a roomful of people in a room that can never start, walking around
`HOST_CANNOT_LEAVE` on the way. Asking the seats makes this guard agree with
every other host check in the product (`deck.ts`, `plans.ts`, `rooms.ts` all
read `isHost`), and it reads rows already in hand — so the `by_host_status`
index the first draft added is gone again.

**The tombstone is enforced in the backend, not by a redirect.**
`convex/lib/access.ts` gained `requireLiveUserId`, and `rooms.create` uses it:
a deleted account calling straight past the UI could otherwise open new rooms
and be their host, and then `purgeExpired` would erase the profile out from
under them, leaving live rooms hosted by nobody (`ACCOUNT_DELETED`).
Deliberately **not** applied to `rooms.join` — a deleted account taking a seat
is exactly a guest taking a seat, which the product already allows for people
with no account at all.

If a reviewer wants the stricter no-past-nights behaviour back, the honest way
is a `rooms.close` mutation for the host, not the removal of the date bound.

**`/restore` is the one screen that admits a tombstoned row exists.**
`/settings` and `/start` both redirect to it rather than each growing their own
copy of the offer, so the deadline, the wording, and the fact that seats do not
come back cannot drift apart.

**The index trap, written down because it is a data-loss bug and not a style
point.** A document with no `deletedAt` is still in `by_deletedAt`, and an
absent value sorts BEFORE every number. A one-sided `q.lt("deletedAt", cutoff)`
therefore matches every *live* profile, and the daily tidy-up job would delete
the accounts of everyone who never asked. The range is bounded at both ends —
`q.gt("deletedAt", 0).lt("deletedAt", cutoff)` — and `gt(0)` is the floor that
excludes "absent", not a plausible-timestamp check.
`convex/account.test.ts` fails on both counts if that floor is removed.

### Known limitation — the Better Auth record outlives the purge

`purgeExpired` deletes **our** `profiles` row. It does **not** delete the Better
Auth user record, because Better Auth's `deleteUser` needs the user's own
session and there is none fourteen days later. What survives is the signup
credential — email and name — holding nothing the product derived. Removing it
too needs the Better Auth `admin` plugin; that is a follow-up, listed in §13,
rather than something done quietly.

### The rest of the surface

- **`/settings`** — signed in as; rename; your answers (rendered from the stored
  `answers`) with "Retake the quiz" → `/start?retake=1`, which seeds the funnel
  from what you said rather than a blank run; your rooms; sign out; delete.
- **`profiles.renameMe`** writes `profiles.displayName` only and leaves Better
  Auth's `user.name` alone. `profiles.write` correspondingly stopped overwriting
  the name on the update path, so a retake no longer silently undoes a rename.
  Two sources of truth kept in sync by hand is the drift this avoids.
- **`profiles.myRooms`** closes a real recovery gap: a room lives behind a
  `sessionKey` in one browser's storage, so a cleared cache made your own room
  unreachable unless you remembered four digits. `rooms.join` could always
  recognise a signed-in member and hand back the same seat; nothing could say
  which door to knock on.
- **Sign-out clears three stores**, through one `clearLocalState()`
  (`src/lib/signout.ts`) rather than a habit at three call sites — because the
  defect review found was exactly a forgotten call. Better Auth's session, the
  `questly-session-` room capabilities, and the funnel draft are independent.
  Leaving the capabilities behind lets the next person on a shared laptop walk
  into every room the last one was in. Leaving the **draft** behind is worse and
  less obvious: `/start` restores it for whoever signs in *next*, and finishing
  the funnel submits it through `saveQuiz`, which derives the user id from the
  *current* identity — so one person's quiz answers were written to the next
  person's account, shown back to them as "Your answers", and used to rank their
  decks.
- **The landing page is now auth-aware**, read server-side through
  `fetchAuthQuery` so there is no signed-out flash. The cost is that `/` is no
  longer statically rendered.
- **The account door sits beside `<ThemeToggle />`** on `/`, `/start` and
  `/room/[code]` — a guest who taps a group-chat link never passes the landing
  page, so that was the only door to the account and it was on a screen they
  never see.

### The header is two roundels

The header used to be a three-button colour bar plus a "Settings" text link.
Both are now `MenuRoundel`
(`src/components/questly/MenuRoundel.tsx`) — one primitive, drawn twice.

- **Why a roundel and not an avatar-and-caret kit.** `globals.css` states the
  design as "Melbourne wayfinding — one orange line, roundel stops", and `.node`
  already draws stops as circles. Two header controls that are both stops on
  that line get drawn as stops. One interaction to learn, used twice.
- **Filled vs hollow is information, not decoration.** The account roundel is
  filled (`border-action-edge bg-action text-on-action`, the pairing `Plate`'s
  action variant uses) the way `.node[data-state="locked"]` fills a settled
  stop; the colour-mode roundel is hollow, because a setting is open. Orange on
  iris is 2.95:1, under SC 1.4.11 — which is why the fill carries a
  `--action-edge` boundary rather than moving to a different orange.
- **The menu surface is `--ground`, deliberately not `--ground-raised`.** The
  page ground is `--ground-deep`, so `--ground` already reads as raised against
  it, and it is the surface `--text-dim` (5.26:1 / 6.21:1) and `--danger`
  (5.03:1 / 6.30:1) have been *measured* against. `--ground-raised` has no
  measured pairings in this repository, and §10's standing rule after nineteen
  wrong ratios is that new markup reuses computed pairings rather than claiming
  new ones. The `--text-dim` border does the separating a raised fill would;
  `--hairline` would not, at 1.44:1.
- **"Delete account" in the menu navigates to `/settings#leaving`. It does not
  delete.** An account-ending action one tap deep in a dropdown is a trap —
  there is no undo for the seats it gives up, and a menu is exactly where a
  mis-tap happens. The existing two-step `ConfirmButton` and the sentence about
  what does not come back stay on `/settings`.
- **The keyboard rule is a pure function** (`src/lib/menu.ts`), because the test
  suite is one `edge-runtime` environment with no DOM: a rule living inside the
  component could not be tested at all. `menuKey` returns `null` for keys that
  are not the menu's, and the component must NOT `preventDefault` on those — or
  Tab stops working and nothing on the page hears a keystroke again. `openIndex`
  encodes why the pattern has two open keys: ArrowUp opens on the *last* item.
- **The badge is never the accessible name.** Initials are an abbreviation; "BC"
  announces as "bee see". `badgeLabel()` gives the button "Account menu for
  {name}" and the visible glyph is `aria-hidden`. `initialsFor()` takes the first
  and *last* word ("Bec van der Meer" → BM), treats hyphens and apostrophes as
  one word, and is Unicode-aware — a Latin-only class would hand people the "?"
  fallback instead of their own initial.
- **`user === undefined` renders a 44px empty box, not a "Sign in" link.** The
  query is still in flight; drawing the signed-out state there flashes it at a
  signed-in person on every page load.

### One frame — `src/components/questly/Screen.tsx`

Eight routes carried hand-written shells between them: four column widths (420 /
460 / 560), three horizontal paddings, four body gaps, two vertical alignments,
two different words in the left slot, eleven copies of the header row and four
copies of the loading screen. Nothing chose any of that. The visible cost was
that the roundels landed somewhere different on almost every screen — on
`/sign-in` the whole column was centred, so the colour switch sat halfway down
the page; one route later it was at the top.

- **The header is a band of fixed height (76px) at the top of every route**, and
  the content starts under it. The design is stated as Melbourne wayfinding, and
  the one thing a transit network is strict about is that the sign is in the same
  place at every stop.
- **The body centres in whatever height is left below the band, on every
  route.** No prop, no exception — a screen shorter than the viewport sat with
  its content jammed under the band and a void running to the bottom, which is
  what "no concrete layout" meant. The band does not move either way: it is a
  sibling of the column that centres, not part of it.
- **Why that is safe on a long screen**, which is the thing to check before
  copying it: `main` is `flex-1` inside a `min-h-full` body, and a flex item's
  `min-height: auto` floors it at its content — so `/settings` grows rather than
  centring and clipping its own top. There is free space to distribute only when
  the content really is shorter than the viewport.
- **It is deliberately not sticky.** `/room` is a swipe deck, and 76px of pinned
  chrome is 76px the card does not get on a phone. The defect worth fixing was
  the header moving *between* routes.
- **The left slot is the product name, not the screen name.** A station sign
  naming the station is the tempting version and it is wrong here — every screen
  already opens with an `<h1>` saying where you are. The wordmark is constant and
  is the way back to `/`.
- Three props, each used: `bleed` (`/room` only — the deck is full-bleed and its
  four screens carry their own padding; the band keeps its padding regardless),
  `badge={false}` (`/sign-in`, `/sign-up` — a "Sign in" control beside a sign-in
  form is the same offer twice), `wordmark={false}` (`/` — the `<h1>` *is* the
  wordmark at 64px).
- **`ScreenPending` is the frame's ground and one line, not the frame with an
  empty body.** All four copies it replaced drew the header first, and a header
  whose account roundel resolves a beat after the page does is a control that
  appears under the thumb after you have decided where to tap.
- `/settings` gained the account roundel it did not have, and the `/room` demo
  banner moved from above the header to under it — the band is chrome, the
  banner is a fact about the room.

### Avatar upload

`profiles.generateAvatarUploadUrl` → POST → `profiles.setAvatar`, with the
limits shared by both ends in `convex/lib/avatar.ts` (2MB; PNG/JPEG/WebP/GIF).
SVG is excluded on purpose — it is a script-execution surface.

- **The URL is resolved per read, never stored.** `profiles.me` returns
  `avatarUrl` from `ctx.storage.getUrl(avatarId)`; the table holds the
  `Id<"_storage">`. This is why `publicProfileValidator` stopped being a straight
  doc projection.
- **`generateAvatarUploadUrl` requires an account**, so the storage bill is not
  open to anyone who can reach the endpoint.
- **The check order in `setAvatar` is load-bearing, and a test found out why.**
  A Convex mutation is a transaction: `ctx.storage.delete` followed by a throw
  deletes *nothing*. So the deleted-account path *returns* rather than throwing —
  that is what lets its cleanup commit. The type/size refusals still throw, and
  therefore still leave the uploaded blob behind; that is stated at the call site
  and a sweep over `_storage` is listed as a follow-up rather than pretended
  away.
- The previous avatar is deleted only *after* the patch succeeds.

### Verification

`npx tsc --noEmit` clean; `npm run lint` 0 errors; `npx next build` builds all
11 routes; `npm test` 440 passing (`convex/account.test.ts` 31,
`convex/profiles.test.ts` 46 including the avatar cases, new
`src/lib/menu.test.ts` 16 and `src/lib/avatar.test.ts` 15, plus additions to
`src/lib/session.test.ts`). Every guard was checked by reverting it and
confirming its own test fails: the `deletedAt` floor (2), the `whenAt` bound (2),
the `isHost` seat check (1), `requireLiveUserId` (1), `forgetDraft` (1). Both
roundels and the avatar section were also reviewed in a browser against the
running dev server. Pushed to `zany-cheetah-110`: `npx convex
function-spec` lists `account.deleteAccount/restoreAccount/deletionStatus/
purgeExpired` and `profiles.myRooms/renameMe/setAvatar/clearAvatar/
generateAvatarUploadUrl`, so the new fields and indexes are live.

---

## 15. Who may lock a stop (issue #11)

**Ruling, as amended: attribution first and unconditionally; the vote is a
house rule; host-only locking is refused.**

This section was written once and then amended when the product owner asked for
vote-to-lock as well. Both halves are recorded, in order, because the second
does not retract the first -- it answers a different sentence in the issue.

### 15a. What shipped first: the lock says whose it is

`plans.setLocked` still lets any member lock or unlock any stop, directly, in
the default room. What changed is that a lock is no longer anonymous:
`stopValidator` carries an optional `lockedBy`, the lock write puts the locking
member's name on it (taken from the member row `requireMember` returns, never
from an argument), clears it on unlock, and the plan screen reads "Locked by
Tam" instead of "Locked".

The argument for changing the behaviour was that "one person quietly locking a
stop everyone else wanted to change is a way to win an argument without having
it". That is a real description of how groups go wrong, and the operative word
is *quietly*. Silence was the defect that needed no rule to fix, so it was
fixed for every room and is not configurable.

### 15b. What shipped second: `lockRule`, at the product owner's request

`rooms.lockRule` is a third house rule beside `swipeSeconds` and
`finalizeRule`, set by the host in the lobby:

- `"anyone"` -- the default, and what every room opened before the column
  existed has. Locking is one tap, as in 15a.
- `"vote"` -- locking **and** unlocking become proposals on the existing
  `proposals` table. `plans.setLocked` opens one with `kind: "lock"` or
  `"unlock"` and casts the asker's own yes; `settleProposal` applies it when
  `needed(n)` yeses land, through `applyStopLock`.

The default did not move. A rule that flipped under every room already open
would have retired a shipped decision silently, which is the thing 15a was
careful not to do in the other direction.

**How the machinery objections were answered.** The first draft of this section
rejected the vote for not fitting the `proposals` table. Building it settled
each point concretely rather than in the abstract:

- *"`replacement` is required."* It is now `v.optional`, with `kind` as the
  explicit discriminant. The nullability is unwrapped in exactly one place --
  `applyProposal` in `convex/lib/proposals.ts` -- so no other reader handles it.
  Storing the current stop back over itself would have kept the field required
  and was rejected as a lie in the data.
- *"A lock vote and a swap proposal on one stop would collide."* They are
  refused, by the same `by_room_stop` check `proposals.open` already uses.
  Allowing both would mean two contradictory majorities on one stop settled by
  whichever landed second. The room settles one, then opens the other.
- *"A stop cannot be protected until a majority agrees."* True, and that is now
  what the room asked for by turning the rule on. It is not imposed on a room
  that did not.

**Why host-only is still refused.** This is a ruling, not a gap:

- The defect named in the issue is silence, not authority. Host-only locking
  gives the same unattributable lock to one person and makes them the only one
  who can undo it -- the identical failure with a smaller cast.
- It would create this product's first content privilege. Section 3 describes an
  authorization model whose entire shape is "a capability proves membership,
  never identity"; the only existing host powers are removing a member,
  settling the room, and setting the house rules -- all of them about the room,
  none of them about the plan.
- A room that wants the host to decide can have that by asking. A room that
  wants it *enforced* wants `"vote"`, which enforces it without inventing a
  privileged user.

### What this cost

Two optional schema columns (`rooms.lockRule`, `proposals.kind`), one required
field relaxed to optional (`proposals.replacement`), a new
`convex/lib/lock.ts` holding the single lock write that both paths share, one
branch in `setLocked`, one branch in `settleProposal`, a `<select>` in the
lobby, and kind-aware copy on the plan screen.

No authorization changed on the default path, so the four existing tests that
exercise `setLocked` as a non-host -- `proposals.test.ts:322`, `:693`, `:719`,
`:733` -- stand exactly as written, and so do the 15a tests.

### What to watch

- `lockedBy` is a name, not a member id, so a member who leaves still shows as
  the person who left the lock. Deliberate -- it is a record of what happened,
  and section 13 item 2 notes ids are not projected anyway -- but it is the sort
  of choice a product owner might make differently.
- A lock the room votes through is attributed to the **proposer**, not the
  deciding voter. If the proposer has left by the time it carries, the lock is
  recorded with no name at all rather than blocked or signed by someone who
  merely agreed.
- Under `"vote"`, a member who leaves takes their opening yes with them and
  `resolveOpenProposals` re-decides the lock against the smaller roster, the
  same as any swap. That is deliberately unlike the finalize vote, which is
  abandoned on a roster change -- see the comment in `convex/lib/roster.ts` for
  why the two differ.

**If this is revisited:** measure whether rooms actually turn `"vote"` on. If
almost none do, attribution alone was the whole fix and this rule is carrying
schema weight for nothing. If many do, the next question is a lock that
expires, which would get most of the same protection with no vote at all.

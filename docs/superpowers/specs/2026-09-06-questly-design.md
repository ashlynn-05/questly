# Questly — design spec

**Date:** 2026-09-06
**Status:** approved for planning
**Build context:** hackathon / demo day

---

## 1. The paragraph

**Questly** turns "we should catch up" into one concrete, bookable plan.

A group opens a room, sets four constraints — how many, how much each, when, where — and swipes one shared deck together on their own phones. The first venue everyone says yes to becomes the plan: an LLM expands it into a 2–4 stop night with times, costs and travel, the group edits any stop it does not like, and the app books it.

**Input:** mood + headcount + budget per head + time + place.
**Output:** one itinerary, agreed, with a booking reference.
**Who pays:** venues, per filled booking. Users pay nothing.

The mechanism is not recommendation quality. It is that *the app* proposes, so no member's ego is attached to the suggestion and declining is free. Every competitor in this space asks an open question; Questly closes it.

---

## 2. Scope

This is a demo-day build. That decision governs every trade below.

**In scope:** the full happy path from sign-up to booking confirmation, working live across multiple phones.

**Simulated, and labelled as such in the UI:** the booking itself. No venue-side product exists, no table is held, no money moves. The confirmation screen says so.

**Out of scope:** venue onboarding, payments, cancellations, notifications, post-quest feedback, native apps.

---

## 3. Decisions

| Decision | Chosen | Why |
|---|---|---|
| Group model | Live multiplayer room | Convex realtime is already wired; two phones matching simultaneously is the one thing the group chat cannot do |
| Match rule | Unanimous, fires instantly, top-card fallback on deck exhaustion | Preserves "nobody was outvoted"; the fallback means it cannot deadlock on stage |
| Venue source | Google Places live + a partner table that boosts | Real data survives questioning; partner boost is the revenue model made visible |
| Post-match | LLM itinerary → simulated booking → real deep link | Latency lands after the swipe, where it is free |
| Plan editing | Any member proposes, majority accepts | User's call over host-only |
| Onboarding | 7-card quiz for the host; guests join with a first name | A sign-up form between a guest and the room kills the demo and the product |
| Planning inputs | Four explicit chips | User chose control over the two-taps claim; the UI must still read as chips, not a form |
| Solo | Forks into "Just me" or matchmaking into an open room | User's call |
| Visual world | The Network — Melbourne transit wayfinding | Chosen over the assigned roll (The Draw) on the decision page |

---

## 4. Flow

1. **Sign up** — email/username/password or Google/Discord. Already built.
2. **Onboarding quiz** — 7 more-likely/less-likely cards plus one goals question. The answers become a sentence, the sentence becomes an OpenAI embedding, the embedding becomes the user's taste vector.
3. **Mood** — touch grass / meet people / treat yourself / do something new. Mood maps to Places `includedTypes`; it is a query parameter, not a theme.
4. **Party** — three doors: *With friends*, *Just me*, *Meet people*. Choosing the "meet people" mood pre-selects the third door.
5. **Constraints** — headcount, budget per head ($0 first), when, where (GPS-prefilled suburb + radius).
6. **Room** — join code and share link. Guests enter a first name and are in. Live roster.
7. **Deck** — one shared ordered deck, everyone swiping at once, presence showing who is still deciding. Buttons carry equal weight to the swipe gesture.
8. **Match** — the instant the last yes lands, every phone resolves to the same destination.
9. **Plan** — the itinerary, editable.
10. **Booking** — reference, deep link out, add-to-calendar, share card.

---

## 5. Data model (Convex)

| Table | Fields | Indexes |
|---|---|---|
| `profiles` | userId, displayName, tasteVector (float64[]), moodAffinity, createdAt | by_user |
| `venues` | placeId, name, suburb, lat, lng, photoUrl, priceFromCents, discountPct, offerText, partnerTier, active | by_placeId, by_active |
| `rooms` | hostUserId, mood, headcount, budgetPerHeadCents, whenAt, centreLat, centreLng, radiusKm, visibility (`private`\|`open`), status (`lobby`\|`swiping`\|`matched`\|`booked`), code, matchedQuestId | by_code, by_visibility_status |
| `members` | roomId, name, userId?, isHost, sessionKey, joinedAt | by_room, by_room_session |
| `quests` | roomId, rank, source (`partner`\|`places`), placeId, title, blurb, priceLabel, priceCents, distanceKm, discountPct, photoUrl, score, scoreBreakdown | by_room_rank |
| `swipes` | roomId, questId, memberId, dir | by_room_quest, by_room_member |
| `plans` | roomId, questId, stops[], totalPerHeadCents, shareMessage | by_room |
| `proposals` | roomId, stopId, proposedBy, replacement, reason, status | by_room_status |
| `proposalVotes` | proposalId, memberId, vote | by_proposal |
| `bookings` | roomId, questId, ref, headcount, totalCents, status, deepLink | by_room |

A `plans.stops[]` entry: `{ id, slot: "meet"|"main"|"after", placeId, name, startAt, durationMin, costPerHeadCents, note, source: "llm"|"places"|"manual"|"partner", locked }`.

Guests are `members` rows without a `userId`. That is the whole guest model — no shadow accounts.

---

## 6. Functions

**Queries**
- `rooms.get({ code })` — the room, its members, the deck, match state, open proposals. Every client subscribes to this; it is the entire multiplayer layer.
- `rooms.openRooms({ mood })` — for solo matchmaking.

**Mutations**
- `rooms.create`, `rooms.join`, `rooms.leave`
- `swipes.cast` — records the swipe, checks unanimity on that quest, and on a full house flips the room to `matched` and schedules `plans.generate`.
- `plans.replaceStop`, `proposals.open`, `proposals.vote`
- `bookings.confirm`

**Actions**
- `deck.build` — Places `searchNearby` with mood→types and the room's centre/radius; merge partner venues (injected even when Places omits them); score; generate all blurbs in one batched OpenAI call; insert `quests`. Runs once per room behind a loading state.
- `plans.generate` — the itinerary and share message.
- `plans.suggestStop` — 3 alternatives for one slot, given the locked stops around it.
- `plans.searchStop` — Places text search for a manually named venue.

---

## 7. Ranking

```
score = w1·partnerBoost
      + w2·discountFit
      + w3·distanceDecay
      + w4·budgetFit
      + w5·moodFit
      + w6·tasteSimilarity
```

`tasteSimilarity` is cosine of the quest embedding against the room's blended taste vector — the mean of member profile vectors. Guests have no vector, so the host's carries.

`budgetFit`: partner venues have real prices. Places gives only a 1–4 `priceLevel`, mapped to dollar bands. Over-budget is penalised hard. A $0 budget restricts to free types (park, beach, market, lookout, hiking area).

`partnerBoost` is explicit and tunable. It is the revenue lever and should be legible in the pitch rather than hidden.

---

## 8. Known problems this spec accepts

- **Places cards are bare.** No real price, no vibe, and the current field mask requests no photos. The mask must add `photos`, `priceLevel`, `editorialSummary`, `websiteUri`, `googleMapsUri`, `currentOpeningHours`. This raises the billing SKU per query — fine at demo scale, and worth stating honestly if a judge asks about unit economics.
- **Proposals reopen negotiation.** Chosen deliberately. Mitigated by resolving on majority the instant it is reached, one open proposal per stop, and the proposer's yes implied.
- **Solo matchmaking has a cold start.** Seed a few live-looking open rooms so the lobby is never empty.
- **A raffle of one.** "Just me" rooms match on the first right-swipe. That is correct, not a bug.

---

## 9. Demo safety

Deck builds cached by (mood, rounded centre, radius, budget) so a second run is instant. Deck exhaustion declares the top-scored card. Guests never hit a sign-up. Geolocation denial falls back to Melbourne CBD. Every LLM call has a canned fallback.

---

## 10. Visual world

**The Network** — Melbourne transit wayfinding, selected on the Impeccable decision page over the assigned direction (seed `3e2868ad`). Full contract in `.impeccable/surfaces/src-app.md`; the built reference is `/direction`.

A night out is a route with stops, not a feed to browse. One orange line runs every screen top to bottom. Stops are roundel nodes — hollow open, filled locked, ringed live. Controls are indicator plates that flip rather than fade. The authored moment is the match: every phone's board flips through its candidates and lands on the same destination at the same instant.

**Type:** Archivo, driven on both axes. Display at `wdth 125`, text at `wdth 100`, tabular figures everywhere.

**Two modes.** Dark (iris) is the default, argued from the use scene — a phone at 6pm deciding on tonight. Light runs the pinned yellow palette for daytime planning.

| Role | Night | Day | Ratio (night / day) |
|---|---|---|---|
| Ground | `#3b3686` iris | `#fdf8e1` cornsilk | 10.2 / 16.0 |
| Page ground | `#1a1640` ink | `#f9dc5c` Naples | — |
| Text | `#ffffff` | `#1a1640` | 10.2 / 16.0 |
| Dim | `#b9b6e0` | `#5b5499` | 5.3 / 6.2 |
| Accent | `#edba40` apricot | `#3b3686` iris | 5.7 / 9.6 |
| Action | `#e0652b` field + ink | same | 4.9 / 4.9 |
| Rail | `#767ae6` | same | 2.8 / 3.5 |

**Three rules that fall out of the measurements, and are not negotiable:**

1. **Orange never carries text.** 2.9:1 on iris, 3.5:1 on cornsilk. It is a field with dark ink on it, in both modes.
2. **The accent role swaps, the meaning does not.** Apricot is 1.8:1 on cornsilk, so iris takes the accent job by day. A price is always the accent colour; the colour changes with the light.
3. **Periwinkle never carries meaning alone.** 2.8:1 on iris fails even the non-text threshold. It draws map lines. Anything meaningful gets a label.

`#1a1640` is derived, not brand — neither palette ships a dark, and orange needs one to reach AA. The focus ring is a token for the same reason: apricot is invisible on cornsilk.

---

## 11. Accessibility

WCAG 2.2 AA is a requirement, not an aspiration.

- Swiping is never the only path. The deck has equal-weight buttons and a full keyboard route.
- The match, presence changes and proposal outcomes are live regions — announced, not only animated.
- `prefers-reduced-motion` removes the travel and keeps the feedback.
- Target sizes meet 2.2 minimums, which binds hardest on mood tiles, constraint chips and swipe controls.
- Every colour pairing is measured against the ground it actually sits on, in both modes.

---

## 12. Honesty constraints

There is no logo, no signed venue, no survey data and no users. The market figures in the concept brief are the founder's own estimates, not published research.

Therefore: no testimonials, no customer logos, no "trusted by", no named partner venue presented as a real partner, no fabricated booking or user counts. Demonstration content is labelled wherever a viewer could mistake it for a commitment.

---

## 13. Already built

Auth (Better Auth on Convex: email/username/password, Google, Discord), the server-side Places `searchNearby` action, the map component, OpenAI embeddings with Convex vector search, and the visual system at `/direction`.

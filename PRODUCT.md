# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Primary: Melbourne 20–34s, mobile-first, socially active but budget-constrained, who want to see friends and stall out in the group chat. The job is not "find information about venues" — it is "end the negotiation and get one concrete thing we are actually doing."

Two entry situations, both real:

- **Group** (the default): someone wants to catch up with 2–6 friends and nobody wants to be the one who suggests something and gets left on read.
- **Solo**: someone has an evening and no group. They either want a "Just me" quest, or they want to be put with strangers doing the same thing.

Not a user yet: venues. They are the payer in the business model but have no interface in this build.

## Stack

Existing codebase answers this: Next.js 16 (App Router) + React 19 + Tailwind v4 on the front end; Convex as the backend (database, realtime subscriptions, server functions, scheduling); Better Auth via `@convex-dev/better-auth` for email/username/password plus Google and Discord OAuth; Google Places API (New) called server-side from a Convex action; `@vis.gl/react-google-maps` for maps; OpenAI for embeddings and plan generation.

## Product Purpose

Turn "we should catch up" into one specific, bookable plan — a place, a time, a price per head — with as little negotiation as possible.

Success for a session is a group reaching an agreed plan they actually book. Success for the business is a filled venue booking, because venues pay per filled booking and users pay nothing.

## Positioning

Every neighbouring product asks an open question. Discovery apps ask "what do you feel like?"; deal apps (EatClub and similar) ask the same question with a price filter attached; group-trip apps (Wanderlog, AvoSquado, TripProf) organise the itinerary and split the expenses *after* the decision is already made. None of them make the decision.

Questly closes the question instead of asking it. Constraints in — headcount, budget per head including $0, when, where — one concrete answer out. And because the app proposes, no one's ego is attached to the suggestion and declining is free. That social property, not the recommendation quality, is the mechanism.

## Operating Context

Used on phones, together, usually in the moment — several people in the same room or the same group chat, deciding on something happening tonight or this week. Occasionally used alone.

The competing tool is the group chat, and the app is only worth opening if it is faster than typing "idk, what do you want to do".

Free quests matter as much as paid ones: they keep the product useful between paydays, so it is still installed on the Friday someone has $60.

## Capabilities and Constraints

Confirmed product surface:

- Sign in / sign up for the host; onboarding quiz (~7 more-likely / less-likely cards) builds a taste vector.
- Mood picker: touch grass, meet people, treat yourself, do something new. Mood drives the venue query, not just the styling.
- Party step, three doors: with friends, just me, meet people (matchmaking into an open room with strangers).
- Planning pane: four explicit inputs — headcount, budget per head (with $0 first-class), when, where.
- Room with a share link and join code. **Guests join with a first name only — no account, no quiz — and their swipes count.**
- Live multiplayer swipe deck: one shared ordered deck, everyone swiping at once, realtime presence.
- Match rule: unanimous right-swipe fires instantly on every phone. Deck exhaustion declares the top-scored card, so it can never deadlock.
- Finalisation: an LLM expands the matched anchor venue into a 2–4 stop plan (meet / main / after) with times, travel, cost per head, a backup, and a paste-ready group-chat message.
- Plan is editable, not fixed. Stops can be locked; unlocked stops can be changed three ways — ask the LLM for alternatives, swap from nearby venues, or pick a venue manually. Every swap recascades times and re-totals cost against the budget.
- Group edits work by proposal: any member proposes a swap, majority accepts, and it resolves the instant the majority is reached.
- Booking: simulated confirmation with a reference, plus a real deep link out to the venue, add-to-calendar and a share card.

Constraints that shape design:

- Venue supply is **Google Places live data** as the universe, plus a separate hand-maintained table of partner venues that carry real prices, real discounts and placement boost. Places returns only a 1–4 price band and no vibe, so non-partner cards need enrichment to be worth swiping on.
- Ranking blends partner boost, discount, distance, budget fit, mood fit and taste similarity. Partner boost is the revenue lever and is deliberately visible rather than hidden.
- Latency belongs before the swipe, never inside it: deck building and blurb generation happen once, behind a loading state.
- This build is for a hackathon / demo day. Bookings are simulated and no venue-side product exists. Nothing in the interface may imply otherwise.

## Brand Commitments

- Product name: **Questly**.
- Fixed palette, already chosen and binding: Iris `#3b3686`, Periwinkle `#767ae6`, Apricot `#edba40`, Deep Orange `#e28c33`, Pure Orange `#e0652b`.
- Tone: fun and excited, but confident rather than silly. Wit lives in the copy, not in ornament.

## Evidence on Hand

None. No logo or wordmark, no signed venues, no survey data, no venue-manager interviews, no users. The market figures in the concept brief are the founder's own sizing estimates, not published research.

Consequences the design must respect: no testimonials, no customer logos, no "trusted by" claims, no named partner venues presented as real partners, no fabricated user counts or booking numbers. Partner venues shown in the product are demonstration data and must be legible as such wherever a viewer could mistake them for commitments.

## Product Principles

1. **Close the question, never reopen it.** Every screen either takes a constraint in or hands an answer back. Anything that returns the user to browsing is a defect.
2. **The app proposes so no person has to.** Suggestions never carry a member's name. Declining must always be free and consequence-free.
3. **$0 is a first-class answer.** Free quests are designed with the same care as paid ones; they are what keeps the product installed.
4. **Together, live, on separate phones.** Shared state updates on every screen at once. Multiplayer is the product, not a feature.
5. **Say what is real.** Simulated bookings, demonstration partners and estimated numbers are never dressed as facts.

## Accessibility & Inclusion

**WCAG 2.2 AA is a requirement.**

Known pressure points, given the confirmed palette and interactions:

- The palette's midtones (Apricot, Deep Orange, Pure Orange) will not carry white body text at AA. Text pairings must be verified, not assumed, and Iris is the reliable foreground.
- The swipe deck needs a full keyboard path and visible focus; swiping cannot be the only way to accept or reject.
- The match, presence changes and proposal outcomes are live regions and must be announced, not just animated.
- Motion is heavy by design; `prefers-reduced-motion` must be honoured throughout without removing the feedback the motion carries.
- Target sizes must meet 2.2's minimum, which matters most on the mood tiles, the chip inputs and the swipe controls.

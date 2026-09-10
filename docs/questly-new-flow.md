# Questly — the new start flow

The tickets this branch implements, kept as the record of what was decided and
why. Every ticket below is done unless it says otherwise.

---

## The change, in one paragraph

The funnel asked seven taste cards, a goals question, then **what kind of
night** (four options), then **who is coming** (three options), then four
constraints. It now asks **eight get-to-know-you questions**, then **the idea
already on their mind** (three activities), then **alone or with people**, and
only then splits into with-friends or a random meetup with strangers.

Two structural moves underneath it. *Treat yourself* and *Meet people* stopped
being kinds of night and became kinds of company, which frees the activity list
to be about the activity and makes room for sidequests. And going alone stopped
pretending to be a room: it asks three things and drops you into the deck.

---

## What moved where

| Before | Now |
|---|---|
| 7 taste cards, then a goals question | 8 questions, no goals screen |
| Night: Touch grass / Meet people / Treat yourself / Do something new | Activity: Touch grass / Random crazy sidequests / Hang-outs |
| Who: With friends / Just me / Meet people | Alone, or with people — then friends or strangers |
| Constraints: how many, budget per head, when, how far | Alone: budget, when, how far. A room: all four. |
| Alone still landed in a lobby with one seat | Alone goes straight to swiping |
| "Four answers and it is solved." | "No worries, plans on Questly" |

---

## Q1 — Four activity types become three

**Why.** *Meet people* and *Treat yourself* describe who you are with, not what
you are doing, and they are now asked on a later screen. *Do something new*
became *Random crazy sidequests*, which is the same idea with a personality.
What is left is three genuine activity types.

| id | Label | What the deck asks Google for |
|---|---|---|
| `grass` | Touch grass | park, hiking area, beach, garden |
| `sidequest` | Random crazy sidequests | amusement park, tourist attraction, museum, art gallery, bowling alley |
| `hangout` | Hang-outs | bar, cafe, restaurant, night club, bakery |

**Why it was not a copy change.** `mood` is stored on both `rooms` and `venues`,
is an index key, and selects the Places types a deck is built from. Every seeded
venue was retagged — a venue nobody retags is a venue that can never appear in a
deck again.

**The migration, and why the schema did not simply tighten.** Tightening the
table validator to the three new ids would make the next schema push fail
against every room already in the database. So there are two contracts:
`moodValidator` is the three ids and is what every argument and every projection
uses; `storedMoodValidator` also accepts the four retired ones. `normalizeMood`
translates at each read, so nothing on screen is wrong while the backfill runs.

Run both backfills after deploying:

```
npx convex run migrations:run '{"fn": "migrations:backfillMoods"}'
npx convex run migrations:run '{"fn": "migrations:backfillVenueMoods"}'
```

Their only job is to make `normalizeMood` a no-op, so that it and
`storedMoodValidator` can be deleted. Until that clean-up lands, the retired ids
are alive in exactly two places and both say so in their header comments.

**Settled.** The stored field keeps the name `mood`. Renaming it to `activity`
touches every read as well and should not ride along with a values migration.

---

## Q2 — Eight questions to get to know someone

**Why.** The first screen a new person sees decides whether they ever open a
room, and it is the only place the recommendations learn anything about them. It
was seven reaction cards plus a goals question with its own screen and its own
interaction model — two mechanics for one job.

Now: eight cards, one *More likely / less likely* tap. Six read affinity for the
three activities, two read the person.

| # | id | The card | Reads |
|---|---|---|---|
| 1 | `green` | walking somewhere green instead of sitting down | Touch grass |
| 2 | `cold-water` | cold water and a towel in a bag | Touch grass |
| 3 | `never-done` | something you have genuinely never done | Sidequest |
| 4 | `detour` | a long detour for something gloriously stupid | Sidequest |
| 5 | `long-table` | one long table and nowhere else to be | Hang-out |
| 6 | `lean-in` | somewhere loud enough that you have to lean in | Hang-out |
| 7 | `roof` | a roof over your head, whatever the weather is doing | Indoor or outdoor |
| 8 | `unplanned` | finding out where you are going when you get there | Plans it or wings it |

**Two per activity, which fixed a real bug.** Three moods had two cards each and
the fourth had one, so that fourth mood's affinity score could never reach the
same magnitude as the others. Its rooms were quietly ranked as though nobody
felt strongly about them.

**Why cards 7 and 8 needed the taste sentence to change.** Only *more likely*
answers are embedded, deliberately: an embedding of "not this" sits near "this"
in vector space and poisons the signal. That is right for cards 1–6, where a no
is an absence. It is wrong for the last two, where the no is itself a preference
— somebody who does not want a roof has said they want to be outside. A card now
carries its own phrase for each side, and only those two fill both.

**What happened to goals.** The question is gone, `saveQuiz` no longer takes it,
and `/settings` no longer shows it. The column stays declared and optional so
rows that still hold one remain valid, but nothing reads it, `profiles.me` does
not project it, and answering the quiz again clears it.

---

## Q3 — "Who's coming?" becomes the branch point

**Why.** Two questions were tangled together. The party screen offered *With
friends*, *Just me* and *Meet people*, but *Meet people* was also one of the four
kinds of night, so the same idea was put to somebody twice in two different
vocabularies.

```
What kind of activity?   ← the idea already on their mind
        │
Alone, or with people?
├── On your own ─────────────────► budget · when · how far
│                                  …then straight into swiping. No lobby.
└── With people
    ├── With friends ───────────► open a room, send them the number
    └── Random meetups ─────────► open a room strangers can join
        with strangers            …or join one that is already open
                                  how many · budget per head · when · how far
```

*Random meetups with strangers* is the label that does the most work: it is the
only one of the three where the value is the strangers.

**The thing that could not stay a lookup table.** Back navigation was a map from
step to step. The constraints screen is now reached two ways, and sending
somebody going alone back to the friends-or-strangers screen would show them a
question they were never asked. `backFrom` takes the draft.

---

## Q4 — Going alone stops pretending to be a room

Two screens asked a solo person about people who were not coming.

**The constraints screen asked how many.** Answering 1 immediately after saying
*on your own* is the same question twice. Alone is asked three things; a room is
asked four, unchanged.

**A solo room still opened a lobby.** One filled seat, a *Waiting…* row for
every seat nobody is coming to fill, a **Copy the join link** button, and a
**Start swiping** button whose subtitle warned that nobody else could join once
the deck started. A room of one now goes straight to the deck being built.

**The part worth reviewing.** Nobody is left to press *Start swiping*, so the
shell starts the build itself — and a failed build hands the room back to
`lobby`, which is the same state the auto-start fires on. The latch on it is a
ref that is never cleared, so a solo room in an empty neighbourhood makes one
attempt rather than rebuilding forever on Places and OpenAI quota. After that
the retry belongs to the person, on the build screen that already offers it.

---

## Q5 — The constraints heading

"Four answers and it is solved." → **"No worries, plans on Questly"**

The old line had to go regardless: once one branch asks three questions, a
heading that counts to four is wrong. An earlier draft was "all on Questly",
which sat directly above the budget picker and read as an offer to pay — a
promise this product cannot make, since every price on screen is an estimate
from Google rather than a number a venue quoted. "Plans on Questly" says the
planning is ours, which is both true and the actual pitch.

---

## Q6 — "In two taps" on the landing page — NOT DONE, needs a decision

Flagged because this flow makes it worse, not because it was asked for. The
landing page promises a plan "in two taps". The new flow is eight questions, an
activity, who's coming, sometimes a fourth screen, then three or four
constraints: roughly fifteen taps for a new visitor, against about twelve
before.

Two taps is still literally true for one person — a guest who taps a group-chat
link — and that person never sees the landing page it is printed on. This is a
product owner's call, not an engineering one.

---

## Still open

1. **"Time per head."** Read as *budget* per head plus a single "when" for the
   room, which is what shipped. Say so if a per-person time was meant.
2. **Q6 above.**
3. **Deleting `normalizeMood` and `storedMoodValidator`** once both backfills
   have run against every deployment.

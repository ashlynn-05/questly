---
version: 1
slug: "src-app"
primary_target: "src/app"
related_targets: []
---

# Surface brief — Questly app screens (src/app)

## Scope and mode

The product's own screens: sign-in, onboarding quiz, mood picker, party step, planning pane, room, swipe deck, match, plan, booking. Mode: **Operate** — the visitor is completing a task (get one plan they will actually book), so state, scanability and affordance outrank expression. Expression lives in the world's own vocabulary, never in front of the task.

## Audience, job, task

Melbourne 20–34, on a phone, usually with friends on their own phones, deciding on tonight or this week. The job is ending the negotiation, not researching venues. The competing tool is the group chat.

## Constraints

- WCAG 2.2 AA is required. Orange is a field colour only — orange text on iris is 2.95:1 and fails. Apricot on iris (5.69:1) is the readable accent. Periwinkle (2.77:1 on iris) is decorative line work only and never carries meaning alone.
- Venue photography comes from Google Places and is not art-directed. The layout must survive an ugly photo, a missing photo, and a very long venue name.
- Swiping is never the only way to accept or reject; the deck needs a keyboard path.
- Bookings are simulated. Partner venues are demonstration data and must read as such.

## Direction contract

**THESIS:** A night out is a route with stops, not a feed to browse. Refuses the dating-app card stack this category always ships.

**OWN-WORLD:** Iris ground, drenched. One orange route line runs every screen top to bottom; stops are roundel nodes, hollow when open, filled when locked. Orange is a field, never text; apricot is the only readable accent. Archivo Expanded display, Archivo text, tabular figures on every number. Controls are indicator-board plates that flip rather than fade.

**STORY:** I set four constraints, my friends board the same line, the board flips to one destination we all picked, and I can change any stop without reopening the argument.

**FIRST VIEWPORT:** Iris field. Orange line one column in, full height. Room number in tabular figures top-left, member nodes riding the line. Venue name in Archivo Expanded at display scale, apricot price beneath. Primary action is a full-width orange plate at the foot.

**FORM:** The Network — Melbourne transit wayfinding. Candidate 1 of my ordered list; the user chose it over assigned candidate 3 (The Draw). Seed key 3e2868ad.

**FINISH:** unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Memorable moment

The match. Every phone's indicator board flips through its remaining candidates and resolves to the same destination at the same instant — the one thing the group chat cannot do.

## Unresolved

- Whether the four moods each own a distinct line colour, or share orange and differ by node shape.
- How the open-room (stranger matchmaking) lobby represents people who have not joined yet.

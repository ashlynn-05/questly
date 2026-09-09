---
name: delegation-brief
description: Use when handing a ticket to a fresh agent session that does not share your context, in its own worktree, clone or checkout. Composes the standalone three-phase brief that session reads instead of your conversation, then delivers it. Triggers on "delegate this ticket", "spawn a worktree for UNI-N", "write a brief for", "hand this off", "open a new one for UNI-N".
---

# Delegation brief

A brief hands a ticket to a session that has none of your context. It gets the
repo, the ticket, and this file. Everything you learned by looking is lost
unless you write it down.

Two failure modes, and they pull against each other. Write too little and the
agent rediscovers what you already know, badly, and picks the wrong fix.
Write too much and it reads as a spec, the agent implements your guesses
without checking them, and your mistakes ship with its name on them.

The brief is evidence plus a gate, not a spec.

**The brief itself lives in [`prompt-template.md`](prompt-template.md).** This
file is how to fill it in. The template is tool-agnostic; delivery is not, so
that is handled separately at the end.

## Not Claude-only

This skill is mirrored byte-identically at `.claude/skills/delegation-brief/`
and `.agents/skills/delegation-brief/`, because different agent tools look in
different places. **Every edit to one must be applied verbatim to the other in
the same commit.** Same rule, same reason, as `CLAUDE.md` and `AGENTS.md`.

Both copies are plain markdown with no harness-specific syntax, so Claude
Code, Codex, Cursor and anything else that can read a file can use them. The
delegated agent does not have to be the same tool as the delegating one.

## Compose it in this order

### 1. Establish the lane

Say what the ticket owns and, explicitly, what it does not. A fresh agent
with a whole monorepo in front of it will helpfully fix the neighbouring
ticket's work unless told not to.

> Your lane: rendering. NOT the schema (UNI-311, done), NOT the card stack
> (UNI-312, done), NOT the responsive pass (UNI-314).

Name the blockers and their state. "UNI-311, your blocker, merged as #201 and
the schema you need is already on `main`" saves a Phase 0 spent wondering.

### 2. Hand over evidence, then tell them to re-derive it

Give the numbers. Then require the agent to reproduce them.

> I have already traced the cause. Verify it yourself by measuring; do not
> take my word for it.

> If I am wrong, say so plainly with the numbers.

This is the single highest-value habit in the whole brief. It buys the speed
of a conclusion without the failure mode of one. A brief that only asserts
gets implemented on faith; a brief that only asks gets rediscovered slowly.

Show your working where it decides something. A measured table beats a
sentence:

> | | width | scale |
> |---|---|---|
> | front card | 1230 | 1.000 |
> | covered card today | 1108 | 0.901 |
> | Tracy's bracket | 1190 | 0.967 |

### 3. Forbid the wrong fix by name

For any bug with an obvious-but-wrong shortcut, close it off explicitly.

> Do not solve it by recolouring the wrapper. The wrapper is white on purpose
> at base, where the stack does not run.

> Keep the icon CMS-driven. Do not derive it from the array index.

Same for decisions that look like drift but are not:

> The 16px is a deliberate override of the Figma component's 8px, confirmed
> with Simon. Do not "correct" it back.

### 4. List the files, each with why

Not "read the codebase". Name the files and say what each one teaches. Point
at existing comments that record measured failures, because those are the
traps the agent is about to walk into.

> `InvestorsMarket.astro`: read its two comments in full before touching it.
> They record measured failures: the fixed height starts at `lg` because held
> at `sm` the section's `overflow-clip` ate the stat row whole at 640.

### 5. Pre-empt the known traps

Anything that has already cost this project an hour goes in the brief. Copy
the ones that apply:

- **The Orca browser cannot resize its viewport.** `resize_window` reports
  success and `innerWidth` does not change. Use a sized same-origin iframe as
  the probe: media queries, `position: sticky` and `getBoundingClientRect` all
  behave correctly inside it.
- **The Orca browser throttles `requestAnimationFrame` to roughly 2fps.**
  Await two frames or scroll-animation reads are stale.
- **A hidden Claude-in-Chrome tab freezes rAF and CSS animations entirely.**
  Screenshots from one go stale. Verify motion by numbers, not by paint.
- **`CI_SKIP_JS_UNIT` has been left switched on before**, so a green CI run
  does not prove the JS tests ran. Run them locally and say so.
- **A new `public` function fails `ci db` on a presence-drift check** unless
  it is added to `ignored_rpcs.ts`. Invisible locally.
- **Do not edit a migration CI has already applied.** `db push` says "Remote
  database is up to date" and applies nothing, so CI keeps testing the old
  definitions and can go green on a fix that never ran.
- **The stash stack is shared across worktrees.** Never bare `git stash` /
  `git stash pop`.

### 6. State the decisions already made, and license the challenge

> Decisions already made. Do not relitigate them, but say so if you think one
> is wrong.

Then number them with the reasoning, not just the conclusion. The reasoning is
what lets the agent notice the decision does not survive contact with the code.

### 7. Say what you could not verify

Sampled a hex from a PNG render rather than a Figma variable? Say so, and say
who confirms it. Could not get past an SSO wall? Say where it stopped you.
A brief that hides its own uncertainty gets it laundered into confidence.

### 8. Pick the testing constraint before they do

The obvious testing approach is usually wrong here, and a fresh agent will
reach for it. Name the harness and forbid the expansion:

> `vitest.config.ts` runs `environment: 'node'` and includes only
> `src/**/*.test.ts`. No DOM, no jsdom, no testing-library. Do not stand up a
> DOM harness. Changing the vitest environment is scope creep.

Then say what to test instead, and give explicit permission not to pad:

> Push what can break into a plain `.ts` module and test it there. Be honest
> about what is not unit-testable rather than padding the suite.

### 9. Adjust for the receiving harness

The template assumes the delegated agent can read Linear, drive a browser and
enter a plan mode. Not every harness can. Check before you write, and rewrite
the affected step rather than leaving an instruction the agent cannot follow:

| Capability | If present | If absent |
|---|---|---|
| Linear MCP | `get_issue UNI-N` | paste the issue bodies into the brief |
| Figma MCP | fileKey and node IDs | attach exported PNGs, say which frame each is |
| Plan mode | name it in Phase 1 | "write the ordered plan as a message and wait" |
| Sanctioned browser | name it and its traps | say verification is by code reading, and what that cannot cover |

An instruction the agent cannot execute is worse than no instruction: it
burns a Phase 0 and teaches the agent to skim the rest.

## Deliver it

Write the filled-in brief to a file. Never paste it into a terminal: a
multi-thousand-word brief submits on every newline in most TUIs and arrives as
hundreds of separate prompts.

Then point the new session at that file. The pointer prompt is the same
everywhere:

> Read `<path>` end to end before doing anything else. It is your full brief
> for `<TICKET-ID>`. Follow its three-phase gate structure exactly: Phase 0 is
> recon only, no code, and ends with a report and a hard STOP.

Stage the file somewhere both sessions can reach. `/tmp/<repo>-briefs/` works
and stays out of the repo; a path inside the worktree does not, because the
worktree may not exist yet when you write the brief.

Keep a copy of every brief. The next ticket in the same parent is usually a
diff against the last one.

### Orca

Orca creates the worktree and starts the agent in one call:

```bash
mkdir -p /tmp/unibuz-briefs
# write the brief to /tmp/unibuz-briefs/uni-N-initial-prompt.md

orca worktree create \
  --repo id:<repoId> \
  --name uni-N-<short-slug> \
  --linear-issue UNI-N \
  --base-branch main \
  --parent-worktree active \
  --agent claude \
  --prompt "Read /tmp/unibuz-briefs/uni-N-initial-prompt.md end to end before doing anything else. It is your full brief for UNI-N. Follow its three-phase gate structure exactly: Phase 0 is recon only, no code, and ends with a report and a hard STOP." \
  --json
```

`--agent` also takes `codex`, so the receiving session does not have to be
Claude. Run `orca skills get orca-cli` for the flags this build actually
supports rather than trusting the list above.

The new worktree's `head` is whatever the local `main` ref points at, which is
often stale. That is fine: step 0 of the brief fetches and merges, and naming
the expected SHA there makes the staleness self-correcting.

### Without Orca

Make the worktree, then start the agent in it:

```bash
git worktree add ../<repo>-uni-N -b <branch-name> origin/main
cd ../<repo>-uni-N
```

- **Claude Code:** `claude "Read /tmp/... end to end ..."`, or start it and
  send the pointer as the first message.
- **Codex:** `codex "Read /tmp/... end to end ..."`. It reads `AGENTS.md`
  rather than `CLAUDE.md`; the two are byte-identical here, so the brief can
  name either.
- **Cursor:** open the worktree as the workspace folder and paste the pointer
  into the agent panel.
- **No harness at all:** the brief is readable prose. Hand the file to a human
  and it still works.

## Closing a delegated worktree

Verify before removing, do not trust "it's done":

```bash
gh pr list --state merged --limit 5 --json number,title,mergedAt,headRefName
git -C <worktree> status --porcelain            # must be empty
git -C <worktree> diff --stat origin/main HEAD  # must be empty
```

The diff against `origin/main` is the one that matters. Local commits still
show as unmerged after a squash merge; an empty content diff is what proves
nothing was lost. Run it through `rtk proxy` if the `rtk` hook is active, as
it filters diff output and an empty result can be the filter rather than the
truth.

Then remove it, with `orca worktree rm --worktree "id:<repoId>::<path>"
--force --json` or plain `git worktree remove <path>`.

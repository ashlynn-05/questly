---
name: phased-work
description: Use when you are working a ticket yourself in this session, not handing it to another agent. Runs the same three-phase gated workflow the delegation brief imposes - Phase 0 recon and report, Phase 1 plan, Phase 2 implement and PR - with you as the agent. Triggers on "work this ticket", "run the workflow here", "phase 0 this", "do this yourself, no delegation", "three-phase this".
---

# Phased work

Same gates as [`delegation-brief`](../delegation-brief/SKILL.md), applied to
this session instead of a fresh one. Use `delegation-brief` when the work goes
to another worktree or another agent. Use this when the work stays here.

The gate structure is the point. It exists because an agent that plans and
implements in one breath implements its first guess. You are that agent here,
so the gates bind you, not someone else.

**Do not compose a brief. Do not create a worktree. Do not spawn an Orca
session.** If you catch yourself writing "you own TICKET-X" in the second
person, you have picked the wrong skill.

## Establish the lane first

Before Phase 0, say in one or two lines what this ticket owns and what it
explicitly does not - the neighbouring tickets, the tempting adjacent fix.
Name the blockers and whether they are cleared. Then hold that line for the
rest of the work.

## Phase 0: recon. No code. Ends in a report.

**0. Sync first.** `git fetch origin && git merge origin/main` on the current
branch, resolve conflicts, confirm `npm run lint` is clean on the merged base
before changing anything. Report what came down.

If this is a git worktree, the stash stack is shared with every other
worktree. Never bare `git stash` / `git stash pop`. Prefer a temporary WIP
commit; if you must stash, `git stash push -u -m "<unique-tag>"`, capture the
SHA from `git stash list --format='%H %gs'`, restore with `git stash apply
<sha>`.

**1. Read the ticket** - and its parent, blocker and dependent.

**2. Read the house rules.** Root `CLAUDE.md` and `AGENTS.md` end to end. They
override your defaults.

**3. Deep scan.** Name the files you read and one line each on what they
teach. Read existing comments in full where they record measured failures -
those are the traps you are about to walk into.

**4. Read the design**, if the ticket has one. Exact values, not impressions.

**5. Stand it up.** App, env, dev command, port. Confirm you can reach it.

**6. Report and STOP.** Post, in this shape:

- **SYSTEM STATE**: what came down in the merge, what is running and where,
  what you could and could not reach.
- **THE PATTERN / THE CAUSE / THE DIFF**: whichever this ticket is about, with
  your own measurements. Numbers, not adjectives.
- **THE PLAN SHAPE**: each change with the file it lands in and the exact
  value that decides it.
- **THE TEST STRATEGY**: the harness constraint and what you will actually
  test. Say plainly what is not unit-testable rather than padding the suite.
- **RISKS**: what you could not resolve, what could regress.
- **WHAT I COULD NOT VERIFY**: sampled a colour off a render instead of a
  variable? Blocked by an SSO wall? Say so and say who confirms it.

Then stop and wait for approval. Do not enter plan mode. Do not start coding
because the plan looks obvious.

## Phase 1: plan. Only after Phase 0 is approved.

Ordered plan, one line per change. Get it approved before writing code.

Before you propose it, close off the wrong fixes by name - for any bug with an
obvious-but-wrong shortcut, say why you are not taking it. And record the
decisions already made with their reasoning, so a later phase does not
relitigate them.

## Phase 2: implement, test, PR.

Work the approved plan in order. Before opening anything:

- `npm run lint` - zero errors, non-negotiable.
- `npm run test`.
- The behavioural checks, each phrased so it can fail.

Then the PR: body from the repo template, `Closes <TICKET-ID>` on its own
line. After pushing, `gh pr checks <pr> --watch`. Do not walk away assuming
green.

## Known traps

- **The Orca browser cannot resize its viewport.** `resize_window` reports
  success and `innerWidth` does not change. Use a sized same-origin iframe as
  the probe.
- **The Orca browser throttles `requestAnimationFrame` to roughly 2fps.**
  Await two frames or scroll reads are stale.
- **A hidden Claude-in-Chrome tab freezes rAF and CSS animations.**
  Screenshots go stale. Verify motion by numbers, not by paint.
- **Do not edit a migration CI has already applied.** `db push` says "Remote
  database is up to date" and applies nothing.
- **The stash stack is shared across worktrees.**

## Not Claude-only

This skill is mirrored at `.claude/skills/phased-work/` and
`.agents/skills/phased-work/` so Codex and Cursor find it too. The `.agents`
copy is a symlink to the `.claude` one, so editing either edits both.

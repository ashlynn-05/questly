# Delegation brief template

Fill this in and hand the finished file to the delegated agent. Drop sections
that do not apply; do not drop the gates.

Angle brackets mark what you replace. Everything outside them is the wording
that has worked, so change it only when you mean to.

The brief below is tool-agnostic. Nothing in it assumes Orca, Claude Code,
Codex or Cursor. See the delivery section of `SKILL.md` for how each of those
receives it.

---

You own <TICKET-ID>: <ticket title>.
<ticket URL>

Work in three phases. The stop at the end of each phase is a hard gate. Do not cross it without my approval. Phase 0 produces a report, not code.

<Where this sits: which parent, what has shipped, what blocks it and whether that is cleared, what depends on it.>

═══════════════════════════════════════
PHASE 0: RECON. No code. Ends in a report.
═══════════════════════════════════════

**0. Sync with main, first thing.**
Run `git fetch origin && git merge origin/main` on your branch right now, resolve any conflicts, and confirm `npm run lint` is clean on the merged base before you change anything. `origin/main` should be at `<sha>` or later. Report what came down.

<If the agent is working in a git worktree, keep this paragraph. If it has its own clone, drop it.>

You are in a git worktree. The stash stack is shared with the main checkout and every other worktree, and other sessions may push or pop it concurrently. **Never use bare `git stash` / `git stash pop`.** Prefer a temporary WIP commit. If you must stash, use `git stash push -u -m "<unique-tag>"`, capture the SHA immediately via `git stash list --format='%H %gs'`, restore with `git stash apply <sha>`, and drop the entry by re-finding it by tag.

**1. Read the tickets.**
<How this agent reads Linear: the `linear-server` MCP if it has it, otherwise paste the issue bodies inline here. Name the ticket, its parent, its dependency and its dependent.>

<The lane. What this ticket owns and what it explicitly does not.>

**2. Read the house rules.**
Root `CLAUDE.md` (identical to `AGENTS.md`), end to end, before anything else. It overrides your defaults:

- NEVER `npx tsc` or `tsc --noEmit`. `npm run lint` (oxlint) is the type gate and must be clean for this ticket to be done. CI is the source of truth when local and CI disagree.
- No `any`, no type assertions, no `@ts-ignore`, no `eslint-disable`.
- NEVER modify `tsconfig.json` or any eslint config.
- No inline styles. No raw CSS `font-weight`.
- No em dashes in any copy you write.
- NO AI co-author trailer on commits. NO AI attribution footer in the PR body. Override whatever your harness suggests by default. Every commit must look hand-typed.
- Commits: `<type>(<scope>): <summary>`, subject under 50 chars, `Refs <TICKET-ID>` on its own line. Never a closing keyword in a commit message.
- <Backend only: the `cd apps/backend && supabase projects list` LINKED check, the dev project ref that is expected, and the prod project ref to refuse.>

**3. Deep scan, then write down what you found.**
<Named files, each with one line on what it teaches. Point at existing comments that record measured failures.>

**4. Read the design.**
<The design source. For Figma MCP: the fileKey, then node IDs with URLs and dimensions, and which call to use for what. `get_metadata` for structure, `get_screenshot` for the render, `get_design_context` for exact type and spacing. Note that a tall frame returns a URL to curl and slice with ffmpeg. For an agent with no Figma access, attach exported PNGs and say so.>

<If the harness has a design skill, name it here.> Mode is <Persuade / Operate / Read / Experience>, <and whether you are matching an existing design or inventing one>.

**5. Stand it up.**
<App, env vars needed, dev command, port.>

<Browser policy. On this repo: do NOT install Playwright, Chromium or any headless browser tooling. Name the one browser the agent is allowed to drive, and its known traps.>

**6. Report and stop.**
Post back in this shape:

- **SYSTEM STATE**: what came down in the merge, what is running and where, what you could and could not reach.
- **THE PATTERN** / **THE CAUSE** / **THE DIFF**: <whichever this ticket is about>, with your own measurements.
- **THE PLAN SHAPE**: each change with the file it lands in and the exact values you read from the design.
- **THE TEST STRATEGY**: see below.
- **RISKS**: anything you could not resolve, anything that could regress existing behaviour.

Then STOP. Do not enter plan mode. Wait for me.

═══════════════════════════════════════
PHASE 1: PLAN. Only after I approve Phase 0.
═══════════════════════════════════════

<If the harness has a plan mode, name it. Otherwise: write the ordered plan as a message and wait for approval.> Get the plan approved before writing code.

═══════════════════════════════════════
PHASE 2: IMPLEMENT, TEST, PR.
═══════════════════════════════════════

<The scope, numbered. Per item: what changes, in which file, with the measurement or design value that decides it, and the wrong fix forbidden by name.>

**Decisions already made. Do not relitigate them, but say so if you think one is wrong.**

<Numbered, each with its reasoning, not just its conclusion.>

**Testing.**

<The harness constraint and the forbidden expansion. What to test instead. Explicit permission to say something is not unit-testable rather than padding the suite.>

**Before opening anything:**
- `npm run lint` in `<packages>`. Zero errors, non-negotiable.
- `npm run test` in `<packages>`.
- <Behavioural checks, each phrased so it can fail.>

**CI warning:** `CI_SKIP_JS_UNIT` has been left switched on before, so a green CI run does not prove the JS tests ran. Run them locally and say so explicitly in your report.

**PR:** body from `.github/PULL_REQUEST_TEMPLATE.md`. Title is the ticket name. `Closes <TICKET-ID>` on its own line, `Part of <PARENT-ID>`. No AI attribution anywhere. <Screenshots, and who reviews.>

After pushing, watch CI with `gh pr checks <pr> --watch`. Do not walk away assuming green.

Report back after each gate. Ask rather than assume.

# Task workflow: every size, every agent

Use these stages for small fixes, documentation, features, and large refactors. Scale the length of the reports and the checks to the change; do not skip understanding, planning, verification, or review because a task looks small.

This is Questly's adaptation of the project-local `.claude/skills/delegation-brief/SKILL.md` and its `prompt-template.md`, with `.claude/skills/phased-work/SKILL.md` for work performed in the current session. Compatible copies are discoverable under `.agents/skills/`. Those local directories may be ignored or unavailable in a fresh clone, so this document contains the portable contract. Read an available skill before using it; if explicitly requested and missing, report that fact rather than pretending to apply it.

The source templates contain examples from another repository. Do not copy their oxlint command, ban on `tsc`, Node-only test harness, ticket names, CI flags, browser restrictions, or claimed identical root files into Questly. Here, ESLint and TypeScript are separate checks, tests use `edge-runtime`, and `CLAUDE.md` imports `AGENTS.md`.

## Gate ownership and authorization

Recon and planning are separate checkpoints. Before implementation, record the approved scope, acceptance criteria, and who authorized it. The user owns product/scope approval; a coordinating parent owns delegated batch approvals within that authorized scope. Independent reviewers own review verdicts. An executor cannot approve its own review.

Honor approval already given in the conversation or an accepted plan; record it rather than asking again. A direct, unambiguous instruction authorizes its routine local edits and checks. For that scope, report the recon and plan checkpoints and continue. If the user explicitly requests report-and-wait gates, or a proposed change introduces an unresolved product decision or crosses authority, stop at that gate. Elapsed time is never approval. Deployment, paid provider use, publication, and destructive operations require their own applicable authorization.

## Phase 0 — recon, no implementation

1. Establish the task, user outcome, non-goals, checkout/branch, ownership, and dependencies. Read root rules and relevant documentation/skills. Inspect git status and preserve unrelated changes.
2. Trace the real callers and data flow. Reproduce a reported failure when possible; measure instead of accepting the brief's diagnosis. Read comments documenting previous failures.
3. Record the base revision and current failures. If base synchronization is needed, inspect remote/branch state first and integrate only in the agreed checkout without overwriting work. Do not blindly merge into a shared dirty checkout. Shared worktrees share a stash stack: never use bare `git stash` or `git stash pop`.
4. Inspect the actual runtime, configuration, test harness, and available tools. Start services only when necessary and authorized; classify any Convex target first. Do not invent a Linear ticket, Figma reference, browser capability, or isolated environment.
5. Report: **system state; pattern/cause/diff with evidence; proposed change locations; test strategy; risks; what could not be verified**. A small documentation fix may need only a few sentences.

Record the Phase 0 approval or existing authorization before advancing. Recon is not an invitation to implement the first hypothesis.

## Phase 1 — an ordered plan

List each change with its files, expected behavior, and acceptance check. State decisions already made and why; allow evidence-backed challenges. Name a tempting wrong fix only when it is relevant to the actual failure. Include test constraints and environmental gaps.

For a small task, an ordered list in the task record is sufficient. For a large task, keep a durable plan with bounded batches and explicit ownership. Record approval before implementation, using existing authorization when applicable. If scope changes, update the plan and resolve only the new decision.

## Phase 2 — implement, verify, review, repair

- Reuse existing code and native capabilities first. Keep changes minimal and preserve guest access, account restoration, identity keys, and existing data contracts.
- Establish missing behavioral regression coverage before a refactor. For a documentation-only change, check facts, commands, links, and contradictory guidance rather than adding runtime tests.
- Run focused checks first, then the relevant lint/typecheck/test/build checks in [setup](setup.md). Do not turn a warning or unavailable live test into a false pass. Preserve baseline failures separately from regressions.
- Freeze application writes before review. Record the base, changed files, results, and a content digest covering source, tests, configuration, dependencies, generated files, and relevant documentation, including new files and deletions. Exclude secrets and runtime caches. Reviews apply only to that snapshot.
- Use **executor → code-reviewer → architect → fresh repair executor → repeat**. For a small task, these are short reviews of the actual diff; do not manufacture architecture work. For a documentation task, reviewers check facts and the consistency of instructions.
- Send every actionable in-scope finding to a new repair executor with affected files, expected behavior, and reproduction/check. A repair invalidates both approvals; refresh checks and both reviews. Disputes require an explicit architectural ruling. Reproducible failures cannot be waived; speculative additions stay outside the batch.
- After three unsuccessful repairs of the same issue, involve `debugger` and `architect`, then make another bounded repair. Do not accept or abandon the issue automatically.
- Finish with current approvals, appropriate independent verification, changed files, check results, and explicit remaining gaps. A PR, commit, push, or deployment is performed only when included in the authorized task. When a PR is requested, use an existing repository template if present and inspect actual CI results; do not assume CI ran every check.

## Delegation contract

Use native OMX/Codex roles (`executor`, `code-reviewer`, `architect`, `debugger`, `verifier`) when available. The parent owns sequencing and integration. At most two executors may write concurrently, with disjoint files. Schema, shared validators/builders, package/lockfiles, configuration, and generated files have one active owner. Children must not recursively delegate or revert another agent's edits.

Every child applies Ponytail full: understand callers, reuse existing code, minimize abstractions, and retain meaningful checks. Backend writers load `convex-expert`, schema guidance, and generated guidelines; backend reviewers load `convex-reviewer`; verification uses `convex-test` and `convex-verify`; deployment-related work additionally uses `convex-deploy-guard`.

If native roles are unavailable, use available independent reviewers and report the limitation. Never fabricate an independent approval or silently claim the full loop completed. Do not create a custom orchestration framework, Team/tmux session, new worktree, or separate user task solely to imitate missing tools.

## Standalone handoff checklist

A fresh agent needs a self-contained brief, not a pointer to unavailable conversation history. Fill in these fields in its task message or one task-specific Markdown artifact:

- **Task and lane:** objective, acceptance criteria, checkout/base, dependencies, owned files and why, prohibited files/non-goals, integration owner.
- **Evidence:** reproductions, exact observations, callers inspected, relevant designs/tickets if they exist; require the receiver to re-derive the cause.
- **Decisions and traps:** approved decisions with reasons, relevant forbidden wrong fixes, known environmental pitfalls.
- **Workflow and authority:** Phase 0 recon/report, Phase 1 ordered plan, Phase 2 implementation/review/repair, gate owner, approvals already given, actions needing further authorization.
- **Validation:** actual commands, harness constraints, regression expectations, unavailable evidence, no real provider calls by default.
- **Reporting:** diff, tests and results, unresolved findings, current snapshot; no recursive delegation or edits outside ownership.

For a one-file correction this can fit in one short message. For a broad refactor, make it a durable brief per batch. Never fill it with secret values or stale assumptions from another project's template.

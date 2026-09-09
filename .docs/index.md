# Questly handbook

Start here whether you are a developer, reviewer, or coding agent. These documents describe the repository, not a promise that every deployed environment matches it.

| Guide | Read it for |
| --- | --- |
| [Infrastructure](infrastructure.md) | Runtime boundaries, data, authentication, providers, queues, quotas, and supported limits |
| [Setup](setup.md) | Install, environment variables, local development, tests, and troubleshooting |
| [Coding conventions](coding-conventions.md) | File ownership, Convex patterns, frontend conventions, and regression checks |
| [Task workflow](task-workflow.md) | Required recon, plan, implementation, review, and repair stages for tasks of every size |

Agents must read the [root rules](../AGENTS.md) and task workflow before changing files. Claude's [entrypoint](../CLAUDE.md) imports those same root rules. Read the relevant guides, then verify claims against the code before editing.

Keep these documents updated in the same change that alters a command, environment requirement, ownership rule, endpoint contract, or infrastructure limit. The installed dependency versions and [lockfile](../package-lock.json), [scripts](../package.json), and source code determine actual behavior. Never copy real credentials or private deployment data into documentation.

## Verification status

The September 2026 refactor passed 647 tests across 36 files, lint with no errors and 11 existing warnings, typecheck, production build, static checks, and guest browser smoke. This is dated local evidence, not a permanent test count or a deployed-capacity guarantee. Rerun the checks for your change.

Authenticated live browser flows, cross-isolate photo/provider behavior, and a live capacity ramp, 15-minute steady state, and recovery still require an isolated non-production environment and agreed latency/cost thresholds. No production deployment is part of the documentation or default task workflow.

# Questly

Questly helps a group choose an activity and agree on a plan. The application uses Next.js App Router, React, Convex, and Better Auth.

Start with the [project handbook](.docs/index.md):

- [Setup and verification](.docs/setup.md)
- [Infrastructure](.docs/infrastructure.md)
- [Coding conventions](.docs/coding-conventions.md)
- [Required task workflow](.docs/task-workflow.md), for small and large changes

Install with `npm ci`. Configure a development Convex backend and the environment described in the setup guide before running `npm run dev`. `npx convex dev` is a backend deployment watcher, not just a local server.

Agents read [AGENTS.md](AGENTS.md) first. Claude's [CLAUDE.md](CLAUDE.md) imports the same root instructions.

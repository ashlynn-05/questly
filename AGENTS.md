# Questly project handbook

Read [.docs/index.md](.docs/index.md) and [.docs/task-workflow.md](.docs/task-workflow.md) before every task, including small fixes and documentation changes. Read the relevant setup, infrastructure, and coding-convention guides before editing. Apply the delegation-brief-style recon → approved plan → implementation → independent review/repair workflow; scale report length to task size, not away the stages. Existing user authorization carries forward: record it at each applicable gate instead of asking again for routine authorized work. Honor explicit report-and-wait instructions and unresolved authority boundaries. Keep the handbook current when commands, conventions, or infrastructure change.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

<!-- convex-ai-start -->

This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read
`convex/_generated/ai/guidelines.md` first** for important guidelines on
how to correctly use Convex APIs and patterns. The file contains rules that
override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running
`npx convex ai-files install`.

<!-- convex-ai-end -->

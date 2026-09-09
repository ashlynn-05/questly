# Setup and verification

## Install

Use Node.js and npm. The installed Next.js 16.3.4 requires Node >=20.9.0; the refactor was verified with Node 26.7.0 and npm 11.19.0. There is no repository Node-version pin. Check dependency engine requirements when changing runtimes.

From the repository root:

```sh
npm ci
```

Use the committed lockfile. Do not switch package managers or upgrade dependencies as a setup workaround.

## Configure an isolated development backend

Copy [.env.example](../.env.example) to `.env.local` only if the latter does not exist. Preserve an existing developer configuration. The template has placeholders, not usable credentials.

Before any Convex command that selects or affects a deployment, inspect the selected target and whether a `CONVEX_DEPLOY_KEY` override exists without printing secrets. Announce whether the target is local, dev, preview, or production. Agents follow the project `convex-deploy-guard` skill. Use a personal or isolated dev deployment; production changes require explicit authorization for that target and action.

On a new checkout, run the following interactively and select/create the intended development project:

```sh
npx convex dev
```

This is a **live backend watcher**: it pushes source/schema changes to its selected development deployment. Stop it before edits that must remain undeployed, and stop only processes you own. It is not merely a local web server. Setup may require Convex login and deployment environment configuration before the first push can complete.

### Next.js environment: `.env.local`

| Variable | Purpose |
| --- | --- |
| `CONVEX_DEPLOYMENT` | CLI deployment selector, normally written by Convex setup |
| `NEXT_PUBLIC_CONVEX_URL` | Convex client URL for the selected backend |
| `NEXT_PUBLIC_CONVEX_SITE_URL` | Its HTTP actions URL; cloud deployments use the matching `.convex.site` URL |

Use the URLs supplied by the selected deployment; do not substitute a production URL to make development work. Values prefixed `NEXT_PUBLIC_` are exposed to the browser. Restart Next after changing them and rebuild for a production-mode run.

The current template also contains `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY`, and `NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID`. The current source does not read these variables; they are not prerequisites for the implemented server-side Places/photo flow. Backend `SITE_URL` below is a separate, active setting.

### Convex deployment environment

Set these in the **selected development deployment's** environment, using its dashboard or the Convex environment tooling after target classification. They do not belong in browser configuration.

| Variable | Requirement |
| --- | --- |
| `SITE_URL` | Frontend origin, e.g. `http://localhost:3000`; used by Better Auth |
| `BETTER_AUTH_SECRET` | A private random secret of at least 32 characters; Better Auth reads it from the backend environment |
| `GOOGLE_MAPS_SERVER_KEY` | Needed for live Google Places and photo requests |
| `OPENAI_API_KEY` | Needed for live chat generation and embeddings |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Optional pair enabling Google OAuth |
| `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET` | Optional pair enabling Discord OAuth |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | Optional pair enabling web push notifications |

Generate the VAPID pair with `npx web-push generate-vapid-keys`. Both halves are deployment secrets and are never committed; the public half reaches the browser only through `api.push.publicKey`, which is why it is not a `NEXT_PUBLIC_` build variable. With either absent, push self-disables end to end: `api.push.publicKey` answers null, the settings screen says notifications are not switched on for this deployment, and `convex/pushSend.ts` returns before it loads `web-push` or opens a socket. Subscriptions can still be stored, so setting the keys later starts delivery without a code change.

Email/password and username authentication are configured independently of the optional OAuth providers. Provider absence/outage has endpoint-specific fallback behavior; missing keys do not prove live integration works. Keep provider calls out of automated tests. Do not spend against a real provider account without an agreed test budget.

## Run the frontend

With the intended backend configured, use a second terminal:

```sh
npm run dev
```

Open `http://localhost:3000`. For another port, use `npm run dev -- --port 3001` and make backend `SITE_URL` match. The Next `/api/auth/[...all]` route proxies authentication to Convex. The Convex HTTP route `/places/photo` serves validated photo redirects.

Optional demo data is implemented in [convex/seed.ts](../convex/seed.ts). On a classified, isolated development deployment with the functions available, `npx convex run seed:run` inserts/updates invented demonstration venues and rooms. This is a database mutation, not a required installation step; never present seeded businesses as actual partners.

## Validate changes

```sh
npm test
npm run lint
npx tsc --noEmit --incremental false
npm run build
git diff --check
```

Run typecheck and build sequentially because Next generates types. `npm run start` serves the completed build; it does not build or start Convex. `npm run test:watch` is available during development. For a focused backend check: `npx vitest run tests/convex/rooms.test.ts`.

The Vitest suite uses `edge-runtime`, `convex-test`, component registrations, and a network guard. Tests are under root `tests/`. Do not weaken the guard or call real providers to make a test pass. A built browser smoke test is separate evidence from unit tests; run mutations and account lifecycle scenarios only on an isolated backend.

After endpoint/schema changes, use supported generation:

```sh
npx convex codegen --typecheck disable
npx tsc --noEmit --incremental false
```

Classify the target first. In the installed Convex version, component codegen uploads bundles to the selected backend for analysis and writes generated bindings; it does not finalize a deployment. It is **not offline**. Never hand-edit `convex/_generated/` to bypass generation or start a watcher merely to refresh types.

## Troubleshooting

- Missing Convex URL or auth failure: check that both frontend URLs select the same backend and that backend `SITE_URL` matches the frontend origin.
- Missing optional OAuth button: both credentials for that provider must be configured in Convex.
- Structured `RATE_LIMITED`: respect `retryAfter` (milliseconds in app errors; HTTP `Retry-After` is seconds). Do not add automatic paid retries.
- Photo `404`: the name is unknown or expired. `429` means quota or an active lease; `503` means source/quota/lease storage is unavailable.
- Missing generated API entry: run supported codegen against the intended target, then typecheck. Do not fabricate bindings.
- Existing dirty checkout or another running watcher: identify ownership before starting processes or changing backend state. Preserve unrelated work.

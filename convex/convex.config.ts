import { defineApp } from "convex/server";
import betterAuth from "@convex-dev/better-auth/convex.config";
import migrations from "@convex-dev/migrations/convex.config.js";
import presence from "@convex-dev/presence/convex.config.js";
import rateLimiter from "@convex-dev/rate-limiter/convex.config.js";
import workpool from "@convex-dev/workpool/convex.config.js";

const app = defineApp();
app.use(betterAuth);
// Schema change, made possible at all. Every optional column in this schema is
// optional forever, and the comments say why: without a backfill tool, stamping
// a field onto rows that predate it is work nobody wants to hand-roll. That is
// sound once and unsustainable across ten columns. `convex/migrations.ts` holds
// the definitions; this is what lets them track their own progress and resume.
app.use(migrations);
// Who is actually in the room right now, which is NOT what `waitingOn` answers.
// `waitingOn` names people who have not finished the deck; somebody who closed
// the tab and somebody who is still thinking look identical in it. This is a
// heartbeat, and it is display-only -- see `convex/presence.ts`.
app.use(presence);
app.use(rateLimiter);
app.use(workpool, { name: "planGeneration" });
// A second pool rather than a shared one. Two kinds of work with nothing in
// common -- a slow, quota-bounded LLM call and a fast HTTPS POST -- sharing one
// parallelism budget means a room waiting on notifications sits behind a plan
// being written, and a burst of either starves the other.
app.use(workpool, { name: "pushDelivery" });

export default app;

import { defineApp } from "convex/server";
import betterAuth from "@convex-dev/better-auth/convex.config";
import rateLimiter from "@convex-dev/rate-limiter/convex.config.js";
import workpool from "@convex-dev/workpool/convex.config.js";

const app = defineApp();
app.use(betterAuth);
app.use(rateLimiter);
app.use(workpool, { name: "planGeneration" });
// A second pool rather than a shared one. Two kinds of work with nothing in
// common -- a slow, quota-bounded LLM call and a fast HTTPS POST -- sharing one
// parallelism budget means a room waiting on notifications sits behind a plan
// being written, and a burst of either starves the other.
app.use(workpool, { name: "pushDelivery" });

export default app;

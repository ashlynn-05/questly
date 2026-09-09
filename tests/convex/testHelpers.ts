import betterAuth from "@convex-dev/better-auth/test";
import rateLimiter from "@convex-dev/rate-limiter/test";
import workpool from "@convex-dev/workpool/test";
import type { GenericSchema, SchemaDefinition } from "convex/server";
import type { TestConvex } from "convex-test";
import schema from "../../convex/schema";

const componentTest = (t: TestConvex<typeof schema>) =>
  t as unknown as TestConvex<SchemaDefinition<GenericSchema, boolean>>;

export function registerComponents(t: TestConvex<typeof schema>): void {
  const generic = componentTest(t);
  betterAuth.register(generic, "betterAuth");
  rateLimiter.register(generic, "rateLimiter");
  workpool.register(generic, "planGeneration");
  workpool.register(generic, "pushDelivery");
}

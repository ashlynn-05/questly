/// <reference types="vite/client" />
import { api, components } from "../../convex/_generated/api";
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import schema from "../../convex/schema";
import { registerComponents } from "./testHelpers";

const modules = import.meta.glob("../../convex/**/*.ts");

test("getCurrentUser returns the Better Auth user contract", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  const now = Date.now();
  const { userId, sessionId } = await t.run(async (ctx) => {
    const user = await ctx.runMutation(components.betterAuth.adapter.create, {
      input: {
        model: "user",
        data: {
          name: "Bec",
          email: "bec@example.com",
          emailVerified: true,
          image: null,
          createdAt: now,
          updatedAt: now,
          username: "bec",
          displayUsername: "Bec",
          phoneNumber: null,
          phoneNumberVerified: null,
          isAnonymous: false,
          twoFactorEnabled: false,
          userId: null,
        },
      },
    });
    const session = await ctx.runMutation(components.betterAuth.adapter.create, {
      input: {
        model: "session",
        data: {
          expiresAt: now + 60_000,
          token: "auth-test-session",
          createdAt: now,
          updatedAt: now,
          userId: user._id,
        },
      },
    });
    return { userId: user._id, sessionId: session._id };
  });

  const current = await t.withIdentity({ subject: userId, sessionId }).query(
    api.auth.getCurrentUser,
    {},
  );

  expect(current).toMatchObject({
    _id: userId,
    name: "Bec",
    email: "bec@example.com",
    emailVerified: true,
    username: "bec",
    displayUsername: "Bec",
    image: null,
    phoneNumber: null,
    phoneNumberVerified: null,
    isAnonymous: false,
    twoFactorEnabled: false,
    userId: null,
  });
  expect(current?._creationTime).toEqual(expect.any(Number));
});

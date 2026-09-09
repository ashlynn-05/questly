import { createClient, type GenericCtx } from "@convex-dev/better-auth";
import { convex } from "@convex-dev/better-auth/plugins";
import { betterAuth } from "better-auth/minimal";
import { username } from "better-auth/plugins/username";
import type { BetterAuthOptions } from "better-auth";
import { v } from "convex/values";
import { components } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";
import { publicQuery } from "./lib/customFunctions";
import authConfig from "./auth.config";

const siteUrl = process.env.SITE_URL!;

export const authComponent = createClient<DataModel>(components.betterAuth);

/**
 * Social providers are registered only when their credentials are present in the
 * Convex deployment env. This keeps email/username sign-in working before the
 * OAuth apps exist -- add creds with `npx convex env set GOOGLE_CLIENT_ID ...`
 * and the buttons start working with no code change.
 */
const socialProviders = (): BetterAuthOptions["socialProviders"] => {
  const providers: NonNullable<BetterAuthOptions["socialProviders"]> = {};

  if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    providers.google = {
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    };
  }

  if (process.env.DISCORD_CLIENT_ID && process.env.DISCORD_CLIENT_SECRET) {
    providers.discord = {
      clientId: process.env.DISCORD_CLIENT_ID,
      clientSecret: process.env.DISCORD_CLIENT_SECRET,
    };
  }

  return providers;
};

export const createAuth = (ctx: GenericCtx<DataModel>) =>
  betterAuth({
    baseURL: siteUrl,
    database: authComponent.adapter(ctx),
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
    },
    socialProviders: socialProviders(),
    // `username()` layers username sign-in on top of email+password, so either
    // identifier works. It is on the Convex component's supported-plugin list.
    plugins: [username(), convex({ authConfig })],
  });

const authUserValidator = v.object({
  _id: v.string(),
  _creationTime: v.number(),
  name: v.string(),
  email: v.string(),
  emailVerified: v.boolean(),
  image: v.optional(v.union(v.null(), v.string())),
  createdAt: v.number(),
  updatedAt: v.number(),
  twoFactorEnabled: v.optional(v.union(v.null(), v.boolean())),
  isAnonymous: v.optional(v.union(v.null(), v.boolean())),
  username: v.optional(v.union(v.null(), v.string())),
  displayUsername: v.optional(v.union(v.null(), v.string())),
  phoneNumber: v.optional(v.union(v.null(), v.string())),
  phoneNumberVerified: v.optional(v.union(v.null(), v.boolean())),
  userId: v.optional(v.union(v.null(), v.string())),
});

/** Current signed-in user, or null when signed out. */
export const getCurrentUser = publicQuery({
  args: {},
  returns: v.union(v.null(), authUserValidator),
  handler: async (ctx) => {
    return (await authComponent.safeGetAuthUser(ctx)) ?? null;
  },
});

/** Which social providers are actually configured, so the UI can hide dead buttons. */
export const enabledSocialProviders = publicQuery({
  args: {},
  returns: v.array(v.string()),
  handler: async () => Object.keys(socialProviders() ?? {}),
});

import {
  customAction,
  customCtx,
  customMutation,
  customQuery,
} from "convex-helpers/server/customFunctions";
import type { ActionCtx, MutationCtx, QueryCtx } from "../_generated/server";
import {
  action,
  mutation,
  query,
} from "../_generated/server";
import { requireUserId, safeUserId } from "./access";

const optionalQueryIdentity = customCtx(async (ctx: QueryCtx) => ({
  userId: await safeUserId(ctx),
}));
const requiredQueryIdentity = customCtx(async (ctx: QueryCtx) => ({
  userId: await requireUserId(ctx),
}));
const optionalMutationIdentity = customCtx(async (ctx: MutationCtx) => ({
  userId: await safeUserId(ctx),
}));
const requiredMutationIdentity = customCtx(async (ctx: MutationCtx) => ({
  userId: await requireUserId(ctx),
}));
const optionalActionIdentity = customCtx(async (ctx: ActionCtx) => ({
  userId: await safeUserId(ctx),
}));
const requiredActionIdentity = customCtx(async (ctx: ActionCtx) => ({
  userId: await requireUserId(ctx),
}));

/** Public functions may inspect the current user while retaining guest access. */
export const publicQuery = customQuery(query, optionalQueryIdentity);
export const publicMutation = customMutation(mutation, optionalMutationIdentity);
export const publicAction = customAction(action, optionalActionIdentity);

/** Authenticated functions receive the server-derived Better Auth subject. */
export const authenticatedQuery = customQuery(query, requiredQueryIdentity);
export const authenticatedMutation = customMutation(mutation, requiredMutationIdentity);
export const authenticatedAction = customAction(action, requiredActionIdentity);

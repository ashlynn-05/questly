/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as ai_embeddings from "../ai/embeddings.js";
import type * as ai_store from "../ai/store.js";
import type * as auth from "../auth.js";
import type * as bookings from "../bookings.js";
import type * as deck from "../deck.js";
import type * as events from "../events.js";
import type * as http from "../http.js";
import type * as lib_access from "../lib/access.js";
import type * as lib_errors from "../lib/errors.js";
import type * as lib_match from "../lib/match.js";
import type * as lib_openai from "../lib/openai.js";
import type * as lib_planPrompt from "../lib/planPrompt.js";
import type * as lib_proposals from "../lib/proposals.js";
import type * as lib_quiz from "../lib/quiz.js";
import type * as lib_roster from "../lib/roster.js";
import type * as lib_scoring from "../lib/scoring.js";
import type * as lib_stops from "../lib/stops.js";
import type * as lib_swap from "../lib/swap.js";
import type * as places from "../places.js";
import type * as plans from "../plans.js";
import type * as profiles from "../profiles.js";
import type * as proposals from "../proposals.js";
import type * as rooms from "../rooms.js";
import type * as seed from "../seed.js";
import type * as swipes from "../swipes.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  "ai/embeddings": typeof ai_embeddings;
  "ai/store": typeof ai_store;
  auth: typeof auth;
  bookings: typeof bookings;
  deck: typeof deck;
  events: typeof events;
  http: typeof http;
  "lib/access": typeof lib_access;
  "lib/errors": typeof lib_errors;
  "lib/match": typeof lib_match;
  "lib/openai": typeof lib_openai;
  "lib/planPrompt": typeof lib_planPrompt;
  "lib/proposals": typeof lib_proposals;
  "lib/quiz": typeof lib_quiz;
  "lib/roster": typeof lib_roster;
  "lib/scoring": typeof lib_scoring;
  "lib/stops": typeof lib_stops;
  "lib/swap": typeof lib_swap;
  places: typeof places;
  plans: typeof plans;
  profiles: typeof profiles;
  proposals: typeof proposals;
  rooms: typeof rooms;
  seed: typeof seed;
  swipes: typeof swipes;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  betterAuth: import("@convex-dev/better-auth/_generated/component.js").ComponentApi<"betterAuth">;
};

/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as account from "../account.js";
import type * as ai_embeddings from "../ai/embeddings.js";
import type * as auth from "../auth.js";
import type * as bookings from "../bookings.js";
import type * as crons from "../crons.js";
import type * as deck from "../deck.js";
import type * as http from "../http.js";
import type * as lib_access from "../lib/access.js";
import type * as lib_account from "../lib/account.js";
import type * as lib_avatar from "../lib/avatar.js";
import type * as lib_customFunctions from "../lib/customFunctions.js";
import type * as lib_deck_build from "../lib/deck/build.js";
import type * as lib_deck_cache from "../lib/deck/cache.js";
import type * as lib_deck_venues from "../lib/deck/venues.js";
import type * as lib_errors from "../lib/errors.js";
import type * as lib_lock from "../lib/lock.js";
import type * as lib_match from "../lib/match.js";
import type * as lib_openai from "../lib/openai.js";
import type * as lib_planPrompt from "../lib/planPrompt.js";
import type * as lib_planQueue from "../lib/planQueue.js";
import type * as lib_plans_generation from "../lib/plans/generation.js";
import type * as lib_plans_search from "../lib/plans/search.js";
import type * as lib_proposals from "../lib/proposals.js";
import type * as lib_push_notify from "../lib/push/notify.js";
import type * as lib_push_queue from "../lib/push/queue.js";
import type * as lib_quiz from "../lib/quiz.js";
import type * as lib_rateLimits from "../lib/rateLimits.js";
import type * as lib_roster from "../lib/roster.js";
import type * as lib_rules from "../lib/rules.js";
import type * as lib_scoring from "../lib/scoring.js";
import type * as lib_stops from "../lib/stops.js";
import type * as lib_swap from "../lib/swap.js";
import type * as places from "../places.js";
import type * as plans from "../plans.js";
import type * as profiles from "../profiles.js";
import type * as proposals from "../proposals.js";
import type * as push from "../push.js";
import type * as pushSend from "../pushSend.js";
import type * as rateLimits from "../rateLimits.js";
import type * as rooms from "../rooms.js";
import type * as seed from "../seed.js";
import type * as swipes from "../swipes.js";
import type * as tables_bookings from "../tables/bookings.js";
import type * as tables_plans from "../tables/plans.js";
import type * as tables_profiles from "../tables/profiles.js";
import type * as tables_push from "../tables/push.js";
import type * as tables_quests from "../tables/quests.js";
import type * as tables_rooms from "../tables/rooms.js";
import type * as tables_venues from "../tables/venues.js";
import type * as validators from "../validators.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  account: typeof account;
  "ai/embeddings": typeof ai_embeddings;
  auth: typeof auth;
  bookings: typeof bookings;
  crons: typeof crons;
  deck: typeof deck;
  http: typeof http;
  "lib/access": typeof lib_access;
  "lib/account": typeof lib_account;
  "lib/avatar": typeof lib_avatar;
  "lib/customFunctions": typeof lib_customFunctions;
  "lib/deck/build": typeof lib_deck_build;
  "lib/deck/cache": typeof lib_deck_cache;
  "lib/deck/venues": typeof lib_deck_venues;
  "lib/errors": typeof lib_errors;
  "lib/lock": typeof lib_lock;
  "lib/match": typeof lib_match;
  "lib/openai": typeof lib_openai;
  "lib/planPrompt": typeof lib_planPrompt;
  "lib/planQueue": typeof lib_planQueue;
  "lib/plans/generation": typeof lib_plans_generation;
  "lib/plans/search": typeof lib_plans_search;
  "lib/proposals": typeof lib_proposals;
  "lib/push/notify": typeof lib_push_notify;
  "lib/push/queue": typeof lib_push_queue;
  "lib/quiz": typeof lib_quiz;
  "lib/rateLimits": typeof lib_rateLimits;
  "lib/roster": typeof lib_roster;
  "lib/rules": typeof lib_rules;
  "lib/scoring": typeof lib_scoring;
  "lib/stops": typeof lib_stops;
  "lib/swap": typeof lib_swap;
  places: typeof places;
  plans: typeof plans;
  profiles: typeof profiles;
  proposals: typeof proposals;
  push: typeof push;
  pushSend: typeof pushSend;
  rateLimits: typeof rateLimits;
  rooms: typeof rooms;
  seed: typeof seed;
  swipes: typeof swipes;
  "tables/bookings": typeof tables_bookings;
  "tables/plans": typeof tables_plans;
  "tables/profiles": typeof tables_profiles;
  "tables/push": typeof tables_push;
  "tables/quests": typeof tables_quests;
  "tables/rooms": typeof tables_rooms;
  "tables/venues": typeof tables_venues;
  validators: typeof validators;
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
  rateLimiter: import("@convex-dev/rate-limiter/_generated/component.js").ComponentApi<"rateLimiter">;
  planGeneration: import("@convex-dev/workpool/_generated/component.js").ComponentApi<"planGeneration">;
  pushDelivery: import("@convex-dev/workpool/_generated/component.js").ComponentApi<"pushDelivery">;
};

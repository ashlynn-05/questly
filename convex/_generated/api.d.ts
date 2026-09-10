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
import type * as lib_account_avatar from "../lib/account/avatar.js";
import type * as lib_account_quiz from "../lib/account/quiz.js";
import type * as lib_account_window from "../lib/account/window.js";
import type * as lib_customFunctions from "../lib/customFunctions.js";
import type * as lib_deck_build from "../lib/deck/build.js";
import type * as lib_deck_cache from "../lib/deck/cache.js";
import type * as lib_deck_scoring from "../lib/deck/scoring.js";
import type * as lib_deck_venues from "../lib/deck/venues.js";
import type * as lib_errors from "../lib/errors.js";
import type * as lib_openai from "../lib/openai.js";
import type * as lib_plans_generation from "../lib/plans/generation.js";
import type * as lib_plans_lock from "../lib/plans/lock.js";
import type * as lib_plans_prompt from "../lib/plans/prompt.js";
import type * as lib_plans_proposals from "../lib/plans/proposals.js";
import type * as lib_plans_queue from "../lib/plans/queue.js";
import type * as lib_plans_search from "../lib/plans/search.js";
import type * as lib_plans_stops from "../lib/plans/stops.js";
import type * as lib_plans_swap from "../lib/plans/swap.js";
import type * as lib_push_notify from "../lib/push/notify.js";
import type * as lib_push_queue from "../lib/push/queue.js";
import type * as lib_rateLimits from "../lib/rateLimits.js";
import type * as lib_rooms_access from "../lib/rooms/access.js";
import type * as lib_rooms_demolish from "../lib/rooms/demolish.js";
import type * as lib_rooms_match from "../lib/rooms/match.js";
import type * as lib_rooms_roster from "../lib/rooms/roster.js";
import type * as lib_rooms_rules from "../lib/rooms/rules.js";
import type * as migrations from "../migrations.js";
import type * as places from "../places.js";
import type * as plans from "../plans.js";
import type * as presence from "../presence.js";
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
  "lib/account/avatar": typeof lib_account_avatar;
  "lib/account/quiz": typeof lib_account_quiz;
  "lib/account/window": typeof lib_account_window;
  "lib/customFunctions": typeof lib_customFunctions;
  "lib/deck/build": typeof lib_deck_build;
  "lib/deck/cache": typeof lib_deck_cache;
  "lib/deck/scoring": typeof lib_deck_scoring;
  "lib/deck/venues": typeof lib_deck_venues;
  "lib/errors": typeof lib_errors;
  "lib/openai": typeof lib_openai;
  "lib/plans/generation": typeof lib_plans_generation;
  "lib/plans/lock": typeof lib_plans_lock;
  "lib/plans/prompt": typeof lib_plans_prompt;
  "lib/plans/proposals": typeof lib_plans_proposals;
  "lib/plans/queue": typeof lib_plans_queue;
  "lib/plans/search": typeof lib_plans_search;
  "lib/plans/stops": typeof lib_plans_stops;
  "lib/plans/swap": typeof lib_plans_swap;
  "lib/push/notify": typeof lib_push_notify;
  "lib/push/queue": typeof lib_push_queue;
  "lib/rateLimits": typeof lib_rateLimits;
  "lib/rooms/access": typeof lib_rooms_access;
  "lib/rooms/demolish": typeof lib_rooms_demolish;
  "lib/rooms/match": typeof lib_rooms_match;
  "lib/rooms/roster": typeof lib_rooms_roster;
  "lib/rooms/rules": typeof lib_rooms_rules;
  migrations: typeof migrations;
  places: typeof places;
  plans: typeof plans;
  presence: typeof presence;
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
  migrations: import("@convex-dev/migrations/_generated/component.js").ComponentApi<"migrations">;
  presence: import("@convex-dev/presence/_generated/component.js").ComponentApi<"presence">;
  rateLimiter: import("@convex-dev/rate-limiter/_generated/component.js").ComponentApi<"rateLimiter">;
  planGeneration: import("@convex-dev/workpool/_generated/component.js").ComponentApi<"planGeneration">;
  pushDelivery: import("@convex-dev/workpool/_generated/component.js").ComponentApi<"pushDelivery">;
};

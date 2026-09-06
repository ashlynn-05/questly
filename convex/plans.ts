import { v } from "convex/values";
import { api, internal } from "./_generated/api";
import { action, internalAction, internalMutation, internalQuery, mutation } from "./_generated/server";
import schema, { slotValidator, stopValidator } from "./schema";
import { memberCount, refuseIfBooked, requireMember, roomByCode } from "./lib/access";
import { throwUserError } from "./lib/errors";
import { applyStopSwap } from "./lib/swap";
import { jsonCompletion } from "./lib/openai";
import { priceLevelToCents } from "./lib/scoring";
import { isOverBudget, totalPerHeadCents, type Slot, type Stop } from "./lib/stops";
import { buildPlanPrompt, fallbackPlan, parsePlanResponse, type PlanInput } from "./lib/planPrompt";

export const planContext = internalQuery({
  args: { roomId: v.id("rooms"), questId: v.id("quests") },
  returns: v.object({
    room: schema.doc("rooms"),
    quest: schema.doc("quests"),
    headcount: v.number(),
  }),
  handler: async (ctx, { roomId, questId }) => {
    const room = await ctx.db.get(roomId);
    const quest = await ctx.db.get(questId);
    if (!room) throwUserError("ROOM_NOT_FOUND", "That room is gone.");
    if (!quest) throwUserError("QUEST_NOT_FOUND", "That quest is gone.");
    // The pair must actually belong together. Internal-only today, so nothing
    // can supply a mismatched pair from outside -- but a mismatch would plan
    // another room's venue with this room's budget and party size, and it would
    // do it silently.
    if (quest.roomId !== roomId) {
      throwUserError("QUEST_NOT_FOUND", "That quest belongs to another room.");
    }

    const members = await ctx.db
      .query("members")
      .withIndex("by_room", (q) => q.eq("roomId", roomId))
      .collect();

    // The roster is the truth about who is actually coming; the room's stated
    // headcount is only the host's guess at lobby time. It stands in if the
    // roster somehow reads empty, so the prompt never asks for 0 people.
    return { room, quest, headcount: members.length || room.headcount };
  },
});

/**
 * Upsert, never insert.
 *
 * `generate` is scheduled, so a retry or a second match can put two of them on
 * this room. A second row would leave `rooms.get` -- the single subscription the
 * client runs on -- showing whichever plan `.first()` happens to land on, which
 * is the plan quietly reverting for everyone in the room.
 */
export const writePlan = internalMutation({
  args: {
    roomId: v.id("rooms"),
    questId: v.id("quests"),
    stops: v.array(stopValidator),
    shareMessage: v.string(),
  },
  returns: v.id("plans"),
  handler: async (ctx, args) => {
    // .first() rather than .unique(): rooms.get reads this row the same way, and
    // a duplicate must not turn into a throw on every write for that room.
    const existing = await ctx.db
      .query("plans")
      .withIndex("by_room", (q) => q.eq("roomId", args.roomId))
      .first();

    const doc = { ...args, totalPerHeadCents: totalPerHeadCents(args.stops) };
    if (existing) {
      await ctx.db.patch(existing._id, doc);
      return existing._id;
    }
    return await ctx.db.insert("plans", doc);
  },
});

/**
 * Turn the matched card into an actual night out.
 *
 * The canned plan is built first and the model only ever replaces it, so a
 * matched room always ends up with a plan: a missing key, a rate limit, a 5xx
 * or a model writing prose all land on the same usable night rather than on an
 * empty screen the group cannot get past.
 */
export const generate = internalAction({
  args: { roomId: v.id("rooms"), questId: v.id("quests") },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const { room, quest, headcount } = await ctx.runQuery(internal.plans.planContext, args);

    const input: PlanInput = {
      venueName: quest.title,
      headcount,
      budgetPerHeadCents: room.budgetPerHeadCents,
      startAt: room.whenAt,
      mood: room.mood,
    };

    // Start from the usable night, then improve on it if the model cooperates.
    let result = fallbackPlan(input);

    try {
      const raw = await jsonCompletion(buildPlanPrompt(input));
      // `jsonCompletion` already parsed the body; re-serialising keeps every
      // untrusted model answer going through the one coercing, never-throwing
      // entry point rather than a second hand-rolled one here.
      const parsed = parsePlanResponse(JSON.stringify(raw), input);

      if (isOverBudget(parsed.stops, room.budgetPerHeadCents)) {
        // A $30 room being handed a $80 night -- or a free room being handed a
        // paid one -- is worse than the plainer plan we already have.
        console.warn("plans.generate: model plan was over budget; keeping the canned night.");
      } else {
        result = parsed;
      }
    } catch (error) {
      // Never leave a matched room without a plan because a third party was
      // slow -- but never fall back silently either, or the outage is invisible.
      console.warn("plans.generate: no model plan, using the canned night.", error);
    }

    await ctx.runMutation(internal.plans.writePlan, {
      roomId: args.roomId,
      questId: args.questId,
      stops: result.stops,
      shareMessage: result.shareMessage,
    });
    return null;
  },
});

/**
 * A solo user editing their own plan.
 *
 * GLOBAL CONSTRAINT -- one editing path per room size, enforced here on the
 * server rather than only in the UI. A room of one swaps a stop directly; a
 * room of two or more can only change its plan through `proposals.open`, which
 * the room then votes on. The two paths must never overlap: a direct write
 * alongside an open proposal on the same stop is a race between one person's
 * edit and the room's decision, and the room is supposed to win. The UI mirrors
 * this later, and must never offer a control this would reject.
 *
 * The swap itself is `applyStopSwap`, the same call the accepted-proposal path
 * makes, so the solo edit and the group edit cannot drift.
 */
export const replaceStop = mutation({
  args: {
    code: v.string(),
    sessionKey: v.string(),
    stopId: v.string(),
    replacement: stopValidator,
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const room = await roomByCode(ctx, args.code);
    // The sessionKey is the only authority accepted: a capability to act as one
    // member in one room. No memberId or userId argument exists.
    await requireMember(ctx, room._id, args.sessionKey);
    refuseIfBooked(room);

    if ((await memberCount(ctx, room._id)) > 1) {
      throwUserError(
        "GROUP_NEEDS_PROPOSAL",
        "In a group room, changes go through a proposal the room votes on.",
      );
    }

    await applyStopSwap(ctx, room._id, args.stopId, args.replacement);
    return null;
  },
});

/**
 * Pin a stop, or unpin it.
 *
 * DELIBERATELY a direct edit even in a group, and NOT routed through a
 * proposal -- do not "fix" this later. A lock changes nothing about the night:
 * it is a signal to the room that someone cares about this stop, it is fully
 * reversible by anyone in one tap, and it costs nobody anything. Making the
 * room vote on a signal would be ceremony, and it would mean a stop could not
 * be protected until a majority agreed to protect it. Content changes -- what
 * the stop actually IS -- are the thing the room votes on, and those go through
 * `proposals.open`.
 *
 * Locking is unanimous by construction: anyone can lock, anyone can unlock. It
 * is not a permission system, and it must never become one.
 */
export const setLocked = mutation({
  args: {
    code: v.string(),
    sessionKey: v.string(),
    stopId: v.string(),
    locked: v.boolean(),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const room = await roomByCode(ctx, args.code);
    await requireMember(ctx, room._id, args.sessionKey);
    // Locking AND unlocking are both refused once the night is booked -- see
    // refuseIfBooked for why releasing a lock is the same problem as a swap.
    refuseIfBooked(room);

    // .first(), not .unique(), for the reason documented at length in rooms.get:
    // a duplicate plan row must not turn into a throw on every edit in the room.
    const plan = await ctx.db
      .query("plans")
      .withIndex("by_room", (q) => q.eq("roomId", room._id))
      .first();
    if (!plan) throwUserError("PLAN_NOT_READY", "There is no plan to edit yet.");

    // A typo'd stop id must not report success while changing nothing.
    if (!plan.stops.some((s) => s.id === args.stopId)) {
      throwUserError("STOP_NOT_FOUND", "That stop is not in this plan.");
    }

    await ctx.db.patch(plan._id, {
      stops: plan.stops.map((s) => (s.id === args.stopId ? { ...s, locked: args.locked } : s)),
    });
    return null;
  },
});

const optionsValidator = v.object({ options: v.array(stopValidator) });

/**
 * Turns Places results into swap candidates for one slot.
 *
 * HONESTY -- the price shown is always the real estimate for the venue, even in
 * a $0 room. `deck.ts` may stamp a free room's candidates at $0 because it
 * restricts the SEARCH to FREE_TYPES first, so the $0 is true there. Here the
 * query is free text: a $0 group that types the name of a fine diner would be
 * shown it at $0 and find out at the table. `isOverBudget` can then do its job
 * and the group declines knowingly.
 */
function toOptions(
  results: Array<{
    id: string; name: string; address: string;
    summary: string | null; priceLevel: string | null;
  }>,
  slot: Slot,
  prefix: string,
): Stop[] {
  return results.slice(0, 6).map((place, i) => ({
    id: `${prefix}_${i}`,
    slot,
    placeId: place.id,
    name: place.name,
    // startAt is rewritten by applyStopSwap, so a placeholder is correct here.
    startAt: 0,
    durationMin: 60,
    costPerHeadCents: priceLevelToCents(place.priceLevel),
    note: place.summary ?? place.address,
    source: "manual" as const,
    locked: false,
  }));
}

/** "Pick it yourself" -- a typed search, biased to the room's area. */
export const searchStop = action({
  args: {
    code: v.string(),
    sessionKey: v.string(),
    query: v.string(),
    slot: slotValidator,
  },
  returns: optionsValidator,
  handler: async (ctx, args): Promise<{ options: Stop[] }> => {
    // rooms.get returns null rather than throwing for an unknown code or a
    // stale key, so membership is established by the null check here.
    const view = await ctx.runQuery(api.rooms.get, {
      code: args.code,
      sessionKey: args.sessionKey,
    });
    if (!view) throwUserError("NOT_A_MEMBER", "You are not a member of this room.");
    if (!args.query.trim()) return { options: [] };

    // internal.places.searchText, not api: the text search is an internalAction
    // precisely so it is not an unauthenticated proxy onto our billed Google key.
    const found = await ctx.runAction(internal.places.searchText, {
      query: args.query,
      lat: view.room.centreLat,
      lng: view.room.centreLng,
      radiusKm: view.room.radiusKm,
    });

    return { options: toOptions(found.results, args.slot, "search") };
  },
});

/**
 * "Ask Claude" -- three alternatives for one stop, with the stops around it as
 * context so the suggestion fits the night rather than replacing it.
 *
 * Falls back to a plain nearby search when the model is unavailable, so the
 * button always does something. An empty sheet reads as a broken feature.
 */
export const suggestStop = action({
  args: { code: v.string(), sessionKey: v.string(), stopId: v.string() },
  returns: optionsValidator,
  handler: async (ctx, args): Promise<{ options: Stop[] }> => {
    const view = await ctx.runQuery(api.rooms.get, {
      code: args.code,
      sessionKey: args.sessionKey,
    });
    if (!view) throwUserError("NOT_A_MEMBER", "You are not a member of this room.");
    if (!view.plan) throwUserError("PLAN_NOT_READY", "There is no plan to edit yet.");

    const target = view.plan.stops.find((s) => s.id === args.stopId);
    if (!target) throwUserError("STOP_NOT_FOUND", "That stop is not in this plan.");

    const free = view.room.budgetPerHeadCents === 0;
    const keeping = view.plan.stops
      .filter((s) => s.id !== args.stopId)
      .map((s) => `${s.slot}: ${s.name}${s.locked ? " (locked, do not change)" : ""}`)
      .join("\n");

    try {
      const prompt = [
        `A group of ${view.members.length} is out in Melbourne. These stops are staying:`,
        keeping || "(none -- this is the only stop)",
        `Replace the "${target.slot}" stop, currently "${target.name}".`,
        free
          ? "The budget is $0 per head, so the replacement must genuinely cost nothing."
          : `The whole night must stay under $${Math.round(view.room.budgetPerHeadCents / 100)} per head.`,
        "Return 3 real Melbourne options as JSON and nothing else, shaped:",
        `{"options":[{"name":string,"durationMin":number,"costPerHeadCents":number,"note":string}]}`,
        "note is one short sentence saying why it fits.",
      ].join("\n");

      // The one shared OpenAI entry point, so this feature cannot drift from
      // plans.generate the day the model name changes.
      const raw = (await jsonCompletion(prompt)) as {
        options?: Array<Record<string, unknown>>;
      };

      const options: Stop[] = (raw.options ?? []).slice(0, 3).map((o, i) => ({
        id: `llm_${i}`,
        slot: target.slot,
        name: typeof o.name === "string" && o.name.trim() ? o.name.trim() : "A stop",
        startAt: 0,
        durationMin: typeof o.durationMin === "number" && o.durationMin > 0 ? o.durationMin : 60,
        // Sanitised, never zeroed: a nonsense value becomes 0, but a real
        // estimate survives even in a $0 room. Showing a paid venue at $0
        // because the room asked for free is the same lie as in `toOptions`.
        costPerHeadCents:
          typeof o.costPerHeadCents === "number" &&
          Number.isFinite(o.costPerHeadCents) &&
          o.costPerHeadCents > 0
            ? Math.round(o.costPerHeadCents)
            : 0,
        note: typeof o.note === "string" ? o.note : "",
        source: "llm" as const,
        locked: false,
      }));

      if (options.length) return { options };
      console.warn(`plans.suggestStop: room ${view.room.code}: the model returned no options.`);
    } catch (error) {
      // Fall through to the search below rather than surfacing an empty sheet
      // -- but never silently: a demo quietly running on the fallback has to be
      // visible in the logs.
      console.warn(
        `plans.suggestStop: room ${view.room.code}: no model suggestions, falling back to a nearby search.`,
        error,
      );
    }

    const found = await ctx.runAction(internal.places.searchText, {
      query: target.name,
      lat: view.room.centreLat,
      lng: view.room.centreLng,
      radiusKm: view.room.radiusKm,
    });

    // The fallback searches for the stop it is replacing, and the search is
    // biased to the room's area, so the top hit is very often the exact venue
    // the user asked to get rid of. A swap sheet whose first option is the stop
    // you are trying to replace reads as broken.
    //
    // Both the place id and the name are checked: a duplicate Places listing
    // carries a different id and is still not an alternative. Two real
    // alternatives beat three where one of them is not one, so nothing is
    // backfilled to make the count up.
    const targetName = target.name.trim().toLowerCase();
    const alternatives = found.results.filter(
      (place) => place.id !== target.placeId && place.name.trim().toLowerCase() !== targetName,
    );

    return { options: toOptions(alternatives, target.slot, "nearby").slice(0, 3) };
  },
});

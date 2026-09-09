import { v } from "convex/values";
import { api, internal } from "./_generated/api";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import schema from "./schema";
import { slotValidator, stopValidator } from "./validators";
import { memberCount, refuseIfBooked, requireMember, roomByCode } from "./lib/access";
import { isProviderReservationError, throwUserError } from "./lib/errors";
import { applyStopLock } from "./lib/lock";
import { notifyRoom } from "./lib/push/notify";
import { settleProposal } from "./lib/proposals";
import { DEFAULT_LOCK_RULE } from "./lib/rules";
import { applyStopSwap } from "./lib/swap";
import { jsonCompletion } from "./lib/openai";
import { FREE_TYPES, MOOD_TYPES } from "./lib/scoring";
import { sanitizeClientStop, totalPerHeadCents, type Stop } from "./lib/stops";
import { generatePlan } from "./lib/plans/generation";
import { optionsValidator, toOptions } from "./lib/plans/search";
import { enqueuePlanGeneration } from "./lib/planQueue";
import { publicAction, publicMutation } from "./lib/customFunctions";


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

export const hasPlan = internalQuery({
  args: { roomId: v.id("rooms") },
  returns: v.boolean(),
  handler: async (ctx, { roomId }) =>
    (await ctx.db.query("plans").withIndex("by_room", (q) => q.eq("roomId", roomId)).first()) !== null,
});

/**
 * A plan build whose action is killed outright -- a deploy, a timeout, a crash
 * -- never reaches its own error handler, so the room would keep its claim
 * forever. After this long, a claim is presumed dead and may be taken.
 *
 * Shorter than `deck.ts`'s `STALE_BUILD_MS` because this build is one bounded
 * OpenAI round trip (see `CHAT_TIMEOUT_MS` in `lib/openai.ts`) rather than a
 * Places search, an embedding batch and a blurb batch -- and because a matched
 * room is staring at "Writing the plan..." with nothing else to do, so a minute
 * of it is already the outer edge of what a group will sit through.
 */
const STALE_PLAN_MS = 60 * 1000;

/**
 * Take the room for one plan build, or refuse. Compare-and-set, because the
 * check and the write must be the same transaction: a match and a host retry
 * can put two builds here at once, and two builds both writing would leave the
 * room's plan flipping between two answers under everyone reading it.
 *
 * Returns a lease token on success and `null` on refusal. The token, not the
 * mere presence of a claim, is what later writes are checked against -- a stale
 * claim can be taken while its build is still running, and that build must not
 * be able to overwrite whatever replaced it.
 *
 * It is a concurrency discriminator, never a credential, and it is never
 * returned to a client: authorisation for a retry is established in
 * `plans.retry` before anything reaches here, exactly as `deck.build`
 * establishes it before `deck.markBuilding`.
 *
 * Deliberately NOT gated on `room.status`. The status rules for starting a plan
 * build belong to the callers -- `retry` refuses anything but `matched`, and
 * `generate` re-reads the room through `planContext` -- and keeping them out of
 * here means the lease means one thing only: who is allowed to write next.
 */
export const markGenerating = internalMutation({
  args: { roomId: v.id("rooms") },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, { roomId }) => {
    const room = await ctx.db.get(roomId);
    if (!room) return null;

    // Someone else holds the claim. Take it only if it has gone stale.
    if (room.planStartedAt !== undefined && Date.now() - room.planStartedAt < STALE_PLAN_MS) {
      return null;
    }

    const planToken = crypto.randomUUID();
    await ctx.db.patch(roomId, { planStartedAt: Date.now(), planToken });
    return planToken;
  },
});

/** Whether this room's plan is still writable by this exact build. */
function holdsPlanLease(room: Doc<"rooms"> | null, token: string): boolean {
  return room !== null && room.planToken === token;
}

/**
 * Release the claim without writing a plan, so a build that failed outright
 * does not block the retry for a further `STALE_PLAN_MS`.
 *
 * Clears `planStartedAt` only. `planToken` stays, so a build whose claim was
 * taken over cannot come back to life and write over the room later.
 */
export const abandonPlan = internalMutation({
  args: { roomId: v.id("rooms"), token: v.string() },
  returns: v.null(),
  handler: async (ctx, { roomId, token }) => {
    const room = await ctx.db.get(roomId);
    if (holdsPlanLease(room, token)) {
      await ctx.db.patch(roomId, { planStartedAt: undefined });
    }
    return null;
  },
});

/**
 * Upsert, never insert.
 *
 * `generate` is scheduled, so a retry or a second match can put two of them on
 * this room. A second row would leave `rooms.get` -- the single subscription the
 * client runs on -- showing whichever plan `.first()` happens to land on, which
 * is the plan quietly reverting for everyone in the room.
 *
 * `token` is the lease from `markGenerating` and is checked here rather than
 * only at the start of the build, because the whole point of a staleness bound
 * is that a claim can be taken WHILE its build is still running. Without the
 * check, the build that was given up for dead would come back and overwrite the
 * plan the group is already reading.
 */
export const writePlan = internalMutation({
  args: {
    roomId: v.id("rooms"),
    questId: v.id("quests"),
    token: v.string(),
    stops: v.array(stopValidator),
    shareMessage: v.string(),
  },
  // Null when the write was dropped: either the room is already booked, or this
  // build's lease was taken while it was running.
  returns: v.union(v.id("plans"), v.null()),
  handler: async (ctx, { token, ...args }) => {
    // The last door into a booked plan, and the only one that is not a user
    // action: `generate` is SCHEDULED, so a build already in flight when the
    // room books is not stopped by anything -- `resolveMatch` only declines to
    // schedule a NEW one. And booking before the plan lands is deliberate
    // (see bookings.ts), where the booking honestly quotes the quest price.
    // Without this check that room books at the quest price and then acquires
    // a different plan underneath the reference the group is holding.
    //
    // A mutation, so the read and the write are one transaction: there is no
    // window between checking the status and acting on it.
    const room = await ctx.db.get(args.roomId);
    if (room?.status === "booked") {
      console.warn(
        `plans.writePlan: room ${room.code} booked before its plan landed; dropping the plan write.`,
      );
      return null;
    }

    // Checked after the booked read so the two refusals log distinctly, and
    // before any write so a superseded build changes nothing at all.
    if (!holdsPlanLease(room, token)) {
      console.warn(
        `plans.writePlan: room ${room?.code ?? args.roomId}: this build's lease was taken while ` +
          `it was running; dropping the plan write in favour of the build that replaced it.`,
      );
      return null;
    }

    // .first() rather than .unique(): rooms.get reads this row the same way, and
    // a duplicate must not turn into a throw on every write for that room.
    const existing = await ctx.db
      .query("plans")
      .withIndex("by_room", (q) => q.eq("roomId", args.roomId))
      .first();

    const doc = { ...args, totalPerHeadCents: totalPerHeadCents(args.stops) };
    let planId: Id<"plans">;
    if (existing) {
      await ctx.db.patch(existing._id, doc);
      planId = existing._id;
    } else {
      planId = await ctx.db.insert("plans", doc);
    }

    // The claim is released, so a later failure could be retried; the token
    // stays as the record of which build won. See the schema comment.
    await ctx.db.patch(args.roomId, { planStartedAt: undefined });

    // The one event with no actor, so nobody is excluded: the plan finishing is
    // not anybody's doing. It is also the one worth waking a phone for that the
    // group cannot predict -- the match was instant, this arrives whenever the
    // model is done.
    //
    // After both early returns above, so a plan that was DROPPED -- for a booked
    // room, or by a build whose lease was taken -- never announces itself.
    await notifyRoom(ctx, args.roomId, "planReady", null);
    return planId;
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
  handler: async (ctx, args): Promise<null> => generatePlan(ctx, args),
});
export const retry = publicMutation({
  args: { code: v.string(), sessionKey: v.string() },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const room = await roomByCode(ctx, args.code);
    const member = await requireMember(ctx, room._id, args.sessionKey);
    if (!member.isHost) {
      throwUserError("NOT_THE_HOST", "Only the host can ask for the plan again.");
    }

    // `matchedQuestId` is written in the same transaction as `status: "matched"`
    // (`lib/match.ts`), so the two are never apart -- but the plan build needs
    // the quest id, and a `!` here would hide a real backend fault behind a
    // crash rather than a sentence.
    if (room.status !== "matched" || !room.matchedQuestId) {
      throwUserError(
        "ROOM_WRONG_STATE",
        "There is nothing to write a plan for yet -- the room has not matched.",
      );
    }
    const questId = room.matchedQuestId;

    // Already has one. Idempotent rather than an error: a host double-tapping
    // as the plan lands should see the plan, not a failure. .first(), not
    // .unique(), for the reason documented at length in rooms.get.
    const existing = await ctx.db
      .query("plans")
      .withIndex("by_room", (q) => q.eq("roomId", room._id))
      .first();
    if (existing) return null;

    // The staleness bound doubles as the "give it a moment" rule: for the first
    // STALE_PLAN_MS after the match the original build is presumed alive, and
    // the honest answer is to wait for it rather than start a second one.
    if (room.planStartedAt !== undefined && Date.now() - room.planStartedAt < STALE_PLAN_MS) {
      throwUserError(
        "PLAN_IN_PROGRESS",
        "The plan is still being written. Give it a few more seconds.",
      );
    }

    // Scheduled, not run inline: this is a mutation and the build makes a
    // network call. `generate` takes the lease itself, so the two entry points
    // into a plan build stay identical.
    await enqueuePlanGeneration(ctx, room._id, questId);
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
export const replaceStop = publicMutation({
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

    // A room of one can still be holding an open proposal: a two-person room
    // where B proposed and then left leaves the proposal open (the departing
    // member's opening yes goes with them, but the remaining member's undecided
    // vote can still carry it). A direct swap here followed by the survivor
    // voting on that proposal would apply the departed member's replacement
    // over the survivor's own edit -- the exact overlap between the two editing
    // paths this rule exists to prevent, reached from the other side.
    //
    // `by_room_stop` narrows to this room's proposals for this one stop -- a
    // handful of rows -- and status is filtered off that, as in `proposals.open`.
    const openOnThisStop = await ctx.db
      .query("proposals")
      .withIndex("by_room_stop", (q) => q.eq("roomId", room._id).eq("stopId", args.stopId))
      .filter((q) => q.eq(q.field("status"), "open"))
      .first();
    if (openOnThisStop) {
      throwUserError(
        "PROPOSAL_EXISTS",
        "There is still an open proposal for that stop. Settle that first.",
      );
    }

    await applyStopSwap(
      ctx,
      room._id,
      args.stopId,
      // The client authored this object; see `sanitizeClientStop`.
      sanitizeClientStop(args.replacement, room.budgetPerHeadCents),
    );
    return null;
  },
});

/**
 * Pin a stop, or unpin it.
 *
 * A lock changes nothing about the night: it is a signal to the room that
 * someone cares about this stop, and it is reversible in one tap. Content
 * changes -- what the stop actually IS -- are a different thing, and in a group
 * they have always gone through `proposals.open`.
 *
 * ISSUE #11 ASKED WHO MAY LOCK. It offered three answers: host-only, a room
 * vote, or keep it open. The complaint underneath it was real and is worth
 * restating: one person QUIETLY locking a stop everyone else wanted to change
 * is a way to win an argument without having it.
 *
 * The answer came in two parts, because that sentence has two halves:
 *
 *  1. The silence, which is unconditional. A lock recorded nothing but a
 *     boolean, so the screen said "Locked" and never said by whom. That is
 *     anonymity, not authority, and no amount of restricting WHO may lock would
 *     have fixed it. Every lock now records `lockedBy` and the screen says
 *     whose it is, in every room, under every rule -- a silent lock was never a
 *     feature anybody chose, so it is not one a room can choose back.
 *
 *  2. The authority, which is the room's to decide. `lockRule` is a house rule
 *     the host sets, and all three of the issue's answers are offered:
 *       - "anyone"  the default, and what every room opened before this had;
 *       - "host"    only the host may lock or unlock, enforced below on the
 *                   member row's `isHost` and on nothing a client says;
 *       - "vote"    locking and unlocking both become proposals the room votes
 *                   on, through the same table a swap already uses.
 *
 * Host-only was argued against here before it was asked for, and the argument
 * is kept in `docs/questly-handover.md` section 15 rather than deleted: it does
 * not by itself remove the silent lock, and it introduces this product's first
 * content privilege. Part 1 answers the first objection -- the lock says whose
 * it is whichever rule is on -- and the second was a judgement about what a
 * group wants, which is the product owner's to make and not this file's. What
 * this file is responsible for is that the privilege is enforced on the server,
 * from the member row, and that is what the check below does.
 */
export const setLocked = publicMutation({
  args: {
    code: v.string(),
    sessionKey: v.string(),
    stopId: v.string(),
    locked: v.boolean(),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const room = await roomByCode(ctx, args.code);
    // The member row, not just the check: `lockedBy` is written from its `name`
    // below, and the opening yes on a lock proposal is cast as this member.
    // Still no host check -- see the ruling above.
    const member = await requireMember(ctx, room._id, args.sessionKey);
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
    const stop = plan.stops.find((s) => s.id === args.stopId);
    if (!stop) throwUserError("STOP_NOT_FOUND", "That stop is not in this plan.");

    const rule = room.lockRule ?? DEFAULT_LOCK_RULE;

    // Read off the member row `requireMember` returned, never from an argument.
    // A `hostSessionKey` or an `isHost` in the args would be the client saying
    // it is the host, which is not evidence that it is.
    //
    // Refused for locking AND unlocking. A rule that let anyone release the
    // host's lock would leave the host able to protect nothing, which is not
    // the rule the room turned on.
    if (rule === "host" && !member.isHost) {
      throwUserError(
        "NOT_THE_HOST",
        "The host looks after the locks in this room. Ask them to pin it.",
      );
    }

    const members = await memberCount(ctx, room._id);

    // A room of one is nobody to vote with. `needed(1)` is 1, so a proposal
    // here would be opened, carried by its own opening yes, and applied in the
    // same transaction -- the same outcome, two rows heavier, and with an
    // accepted proposal in the history for a decision nobody deliberated.
    if (rule !== "vote" || members < 2) {
      await applyStopLock(
        ctx,
        room._id,
        args.stopId,
        args.locked,
        // The name comes off the member row `requireMember` already returned,
        // never from an argument. A client-supplied name here would let anyone
        // sign someone else's name to a lock, which is worse than the silence
        // this field exists to end.
        args.locked ? member.name : null,
      );
      return null;
    }

    // Already where the room is being asked to put it.
    //
    // Only on this path. Locking an already-locked stop directly is a no-op
    // with one deliberate effect -- it moves `lockedBy` to whoever tapped last,
    // which is how a room passes an existing lock to the person who now cares
    // about it. A proposal cannot do that quietly: it would sit on the rail
    // collecting yeses for a change that has already happened, and it would
    // hold the stop's one proposal slot while it did it.
    if (stop.locked === args.locked) return null;

    // One open proposal per stop, and a lock proposal counts. Two live
    // proposals on one stop would let the room vote twice on the same slot;
    // worse here than for a swap, because a lock vote and a swap vote on the
    // same stop are directly contradictory and whichever majority landed second
    // would win by timing.
    const clash = await ctx.db
      .query("proposals")
      .withIndex("by_room_stop", (q) => q.eq("roomId", room._id).eq("stopId", args.stopId))
      .filter((q) => q.eq(q.field("status"), "open"))
      .first();
    if (clash) {
      throwUserError(
        "PROPOSAL_EXISTS",
        "There is already an open proposal for that stop. Settle that first.",
      );
    }

    const proposalId = await ctx.db.insert("proposals", {
      roomId: room._id,
      stopId: args.stopId,
      proposedBy: member._id,
      kind: args.locked ? "lock" : "unlock",
      // No `replacement`: a lock does not change what the stop is. See the
      // field's note in the schema for why the current stop is not stored here
      // to keep it non-optional.
      //
      // No reason either. The swap sheet asks for one because "why this place
      // instead" is a real question; "why protect this" is answered by the
      // proposer's name, which the card already shows.
      reason: "",
      status: "open",
    });

    // Asking is agreeing, exactly as in `proposals.open`, and recorded as a
    // real row rather than implied by `proposedBy` so one tally counts every
    // yes the same way -- and so it leaves with the proposer instead of
    // outliving them as a phantom.
    await ctx.db.insert("proposalVotes", { proposalId, memberId: member._id, vote: "yes" });

    const proposal = await ctx.db.get(proposalId);
    // Not user-actionable: the row was inserted above in this same transaction.
    if (!proposal) throw new Error("plans.setLocked: the proposal vanished mid-transaction.");

    // In a room of two, needed(2) is 2, so this settles nothing yet and the
    // other person decides. The threshold is never written here as a literal.
    await settleProposal(ctx, proposal);
    return null;
  },
});

/** "Pick it yourself" -- a typed search, biased to the room's area. */
export const searchStop = publicAction({
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

    await ctx.runMutation(internal.rateLimits.reserveRequest, {
      roomId: view.room._id,
      memberId: view.you._id,
      family: "search",
    });

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
export const suggestStop = publicAction({
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

    await ctx.runMutation(internal.rateLimits.reserveRequest, {
      roomId: view.room._id,
      memberId: view.you._id,
      family: "suggest",
    });

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
      const raw = (await jsonCompletion(
        prompt,
        () => ctx.runMutation(internal.rateLimits.reserveProvider, { provider: "openai" }),
      )) as {
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
      if (isProviderReservationError(error)) throw error;
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
    const alternatives = <P extends { id: string; name: string }>(places: P[]): P[] =>
      places.filter(
        (place) => place.id !== target.placeId && place.name.trim().toLowerCase() !== targetName,
      );

    const nearby = alternatives(found.results);
    let options = toOptions(nearby, target.slot, "nearby").slice(0, 3);
    if (options.length) return { options };

    // Two alternatives instead of three is the right trade; ZERO is the empty
    // sheet this whole fallback exists to prevent. The answer is another
    // search, never relaxing the filter that was just applied -- the venue
    // being replaced is not an alternative however few others there are.
    //
    // The second search asks for the room's mood instead of the target's name,
    // which is what got us here -- and for a $0 room it asks for FREE_TYPES
    // instead, exactly as `deck.build` chooses between the two. Handing a group
    // who said they have nothing to spend a list of spas is the same honesty
    // problem as the fabricated $0, pointed the other way. The underscores go
    // because this is a text query, not a type filter.
    //
    // The two cases are logged differently on purpose: "returned only the
    // venue we are replacing" and "returned nothing at all" call for different
    // responses from whoever is reading the logs, and the whole point of this
    // line is to say which one happened.
    console.warn(
      found.results.length === 0
        ? `plans.suggestStop: room ${view.room.code}: the nearby search for "${target.name}" ` +
            `returned nothing; trying the room's mood instead.`
        : `plans.suggestStop: room ${view.room.code}: the nearby search for "${target.name}" ` +
            `returned ${found.results.length} result(s), all of them that same venue; ` +
            `trying the room's mood instead.`,
    );

    const byMood = await ctx.runAction(internal.places.searchText, {
      query: (free ? FREE_TYPES : MOOD_TYPES[view.room.mood]).join(" ").replace(/_/g, " "),
      lat: view.room.centreLat,
      lng: view.room.centreLng,
      radiusKm: view.room.radiusKm,
    });
    options = toOptions(alternatives(byMood.results), target.slot, "mood").slice(0, 3);

    if (!options.length) {
      // Genuinely nothing to offer. Still returned as an empty list rather than
      // a throw -- but never silently, so an area with no coverage is visible.
      console.warn(
        `plans.suggestStop: room ${view.room.code}: no alternatives for "${target.name}" ` +
          `after a mood search either.`,
      );
    }
    return { options };
  },
});

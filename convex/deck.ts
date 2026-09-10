import { v } from "convex/values";
import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { internalMutation, internalQuery } from "./_generated/server";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";

import schema from "./schema";
import { MAX_ROOM_MEMBERS } from "./lib/rooms/access";
import { questFields, findRecentDeck } from "./lib/deck/cache";
import {
  VENUE_CATALOG_CEILING,
} from "./lib/deck/venues";
import { buildDeck } from "./lib/deck/build";
import { type Mood, normalizeMood } from "./lib/deck/scoring";
import { throwUserError } from "./lib/errors";
import { publicAction } from "./lib/customFunctions";

async function readContextBase(ctx: QueryCtx, roomId: Id<"rooms">) {
  const room = await ctx.db.get(roomId);
  if (!room) throwUserError("ROOM_NOT_FOUND", "That room is gone.");

  const members = await ctx.db
    .query("members")
    .withIndex("by_room", (q) => q.eq("roomId", roomId))
    .take(MAX_ROOM_MEMBERS);

  // Guests have no profile, so the signed-in members' taste carries the room.
  const vectors: number[][] = [];
  const affinities: number[] = [];
  for (const member of members) {
    const userId = member.userId;
    if (!userId) continue;
    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    if (!profile) continue;
    if (profile.tasteVector.length) vectors.push(profile.tasteVector);
    const affinity = profile.moodAffinity[normalizeMood(room.mood)];
    if (typeof affinity === "number") affinities.push(affinity);
  }
  const moodAffinity = affinities.length
    ? affinities.reduce((a, b) => a + b, 0) / affinities.length
    : 0;

  return { room, vectors, moodAffinity };
}

async function readBoundedPartners(ctx: QueryCtx, mood: Mood) {
  const active = await ctx.db
    .query("venues")
    .withIndex("by_active", (q) => q.eq("active", true))
    .take(VENUE_CATALOG_CEILING + 1);
  if (active.length > VENUE_CATALOG_CEILING) {
    throwUserError(
      "VENUE_CATALOG_TOO_LARGE",
      "The active venue catalogue is too large to build this deck safely.",
    );
  }
  return active.filter((venue) => venue.moods.some((m) => normalizeMood(m) === mood));
}

const contextBaseReturns = v.object({
  room: schema.doc("rooms"),
  vectors: v.array(v.array(v.float64())),
  moodAffinity: v.number(),
});

/** Context without venues for the paginated action-side reader. */
export const contextBase = internalQuery({
  args: { roomId: v.id("rooms") },
  returns: contextBaseReturns,
  handler: async (ctx, { roomId }) => readContextBase(ctx, roomId),
});

/** One bounded page from the active catalog. The action supplies fixed limits. */
export const activeVenuePage = internalQuery({
  args: { paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(schema.doc("venues")),
  handler: async (ctx, { paginationOpts }) =>
    ctx.db
      .query("venues")
      .withIndex("by_active", (q) => q.eq("active", true))
      .paginate(paginationOpts),
});

export const context = internalQuery({
  args: { roomId: v.id("rooms") },
  returns: v.object({
    room: schema.doc("rooms"),
    partners: v.array(schema.doc("venues")),
    vectors: v.array(v.array(v.float64())),
    // The room's appetite for its own mood, blended across the members who
    // have answered the quiz. 0 when nobody has -- see `moodAffinityMultiplier`.
    moodAffinity: v.number(),
  }),
  handler: async (ctx, { roomId }) => {
    const base = await readContextBase(ctx, roomId);
    const partners = await readBoundedPartners(ctx, normalizeMood(base.room.mood));
    return { ...base, partners };
  },
});

/**
 * A build whose action is killed outright -- a deploy, a timeout, a crash --
 * never reaches its own error handler, so the room would keep its claim
 * forever. After this long, a claim is presumed dead and may be taken.
 */
const STALE_BUILD_MS = 2 * 60 * 1000;

/**
 * Take the room for one build, or refuse. Compare-and-set, because the check
 * and the write must be the same transaction: a host double-click puts two
 * actions here at once, and if both were allowed to proceed, the loser's
 * `insert` would later delete a deck the room was already swiping and orphan
 * every swipe cast against it.
 *
 * Returns a lease token on success and `null` on refusal. The token, not the
 * "building" status, is what later writes are checked against -- because a
 * stale claim can be taken while its build is still running, and that build
 * must not be able to overwrite whatever replaced it. It is a concurrency
 * discriminator, never a credential: `build` has already established that the
 * caller is the host before anything reaches here.
 */
export const markBuilding = internalMutation({
  args: { roomId: v.id("rooms") },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, { roomId }) => {
    const room = await ctx.db.get(roomId);
    if (!room) return null;

    if (room.status === "building") {
      // Someone else holds the claim. Take it only if it has gone stale.
      const startedAt = room.buildStartedAt ?? 0;
      if (Date.now() - startedAt < STALE_BUILD_MS) return null;
    } else if (room.status === "swiping") {
      // A swiping room with cards is off limits: rebuilding would delete the
      // deck out from under swipes already cast against it. A swiping room with
      // NO cards never started, cannot have a swipe, and has no other way out
      // -- see `deck.build`. Read in this transaction, alongside the status, so
      // the two cannot disagree.
      const anyQuest = await ctx.db
        .query("quests")
        .withIndex("by_room_rank", (q) => q.eq("roomId", roomId))
        .first();
      if (anyQuest) return null;
    } else if (room.status !== "lobby") {
      return null;
    }

    const buildToken = crypto.randomUUID();
    await ctx.db.patch(roomId, {
      status: "building",
      buildStartedAt: Date.now(),
      buildToken,
    });
    return buildToken;
  },
});

/** Whether this room is still held by this exact build. */
function holdsLease(room: Doc<"rooms"> | null, token: string): boolean {
  return room?.status === "building" && room.buildToken === token;
}

/**
 * A build that found nothing must not leave the room spinning on "building"
 * forever -- it goes back to the lobby, where the host still has the button.
 *
 * Token-checked like every other write: a build whose stale claim was taken
 * over must not hand back a room that now belongs to a build still in flight.
 */
export const abandonBuild = internalMutation({
  args: { roomId: v.id("rooms"), token: v.string() },
  returns: v.null(),
  handler: async (ctx, { roomId, token }) => {
    const room = await ctx.db.get(roomId);
    if (holdsLease(room, token)) {
      await ctx.db.patch(roomId, {
        status: "lobby",
        buildStartedAt: undefined,
        buildToken: undefined,
      });
    }
    return null;
  },
});

/**
 * Write the deck, if this build still holds the room.
 *
 * Returns the deck size, or `null` if the lease was taken while this build was
 * running. Bailing matters more than it looks: this deletes the room's whole
 * deck before writing, so a stalled build that wrote anyway would destroy the
 * deck that replaced it and orphan every swipe already cast against it.
 */
export const insert = internalMutation({
  args: { roomId: v.id("rooms"), token: v.string(), quests: v.array(questFields) },
  returns: v.union(v.number(), v.null()),
  handler: async (ctx, { roomId, token, quests }) => {
    if (!holdsLease(await ctx.db.get(roomId), token)) return null;

    // An empty deck is the one room state with no way out of it. This is the
    // only writer of `status: "swiping"`, and a swiping room with no cards can
    // neither be rebuilt (`build` refuses), joined (`join` refuses), nor swiped
    // (there is no card to tap), while `waitingOn` computes "waiting on nobody"
    // for everyone -- so a solo host lands in a room that displays as finished
    // and is permanently stuck. Both callers already guarantee a non-empty list
    // by arithmetic; the guarantee belongs here, one line from the write it
    // protects, rather than in two callers a refactor away from changing.
    //
    // A throw rather than `return null`, and not user-actionable: `null` already
    // means "a newer build holds the room", which `insertDeck` reports to the
    // user as exactly that. An empty deck is not that -- it is a backend fault,
    // and the transaction rolling back is the correct outcome.
    if (quests.length === 0) {
      throw new Error("deck.insert: refusing to open swiping on an empty deck.");
    }

    const existing = await ctx.db
      .query("quests")
      .withIndex("by_room_rank", (q) => q.eq("roomId", roomId))
      .collect();
    for (const stale of existing) await ctx.db.delete(stale._id);

    for (const q of quests) await ctx.db.insert("quests", { ...q, roomId });
    await ctx.db.patch(roomId, {
      status: "swiping",
      deckBuiltAt: Date.now(),
      buildStartedAt: undefined,
      buildToken: undefined,
    });
    return quests.length;
  },
});


export const build = publicAction({
  args: { code: v.string(), sessionKey: v.string() },
  returns: v.object({ deckSize: v.number() }),
  handler: async (ctx, args): Promise<{ deckSize: number }> => {
    const view = await ctx.runQuery(api.rooms.get, {
      code: args.code,
      sessionKey: args.sessionKey,
    });
    if (!view) throwUserError("NOT_A_MEMBER", "You are not a member of this room.");

    // Host only. The lobby offers this button to nobody else, and two members
    // racing the build would each spend Places and OpenAI quota on a deck only
    // one of them gets to keep.
    if (!view.you.isHost) {
      throwUserError("NOT_THE_HOST", "Only the host can start the deck.");
    }
    // "building" is allowed so a build that died halfway can be retried. Past
    // that, a rebuild would silently invalidate swipes, a match, or a booking.
    //
    // "swiping" with an EMPTY deck is admitted for the same reason "building"
    // is: it is a room that never actually started, not one in progress. Cards
    // are the only thing a swiping room can invalidate, and there are none --
    // no swipe, no match and no booking can exist without one. `deck.insert`
    // now refuses to create that state at all, so this is the way out for any
    // room already in it, and it costs nothing to leave open.
    const stuckMidBuild = view.room.status === "swiping" && view.quests.length === 0;
    if (view.room.status !== "lobby" && view.room.status !== "building" && !stuckMidBuild) {
      throwUserError("ROOM_WRONG_STATE", "This room has already started swiping.");
    }

    const roomId: Id<"rooms"> = view.room._id;
    // The checks above are for the error message; THIS is the authorisation to
    // build. Everything before it was read in an earlier transaction and could
    // already be stale by now.
    const token = await ctx.runMutation(internal.deck.markBuilding, { roomId });
    if (token === null) {
      throwUserError("BUILD_IN_PROGRESS", "This deck is already being built. Give it a moment.");
    }

    try {
      await ctx.runMutation(internal.rateLimits.reserveGeneration, {
        roomId,
        family: "deck",
      });
      return { deckSize: await buildDeck(ctx, roomId, token) };
    } catch (error) {
      // Google 5xx, a quota wall, an empty neighbourhood: whatever it was, the
      // room must not be left spinning on "building" with no way out of it.
      // Only if we still hold it -- abandonBuild checks the token.
      await ctx.runMutation(internal.deck.abandonBuild, { roomId, token });
      throw error;
    }
  },
});

/** A cached deck goes stale after this long, so a demo run from yesterday never
 * serves tonight's prices. An hour is generous for a live demo and short
 * enough that nobody could call the reused cards "the wrong deck". */
export const recentDeck = internalQuery({
  args: { roomId: v.id("rooms"), now: v.number() },
  returns: v.union(v.null(), v.array(questFields)),
  handler: async (ctx, { roomId, now }) => findRecentDeck(ctx, roomId, now),
});

/**
 * The vectors this shortlist already has, aligned to the ids it asked about.
 *
 * `null` for a miss rather than a short array, so the caller can pair each
 * answer with the candidate that produced it without a second lookup.
 */
export const cachedEmbeddings = internalQuery({
  args: { model: v.string(), placeIds: v.array(v.string()) },
  returns: v.array(v.union(v.array(v.float64()), v.null())),
  handler: async (ctx, { model, placeIds }): Promise<Array<number[] | null>> =>
    Promise.all(
      placeIds.map(async (placeId) => {
        const row = await ctx.db
          .query("venueEmbeddings")
          .withIndex("by_model_place", (q) => q.eq("model", model).eq("placeId", placeId))
          .first();
        return row?.vector ?? null;
      }),
    ),
});

/**
 * Keep the vectors we just paid for.
 *
 * `.first()` rather than `.unique()`, and a skip rather than a throw, for the
 * reason `rooms.get` gives at length: two rooms can build at the same instant
 * and race to write the same venue. A duplicate row here is harmless -- both
 * hold a vector for the same place -- and refusing to write is cheaper than a
 * transaction that fails and loses the whole batch.
 */
export const saveEmbeddings = internalMutation({
  args: {
    model: v.string(),
    entries: v.array(v.object({ placeId: v.string(), vector: v.array(v.float64()) })),
  },
  returns: v.null(),
  handler: async (ctx, { model, entries }) => {
    for (const entry of entries) {
      const existing = await ctx.db
        .query("venueEmbeddings")
        .withIndex("by_model_place", (q) => q.eq("model", model).eq("placeId", entry.placeId))
        .first();
      if (!existing) await ctx.db.insert("venueEmbeddings", { model, ...entry });
    }
    return null;
  },
});

import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import schema, { moodValidator, stopValidator } from "./schema";
import {
  MAX_ROOM_MEMBERS,
  findMember, findRoomByCode, needed, newRoomCode, newSessionKey, requireMember, requireUserId, roomByCode, safeUserId,
} from "./lib/access";
import { throwUserError } from "./lib/errors";
import { detachMember } from "./lib/roster";
import { isOverBudget } from "./lib/stops";

const memberViewValidator = v.object({
  _id: v.id("members"),
  name: v.string(),
  isHost: v.boolean(),
});

/**
 * The exact shape five later tasks read. Declaring it as a `returns` validator
 * makes Convex reject a drifted response at runtime and makes TypeScript reject
 * a drifted handler at compile time, so neither side can quietly change the
 * contract the whole client is built on.
 *
 * No member's `sessionKey` appears anywhere in it: that is enforced here, in
 * the type, not only by the projection below.
 */
const roomViewValidator = v.union(
  v.null(),
  v.object({
    room: v.object({
      _id: v.id("rooms"),
      code: v.string(),
      mood: moodValidator,
      headcount: v.number(),
      budgetPerHeadCents: v.number(),
      whenAt: v.number(),
      centreLat: v.number(),
      centreLng: v.number(),
      radiusKm: v.number(),
      visibility: v.union(v.literal("private"), v.literal("open")),
      status: v.union(
        v.literal("lobby"),
        v.literal("building"),
        v.literal("swiping"),
        v.literal("matched"),
        v.literal("booked"),
      ),
      matchedQuestId: v.optional(v.id("quests")),
    }),
    you: memberViewValidator,
    members: v.array(memberViewValidator),
    quests: v.array(schema.doc("quests")),
    plan: v.union(
      v.null(),
      v.object({
        _id: v.id("plans"),
        stops: v.array(stopValidator),
        totalPerHeadCents: v.number(),
        // Derived, never stored: the plan and the budget can each move without
        // the other, and a persisted flag would go stale the moment either did.
        overBudget: v.boolean(),
        shareMessage: v.string(),
      }),
    ),
    booking: v.union(v.null(), schema.doc("bookings")),
    proposals: v.array(
      v.object({
        _id: v.id("proposals"),
        stopId: v.string(),
        replacement: stopValidator,
        reason: v.string(),
        proposedByName: v.string(),
        yes: v.number(),
        needed: v.number(),
        youVoted: v.boolean(),
      }),
    ),
    progress: v.object({
      swipedByYou: v.number(),
      deckSize: v.number(),
      waitingOn: v.array(v.string()),
    }),
  }),
);

export const create = mutation({
  args: {
    mood: moodValidator,
    headcount: v.number(),
    budgetPerHeadCents: v.number(),
    whenAt: v.number(),
    centreLat: v.number(),
    centreLng: v.number(),
    radiusKm: v.number(),
    visibility: v.union(v.literal("private"), v.literal("open")),
    hostName: v.string(),
  },
  returns: v.object({ code: v.string(), sessionKey: v.string() }),
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const { hostName, ...room } = args;

    // Four digits collide eventually; retry rather than hand out a dead code.
    // Never fall through to an insert on a taken code: two rooms sharing one
    // code makes findRoomByCode's .unique() throw for both of them, forever, and
    // rooms.get is the one subscription the whole client runs on.
    let code = newRoomCode();
    let free = false;
    for (let i = 0; i < 10; i++) {
      if (!(await findRoomByCode(ctx, code))) {
        free = true;
        break;
      }
      code = newRoomCode();
    }
    if (!free) throwUserError("NO_FREE_ROOM_CODE", "Could not find a free room code. Please try again.");

    const roomId = await ctx.db.insert("rooms", {
      ...room,
      hostUserId: userId,
      status: "lobby",
      code,
    });

    const sessionKey = newSessionKey();
    await ctx.db.insert("members", {
      roomId,
      name: hostName.trim() || "Host",
      userId,
      isHost: true,
      sessionKey,
      joinedAt: Date.now(),
    });

    return { code, sessionKey };
  },
});

export const join = mutation({
  args: {
    code: v.string(),
    name: v.string(),
    // Optional, and never an identity claim: holding this key proves you are
    // already a member of this one room, which is what makes a re-join
    // idempotent. A caller who omits it is simply someone we cannot recognise.
    sessionKey: v.optional(v.string()),
  },
  returns: v.object({ code: v.string(), sessionKey: v.string() }),
  handler: async (ctx, { code, name, sessionKey }) => {
    const room = await roomByCode(ctx, code);

    // Signed-in users get their id attached; guests do not need one.
    const userId = await safeUserId(ctx);

    const roster = await ctx.db
      .query("members")
      .withIndex("by_room", (q) => q.eq("roomId", room._id))
      .collect();

    // Re-entering is not joining.
    //
    // A refresh, a double-tap, or the host typing their own room code must hand
    // back the membership that already exists. A second row for the same person
    // is a phantom member: it permanently inflates needed() and sits in
    // waitingOn forever, so the room can never reach unanimity -- exactly the
    // stall the never-deadlock constraint exists to prevent.
    //
    // There are two ways to recognise someone: the capability they were issued,
    // and the account they are signed in to. Both are resolved BEFORE the lobby
    // gate below, so a member who refreshes mid-swipe is not locked out of the
    // room they are already in. Handing back their existing row leaves the
    // roster -- and therefore the unanimity denominator -- untouched, which is
    // the only thing that gate is protecting.
    const existing =
      (sessionKey ? roster.find((m) => m.sessionKey === sessionKey) : undefined) ??
      (userId ? roster.find((m) => m.userId === userId) : undefined);
    if (existing) return { code, sessionKey: existing.sessionKey };

    // The roster freezes the moment the room leaves the lobby: unanimity is
    // judged against the members who saw the deck, so a late joiner would
    // silently move the denominator mid-swipe.
    if (room.status !== "lobby") {
      throwUserError("ROOM_CLOSED", "This room has already started, so it is closed to new people.");
    }

    const trimmed = name.trim();
    if (!trimmed) throwUserError("FIELD_REQUIRED", "A first name is required.");

    if (roster.length >= MAX_ROOM_MEMBERS) {
      throwUserError(
        "ROOM_FULL",
        `This room is full. A room holds at most ${MAX_ROOM_MEMBERS} people.`,
      );
    }

    // The host's own capacity choice, not just the absolute ceiling above.
    // `headcount` is what every string on screen ("4 of 4 in") presents as
    // capacity, so a plan and a budget costed for four must actually stop
    // admitting people at four.
    if (roster.length >= room.headcount) {
      throwUserError(
        "ROOM_FULL",
        `This room is already at its planned size of ${room.headcount}.`,
      );
    }

    // An accountless guest arriving with no prior key is unrecognisable by
    // construction, and deliberately so: two friends both called Tam are
    // indistinguishable from one Tam joining twice, and a name-based identity
    // would merge two real people into one member -- silently dropping someone
    // from the roster, which is worse than an extra row someone can leave. They
    // get a fresh row; keeping the issued sessionKey and sending it back is the
    // client's job.
    const newKey = newSessionKey();
    await ctx.db.insert("members", {
      roomId: room._id,
      name: trimmed,
      userId: userId ?? undefined,
      isHost: false,
      sessionKey: newKey,
      joinedAt: Date.now(),
    });

    return { code, sessionKey: newKey };
  },
});

/**
 * The single subscription the product runs on. Everything reactive -- roster,
 * deck, swipe progress, match, plan, proposals, booking -- arrives here, so a
 * client needs no polling and no socket code of its own.
 *
 * Returns null rather than throwing on an unknown room or a stale session key:
 * a thrown query error would take down the React tree, and the honest response
 * to "I do not know you here" is to send them to /join.
 */
export const get = query({
  args: { code: v.string(), sessionKey: v.string() },
  returns: roomViewValidator,
  handler: async (ctx, { code, sessionKey }) => {
    const room = await findRoomByCode(ctx, code);
    if (!room) return null;

    const you = await findMember(ctx, room._id, sessionKey);
    if (!you) return null;

    const members = await ctx.db
      .query("members")
      .withIndex("by_room", (q) => q.eq("roomId", room._id))
      .collect();

    const quests = await ctx.db
      .query("quests")
      .withIndex("by_room_rank", (q) => q.eq("roomId", room._id))
      .order("asc")
      .collect();

    const swipes = await ctx.db
      .query("swipes")
      .withIndex("by_room_member", (q) => q.eq("roomId", room._id))
      .collect();

    // .first(), not .unique(), and deliberately so -- do not "tidy" this back.
    //
    // Nothing in the schema enforces one plan or one booking per room, and
    // .unique() THROWS when it finds two. A single duplicate row would make
    // this query throw on every subsequent read, and this query is the only
    // subscription the client has: that is not a bad read, it is a permanent
    // outage for that room with no way back. .first() downgrades the worst case
    // to "a stale row wins", which is recoverable. Tasks 10-13 upsert these
    // rows, but rooms.get must not depend on their discipline.
    const plan = await ctx.db
      .query("plans")
      .withIndex("by_room", (q) => q.eq("roomId", room._id))
      .first();

    const booking = await ctx.db
      .query("bookings")
      .withIndex("by_room", (q) => q.eq("roomId", room._id))
      .first();

    const openProposals = await ctx.db
      .query("proposals")
      .withIndex("by_room_status", (q) => q.eq("roomId", room._id).eq("status", "open"))
      .collect();

    const proposals = await Promise.all(
      openProposals.map(async (p) => {
        const votes = await ctx.db
          .query("proposalVotes")
          .withIndex("by_proposal", (q) => q.eq("proposalId", p._id))
          .collect();
        return {
          _id: p._id,
          stopId: p.stopId,
          replacement: p.replacement,
          reason: p.reason,
          proposedByName: members.find((m) => m._id === p.proposedBy)?.name ?? "Someone",
          yes: votes.filter((vote) => vote.vote === "yes").length,
          needed: needed(members.length),
          youVoted: votes.some((vote) => vote.memberId === you._id),
        };
      }),
    );

    const yourSwipes = swipes.filter((s) => s.memberId === you._id);

    // sessionKey is deliberately absent from every member projected here: it is
    // a capability, and one member must never be able to act as another.
    return {
      room: {
        _id: room._id,
        code: room.code,
        mood: room.mood,
        headcount: room.headcount,
        budgetPerHeadCents: room.budgetPerHeadCents,
        whenAt: room.whenAt,
        // Needed by plans.searchStop to bias the search. Not secret.
        centreLat: room.centreLat,
        centreLng: room.centreLng,
        radiusKm: room.radiusKm,
        visibility: room.visibility,
        status: room.status,
        matchedQuestId: room.matchedQuestId,
      },
      you: { _id: you._id, name: you.name, isHost: you.isHost },
      members: members.map((m) => ({ _id: m._id, name: m.name, isHost: m.isHost })),
      quests,
      plan: plan
        ? {
            _id: plan._id,
            stops: plan.stops,
            totalPerHeadCents: plan.totalPerHeadCents,
            // HONESTY. `plans.searchStop` and `plans.suggestStop` deliberately
            // never fabricate a $0 price, and `applyStopSwap` deliberately does
            // not refuse an expensive swap -- the group is allowed to decide to
            // overspend. This is what makes that decision an informed one. A $0
            // room is over budget the moment its plan costs anything, which is
            // correct and should show.
            overBudget: isOverBudget(plan.stops, room.budgetPerHeadCents),
            shareMessage: plan.shareMessage,
          }
        : null,
      booking,
      proposals,
      progress: {
        swipedByYou: yourSwipes.length,
        deckSize: quests.length,
        // Who the room is still waiting on, by name -- the presence signal.
        waitingOn: members
          .filter((m) => swipes.filter((s) => s.memberId === m._id).length < quests.length)
          .map((m) => m.name),
      },
    };
  },
});

export const openRooms = query({
  args: { mood: moodValidator },
  returns: v.array(
    v.object({
      code: v.string(),
      mood: moodValidator,
      headcount: v.number(),
      memberCount: v.number(),
      whenAt: v.number(),
      demo: v.boolean(),
    }),
  ),
  handler: async (ctx, { mood }) => {
    const rooms = await ctx.db
      .query("rooms")
      .withIndex("by_visibility_status", (q) => q.eq("visibility", "open").eq("status", "lobby"))
      .collect();

    const withCounts = await Promise.all(
      rooms
        .filter((r) => r.mood === mood)
        .map(async (r) => {
          const members = await ctx.db
            .query("members")
            .withIndex("by_room", (q) => q.eq("roomId", r._id))
            .collect();
          return {
            code: r.code,
            mood: r.mood,
            headcount: r.headcount,
            memberCount: members.length,
            whenAt: r.whenAt,
            demo: r.demo === true,
          };
        }),
    );

    // A room already at its planned size is a dead end on the one screen that
    // decides whether anyone reaches a room at all -- offering it only to
    // refuse the tap is worse than not offering it.
    return withCounts.filter((r) => r.memberCount < r.headcount);
  },
});

/**
 * Someone bails. Their swipes and their proposal votes go with them, because
 * unanimity and majority are both judged against the current roster -- a
 * departed member's "no" must not hold the room hostage. The host cannot leave:
 * the room is theirs, and an orphaned room has nobody to start the deck.
 *
 * Everything after the authorisation check is `detachMember`, which is shared
 * byte-for-byte with `removeMember` below and which re-decides the two things
 * the shrunken roster has just changed: every open proposal, and the match.
 */
export const leave = mutation({
  args: { code: v.string(), sessionKey: v.string() },
  returns: v.null(),
  handler: async (ctx, { code, sessionKey }): Promise<null> => {
    const room = await roomByCode(ctx, code);
    const member = await findMember(ctx, room._id, sessionKey);
    if (!member) return null; // already gone; leaving twice is not an error
    if (member.isHost) throwUserError("HOST_CANNOT_LEAVE", "The host cannot leave their own room.");

    await detachMember(ctx, member);
    return null;
  },
});

/**
 * The host's escape hatch: remove someone who cannot remove themselves.
 *
 * `rooms.join` deliberately gives an accountless guest with no prior key a
 * fresh row, because two friends both called Tam must not be merged into one
 * member. The cost is that a guest who submits `join` twice before their first
 * session key reaches their phone leaves behind a member row that NOBODY holds
 * the key for. That row cannot swipe and cannot `leave` -- and it is counted by
 * both match conditions and by every majority -- so the room waits on a person
 * who does not exist. The Global Constraint says the match can never deadlock,
 * so somebody has to be able to clear it, and the only person present who can
 * be trusted with that is the host.
 *
 * `memberId` is a TARGET, never a credential. The caller's authority comes from
 * their own `sessionKey`, and the row they name must belong to the room that
 * key is for -- otherwise a host of any room could delete a member of any other.
 */
export const removeMember = mutation({
  args: { code: v.string(), sessionKey: v.string(), memberId: v.id("members") },
  returns: v.null(),
  handler: async (ctx, { code, sessionKey, memberId }): Promise<null> => {
    const room = await roomByCode(ctx, code);
    const caller = await requireMember(ctx, room._id, sessionKey);
    if (!caller.isHost) {
      throwUserError("NOT_THE_HOST", "Only the host can remove someone from this room.");
    }

    const target = await ctx.db.get(memberId);
    if (!target || target.roomId !== room._id) {
      throwUserError("NOT_A_MEMBER", "That person is not in this room.");
    }
    // The host cannot remove themselves, for the same reason they cannot leave:
    // an orphaned room has nobody to start the deck. Covers the caller's own
    // row and any other host row, without trusting that there is exactly one.
    if (target.isHost) {
      throwUserError("HOST_CANNOT_LEAVE", "The host cannot remove themselves from their own room.");
    }

    // Exactly what `leave` does, because a member removed and a member departed
    // must leave the room in the same state. One implementation, so the two can
    // never drift.
    await detachMember(ctx, target);
    return null;
  },
});

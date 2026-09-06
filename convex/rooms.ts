import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { moodValidator } from "./schema";
import {
  findMember, findRoomByCode, needed, newRoomCode, newSessionKey, requireUserId, roomByCode, safeUserId,
} from "./lib/access";
import { throwUserError } from "./lib/errors";

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
  args: { code: v.string(), name: v.string() },
  handler: async (ctx, { code, name }) => {
    const room = await roomByCode(ctx, code);
    // The roster freezes the moment the room leaves the lobby: unanimity is
    // judged against the members who saw the deck, so a late joiner would
    // silently move the denominator mid-swipe.
    if (room.status !== "lobby") {
      throwUserError("ROOM_CLOSED", "This room has already started, so it is closed to new people.");
    }

    const trimmed = name.trim();
    if (!trimmed) throwUserError("FIELD_REQUIRED", "A first name is required.");

    // Signed-in users get their id attached; guests do not need one.
    const userId = await safeUserId(ctx);

    const sessionKey = newSessionKey();
    await ctx.db.insert("members", {
      roomId: room._id,
      name: trimmed,
      userId: userId ?? undefined,
      isHost: false,
      sessionKey,
      joinedAt: Date.now(),
    });

    return { code, sessionKey };
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

    const plan = await ctx.db
      .query("plans")
      .withIndex("by_room", (q) => q.eq("roomId", room._id))
      .unique();

    const booking = await ctx.db
      .query("bookings")
      .withIndex("by_room", (q) => q.eq("roomId", room._id))
      .unique();

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
  handler: async (ctx, { mood }) => {
    const rooms = await ctx.db
      .query("rooms")
      .withIndex("by_visibility_status", (q) => q.eq("visibility", "open").eq("status", "lobby"))
      .collect();

    return await Promise.all(
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
  },
});

/**
 * Someone bails. Their swipes go with them, because unanimity is judged against
 * the current roster -- a departed member's "no" must not hold the room hostage.
 * The host cannot leave: the room is theirs, and an orphaned room has nobody to
 * start the deck.
 */
export const leave = mutation({
  args: { code: v.string(), sessionKey: v.string() },
  handler: async (ctx, { code, sessionKey }): Promise<null> => {
    const room = await roomByCode(ctx, code);
    const member = await findMember(ctx, room._id, sessionKey);
    if (!member) return null; // already gone; leaving twice is not an error
    if (member.isHost) throwUserError("HOST_CANNOT_LEAVE", "The host cannot leave their own room.");

    const swipes = await ctx.db
      .query("swipes")
      .withIndex("by_room_member", (q) => q.eq("roomId", room._id).eq("memberId", member._id))
      .collect();
    for (const swipe of swipes) {
      await ctx.db.delete(swipe._id);
    }

    const votes = await ctx.db
      .query("proposalVotes")
      .withIndex("by_member", (q) => q.eq("memberId", member._id))
      .collect();
    for (const vote of votes) {
      await ctx.db.delete(vote._id);
    }

    await ctx.db.delete(member._id);

    // TODO(task 12): re-resolve any open proposal that can no longer reach a
    // majority of the shrunken roster.
    return null;
  },
});

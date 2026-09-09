import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { v } from "convex/values";
import schema from "./schema";
import { moodValidator, proposalKindValidator, stopValidator } from "./validators";
import {
  MAX_ROOM_MEMBERS,
  findMember, findRoomByCode, memberCount, needed, newRoomCode, newSessionKey, refuseIfBooked, requireLiveUserId, requireMember, roomByCode,
} from "./lib/rooms/access";
import type { Doc } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { throwUserError } from "./lib/errors";
import { authenticatedMutation, publicMutation, publicQuery } from "./lib/customFunctions";
import { notifyRoom } from "./lib/push/notify";
import { detachMember } from "./lib/rooms/roster";
import {
  DEFAULT_FINALIZE_RULE,
  DEFAULT_LOCK_RULE,
  type FinalizeRule,
  type LockRule,
  clearFinalizeVotes,
  finalizeRuleValidator,
  finalizeSecondsValidator,
  lockRuleValidator,
  swipeSecondsValidator,
  voteDeadlineAt,
  votesNeeded,
} from "./lib/rooms/rules";
import { isOverBudget } from "./lib/plans/stops";

const memberViewValidator = v.object({
  _id: v.id("members"),
  name: v.string(),
  isHost: v.boolean(),
  /**
   * The picture in this person's roundel, or null when there is none to draw.
   *
   * Resolved per read and never stored, for the reason the schema gives on
   * `profiles.avatarId`: a stored URL is a signed string that expires on its
   * own schedule with nothing here to notice. Null rather than absent, so the
   * roster branches on a value instead of on a missing key.
   */
  avatarUrl: v.union(v.string(), v.null()),
});

/**
 * One member's picture, by way of the account behind them.
 *
 * A guest row carries no `userId` -- `.index("by_user")` is sparse for exactly
 * that reason -- so a guest costs no reads at all and shows their initials. A
 * tombstoned profile is treated as no profile, the same ruling `profiles.me`
 * makes: an account in its deletion window is signed-out everywhere else, and
 * a face is the last thing that should outlive it.
 */
async function memberAvatarUrl(ctx: QueryCtx, userId: string | undefined) {
  if (!userId) return null;
  const profile = await ctx.db
    .query("profiles")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
  if (!profile || profile.deletedAt !== undefined || !profile.avatarId) return null;
  return await ctx.storage.getUrl(profile.avatarId);
}

const openRoomValidator = v.object({
  code: v.string(),
  mood: moodValidator,
  headcount: v.number(),
  memberCount: v.number(),
  whenAt: v.number(),
  demo: v.boolean(),
});

const DISCOVERY_PAGE_SIZE = 20;
const LEGACY_DISCOVERY_LIMIT = 100;

async function openRoomSummary(ctx: QueryCtx, room: Doc<"rooms">) {
  return {
    code: room.code,
    mood: room.mood,
    headcount: room.headcount,
    memberCount: await memberCount(ctx, room._id),
    whenAt: room.whenAt,
    demo: room.demo === true,
  };
}

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
      // A seeded room has to announce itself INSIDE the room, not only in the
      // funnel that offered it. `openRooms` labels a demo room honestly and
      // then the label used to vanish at the door -- which is precisely where
      // someone starts believing the roster, the venues and the booking are
      // real. Projected as a plain boolean (the column is optional) so every
      // screen in the room can say so.
      demo: v.boolean(),
      status: v.union(
        v.literal("lobby"),
        v.literal("building"),
        v.literal("swiping"),
        v.literal("matched"),
        v.literal("booked"),
      ),
      matchedQuestId: v.optional(v.id("quests")),
      // The host's three house rules, projected as concrete values rather
      // than as the optional columns they are stored in: every screen that
      // draws them needs a number and a rule, not a maybe.
      swipeSeconds: v.number(),
      finalizeRule: finalizeRuleValidator,
      finalizeSeconds: v.number(),
      lockRule: lockRuleValidator,
    }),
    /**
     * The open vote to settle the night, or the empty shape of one.
     *
     * Projected for every room, including the ones whose rule needs no vote,
     * so the screen never has to decide whether this field exists before it
     * can read it. Under "anyone" and "host" the threshold is one person and
     * nothing is ever recorded, which reads correctly: nobody has voted, and
     * one vote is what it takes.
     */
    finalize: v.object({
      votes: v.number(),
      needed: v.number(),
      youVoted: v.boolean(),
      // Names, like `waitingOn` and like a stop's `lockedBy`. The screen shows
      // who is already in so the room knows who it is waiting on.
      voters: v.array(v.string()),
      // When the window runs out, or null when there is no open vote or no
      // deadline at all. The clock is the client's: this is the instant, not a
      // remaining count, so a phone that was asleep works out the truth rather
      // than resuming a stale countdown.
      deadlineAt: v.union(v.number(), v.null()),
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
        // What the room is being asked to agree to. Concrete here even though
        // the column is optional: the screen draws a different card for each,
        // and "absent means swap" is a rule the backend already applies once,
        // in `settleProposal`, and should not be teaching the client as well.
        kind: proposalKindValidator,
        // Null on a lock or an unlock, which replaces nothing. `kind` is what
        // says which -- a reader must never work it out from this being null,
        // because the two would disagree the first time one of them changed.
        replacement: v.union(stopValidator, v.null()),
        reason: v.string(),
        proposedByName: v.string(),
        yes: v.number(),
        needed: v.number(),
        // WHICH way you voted, not merely that you did. `proposals.vote` takes
        // `yes | no` and patches an existing row -- "changing your mind is a
        // patch, never a second yes" -- so a boolean showed a member who voted
        // no exactly what it showed a member who had not voted at all, and
        // gave a mis-tap on a group decision no way back. `null` is "you have
        // not voted".
        yourVote: v.union(v.literal("yes"), v.literal("no"), v.null()),
      }),
    ),
    progress: v.object({
      swipedByYou: v.number(),
      deckSize: v.number(),
      waitingOn: v.array(v.string()),
    }),
  }),
);

export const create = authenticatedMutation({
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
    // Live, not merely signed in: a deleted account must not be able to become
    // the host of a new room that would outlive its own profile.
    const userId = await requireLiveUserId(ctx);

    // A night that has already started is not a plan, and nothing anywhere
    // refused one before this: `whenAt` arrived as a bare `v.number()` and was
    // stored. It is not only a hand-typed time that gets here either -- the
    // preset path resolves "Tonight" to 6:30pm TODAY, so tapping it at 11pm
    // produced a room five hours in the past, and then showed that time to
    // everyone who joined. The client says the same sentence sooner; this is
    // the rule.
    if (args.whenAt <= Date.now()) {
      throwUserError("WHEN_IN_THE_PAST", "That time has already passed. Pick a later time.");
    }

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
      swipeCount: 0,
    });

    return { code, sessionKey };
  },
});

export const join = publicMutation({
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
    const userId = ctx.userId;

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
    // A seeded demo room is created with an EMPTY roster precisely so its host
    // seat is claimable, and the first person through the door takes it.
    //
    // Without this the demo rooms are dead ends: `deck.build` is host-only, and
    // a room whose host seat belongs to a session key nobody holds can never
    // start. This is deliberately not a general "promote someone when the host
    // is missing" rule -- `rooms.create` always writes a host, so the only
    // rooms that can reach here with an empty roster are the seeded ones, and
    // narrowing it to `demo` keeps it that way rather than leaving a path by
    // which a real room's host seat could ever change hands.
    //
    // Claiming the seat does not launder the room: `demo` stays true, so every
    // screen keeps saying this is demonstration data.
    const claimsHostSeat = room.demo === true && roster.length === 0;

    const newKey = newSessionKey();
    const memberId = await ctx.db.insert("members", {
      roomId: room._id,
      name: trimmed,
      userId: userId ?? undefined,
      isHost: claimsHostSeat,
      sessionKey: newKey,
      joinedAt: Date.now(),
      swipeCount: 0,
    });

    // Only a genuinely NEW seat, which is why this sits here and not at the top
    // of the handler: the re-entry path above returns before ever reaching it.
    // A refresh, a double-tap or the host typing their own code is not somebody
    // joining, and telling a room it has "another person in it" every time
    // anyone reloads would make the whole feature something people turn off.
    const joiner = await ctx.db.get(memberId);
    await notifyRoom(ctx, room._id, "joined", joiner);

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
export const get = publicQuery({
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

    // THIS MEMBER'S ROWS ONLY. It used to be the whole room's -- 96 rows at the
    // twelve-member ceiling -- and every one of them was read to produce two
    // numbers that never looked at `dir` or `questId`. This query re-runs on
    // every write in the room, roughly 1150 times over a full session, so that
    // was 96 documents fetched about 1150 times to count to nine.
    //
    // Everyone else's count now comes off their own member row, which the
    // roster read above already has in hand. `lib/rooms/match.ts` writes it,
    // from these same rows, in the transaction that changes them. See the
    // schema comment on `members.swipeCount`.
    const yourSwipes = await ctx.db
      .query("swipes")
      .withIndex("by_room_member", (q) =>
        q.eq("roomId", room._id).eq("memberId", you._id),
      )
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
          // The same `?? "swap"` the backend applies: rows written before a
          // lock could be voted on carry no kind and are swaps by definition.
          kind: p.kind ?? "swap",
          replacement: p.replacement ?? null,
          reason: p.reason,
          proposedByName: members.find((m) => m._id === p.proposedBy)?.name ?? "Someone",
          yes: votes.filter((vote) => vote.vote === "yes").length,
          needed: needed(members.length),
          // One row per member is `proposals.vote`'s own invariant, so the
          // first match IS this member's vote.
          yourVote: votes.find((vote) => vote.memberId === you._id)?.vote ?? null,
        };
      }),
    );

    // Bounded by `MAX_ROOM_MEMBERS`, and most rooms are guests who cost nothing
    // here. Keyed by member rather than by account so `you` reads out of the
    // same map as everybody else and the two cannot disagree.
    const avatars = new Map(
      await Promise.all(
        members.map(async (m) => [m._id, await memberAvatarUrl(ctx, m.userId)] as const),
      ),
    );

    const finalizeRule = room.finalizeRule ?? DEFAULT_FINALIZE_RULE;
    const finalizeSeconds = room.finalizeSeconds ?? 0;
    const finalizeVotes = await ctx.db
      .query("finalizeVotes")
      .withIndex("by_room", (q) => q.eq("roomId", room._id))
      .collect();

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
        // Optional in the schema, never optional on screen: an unseeded room
        // is honestly `false`, and the room's own screens say so when it is
        // `true`.
        demo: room.demo === true,
        status: room.status,
        matchedQuestId: room.matchedQuestId,
        // Absent is off, and off is what every room opened before the host
        // could set a timer has.
        swipeSeconds: room.swipeSeconds ?? 0,
        finalizeRule,
        finalizeSeconds,
        lockRule: room.lockRule ?? DEFAULT_LOCK_RULE,
      },
      finalize: {
        votes: finalizeVotes.length,
        needed: votesNeeded(finalizeRule, members.length),
        youVoted: finalizeVotes.some((vote) => vote.memberId === you._id),
        // Members who have left took their votes with them, so a vote row
        // without a member row cannot happen -- but the join is written to
        // survive one rather than to print "undefined" if it ever does.
        voters: finalizeVotes
          .map((vote) => members.find((m) => m._id === vote.memberId)?.name)
          .filter((name): name is string => name !== undefined),
        // Deliberately NOT zeroed out here when the window has already run out.
        // A query does not re-run because time passed, so a server that
        // decided "lapsed" at read time would keep saying whatever was true
        // when the last write happened. The instant is the honest thing to
        // hand over; the screen counts it down and `bookings.confirm` clears
        // the votes on the next tap.
        deadlineAt: voteDeadlineAt(room.finalizeStartedAt, finalizeSeconds),
      },
      you: { _id: you._id, name: you.name, isHost: you.isHost, avatarUrl: avatars.get(you._id) ?? null },
      members: members.map((m) => ({
        _id: m._id,
        name: m.name,
        isHost: m.isHost,
        avatarUrl: avatars.get(m._id) ?? null,
      })),
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
        // Who the room is still waiting on, by name.
        //
        // NOT a presence signal, whatever the old comment here said: it names
        // people who have not finished the deck, and somebody who shut their
        // laptop is indistinguishable in it from somebody still deciding.
        // `convex/presence.ts` answers the other question, separately, and
        // never feeds this one.
        //
        // `?? 0` covers a seat written before `swipeCount` existed and not yet
        // backfilled, which reads as "has not started" -- the same thing the
        // old row count said about a member with no rows.
        waitingOn: members
          .filter((m) => (m.swipeCount ?? 0) < quests.length)
          .map((m) => m.name),
      },
    };
  },
});

export const openRooms = publicQuery({
  args: { mood: moodValidator },
  returns: v.array(openRoomValidator),
  handler: async (ctx, { mood }) => {
    const rooms = await ctx.db
      .query("rooms")
      .withIndex("by_visibility_status_mood", (q) =>
        q.eq("visibility", "open").eq("status", "lobby").eq("mood", mood),
      )
      .take(LEGACY_DISCOVERY_LIMIT + 1);

    if (rooms.length > LEGACY_DISCOVERY_LIMIT) {
      throwUserError(
        "DISCOVERY_LIMIT",
        `There are more than ${LEGACY_DISCOVERY_LIMIT} open rooms for this mood. Please try again later.`,
      );
    }

    const withCounts = await Promise.all(rooms.map((room) => openRoomSummary(ctx, room)));

    // A room already at its planned size is a dead end on the one screen that
    // decides whether anyone reaches a room at all -- offering it only to
    // refuse the tap is worse than not offering it.
    return withCounts.filter((r) => r.memberCount < r.headcount);
  },
});

/**
 * The bounded replacement for the lobby's legacy all-at-once read. The index
 * removes private, started, and wrong-mood rooms before pagination; full rooms
 * are filtered after each page because their member count is live data.
 */
export const openRoomsPage = publicQuery({
  args: { mood: moodValidator, paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(openRoomValidator),
  handler: async (ctx, { mood, paginationOpts }) => {
    if (paginationOpts.numItems > DISCOVERY_PAGE_SIZE) {
      throwUserError(
        "DISCOVERY_LIMIT",
        `Lobby pages support at most ${DISCOVERY_PAGE_SIZE} rooms.`,
      );
    }

    const page = await ctx.db
      .query("rooms")
      .withIndex("by_visibility_status_mood", (q) =>
        q.eq("visibility", "open").eq("status", "lobby").eq("mood", mood),
      )
      .paginate(paginationOpts);
    const rooms = await Promise.all(page.page.map((room) => openRoomSummary(ctx, room)));

    return {
      ...page,
      page: rooms.filter((room) => room.memberCount < room.headcount),
    };
  },
});

/**
 * The host's three house rules: how long a card stays up, who settles the
 * night, and whether locking a stop is a tap or a vote.
 *
 * One mutation for all of them, because they are one decision made in one
 * place -- the
 * lobby, before anyone is looking at a card -- and because a second copy of the
 * host check is a second place for it to be got wrong.
 *
 * Host is read off the member row this session key resolves to. There is no
 * `hostSessionKey` argument and no `isHost` argument: the client saying it is
 * the host is not evidence that it is.
 *
 * Every field is optional and only the ones that arrive are written, so the
 * lobby's three controls can each move on their own without sending the other
 * two back at whatever value that phone last rendered.
 */
export const setRules = publicMutation({
  args: {
    code: v.string(),
    sessionKey: v.string(),
    swipeSeconds: v.optional(swipeSecondsValidator),
    finalizeRule: v.optional(finalizeRuleValidator),
    finalizeSeconds: v.optional(finalizeSecondsValidator),
    lockRule: v.optional(lockRuleValidator),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const room = await roomByCode(ctx, args.code);
    // After requireMember, so a stranger is told they are a stranger rather
    // than being told who the host of a room they are not in is.
    const caller = await requireMember(ctx, room._id, args.sessionKey);
    if (!caller.isHost) {
      throwUserError("NOT_THE_HOST", "Only the host can change the rules of this room.");
    }
    // A booked night is frozen, and that includes the rule that settled it.
    refuseIfBooked(room);

    const patch: {
      swipeSeconds?: number;
      finalizeRule?: FinalizeRule;
      finalizeSeconds?: number;
      finalizeStartedAt?: undefined;
      lockRule?: LockRule;
    } = {};
    if (args.swipeSeconds !== undefined) patch.swipeSeconds = args.swipeSeconds;
    if (args.finalizeRule !== undefined) patch.finalizeRule = args.finalizeRule;
    if (args.finalizeSeconds !== undefined) patch.finalizeSeconds = args.finalizeSeconds;
    if (args.lockRule !== undefined) patch.lockRule = args.lockRule;

    // Turning the vote OFF closes the votes it was running.
    //
    // A lock proposal is a question the room can only be asked under one rule.
    // Left open across the switch it outlives its own premise: the stop becomes
    // tappable, somebody locks and unlocks it, and then a late yes on the
    // orphaned proposal re-locks a stop the room has since deliberately let go
    // -- under a rule that says a lock is a tap, decided by a vote nobody is
    // still running. `applyProposal` refuses to rewrite a stop already in the
    // asked-for state, which stops the attribution being stolen, but it cannot
    // tell a stale question from a live one. This can.
    //
    // Closed as rejected, not deleted, for the reason `resolveOpenProposals`
    // closes an unappliable one that way: a proposal that vanishes is one
    // nobody can see was decided.
    if (args.lockRule !== undefined && args.lockRule !== (room.lockRule ?? DEFAULT_LOCK_RULE)) {
      const open = await ctx.db
        .query("proposals")
        .withIndex("by_room_status", (q) => q.eq("roomId", room._id).eq("status", "open"))
        .collect();
      for (const proposal of open) {
        if (proposal.kind === "lock" || proposal.kind === "unlock") {
          await ctx.db.patch(proposal._id, { status: "rejected" });
        }
      }
    }

    // Changing either half of the vote throws away the votes already cast.
    //
    // A yes is consent to a specific question, and "should we book this?" under
    // "everyone agrees" is not the same question as it is under "most of you
    // do". Keeping the tally would let a host turn two yeses out of four into a
    // booking by moving the threshold under them, which is the one thing a vote
    // exists to stop.
    const rulesMoved =
      (args.finalizeRule !== undefined && args.finalizeRule !== (room.finalizeRule ?? DEFAULT_FINALIZE_RULE)) ||
      (args.finalizeSeconds !== undefined && args.finalizeSeconds !== (room.finalizeSeconds ?? 0));
    if (rulesMoved) {
      await clearFinalizeVotes(ctx, room._id);
      patch.finalizeStartedAt = undefined;
    }

    await ctx.db.patch(room._id, patch);
    return null;
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
export const leave = publicMutation({
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
export const removeMember = publicMutation({
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

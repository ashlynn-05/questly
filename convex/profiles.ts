import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import schema from "./schema";
import { answerValidator, moodValidator } from "./validators";
import { isProviderReservationError, throwUserError } from "./lib/errors";
import {
  authenticatedAction,
  authenticatedMutation,
  publicQuery,
} from "./lib/customFunctions";
import { CARD_IDS, GOAL_IDS, moodAffinity, tasteSentence, type QuizAnswers } from "./lib/quiz";
import { AVATAR_TYPES, MAX_AVATAR_BYTES, MAX_AVATAR_MB } from "./lib/avatar";

// The 1536-float vector never goes to the browser -- this validator is what
// makes that a type error, not just a habit, if a future edit forgets to strip it.
//
// `deletedAt` is omitted for a different reason: it is never anything but
// `undefined` here, because `me` refuses to return a tombstoned profile at all.
// Projecting a field whose only possible value is "absent" would invite a caller
// to branch on it and get the answer wrong -- the tombstone is read through
// `account.deletionStatus`, which is the one function that knows about it.
//
// `avatarId` is omitted and `avatarUrl` added in its place: the id is a handle
// only this backend can do anything with, and the URL is what an <img> needs.
// Resolved per read rather than stored, so it can never be a stale signed
// string sitting in a row (see the schema note on the field).
const publicProfileValidator = v.object({
  ...schema.doc("profiles").omit("tasteVector", "deletedAt", "avatarId").fields,
  avatarUrl: v.union(v.string(), v.null()),
});

/**
 * A room as the settings screen lists it. Deliberately none of the commercial
 * or planning detail `rooms.get` carries: this is a way back into a room you
 * are already in, not a second view of it.
 */
const myRoomValidator = v.object({
  code: v.string(),
  mood: moodValidator,
  status: v.union(
    v.literal("lobby"),
    v.literal("building"),
    v.literal("swiping"),
    v.literal("matched"),
    v.literal("booked"),
  ),
  whenAt: v.number(),
  isHost: v.boolean(),
  demo: v.boolean(),
});

/**
 * A ceiling on "your rooms", so the query cannot become a scan.
 *
 * Both halves of it are bounded independently and then merged, because either
 * index could in principle be the long one: a demo account that has hosted
 * hundreds of rooms, or a regular who has been invited into hundreds. Somebody
 * past this many rooms is not served by a longer list anyway -- they are served
 * by the room code they were sent.
 */
const MAX_MY_ROOMS = 24;

/** A display name is one line of a person's own choosing, not an identity claim. */
const MAX_DISPLAY_NAME = 40;

export const me = publicQuery({
  args: {},
  returns: v.union(v.null(), publicProfileValidator),
  handler: async (ctx) => {
    const userId = ctx.userId;
    if (!userId) return null;

    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    if (!profile) return null;

    // A deleted account has no profile, as far as the rest of the product is
    // concerned. Saying so HERE, once, is what keeps every other screen out of
    // it: `/start` resumes a returning host straight to the mood step on the
    // strength of this query alone, and a tombstoned profile answering it would
    // hand a deleted account back its old taste vector. The tombstone itself is
    // readable -- through `account.deletionStatus`, whose whole job is to be the
    // one function that admits the row is still there.
    if (profile.deletedAt !== undefined) return null;

    // The 1536-float vector never goes to the browser; `deletedAt` is `undefined`
    // by the line above and is not projected either.
    const { tasteVector: _vector, deletedAt: _deletedAt, avatarId, ...rest } = profile;
    // `getUrl` returns null for an id whose file is gone -- a purge, a failed
    // upload -- and the screen already draws initials when there is no picture,
    // so that is a state it handles rather than an error worth throwing at
    // somebody opening their own settings.
    return { ...rest, avatarUrl: avatarId ? await ctx.storage.getUrl(avatarId) : null };
  },
});

/**
 * Internal: `userId` here is not a trust boundary crossing, because the only
 * caller is `saveQuiz` below, which has already derived it from the
 * authenticated identity. Nothing else may call this, and it must stay
 * internal so nothing else can.
 */
export const write = internalMutation({
  args: {
    userId: v.string(),
    displayName: v.string(),
    tasteVector: v.array(v.float64()),
    tasteSentence: v.string(),
    moodAffinity: v.record(v.string(), v.number()),
    goals: v.optional(v.array(v.string())),
    answers: v.optional(v.record(v.string(), answerValidator)),
  },
  returns: v.id("profiles"),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("profiles")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .unique();
    if (existing) {
      // A name the person chose on `/settings` outlives a retake of the quiz.
      //
      // `saveQuiz` derives `displayName` from the authenticated identity, which
      // is right for the FIRST write -- there is nothing else to go on -- and
      // wrong for every one after it: a retake would silently undo a rename,
      // and the person would have no way to tell why. So the derived name only
      // seeds the row, and `renameMe` owns it from then on.
      const { displayName: _derivedName, ...rest } = args;
      await ctx.db.patch(existing._id, {
        ...rest,
        // Finishing the quiz again is itself a restore: somebody who deleted
        // their account, signed back in and answered the cards has plainly not
        // left. Clearing the tombstone here means there is no second path that
        // could write a live profile while leaving it marked for the purge.
        deletedAt: undefined,
      });
      return existing._id;
    }
    return await ctx.db.insert("profiles", { ...args, createdAt: Date.now() });
  },
});

export const saveQuiz = authenticatedAction({
  args: {
    answers: v.record(v.string(), answerValidator),
    goals: v.array(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    // displayName is never accepted as an argument: a client-supplied name is
    // trivially spoofable, and a roomful of members all claiming the same name
    // is exactly the confusion this field exists to prevent. It is derived
    // here, from the authenticated identity, or not at all.
    const userId = ctx.userId;
    const identity = await ctx.auth.getUserIdentity();
    const displayName = identity?.name?.trim() || identity?.email?.trim() || "Explorer";

    // Both halves of the quiz are checked against the set the product actually
    // offers. The goals check has always been here; the answers check is new,
    // and is what stops an arbitrary key reaching a stored column that
    // `/settings` renders back to the person as "what you said".
    for (const cardId of Object.keys(args.answers)) {
      if (!CARD_IDS.has(cardId)) {
        throwUserError("INVALID_ANSWER", `"${cardId}" is not one of the cards in the quiz.`);
      }
    }

    for (const goal of args.goals) {
      if (!GOAL_IDS.has(goal)) {
        throwUserError("INVALID_GOAL", `"${goal}" is not one of the goals on offer.`);
      }
    }

    const sentence = tasteSentence(args.answers as QuizAnswers, args.goals);

    // The one OpenAI call in the product with no fallback, on the one screen
    // where every failure costs a signup. It used to let a plain `Error` out,
    // so an OpenAI outage ended onboarding at "Server Error" with no way past
    // it -- a new user could not finish signing up because a third party was
    // down.
    //
    // An empty vector is a real, already-handled state rather than a broken
    // one: `deck.blend` skips profiles with no vector and `scoring.cosine`
    // returns 0 for an absent one, so the deck falls back to ranking on budget,
    // distance, mood and partner tier -- which is exactly what a guest gets.
    // The quiz answers, the taste sentence and the goals are all still stored,
    // so re-running the quiz later fills the vector in. Never silently, though:
    // a permanent outage would otherwise turn personalisation off for every new
    // user with nothing in the logs to say when it stopped.
    let embedding: number[] = [];
    try {
      embedding = await ctx.runAction(internal.ai.embeddings.embedText, { text: sentence });
    } catch (error) {
      if (isProviderReservationError(error)) throw error;
      console.warn(
        "profiles.saveQuiz: no taste vector for this profile; saving the quiz without one.",
        error,
      );
    }

    await ctx.runMutation(internal.profiles.write, {
      userId,
      displayName,
      tasteVector: embedding,
      tasteSentence: sentence,
      moodAffinity: moodAffinity(args.answers as QuizAnswers),
      goals: args.goals,
      // Stored as well as summed, so the answers can be shown back and changed.
      // The derived fields above are all one-way.
      answers: args.answers,
    });
    return null;
  },
});

/**
 * Rename yourself.
 *
 * This is NOT the exception to the rule `saveQuiz` states forty lines above.
 * That rule refuses a client-supplied `displayName` because it would be a claim
 * about WHO IS SPEAKING, made on the one screen whose output lands in a room
 * full of other people -- and a roomful of members all claiming one name is the
 * confusion the field exists to prevent. Here the user id is still derived
 * server-side and the row written is still only their own; the name is a
 * preference about themselves, not an assertion about their identity. The name
 * a room actually shows is `members.name`, typed per room at the door, and
 * nothing here touches it.
 *
 * Only the profile is written, and Better Auth's own `user.name` is left alone.
 * It seeds `displayName` on the first `saveQuiz` and has no further say -- which
 * is why `profiles.write` stops overwriting the name on later writes. Two
 * sources of truth for one string, kept in sync by hand, is the drift this
 * avoids rather than invites.
 */
export const renameMe = authenticatedMutation({
  args: { displayName: v.string() },
  returns: v.null(),
  handler: async (ctx, { displayName }): Promise<null> => {
    const userId = ctx.userId;

    const name = displayName.trim();
    if (!name) throwUserError("NAME_REQUIRED", "A name is required.");
    if (name.length > MAX_DISPLAY_NAME) {
      throwUserError(
        "NAME_REQUIRED",
        `A name can be at most ${MAX_DISPLAY_NAME} characters.`,
      );
    }

    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    // No profile yet means the quiz has not been finished, and there is nothing
    // to rename. Silent rather than an error: the settings screen only offers
    // the field to somebody who has one, so reaching here is a race (two tabs,
    // one of them deleting) and not something to shout about.
    if (!profile || profile.deletedAt !== undefined) return null;

    await ctx.db.patch(profile._id, { displayName: name });
    return null;
  },
});

/**
 * Step one of two for a new avatar: a URL the browser may POST the bytes to.
 *
 * The file never passes through a Convex function. That is not an optimisation
 * -- a mutation cannot receive a multi-megabyte argument, and an action that
 * relayed the bytes would double the transfer and put the upload inside our own
 * execution budget. The browser posts straight to storage, gets an id back, and
 * `setAvatar` below is what makes that id mean anything.
 *
 * Requires an account, so an anonymous caller cannot mint upload URLs and use
 * this deployment's storage as their own. Nothing is written here: an upload
 * that is started and abandoned leaves an orphan file and no row pointing at
 * it, which is the right way round -- the alternative is a row pointing at a
 * file that never arrived.
 */
export const generateAvatarUploadUrl = authenticatedMutation({
  args: {},
  returns: v.string(),
  handler: async (ctx): Promise<string> => {
    return await ctx.storage.generateUploadUrl();
  },
});

/**
 * Step two: adopt an uploaded file as this account's picture.
 *
 * `storageId` is a TARGET, not a credential -- the same shape, and the same
 * reasoning, as `rooms.removeMember`'s `memberId`. The caller's authority comes
 * from their own session; the id only says which file they just uploaded.
 *
 * The metadata check is the real gate. `_storage` records the type and size the
 * upload actually had, so this refuses an SVG (an image by MIME, and a
 * script-execution surface) and a file over the ceiling AFTER the bytes landed
 * -- the browser-side check in `convex/lib/avatar.ts` is a courtesy that saves a
 * pointless upload, not a rule, because anything the browser enforces the
 * browser can also skip. An upload that declared NO type is refused too: a
 * missing Content-Type is exactly how somebody would try to walk an SVG past a
 * list of allowed ones.
 *
 * ORDER MATTERS, and not for tidiness. The checks run cheapest-and-most-
 * fundamental first -- is there an account to attach this to, then is the file
 * acceptable -- because only the first of those can clean up after itself. A
 * mutation is a transaction: `throwUserError` rolls back everything the handler
 * did, INCLUDING a `ctx.storage.delete`, so deleting-then-throwing deletes
 * nothing and only reads as though it does. The no-account path returns instead
 * of throwing, so its delete commits. The refusal paths leave the file behind,
 * which is honest about what a transaction can do, and no worse than the orphan
 * anybody can already create by calling `generateAvatarUploadUrl` and never
 * following it with this. Sweeping those needs a scheduled job over `_storage`
 * and is a follow-up, not something to fake here.
 */
export const setAvatar = authenticatedMutation({
  args: { storageId: v.id("_storage") },
  returns: v.null(),
  handler: async (ctx, { storageId }): Promise<null> => {
    const userId = ctx.userId;

    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    // Nothing to hang it on. Returning rather than throwing is what lets this
    // delete actually commit -- see the ordering note above.
    if (!profile || profile.deletedAt !== undefined) {
      await ctx.storage.delete(storageId);
      return null;
    }

    const uploaded = await ctx.db.system.get(storageId);
    if (!uploaded) {
      throwUserError("AVATAR_MISSING", "That upload did not finish. Please try again.");
    }
    if (!AVATAR_TYPES.includes(uploaded.contentType ?? "")) {
      throwUserError("AVATAR_TYPE", "A picture has to be a PNG, JPEG, WebP or GIF.");
    }
    if (uploaded.size > MAX_AVATAR_BYTES) {
      throwUserError("AVATAR_SIZE", `A picture has to be under ${MAX_AVATAR_MB}MB.`);
    }

    const previous = profile.avatarId;
    await ctx.db.patch(profile._id, { avatarId: storageId });
    // Deleted only after the row points somewhere else, so a failure between
    // the two leaves an orphan file rather than a roundel pointing at nothing.
    if (previous) await ctx.storage.delete(previous);
    return null;
  },
});

/** Back to initials, and the bytes go with it. */
export const clearAvatar = authenticatedMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx): Promise<null> => {
    const userId = ctx.userId;

    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    if (!profile?.avatarId) return null;

    const previous = profile.avatarId;
    await ctx.db.patch(profile._id, { avatarId: undefined });
    await ctx.storage.delete(previous);
    return null;
  },
});

/**
 * The rooms this account can get back into.
 *
 * The gap this closes: a room lives at `/room/<code>` behind a `sessionKey` held
 * in this browser's storage, and nothing else in the product could list them.
 * Clear the storage -- a new phone, a cleared cache, a browser that refuses to
 * persist -- and your own room was unreachable unless you remembered four
 * digits. `rooms.join` has always been able to recognise a signed-in member by
 * `userId` and hand back the same seat (`convex/rooms.ts`), so the way back
 * existed; there was just nothing that could say which door to knock on.
 *
 * Two indexes because there are two ways to belong: you opened it, or you were
 * let in. Both are `.take()`-bounded rather than collected -- these tables grow
 * with every room and every guest the product has ever had.
 */
export const myRooms = publicQuery({
  args: {},
  returns: v.array(myRoomValidator),
  handler: async (ctx) => {
    const userId = ctx.userId;
    if (!userId) return [];

    const hosted = await ctx.db
      .query("rooms")
      .withIndex("by_host", (q) => q.eq("hostUserId", userId))
      .take(MAX_MY_ROOMS);

    const seats = await ctx.db
      .query("members")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .take(MAX_MY_ROOMS);

    // Keyed by room id, so a host -- who is both the room's `hostUserId` AND a
    // member row in it -- appears once. The hosted rooms go in first, because
    // that is the half that knows `isHost` without reading anything else.
    const byId = new Map<string, { room: (typeof hosted)[number]; isHost: boolean }>();
    for (const room of hosted) byId.set(room._id, { room, isHost: true });

    for (const seat of seats) {
      if (byId.has(seat.roomId)) continue;
      const room = await ctx.db.get(seat.roomId);
      // A seat whose room is gone is not an error worth throwing at somebody
      // looking at a list of their nights; it is simply not a room to show.
      if (room) byId.set(room._id, { room, isHost: seat.isHost });
    }

    return Array.from(byId.values())
      // The night furthest in the future first: what is still to come is what
      // somebody opening this list is looking for.
      .sort((a, b) => b.room.whenAt - a.room.whenAt)
      .slice(0, MAX_MY_ROOMS)
      .map(({ room, isHost }) => ({
        code: room.code,
        mood: room.mood,
        status: room.status,
        whenAt: room.whenAt,
        isHost,
        // Projected as a plain boolean (the column is optional) for the same
        // reason `rooms.get` does it: a seeded room announces itself as seeded
        // everywhere it is shown, this list included.
        demo: room.demo === true,
      }));
  },
});

import { v } from "convex/values";
import { Presence } from "@convex-dev/presence";
import { components } from "./_generated/api";
import { mutation } from "./_generated/server";
import { publicMutation, publicQuery } from "./lib/customFunctions";
import { requireMember, roomByCode } from "./lib/rooms/access";

/**
 * Who has the room open right now.
 *
 * THIS IS DISPLAY-ONLY, AND THAT IS THE WHOLE DESIGN. It never feeds
 * `waitingOn`, never feeds `everyoneDone`, and never feeds a threshold of any
 * kind. The room's denominator is the roster, deliberately: a group that
 * matches because somebody's phone slept is a group that gets sent to a bar
 * nobody agreed on, and every guarantee in `lib/rooms/match.ts` is written
 * against a denominator that cannot move on its own.
 *
 * What it adds is the thing `waitingOn` genuinely cannot say. "Waiting on Sam"
 * looks identical whether Sam is still deciding or Sam closed the tab twenty
 * minutes ago, and the group has no way to tell which. A greyed-out face says.
 *
 * Keyed on the member row rather than the account, so guests are covered and a
 * face maps straight back to a roster entry.
 */
export const presence = new Presence(components.presence);

/**
 * How long a phone may go quiet before it is presumed gone.
 *
 * Server-side, not a client argument. The component disconnects at 2.5x this,
 * so a client that could name its own interval could keep its own face lit
 * indefinitely -- and this is a signal about somebody else's attention, which
 * makes it exactly the wrong thing to let a client assert about itself.
 */
const HEARTBEAT_MS = 10_000;

export const heartbeat = publicMutation({
  args: {
    code: v.string(),
    sessionKey: v.string(),
    // Per TAB, not per browser: `sessionKey` is the member's capability and is
    // shared by every tab it is open in, so using it here would let closing one
    // tab mark the other one away.
    sessionId: v.string(),
  },
  returns: v.object({ roomToken: v.string(), sessionToken: v.string() }),
  handler: async (ctx, { code, sessionKey, sessionId }) => {
    const room = await roomByCode(ctx, code);
    // Same authorisation as every other room mutation, for the same reason: no
    // member id is accepted from the client, so nobody can light up a face
    // that is not theirs.
    const member = await requireMember(ctx, room._id, sessionKey);
    return await presence.heartbeat(ctx, room._id, member._id, sessionId, HEARTBEAT_MS);
  },
});

/**
 * The room token already proves the caller heartbeat into this room, and the
 * component's own guidance is to add no per-user reads here so every
 * subscriber in the room shares one cached result. That is also why this is
 * its own subscription rather than another field on `rooms.get`: folding it in
 * would re-run that query on every heartbeat in the room, which is exactly the
 * read amplification the rest of this change removes.
 *
 * The trade that buys the shared cache: the component mints one token per room
 * and never rotates it, so unlike every other room query this does not
 * re-check membership on each read, and somebody the host removed can keep
 * subscribing with the token they already hold. What they see is member ids
 * and booleans -- no names, no room contents -- which is why this is the side
 * of the trade worth taking.
 */
export const list = publicQuery({
  args: { roomToken: v.string() },
  returns: v.array(
    v.object({
      userId: v.string(),
      online: v.boolean(),
      lastDisconnected: v.number(),
      data: v.optional(v.any()),
    }),
  ),
  handler: async (ctx, { roomToken }) => await presence.list(ctx, roomToken),
});

/**
 * Plain `mutation`, not `publicMutation`: the session token IS the
 * authorisation here. It was minted by that session's own heartbeat and grants
 * nothing but marking that one session away, so there is no identity left for
 * the wrapper to establish.
 *
 * Best effort, and the timeout is the real backstop. The client fires this
 * from `pagehide`, over the same websocket everything else uses, and a tab
 * being closed is not obliged to finish sending it. When it does land the face
 * greys out immediately; when it does not, the missed heartbeats do it 25
 * seconds later.
 */
export const disconnect = mutation({
  args: { sessionToken: v.string() },
  returns: v.null(),
  handler: async (ctx, { sessionToken }) => await presence.disconnect(ctx, sessionToken),
});

/// <reference types="vite/client" />
import { registerComponents } from "./testHelpers";
import { convexTest, type TestConvex } from "convex-test";
import { afterEach, beforeEach, expect, test } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import schema from "../../convex/schema";

const modules = import.meta.glob("../../convex/**/*.ts");
const START = 1_800_000_000_000;

type T = TestConvex<typeof schema>;

/**
 * The rules this file exists to hold, in the order they matter:
 *
 *  - a subscription is filed under whoever the SERVER says the caller is, and
 *    that works for an account and for a guest holding a seat;
 *  - the recipient list comes from room membership and never from an argument;
 *  - the person who caused an event is not told about it, guest or not;
 *  - a subscription dies with the thing it belonged to;
 *  - and, above all, NOTHING GOES OUT ON THE WIRE. The last test is the one
 *    that keeps every other backend file's `finishAllScheduledFunctions` from
 *    putting a real push on the internet. `web-push` sends over
 *    `https.request`, which the guard in `tests/setup.ts` does NOT wrap -- it
 *    replaces `globalThis.fetch` and nothing else -- so a send from a test
 *    would go out silently and the suite would stay green.
 */

// Set per test and deleted after, which is this repo's idiom rather than
// `vi.stubEnv`. Both halves are read INSIDE the handlers, never at module
// scope, which is what makes setting them here work at all.
beforeEach(() => {
  delete process.env.VAPID_PUBLIC_KEY;
  delete process.env.VAPID_PRIVATE_KEY;
});
afterEach(() => {
  delete process.env.VAPID_PUBLIC_KEY;
  delete process.env.VAPID_PRIVATE_KEY;
});

function setup(): T {
  const t = convexTest(schema, modules);
  registerComponents(t);
  return t;
}

/** A room with one host and one other seat, either of which may be a guest. */
async function roomWith(
  t: T,
  seats: { name: string; userId?: string; isHost?: boolean }[],
): Promise<{ roomId: Id<"rooms">; memberIds: Id<"members">[]; code: string }> {
  return await t.run(async (ctx) => {
    const roomId = await ctx.db.insert("rooms", {
      hostUserId: seats[0].userId ?? "u1",
      mood: "hangout",
      headcount: seats.length,
      budgetPerHeadCents: 3000,
      whenAt: START,
      centreLat: -37.8,
      centreLng: 144.96,
      radiusKm: 5,
      visibility: "private",
      status: "lobby",
      code: "5555",
    });
    const memberIds: Id<"members">[] = [];
    for (const [i, seat] of seats.entries()) {
      memberIds.push(
        await ctx.db.insert("members", {
          roomId,
          name: seat.name,
          userId: seat.userId,
          isHost: seat.isHost ?? i === 0,
          sessionKey: `key-${i}`,
          joinedAt: START,
        }),
      );
    }
    return { roomId, memberIds, code: "5555" };
  });
}

const DEVICE = (n: number) => ({
  endpoint: `https://push.example/${n}`,
  p256dh: `p256dh-${n}`,
  auth: `auth-${n}`,
});

async function rows(t: T) {
  return await t.run(async (ctx) => await ctx.db.query("pushSubscriptions").collect());
}

test("a signed-in caller's subscription is filed under their account", async () => {
  const t = setup();
  const asUser = t.withIdentity({ subject: "u1", name: "Bec" });

  expect(await asUser.mutation(api.push.subscribe, DEVICE(1))).toBe(true);

  const stored = await rows(t);
  expect(stored).toHaveLength(1);
  expect(stored[0].owner).toBe("u1");
});

test("a guest's subscription is filed under their seat, from the code and key they hold", async () => {
  const t = setup();
  const { code, memberIds } = await roomWith(t, [
    { name: "Bec", userId: "u1" },
    { name: "Sam" },
  ]);

  // No identity at all: this is the guest path, and the seat is the whole of
  // what identifies them.
  expect(
    await t.mutation(api.push.subscribe, { ...DEVICE(2), code, sessionKey: "key-1" }),
  ).toBe(true);

  const stored = await rows(t);
  expect(stored).toHaveLength(1);
  expect(stored[0].owner).toBe(`member:${memberIds[1]}`);
});

test("a caller with neither an account nor a seat is refused, without throwing", async () => {
  const t = setup();
  expect(await t.mutation(api.push.subscribe, DEVICE(3))).toBe(false);
  expect(await rows(t)).toHaveLength(0);
  // And the count says "nobody here", which is a different answer from "no
  // devices" -- the screen draws them differently.
  expect(await t.query(api.push.myDeviceCount, {})).toBeNull();
});

test("a guest's seat wins nothing when the key is wrong", async () => {
  const t = setup();
  const { code } = await roomWith(t, [{ name: "Bec", userId: "u1" }, { name: "Sam" }]);
  await expect(
    t.mutation(api.push.subscribe, { ...DEVICE(4), code, sessionKey: "not-a-key" }),
  ).rejects.toThrow();
  expect(await rows(t)).toHaveLength(0);
});

test("re-subscribing the same browser updates its row rather than adding one", async () => {
  const t = setup();
  const asUser = t.withIdentity({ subject: "u1", name: "Bec" });

  await asUser.mutation(api.push.subscribe, DEVICE(1));
  // Same endpoint, rotated keys -- exactly what a browser hands back after a
  // service worker update.
  await asUser.mutation(api.push.subscribe, {
    endpoint: DEVICE(1).endpoint,
    p256dh: "rotated",
    auth: "rotated-auth",
  });

  const stored = await rows(t);
  expect(stored).toHaveLength(1);
  expect(stored[0].p256dh).toBe("rotated");
});

test("an endpoint re-homes to whoever is holding the browser now", async () => {
  const t = setup();
  await t.withIdentity({ subject: "u1", name: "Bec" }).mutation(api.push.subscribe, DEVICE(1));
  await t.withIdentity({ subject: "u2", name: "Sam" }).mutation(api.push.subscribe, DEVICE(1));

  const stored = await rows(t);
  expect(stored).toHaveLength(1);
  expect(stored[0].owner).toBe("u2");
});

test("unsubscribing takes your own device off and cannot take somebody else's", async () => {
  const t = setup();
  const asBec = t.withIdentity({ subject: "u1", name: "Bec" });
  const asSam = t.withIdentity({ subject: "u2", name: "Sam" });

  await asBec.mutation(api.push.subscribe, DEVICE(1));
  await asSam.mutation(api.push.subscribe, DEVICE(2));

  // Sam knows Bec's endpoint -- it is only a string -- and it changes nothing.
  await asSam.mutation(api.push.unsubscribe, { endpoint: DEVICE(1).endpoint });
  expect(await rows(t)).toHaveLength(2);

  await asBec.mutation(api.push.unsubscribe, { endpoint: DEVICE(1).endpoint });
  const stored = await rows(t);
  expect(stored).toHaveLength(1);
  expect(stored[0].owner).toBe("u2");
});

test("the recipient list is the room's roster, minus the actor", async () => {
  const t = setup();
  const { roomId, memberIds } = await roomWith(t, [
    { name: "Bec", userId: "u1" },
    { name: "Sam", userId: "u2" },
    { name: "Ash", userId: "u3" },
  ]);
  await t.withIdentity({ subject: "u1" }).mutation(api.push.subscribe, DEVICE(1));
  await t.withIdentity({ subject: "u2" }).mutation(api.push.subscribe, DEVICE(2));
  await t.withIdentity({ subject: "u3" }).mutation(api.push.subscribe, DEVICE(3));
  // Somebody in no room at all, to prove the list is a roster and not a table
  // scan of every subscription.
  await t.withIdentity({ subject: "u9" }).mutation(api.push.subscribe, DEVICE(9));

  const delivery = await t.query(internal.push.delivery, {
    roomId,
    event: "matched",
    actorMemberId: memberIds[0],
  });

  expect(delivery).not.toBeNull();
  expect(delivery!.targets.map((x) => x.endpoint).sort()).toEqual([
    DEVICE(2).endpoint,
    DEVICE(3).endpoint,
  ]);
});

test("a guest is notified, and a guest actor is not notified of their own doing", async () => {
  const t = setup();
  const { roomId, code, memberIds } = await roomWith(t, [
    { name: "Bec", userId: "u1" },
    { name: "Sam" },
    { name: "Ash" },
  ]);
  await t.mutation(api.push.subscribe, { ...DEVICE(2), code, sessionKey: "key-1" });
  await t.mutation(api.push.subscribe, { ...DEVICE(3), code, sessionKey: "key-2" });

  const delivery = await t.query(internal.push.delivery, {
    roomId,
    event: "joined",
    actorMemberId: memberIds[1],
  });

  expect(delivery!.targets.map((x) => x.endpoint)).toEqual([DEVICE(3).endpoint]);
});

test("the copy names the room and nothing in it", async () => {
  const t = setup();
  const { roomId } = await roomWith(t, [{ name: "Bec", userId: "u1" }, { name: "Sam", userId: "u2" }]);
  await t.withIdentity({ subject: "u2" }).mutation(api.push.subscribe, DEVICE(2));

  const delivery = await t.query(internal.push.delivery, {
    roomId,
    event: "booked",
    actorMemberId: null,
  });

  expect(delivery!.url).toBe("/room/5555");
  // The room code is the one identifier allowed through: a payload is drawn on
  // a locked screen and the endpoint may outlive the membership.
  expect(`${delivery!.title} ${delivery!.body}`).toContain("5555");
  expect(delivery!.body).not.toMatch(/Bec|Sam|\$/);
});

test("a room where nobody subscribed has nothing to deliver", async () => {
  const t = setup();
  const { roomId } = await roomWith(t, [{ name: "Bec", userId: "u1" }, { name: "Sam" }]);
  expect(
    await t.query(internal.push.delivery, { roomId, event: "planReady", actorMemberId: null }),
  ).toBeNull();
});

test("the test send reaches the caller's own devices and no one else's", async () => {
  const t = setup();
  await t.withIdentity({ subject: "u1" }).mutation(api.push.subscribe, DEVICE(1));
  await t.withIdentity({ subject: "u2" }).mutation(api.push.subscribe, DEVICE(2));

  const mine = await t.query(internal.push.testDelivery, { owner: "u1" });
  expect(mine!.targets.map((x) => x.endpoint)).toEqual([DEVICE(1).endpoint]);
});

test("endpoints the push service reported gone are deleted", async () => {
  const t = setup();
  await t.withIdentity({ subject: "u1" }).mutation(api.push.subscribe, DEVICE(1));
  await t.withIdentity({ subject: "u1" }).mutation(api.push.subscribe, DEVICE(2));

  await t.mutation(internal.push.dropExpired, { endpoints: [DEVICE(1).endpoint] });

  const stored = await rows(t);
  expect(stored.map((r) => r.endpoint)).toEqual([DEVICE(2).endpoint]);
});

test("leaving a room drops the guest's seat subscription and keeps an account's", async () => {
  const t = setup();
  const { code } = await roomWith(t, [
    { name: "Bec", userId: "u1" },
    { name: "Sam" },
  ]);
  // Bec has an account and subscribed from settings; Sam is a guest in this room.
  await t.withIdentity({ subject: "u1" }).mutation(api.push.subscribe, DEVICE(1));
  await t.mutation(api.push.subscribe, { ...DEVICE(2), code, sessionKey: "key-1" });

  await t.mutation(api.rooms.leave, { code, sessionKey: "key-1" });

  const stored = await rows(t);
  expect(stored.map((r) => r.owner)).toEqual(["u1"]);
});

test("deleting an account drops every device it was being notified on", async () => {
  const t = setup();
  const asUser = t.withIdentity({ subject: "u1", name: "Bec" });
  await asUser.mutation(api.push.subscribe, DEVICE(1));
  await asUser.mutation(api.push.subscribe, DEVICE(2));
  await t.withIdentity({ subject: "u2" }).mutation(api.push.subscribe, DEVICE(3));

  await asUser.mutation(api.account.deleteAccount, {});

  const stored = await rows(t);
  expect(stored.map((r) => r.owner)).toEqual(["u2"]);
});

test("with no VAPID keys the delivery action sends nothing and touches no socket", async () => {
  const t = setup();
  const { roomId } = await roomWith(t, [{ name: "Bec", userId: "u1" }, { name: "Sam", userId: "u2" }]);
  await t.withIdentity({ subject: "u2" }).mutation(api.push.subscribe, DEVICE(2));

  // The keys are absent (see `beforeEach`), which is the state of every other
  // test file in this suite. Running the action to completion here is the
  // assertion: it must return before it loads `web-push` at all. If that early
  // return were removed, this line would open a real HTTPS connection to
  // `push.example` -- and so would every drained scheduler job in
  // `plans.test.ts`, `swipes.test.ts` and `bookings.test.ts`.
  await expect(
    t.action(internal.pushSend.deliver, { roomId, event: "matched", actorMemberId: null }),
  ).resolves.toBeNull();

  // Still there: not sending is not the same as unsubscribing.
  expect(await rows(t)).toHaveLength(1);
});

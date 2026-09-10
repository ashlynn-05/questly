/// <reference types="vite/client" />
import { registerComponents } from "./testHelpers";
import { convexTest, type TestConvex } from "convex-test";
import { expect, test } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import schema from "../../convex/schema";

/**
 * `progress.swipedByYou` and `progress.waitingOn` had one assertion between
 * them in the whole suite before this file, and both are about to stop being
 * derived from the room's swipe rows.
 *
 * So these tests are written against the CURRENT implementation and must keep
 * passing byte-for-byte afterwards. They are the reason a per-member counter
 * can be trusted: every path that can move one is exercised here, including the
 * three that write nothing (an identical re-send, a direction change, and a
 * member leaving with their rows).
 *
 * `swipedByYou` is not a cosmetic number. `Deck.tsx` uses it as the member's
 * position in the deck, so a wrong value does not merely mislabel a screen --
 * it puts somebody back on a card they already answered.
 */

const modules = import.meta.glob("../../convex/**/*.ts");
type T = TestConvex<typeof schema>;

const FUTURE = Date.now() + 7 * 24 * 60 * 60 * 1000;

const CREATE = {
  mood: "grass" as const,
  headcount: 4,
  budgetPerHeadCents: 0,
  whenAt: FUTURE,
  centreLat: -37.8,
  centreLng: 144.96,
  radiusKm: 5,
  visibility: "private" as const,
  hostName: "Bec",
};

type Seat = { name: string; sessionKey: string };

/**
 * A room already swiping, with `names.length` seats and `deck` cards.
 *
 * The deck is written straight through `ctx.db` rather than by running
 * `deck.build`: the builder calls Google and OpenAI, and nothing here is about
 * what ends up on the cards.
 */
async function swipingRoom(t: T, names: string[], deck: number) {
  const [hostName, ...guests] = names;
  const host = t.withIdentity({ subject: "u-host", name: hostName });
  const created = await host.mutation(api.rooms.create, { ...CREATE, hostName });

  const seats: Seat[] = [{ name: hostName, sessionKey: created.sessionKey }];
  for (const name of guests) {
    const joined = await t.mutation(api.rooms.join, { code: created.code, name });
    seats.push({ name, sessionKey: joined.sessionKey });
  }

  const questIds = await t.run(async (ctx) => {
    const room = await ctx.db
      .query("rooms")
      .withIndex("by_code", (q) => q.eq("code", created.code))
      .unique();
    await ctx.db.patch(room!._id, { status: "swiping" });
    const ids: Array<Id<"quests">> = [];
    for (let rank = 0; rank < deck; rank++) {
      ids.push(
        await ctx.db.insert("quests", {
          roomId: room!._id,
          rank,
          source: "places",
          placeId: `p${rank}`,
          title: `Card ${rank}`,
          blurb: "",
          priceLabel: "Free",
          priceCents: 0,
          distanceKm: 1,
          discountPct: 0,
          // Descending, so rank order is score order the way a real deck is.
          score: deck - rank,
          scoreBreakdown: {},
        }),
      );
    }
    return ids;
  });

  return { code: created.code, seats, questIds };
}

function progress(t: T, code: string, seat: Seat) {
  return t
    .query(api.rooms.get, { code, sessionKey: seat.sessionKey })
    .then((view) => view!.progress);
}

test("a new swipe advances only the swiper's own count", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  const { code, seats, questIds } = await swipingRoom(t, ["Bec", "Tam"], 3);
  const [bec, tam] = seats;

  expect(await progress(t, code, bec)).toMatchObject({ swipedByYou: 0, deckSize: 3 });

  await t.mutation(api.swipes.cast, {
    code,
    sessionKey: bec.sessionKey,
    questId: questIds[0],
    dir: "no",
  });

  expect((await progress(t, code, bec)).swipedByYou).toBe(1);
  // Tam's own position is untouched by somebody else's swipe.
  expect((await progress(t, code, tam)).swipedByYou).toBe(0);
});

test("re-sending the identical swipe does not advance the count", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  const { code, seats, questIds } = await swipingRoom(t, ["Bec", "Tam"], 3);
  const [bec] = seats;

  const cast = () =>
    t.mutation(api.swipes.cast, {
      code,
      sessionKey: bec.sessionKey,
      questId: questIds[0],
      dir: "yes",
    });

  await cast();
  await cast();
  await cast();

  // A double-tap or a reconnecting client must not look like three cards.
  expect((await progress(t, code, bec)).swipedByYou).toBe(1);
});

test("changing your mind on a card does not advance the count", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  const { code, seats, questIds } = await swipingRoom(t, ["Bec", "Tam"], 3);
  const [bec] = seats;

  await t.mutation(api.swipes.cast, {
    code,
    sessionKey: bec.sessionKey,
    questId: questIds[0],
    dir: "yes",
  });
  await t.mutation(api.swipes.cast, {
    code,
    sessionKey: bec.sessionKey,
    questId: questIds[0],
    dir: "no",
  });

  expect((await progress(t, code, bec)).swipedByYou).toBe(1);
});

test("waitingOn names everyone who has not finished the deck", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  const { code, seats, questIds } = await swipingRoom(t, ["Bec", "Tam", "Jo"], 2);
  const [bec, tam] = seats;

  expect((await progress(t, code, bec)).waitingOn.sort()).toEqual(["Bec", "Jo", "Tam"]);

  // One card each: nobody is through a two-card deck yet.
  for (const seat of [bec, tam]) {
    await t.mutation(api.swipes.cast, {
      code,
      sessionKey: seat.sessionKey,
      questId: questIds[0],
      dir: "no",
    });
  }
  expect((await progress(t, code, bec)).waitingOn.sort()).toEqual(["Bec", "Jo", "Tam"]);

  // Bec finishes and drops out of the list; the other two stay in it.
  await t.mutation(api.swipes.cast, {
    code,
    sessionKey: bec.sessionKey,
    questId: questIds[1],
    dir: "no",
  });
  expect((await progress(t, code, bec)).waitingOn.sort()).toEqual(["Jo", "Tam"]);
});

test("a member who leaves stops being waited on and leaves the others alone", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  const { code, seats, questIds } = await swipingRoom(t, ["Bec", "Tam", "Jo"], 3);
  const [bec, tam, jo] = seats;

  await t.mutation(api.swipes.cast, {
    code,
    sessionKey: bec.sessionKey,
    questId: questIds[0],
    dir: "no",
  });
  await t.mutation(api.swipes.cast, {
    code,
    sessionKey: jo.sessionKey,
    questId: questIds[0],
    dir: "no",
  });

  await t.mutation(api.rooms.leave, { code, sessionKey: jo.sessionKey });

  const after = await progress(t, code, bec);
  expect(after.waitingOn.sort()).toEqual(["Bec", "Tam"]);
  // Jo's rows went with Jo. Bec's did not.
  expect(after.swipedByYou).toBe(1);
  expect((await progress(t, code, tam)).swipedByYou).toBe(0);
});

test("a host removing a seat leaves the remaining counts intact", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  const { code, seats, questIds } = await swipingRoom(t, ["Bec", "Tam", "Jo"], 3);
  const [bec, tam, jo] = seats;

  for (const seat of [bec, tam, jo]) {
    await t.mutation(api.swipes.cast, {
      code,
      sessionKey: seat.sessionKey,
      questId: questIds[0],
      dir: "no",
    });
  }

  const joId = await t.run(async (ctx) => {
    const room = await ctx.db
      .query("rooms")
      .withIndex("by_code", (q) => q.eq("code", code))
      .unique();
    const member = await ctx.db
      .query("members")
      .withIndex("by_room_session", (q) =>
        q.eq("roomId", room!._id).eq("sessionKey", jo.sessionKey),
      )
      .unique();
    return member!._id;
  });

  await t.mutation(api.rooms.removeMember, {
    code,
    sessionKey: bec.sessionKey,
    memberId: joId,
  });

  const after = await progress(t, code, bec);
  expect(after.waitingOn.sort()).toEqual(["Bec", "Tam"]);
  expect(after.swipedByYou).toBe(1);
  expect((await progress(t, code, tam)).swipedByYou).toBe(1);
});

test("a swipe row written outside the normal path is healed by the next mutation", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  const { code, seats, questIds } = await swipingRoom(t, ["Bec", "Tam", "Jo"], 3);
  const [bec, tam, jo] = seats;

  // Straight through the database, the way a fixture or a repair mutation
  // would: two rows for Tam and one for Jo, with nothing touching their counts.
  await t.run(async (ctx) => {
    const room = await ctx.db
      .query("rooms")
      .withIndex("by_code", (q) => q.eq("code", code))
      .unique();
    const seatOf = async (sessionKey: string) =>
      (await ctx.db
        .query("members")
        .withIndex("by_room_session", (q) =>
          q.eq("roomId", room!._id).eq("sessionKey", sessionKey),
        )
        .unique())!._id;
    const tamId = await seatOf(tam.sessionKey);
    const joId = await seatOf(jo.sessionKey);
    for (const [memberId, quests] of [
      [tamId, [questIds[0], questIds[1]]],
      [joId, [questIds[0]]],
    ] as const) {
      for (const questId of quests) {
        await ctx.db.insert("swipes", {
          roomId: room!._id,
          questId,
          memberId,
          dir: "no",
        });
      }
    }
  });

  // Bec swipes an unrelated card. `resolveMatch` recomputes every member's
  // count from the rows, so one person acting repairs the whole room.
  await t.mutation(api.swipes.cast, {
    code,
    sessionKey: bec.sessionKey,
    questId: questIds[2],
    dir: "no",
  });

  expect((await progress(t, code, tam)).swipedByYou).toBe(2);
  expect((await progress(t, code, jo)).swipedByYou).toBe(1);
  // Tam is two cards into a three-card deck, so everyone is still outstanding.
  expect((await progress(t, code, bec)).waitingOn.sort()).toEqual(["Bec", "Jo", "Tam"]);
});

test("the backfill counts seats that predate the column, and is safe to repeat", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  const { code, seats, questIds } = await swipingRoom(t, ["Bec", "Tam"], 3);
  const [bec, tam] = seats;

  // A seat exactly as it existed before `swipeCount` did: a full deck of rows
  // in the table and no number on the member row. Tam is through all three
  // cards, so `waitingOn` is where the missing number shows -- `swipedByYou`
  // would not, because a member's OWN count is still read from their rows.
  await t.run(async (ctx) => {
    const room = await ctx.db
      .query("rooms")
      .withIndex("by_code", (q) => q.eq("code", code))
      .unique();
    const member = await ctx.db
      .query("members")
      .withIndex("by_room_session", (q) =>
        q.eq("roomId", room!._id).eq("sessionKey", tam.sessionKey),
      )
      .unique();
    for (const questId of questIds) {
      await ctx.db.insert("swipes", {
        roomId: room!._id,
        questId,
        memberId: member!._id,
        dir: "no",
      });
    }
    await ctx.db.patch(member!._id, { swipeCount: undefined });
  });

  // Un-backfilled, Tam reads as nought cards in and the room waits on them.
  expect((await progress(t, code, bec)).waitingOn.sort()).toEqual(["Bec", "Tam"]);

  await t.mutation(internal.migrations.backfillSwipeCount, {
    fn: "migrations:backfillSwipeCount",
  });

  // Backfilled, the room stops waiting on somebody who already finished.
  expect((await progress(t, code, bec)).waitingOn).toEqual(["Bec"]);
  expect((await progress(t, code, tam)).swipedByYou).toBe(3);

  // Idempotent: it recomputes from the rows rather than adding to what it finds.
  await t.mutation(internal.migrations.backfillSwipeCount, {
    fn: "migrations:backfillSwipeCount",
  });
  expect((await progress(t, code, bec)).waitingOn).toEqual(["Bec"]);
});

test("a full session ends with everyone through the deck and nobody waited on", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  // Two people who never agree, so the room runs the deck out rather than
  // matching early and freezing `progress` behind a decided room.
  const { code, seats, questIds } = await swipingRoom(t, ["Bec", "Tam"], 3);
  const [bec, tam] = seats;

  for (const [index, questId] of questIds.entries()) {
    await t.mutation(api.swipes.cast, {
      code,
      sessionKey: bec.sessionKey,
      questId,
      dir: "yes",
    });
    await t.mutation(api.swipes.cast, {
      code,
      sessionKey: tam.sessionKey,
      questId,
      dir: "no",
    });
    const seen = index + 1;
    expect((await progress(t, code, bec)).swipedByYou).toBe(seen);
    expect((await progress(t, code, tam)).swipedByYou).toBe(seen);
  }

  const end = await progress(t, code, bec);
  expect(end.swipedByYou).toBe(3);
  expect(end.waitingOn).toEqual([]);
});

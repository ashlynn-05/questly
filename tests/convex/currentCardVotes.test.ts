/// <reference types="vite/client" />
import { registerComponents } from "./testHelpers";
import { convexTest, type TestConvex } from "convex-test";
import { expect, test } from "vitest";
import { api } from "../../convex/_generated/api";
import schema from "../../convex/schema";

const modules = import.meta.glob("../../convex/**/*.ts");

type T = TestConvex<typeof schema>;

/**
 * `rooms.get.currentCardVotes` — how the room voted on the card the ASKING
 * member is looking at.
 *
 * The property under test is that "the current card" is per member. The deck is
 * paced by each member's own swipe count, so two people are on two different
 * cards at the same instant, and a projection that computed one shared card
 * would show the room voting on something the reader is not looking at. Every
 * test below asks from two seats and compares.
 */

const ROOM = {
  hostUserId: "u1",
  mood: "grass" as const,
  headcount: 3,
  budgetPerHeadCents: 0,
  whenAt: 1_800_000_000_000,
  centreLat: -37.8,
  centreLng: 144.96,
  radiusKm: 5,
  visibility: "private" as const,
};

const QUEST = {
  source: "places" as const,
  blurb: "",
  priceLabel: "Free",
  priceCents: 0,
  discountPct: 0,
  scoreBreakdown: {},
};

/** Three members, three cards, nobody has swiped yet. */
async function room(t: T) {
  return await t.run(async (ctx) => {
    const roomId = await ctx.db.insert("rooms", { ...ROOM, status: "swiping", code: "7777" });
    const bec = await ctx.db.insert("members", {
      roomId, name: "Bec", isHost: true, sessionKey: "k-bec", joinedAt: 1,
    });
    const tam = await ctx.db.insert("members", {
      roomId, name: "Tam", isHost: false, sessionKey: "k-tam", joinedAt: 2,
    });
    const ori = await ctx.db.insert("members", {
      roomId, name: "Ori", isHost: false, sessionKey: "k-ori", joinedAt: 3,
    });
    const cards = [];
    for (const [rank, title] of [[0, "Princes Park"], [1, "The Tan"], [2, "Edinburgh"]] as const) {
      cards.push(
        await ctx.db.insert("quests", {
          ...QUEST, roomId, rank, placeId: `p${rank}`, title, distanceKm: 1, score: 9 - rank,
        }),
      );
    }
    return { roomId, bec, tam, ori, cards };
  });
}

const setup = () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  return t;
};

const votesFor = async (t: T, sessionKey: string) => {
  const view = await t.query(api.rooms.get, { code: "7777", sessionKey });
  return view!.currentCardVotes;
};

test("every member in the room appears, with no vote before anyone swipes", async () => {
  const t = setup();
  const { bec, tam, ori } = await room(t);

  const votes = await votesFor(t, "k-bec");
  expect(votes).toHaveLength(3);
  expect(votes.map((v) => v.name).sort()).toEqual(["Bec", "Ori", "Tam"]);
  expect(votes.map((v) => v.dir)).toEqual([null, null, null]);
  // The id is projected as well as the name, so two members called the same
  // thing do not collide the way they do in `progress.waitingOn`.
  expect(votes.map((v) => v.memberId).sort()).toEqual([bec, tam, ori].sort());
});

test("a member who has not reached the card reports null, never a no", async () => {
  const t = setup();
  const { cards } = await room(t);

  // Tam races ahead and says no to the first card. Bec is still on it.
  await t.mutation(api.swipes.cast, {
    code: "7777", sessionKey: "k-tam", questId: cards[0], dir: "no",
  });

  const votes = await votesFor(t, "k-bec");
  const byName = Object.fromEntries(votes.map((v) => [v.name, v.dir]));
  expect(byName.Tam).toBe("no");
  // Ori has swiped nothing at all. That is not a rejection.
  expect(byName.Ori).toBeNull();
  expect(byName.Bec).toBeNull();
});

test("the list follows the ASKING member's position, not a shared one", async () => {
  const t = setup();
  const { cards } = await room(t);

  // Bec is now on card 2. Tam is still on card 1.
  await t.mutation(api.swipes.cast, {
    code: "7777", sessionKey: "k-bec", questId: cards[0], dir: "yes",
  });
  await t.mutation(api.swipes.cast, {
    code: "7777", sessionKey: "k-ori", questId: cards[0], dir: "yes",
  });

  // Tam is looking at card 1, where two people have already said yes.
  const tamSees = Object.fromEntries((await votesFor(t, "k-tam")).map((v) => [v.name, v.dir]));
  expect(tamSees).toEqual({ Bec: "yes", Ori: "yes", Tam: null });

  // Bec is looking at card 2, where nobody has voted at all.
  const becSees = Object.fromEntries((await votesFor(t, "k-bec")).map((v) => [v.name, v.dir]));
  expect(becSees).toEqual({ Bec: null, Ori: null, Tam: null });
});

test("your own vote is never shown on the card you are being asked about", async () => {
  const t = setup();
  const { cards } = await room(t);

  await t.mutation(api.swipes.cast, {
    code: "7777", sessionKey: "k-bec", questId: cards[0], dir: "yes",
  });

  // Having voted moved Bec to the next card, so Bec's own row is null again.
  // The panel can only ever show you as undecided on the card in front of you,
  // which is the honest reading: a vote is what moves you off it.
  const votes = await votesFor(t, "k-bec");
  expect(votes.find((v) => v.name === "Bec")?.dir).toBeNull();
});

test("both directions survive the projection", async () => {
  const t = setup();
  const { cards } = await room(t);

  await t.mutation(api.swipes.cast, {
    code: "7777", sessionKey: "k-tam", questId: cards[0], dir: "yes",
  });
  await t.mutation(api.swipes.cast, {
    code: "7777", sessionKey: "k-ori", questId: cards[0], dir: "no",
  });

  const byName = Object.fromEntries((await votesFor(t, "k-bec")).map((v) => [v.name, v.dir]));
  expect(byName).toEqual({ Bec: null, Tam: "yes", Ori: "no" });
});

test("a member through the whole deck gets an empty list, not a stale last card", async () => {
  const t = setup();
  const { cards } = await room(t);

  for (const questId of cards) {
    await t.mutation(api.swipes.cast, {
      code: "7777", sessionKey: "k-bec", questId, dir: "no",
    });
  }

  expect(await votesFor(t, "k-bec")).toEqual([]);
  // The others are still mid-deck and still get a list.
  expect(await votesFor(t, "k-tam")).toHaveLength(3);
});

test("a room with no deck yet has no card to vote on", async () => {
  const t = setup();
  await t.run(async (ctx) => {
    const roomId = await ctx.db.insert("rooms", { ...ROOM, status: "lobby", code: "8888" });
    await ctx.db.insert("members", {
      roomId, name: "Bec", isHost: true, sessionKey: "k-bec", joinedAt: 1,
    });
  });

  const view = await t.query(api.rooms.get, { code: "8888", sessionKey: "k-bec" });
  expect(view!.currentCardVotes).toEqual([]);
});

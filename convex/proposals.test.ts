/// <reference types="vite/client" />
import { convexTest, type TestConvex } from "convex-test";
import { ConvexError } from "convex/values";
import { expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const START = 1_800_000_000_000;

/**
 * The schema-aware handle. `ReturnType<typeof convexTest>` silently drops the
 * schema types, which leaves vitest green while `tsc` reports errors.
 */
type T = TestConvex<typeof schema>;

/**
 * Every user-facing throw must arrive as a `ConvexError` carrying a stable
 * `code`: a plain `Error`'s message is redacted to "Server Error" in
 * production, so prose alone is not a contract the browser can rely on.
 */
async function expectUserError(promise: Promise<unknown>, code: string, messagePattern: RegExp) {
  await expect(promise).rejects.toBeInstanceOf(ConvexError);
  await expect(promise).rejects.toMatchObject({
    data: { code, message: expect.stringMatching(messagePattern) },
  });
}

const STOP = (over: Record<string, unknown> = {}) => ({
  id: "s2",
  slot: "after" as const,
  name: "The Long Weekend",
  startAt: START,
  durationMin: 60,
  costPerHeadCents: 1400,
  note: "",
  source: "llm" as const,
  locked: false,
  ...over,
});

async function roomWithPlan(t: T, memberNames: string[]) {
  const ids = await t.run(async (ctx) => {
    const roomId = await ctx.db.insert("rooms", {
      hostUserId: "u1",
      mood: "treat",
      headcount: memberNames.length,
      budgetPerHeadCents: 3000,
      whenAt: START,
      centreLat: -37.8,
      centreLng: 144.96,
      radiusKm: 5,
      visibility: "private",
      status: "matched",
      code: "5555",
    });
    for (const [i, name] of memberNames.entries()) {
      await ctx.db.insert("members", {
        roomId,
        name,
        isHost: i === 0,
        sessionKey: `k-${name}`,
        joinedAt: i,
      });
    }
    const questId = await ctx.db.insert("quests", {
      roomId,
      rank: 0,
      source: "places",
      placeId: "p",
      title: "The Long Weekend",
      blurb: "",
      priceLabel: "$14",
      priceCents: 1400,
      distanceKm: 1,
      discountPct: 0,
      score: 1,
      scoreBreakdown: {},
    });
    return { roomId, questId };
  });

  await t.mutation(internal.plans.writePlan, {
    roomId: ids.roomId,
    questId: ids.questId,
    stops: [
      {
        id: "s1", slot: "main", name: "The bench", startAt: START, durationMin: 30,
        costPerHeadCents: 0, note: "", source: "llm", locked: true,
      },
      STOP(),
    ],
    shareMessage: "x",
  });
  return ids;
}

const planOf = (t: T, roomId: Id<"rooms">) =>
  t.run(async (ctx) =>
    ctx.db.query("plans").withIndex("by_room", (q) => q.eq("roomId", roomId)).unique(),
  );

const proposalOf = (t: T, proposalId: Id<"proposals">) =>
  t.run(async (ctx) => ctx.db.get(proposalId));

const votesOf = (t: T, proposalId: Id<"proposals">) =>
  t.run(async (ctx) =>
    ctx.db
      .query("proposalVotes")
      .withIndex("by_proposal", (q) => q.eq("proposalId", proposalId))
      .collect(),
  );

/** The one member row a session key stands for. */
const memberIdOf = (t: T, roomId: Id<"rooms">, sessionKey: string) =>
  t.run(async (ctx) => {
    const member = await ctx.db
      .query("members")
      .withIndex("by_room_session", (q) => q.eq("roomId", roomId).eq("sessionKey", sessionKey))
      .unique();
    return member!._id;
  });

// --- the solo path: a direct swap ----------------------------------------

test("in a room of one, a stop can be swapped directly", async () => {
  const t = convexTest(schema, modules);
  const { roomId } = await roomWithPlan(t, ["Bec"]);
  await t.mutation(api.plans.replaceStop, {
    code: "5555", sessionKey: "k-Bec", stopId: "s2",
    replacement: STOP({ name: "Heartattack and Vine", costPerHeadCents: 900 }),
  });
  const plan = await planOf(t, roomId);
  expect(plan!.stops[1].name).toBe("Heartattack and Vine");
  expect(plan!.totalPerHeadCents).toBe(900);
});

test("a swap keeps the stop id so open proposals still point at it", async () => {
  const t = convexTest(schema, modules);
  const { roomId } = await roomWithPlan(t, ["Bec"]);
  await t.mutation(api.plans.replaceStop, {
    code: "5555", sessionKey: "k-Bec", stopId: "s2",
    replacement: STOP({ id: "ignored", name: "X" }),
  });
  const plan = await planOf(t, roomId);
  expect(plan!.stops[1].id).toBe("s2");
});

// GLOBAL CONSTRAINT: the two editing paths must not overlap. A room of two or
// more has exactly one write path into its plan, and it is `proposals`.
test("in a group room, a direct swap is refused and must go through a proposal", async () => {
  const t = convexTest(schema, modules);
  await roomWithPlan(t, ["Bec", "Tam"]);
  await expectUserError(
    t.mutation(api.plans.replaceStop, {
      code: "5555", sessionKey: "k-Bec", stopId: "s2", replacement: STOP({ name: "X" }),
    }),
    "GROUP_NEEDS_PROPOSAL",
    /proposal/i,
  );
});

test("the group refusal is enforced before anything is written", async () => {
  const t = convexTest(schema, modules);
  const { roomId } = await roomWithPlan(t, ["Bec", "Tam"]);
  await expect(
    t.mutation(api.plans.replaceStop, {
      code: "5555", sessionKey: "k-Bec", stopId: "s2", replacement: STOP({ name: "X" }),
    }),
  ).rejects.toThrow();
  const plan = await planOf(t, roomId);
  expect(plan!.stops[1].name).toBe("The Long Weekend");
});

test("a stranger's session key cannot swap a stop", async () => {
  const t = convexTest(schema, modules);
  await roomWithPlan(t, ["Bec"]);
  await expectUserError(
    t.mutation(api.plans.replaceStop, {
      code: "5555", sessionKey: "k-nobody", stopId: "s2", replacement: STOP({ name: "X" }),
    }),
    "NOT_A_MEMBER",
    /not a member/i,
  );
});

test("a locked stop cannot be replaced", async () => {
  const t = convexTest(schema, modules);
  await roomWithPlan(t, ["Bec"]);
  await expectUserError(
    t.mutation(api.plans.replaceStop, {
      code: "5555", sessionKey: "k-Bec", stopId: "s1",
      replacement: STOP({ id: "s1", slot: "main", name: "X" }),
    }),
    "STOP_LOCKED",
    /locked/i,
  );
});

test("unlocking a stop makes it swappable again", async () => {
  const t = convexTest(schema, modules);
  const { roomId } = await roomWithPlan(t, ["Bec"]);
  await t.mutation(api.plans.setLocked, {
    code: "5555", sessionKey: "k-Bec", stopId: "s1", locked: false,
  });
  await t.mutation(api.plans.replaceStop, {
    code: "5555", sessionKey: "k-Bec", stopId: "s1",
    replacement: STOP({ id: "s1", slot: "main", name: "Somewhere else", costPerHeadCents: 0 }),
  });
  const plan = await planOf(t, roomId);
  expect(plan!.stops[0].name).toBe("Somewhere else");
});

// Correction 5: locking is a direct edit even in a group, deliberately. It is
// reversible by anyone in one tap and changes nothing about the night, so it is
// a signal to the room rather than a content change the room votes on.
test("anyone in a group room can lock and unlock a stop without a proposal", async () => {
  const t = convexTest(schema, modules);
  const { roomId } = await roomWithPlan(t, ["Bec", "Tam", "Sam"]);
  await t.mutation(api.plans.setLocked, {
    code: "5555", sessionKey: "k-Tam", stopId: "s2", locked: true,
  });
  expect((await planOf(t, roomId))!.stops[1].locked).toBe(true);

  await t.mutation(api.plans.setLocked, {
    code: "5555", sessionKey: "k-Sam", stopId: "s2", locked: false,
  });
  expect((await planOf(t, roomId))!.stops[1].locked).toBe(false);
});

test("locking a stop that is not in the plan is refused rather than silently ignored", async () => {
  const t = convexTest(schema, modules);
  await roomWithPlan(t, ["Bec"]);
  await expectUserError(
    t.mutation(api.plans.setLocked, {
      code: "5555", sessionKey: "k-Bec", stopId: "nope", locked: true,
    }),
    "STOP_NOT_FOUND",
    /not in this plan/i,
  );
});

// --- the group path: propose and vote -------------------------------------

test("the proposer's yes is recorded automatically", async () => {
  const t = convexTest(schema, modules);
  await roomWithPlan(t, ["Bec", "Tam", "Sam"]);
  const { proposalId, accepted } = await t.mutation(api.proposals.open, {
    code: "5555", sessionKey: "k-Bec", stopId: "s2",
    replacement: STOP({ name: "Bar Liberty" }), reason: "closer",
  });
  expect(accepted).toBe(false); // 1 of 3, needs 2

  expect(await votesOf(t, proposalId)).toHaveLength(1);
});

test("in a room of two, proposing alone is not enough", async () => {
  const t = convexTest(schema, modules);
  await roomWithPlan(t, ["Bec", "Tam"]);
  const { accepted } = await t.mutation(api.proposals.open, {
    code: "5555", sessionKey: "k-Bec", stopId: "s2", replacement: STOP({ name: "X" }), reason: "",
  });
  expect(accepted).toBe(false); // needed(2) is 2
});

// needed(1) is 1, so the room of one that goes through `proposals` rather than
// `plans.replaceStop` gets the same answer. There is no second threshold.
test("in a room of one, proposing carries immediately", async () => {
  const t = convexTest(schema, modules);
  const { roomId } = await roomWithPlan(t, ["Bec"]);
  const { accepted } = await t.mutation(api.proposals.open, {
    code: "5555", sessionKey: "k-Bec", stopId: "s2",
    replacement: STOP({ name: "Solo bar", costPerHeadCents: 500 }), reason: "",
  });
  expect(accepted).toBe(true);
  expect((await planOf(t, roomId))!.stops[1].name).toBe("Solo bar");
});

test("a strict majority applies the swap the instant it lands", async () => {
  const t = convexTest(schema, modules);
  const { roomId } = await roomWithPlan(t, ["Bec", "Tam", "Sam"]);
  const { proposalId } = await t.mutation(api.proposals.open, {
    code: "5555", sessionKey: "k-Bec", stopId: "s2",
    replacement: STOP({ name: "Bar Liberty", costPerHeadCents: 1000 }), reason: "closer",
  });
  const r = await t.mutation(api.proposals.vote, {
    code: "5555", sessionKey: "k-Tam", proposalId, vote: "yes",
  });
  expect(r.accepted).toBe(true);

  const plan = await planOf(t, roomId);
  expect(plan!.stops[1].name).toBe("Bar Liberty");
  expect(plan!.totalPerHeadCents).toBe(1000);

  expect((await proposalOf(t, proposalId))!.status).toBe("accepted");
});

test("only one proposal per stop can be open at a time", async () => {
  const t = convexTest(schema, modules);
  await roomWithPlan(t, ["Bec", "Tam", "Sam"]);
  await t.mutation(api.proposals.open, {
    code: "5555", sessionKey: "k-Bec", stopId: "s2", replacement: STOP({ name: "A" }), reason: "",
  });
  await expectUserError(
    t.mutation(api.proposals.open, {
      code: "5555", sessionKey: "k-Tam", stopId: "s2", replacement: STOP({ name: "B" }), reason: "",
    }),
    "PROPOSAL_EXISTS",
    /already/i,
  );
});

test("once a proposal resolves, the stop is open for proposals again", async () => {
  const t = convexTest(schema, modules);
  await roomWithPlan(t, ["Bec", "Tam", "Sam"]);
  const first = await t.mutation(api.proposals.open, {
    code: "5555", sessionKey: "k-Bec", stopId: "s2", replacement: STOP({ name: "A" }), reason: "",
  });
  await t.mutation(api.proposals.vote, {
    code: "5555", sessionKey: "k-Tam", proposalId: first.proposalId, vote: "yes",
  });
  // Accepted, so no longer open -- a second change to the same stop is allowed.
  const second = await t.mutation(api.proposals.open, {
    code: "5555", sessionKey: "k-Sam", stopId: "s2", replacement: STOP({ name: "B" }), reason: "",
  });
  expect(second.accepted).toBe(false);
});

test("a proposal against a stop that is not in the plan is refused up front", async () => {
  const t = convexTest(schema, modules);
  await roomWithPlan(t, ["Bec", "Tam", "Sam"]);
  await expectUserError(
    t.mutation(api.proposals.open, {
      code: "5555", sessionKey: "k-Bec", stopId: "nope", replacement: STOP({ name: "A" }), reason: "",
    }),
    "STOP_NOT_FOUND",
    /not in this plan/i,
  );
});

// The refusal lands on the person who caused it, rather than on whoever happens
// to cast the deciding vote later.
test("a proposal against a locked stop is refused when it is opened", async () => {
  const t = convexTest(schema, modules);
  await roomWithPlan(t, ["Bec", "Tam", "Sam"]);
  await expectUserError(
    t.mutation(api.proposals.open, {
      code: "5555", sessionKey: "k-Bec", stopId: "s1",
      replacement: STOP({ id: "s1", slot: "main", name: "A" }), reason: "",
    }),
    "STOP_LOCKED",
    /locked/i,
  );
});

test("a non-member cannot open a proposal", async () => {
  const t = convexTest(schema, modules);
  await roomWithPlan(t, ["Bec", "Tam", "Sam"]);
  await expectUserError(
    t.mutation(api.proposals.open, {
      code: "5555", sessionKey: "k-nobody", stopId: "s2", replacement: STOP({ name: "A" }), reason: "",
    }),
    "NOT_A_MEMBER",
    /not a member/i,
  );
});

test("nobody votes twice on the same proposal", async () => {
  const t = convexTest(schema, modules);
  await roomWithPlan(t, ["Bec", "Tam", "Sam", "Jo"]);
  const { proposalId } = await t.mutation(api.proposals.open, {
    code: "5555", sessionKey: "k-Bec", stopId: "s2", replacement: STOP({ name: "A" }), reason: "",
  });
  await t.mutation(api.proposals.vote, { code: "5555", sessionKey: "k-Tam", proposalId, vote: "yes" });
  await t.mutation(api.proposals.vote, { code: "5555", sessionKey: "k-Tam", proposalId, vote: "yes" });

  // Bec's automatic yes plus Tam's single vote.
  expect(await votesOf(t, proposalId)).toHaveLength(2);
});

test("changing your mind moves your vote rather than adding one", async () => {
  const t = convexTest(schema, modules);
  await roomWithPlan(t, ["Bec", "Tam", "Sam", "Jo"]);
  const { proposalId } = await t.mutation(api.proposals.open, {
    code: "5555", sessionKey: "k-Bec", stopId: "s2", replacement: STOP({ name: "A" }), reason: "",
  });
  await t.mutation(api.proposals.vote, { code: "5555", sessionKey: "k-Tam", proposalId, vote: "no" });
  const flipped = await t.mutation(api.proposals.vote, {
    code: "5555", sessionKey: "k-Tam", proposalId, vote: "yes",
  });
  expect(flipped.accepted).toBe(false); // 2 of 4, needed(4) is 3

  const votes = await votesOf(t, proposalId);
  expect(votes).toHaveLength(2);
  expect(votes.filter((row) => row.vote === "yes")).toHaveLength(2);
});

test("a non-member cannot vote", async () => {
  const t = convexTest(schema, modules);
  await roomWithPlan(t, ["Bec", "Tam", "Sam"]);
  const { proposalId } = await t.mutation(api.proposals.open, {
    code: "5555", sessionKey: "k-Bec", stopId: "s2", replacement: STOP({ name: "A" }), reason: "",
  });
  await expectUserError(
    t.mutation(api.proposals.vote, { code: "5555", sessionKey: "k-nobody", proposalId, vote: "yes" }),
    "NOT_A_MEMBER",
    /not a member/i,
  );
});

// A proposal id is client-supplied. Being a member of SOME room is not
// authority to vote on ANY room's plan.
test("a member of another room cannot vote with a borrowed proposal id", async () => {
  const t = convexTest(schema, modules);
  await roomWithPlan(t, ["Bec", "Tam", "Sam"]);
  const { proposalId } = await t.mutation(api.proposals.open, {
    code: "5555", sessionKey: "k-Bec", stopId: "s2", replacement: STOP({ name: "A" }), reason: "",
  });

  await t.run(async (ctx) => {
    const roomId = await ctx.db.insert("rooms", {
      hostUserId: "u9", mood: "treat", headcount: 1, budgetPerHeadCents: 3000, whenAt: START,
      centreLat: -37.8, centreLng: 144.96, radiusKm: 5, visibility: "private",
      status: "matched", code: "6666",
    });
    await ctx.db.insert("members", {
      roomId, name: "Kim", isHost: true, sessionKey: "k-Kim", joinedAt: 0,
    });
  });

  await expectUserError(
    t.mutation(api.proposals.vote, { code: "6666", sessionKey: "k-Kim", proposalId, vote: "yes" }),
    "PROPOSAL_NOT_FOUND",
    /no such proposal/i,
  );
  expect((await proposalOf(t, proposalId))!.status).toBe("open");
});

test("voting on a resolved proposal reports the outcome instead of reapplying it", async () => {
  const t = convexTest(schema, modules);
  const { roomId } = await roomWithPlan(t, ["Bec", "Tam", "Sam"]);
  const { proposalId } = await t.mutation(api.proposals.open, {
    code: "5555", sessionKey: "k-Bec", stopId: "s2", replacement: STOP({ name: "A" }), reason: "",
  });
  await t.mutation(api.proposals.vote, { code: "5555", sessionKey: "k-Tam", proposalId, vote: "yes" });

  // Someone edits the stop after the room decided; the late vote must not undo
  // it by re-applying the accepted replacement.
  await t.run(async (ctx) => {
    const plan = await ctx.db
      .query("plans").withIndex("by_room", (q) => q.eq("roomId", roomId)).unique();
    await ctx.db.patch(plan!._id, {
      stops: plan!.stops.map((s) => (s.id === "s2" ? { ...s, name: "Later change" } : s)),
    });
  });

  const late = await t.mutation(api.proposals.vote, {
    code: "5555", sessionKey: "k-Sam", proposalId, vote: "no",
  });
  expect(late.accepted).toBe(true);
  expect((await planOf(t, roomId))!.stops[1].name).toBe("Later change");
  expect(await votesOf(t, proposalId)).toHaveLength(2); // Sam's late no was not recorded
});

// The match may never deadlock, and neither may a vote: once no undecided
// member can carry it, the proposal closes instead of sitting open forever.
test("a proposal nobody left can carry is closed rather than left open", async () => {
  const t = convexTest(schema, modules);
  const { roomId } = await roomWithPlan(t, ["Bec", "Tam", "Sam", "Jo"]);
  const { proposalId } = await t.mutation(api.proposals.open, {
    code: "5555", sessionKey: "k-Bec", stopId: "s2", replacement: STOP({ name: "A" }), reason: "",
  });
  await t.mutation(api.proposals.vote, { code: "5555", sessionKey: "k-Tam", proposalId, vote: "no" });
  // needed(4) is 3; with two noes and one undecided, 1 + 1 < 3.
  const r = await t.mutation(api.proposals.vote, {
    code: "5555", sessionKey: "k-Sam", proposalId, vote: "no",
  });
  expect(r.accepted).toBe(false);
  expect((await proposalOf(t, proposalId))!.status).toBe("rejected");
  expect((await planOf(t, roomId))!.stops[1].name).toBe("The Long Weekend");
});

// --- correction 3: a shrinking roster re-resolves open proposals -----------

test("a proposal the remaining roster already agreed on lands when the others leave", async () => {
  const t = convexTest(schema, modules);
  const { roomId } = await roomWithPlan(t, ["Bec", "Tam", "Sam", "Jo"]);
  const { proposalId } = await t.mutation(api.proposals.open, {
    code: "5555", sessionKey: "k-Bec", stopId: "s2",
    replacement: STOP({ name: "Bar Liberty", costPerHeadCents: 1000 }), reason: "",
  });
  await t.mutation(api.proposals.vote, { code: "5555", sessionKey: "k-Tam", proposalId, vote: "yes" });
  expect((await proposalOf(t, proposalId))!.status).toBe("open"); // 2 of 4, needs 3

  // The two who never voted leave. Nobody is left to cast the vote it is
  // waiting on, and needed(2) is 2 -- which the room already has.
  await t.mutation(api.rooms.leave, { code: "5555", sessionKey: "k-Sam" });
  await t.mutation(api.rooms.leave, { code: "5555", sessionKey: "k-Jo" });

  expect((await proposalOf(t, proposalId))!.status).toBe("accepted");
  const plan = await planOf(t, roomId);
  expect(plan!.stops[1].name).toBe("Bar Liberty");
  expect(plan!.totalPerHeadCents).toBe(1000);
});

test("a proposal the remaining roster can no longer carry is closed when they leave", async () => {
  const t = convexTest(schema, modules);
  const { roomId } = await roomWithPlan(t, ["Bec", "Tam", "Sam", "Jo", "Kim"]);
  const { proposalId } = await t.mutation(api.proposals.open, {
    code: "5555", sessionKey: "k-Bec", stopId: "s2", replacement: STOP({ name: "A" }), reason: "",
  });
  await t.mutation(api.proposals.vote, { code: "5555", sessionKey: "k-Tam", proposalId, vote: "no" });

  // The three undecided members leave. Bec's yes is 1 of a roster of 2, and
  // Tam has already voted, so nothing further can ever arrive.
  await t.mutation(api.rooms.leave, { code: "5555", sessionKey: "k-Sam" });
  await t.mutation(api.rooms.leave, { code: "5555", sessionKey: "k-Jo" });
  await t.mutation(api.rooms.leave, { code: "5555", sessionKey: "k-Kim" });

  expect((await proposalOf(t, proposalId))!.status).toBe("rejected");
  expect((await planOf(t, roomId))!.stops[1].name).toBe("The Long Weekend");
});

test("the proposer leaving takes their yes with them", async () => {
  const t = convexTest(schema, modules);
  const { roomId } = await roomWithPlan(t, ["Bec", "Tam", "Sam"]);
  const { proposalId } = await t.mutation(api.proposals.open, {
    code: "5555", sessionKey: "k-Tam", stopId: "s2", replacement: STOP({ name: "A" }), reason: "",
  });
  await t.mutation(api.rooms.leave, { code: "5555", sessionKey: "k-Tam" });

  // Roster of 2, needed 2, no votes left at all and two undecided members: it
  // is still reachable, so it stays open rather than being closed early.
  expect((await proposalOf(t, proposalId))!.status).toBe("open");
  expect(await votesOf(t, proposalId)).toHaveLength(0);
  expect((await planOf(t, roomId))!.stops[1].name).toBe("The Long Weekend");
});

// Correction 4: the host's escape hatch cleans up exactly what leaving does.
test("the host removing a member re-resolves proposals the same way leaving does", async () => {
  const t = convexTest(schema, modules);
  const { roomId } = await roomWithPlan(t, ["Bec", "Tam", "Sam", "Jo"]);
  const { proposalId } = await t.mutation(api.proposals.open, {
    code: "5555", sessionKey: "k-Bec", stopId: "s2",
    replacement: STOP({ name: "Bar Liberty", costPerHeadCents: 1000 }), reason: "",
  });
  await t.mutation(api.proposals.vote, { code: "5555", sessionKey: "k-Tam", proposalId, vote: "yes" });

  await t.mutation(api.rooms.removeMember, {
    code: "5555", sessionKey: "k-Bec", memberId: await memberIdOf(t, roomId, "k-Sam"),
  });
  await t.mutation(api.rooms.removeMember, {
    code: "5555", sessionKey: "k-Bec", memberId: await memberIdOf(t, roomId, "k-Jo"),
  });

  expect((await proposalOf(t, proposalId))!.status).toBe("accepted");
  expect((await planOf(t, roomId))!.stops[1].name).toBe("Bar Liberty");
});

test("removing a member deletes their votes, so a majority is judged on who is present", async () => {
  const t = convexTest(schema, modules);
  const { roomId } = await roomWithPlan(t, ["Bec", "Tam", "Sam", "Jo", "Kim"]);
  const { proposalId } = await t.mutation(api.proposals.open, {
    code: "5555", sessionKey: "k-Bec", stopId: "s2", replacement: STOP({ name: "A" }), reason: "",
  });
  await t.mutation(api.proposals.vote, { code: "5555", sessionKey: "k-Tam", proposalId, vote: "yes" });
  expect(await votesOf(t, proposalId)).toHaveLength(2);

  await t.mutation(api.rooms.removeMember, {
    code: "5555", sessionKey: "k-Bec", memberId: await memberIdOf(t, roomId, "k-Tam"),
  });
  // Tam's yes went with Tam: 1 of 4, needed 3, three undecided -- still open.
  expect(await votesOf(t, proposalId)).toHaveLength(1);
  expect((await proposalOf(t, proposalId))!.status).toBe("open");
});

// A locked stop cannot be swapped, and a departure must not be blocked by one.
test("a departure is not blocked by a proposal whose stop was locked after it opened", async () => {
  const t = convexTest(schema, modules);
  const { roomId } = await roomWithPlan(t, ["Bec", "Tam", "Sam", "Jo"]);
  const { proposalId } = await t.mutation(api.proposals.open, {
    code: "5555", sessionKey: "k-Bec", stopId: "s2", replacement: STOP({ name: "A" }), reason: "",
  });
  await t.mutation(api.proposals.vote, { code: "5555", sessionKey: "k-Tam", proposalId, vote: "yes" });
  await t.mutation(api.plans.setLocked, {
    code: "5555", sessionKey: "k-Sam", stopId: "s2", locked: true,
  });

  // The swap can no longer be applied, but Sam and Jo must still be able to go.
  await t.mutation(api.rooms.leave, { code: "5555", sessionKey: "k-Sam" });
  await t.mutation(api.rooms.leave, { code: "5555", sessionKey: "k-Jo" });

  expect((await proposalOf(t, proposalId))!.status).toBe("rejected");
  const plan = await planOf(t, roomId);
  expect(plan!.stops[1].name).toBe("The Long Weekend");
  expect(plan!.stops[1].locked).toBe(true);
  const roster = await t.run(async (ctx) =>
    ctx.db.query("members").withIndex("by_room", (q) => q.eq("roomId", roomId)).collect(),
  );
  expect(roster.map((m) => m.name).sort()).toEqual(["Bec", "Tam"]);
});

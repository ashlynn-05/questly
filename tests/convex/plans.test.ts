/// <reference types="vite/client" />
import { registerComponents } from "./testHelpers";
import { convexTest, type TestConvex } from "convex-test";
import { ConvexError } from "convex/values";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import schema from "../../convex/schema";
import { applyStopSwap } from "../../convex/lib/plans/swap";
import { TRAVEL_BUFFER_MIN, type Stop } from "../../convex/lib/plans/stops";
import { buildPlanPrompt, fallbackPlan, parsePlanResponse } from "../../convex/lib/plans/prompt";
import { enqueuePlanGeneration } from "../../convex/lib/plans/queue";

const modules = import.meta.glob("../../convex/**/*.ts");
const START = 1_800_000_000_000;

// The schema-aware handle, so helpers below keep the real document types
// instead of falling back to the generic data model.
type T = TestConvex<typeof schema>;

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const OPENAI_KEY = "test-openai-key";

const INPUT = {
  venueName: "Princes Park",
  headcount: 4,
  budgetPerHeadCents: 0,
  // What the matched card says the venue costs, never a share of the budget.
  anchorPriceCents: 0,
  startAt: START,
  mood: "grass" as const,
};

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

// --- the prompt and the parser -------------------------------------------

test("the prompt names the venue, the party size and the budget", () => {
  const prompt = buildPlanPrompt({ ...INPUT, budgetPerHeadCents: 3000 });
  expect(prompt).toContain("Princes Park");
  expect(prompt).toContain("4 people");
  expect(prompt).toContain("$30");
});

test("a $0 budget is stated as a hard constraint in the prompt", () => {
  expect(buildPlanPrompt(INPUT)).toMatch(/\$0 per head/);
});

test("a well-formed model response parses into cascading stops", () => {
  const json = JSON.stringify({
    stops: [
      { slot: "meet", name: "Royal Pde gate", durationMin: 20, costPerHeadCents: 0, note: "Meet by the gate" },
      { slot: "main", name: "Princes Park lap", durationMin: 60, costPerHeadCents: 0, note: "3.2km" },
    ],
    shareMessage: "Princes Park 6:30, free, bring a jumper",
  });
  const { stops, shareMessage } = parsePlanResponse(json, INPUT);
  expect(stops).toHaveLength(2);
  expect(stops[0].startAt).toBe(START);
  expect(stops[1].startAt).toBeGreaterThan(stops[0].startAt);
  // Cascading is the shared helper's arithmetic, not a second copy of it here.
  expect(stops[1].startAt).toBe(START + (20 + TRAVEL_BUFFER_MIN) * 60_000);
  expect(stops.every((s) => s.id.length > 0)).toBe(true);
  expect(new Set(stops.map((s) => s.id)).size).toBe(2);
  expect(stops.every((s) => s.locked === false)).toBe(true);
  expect(shareMessage).toContain("Princes Park");
});

test("prose instead of JSON degrades into a usable plan rather than throwing", () => {
  const { stops } = parsePlanResponse("Sure! Here is a great night out for you.", INPUT);
  expect(stops.length).toBeGreaterThan(0);
});

/**
 * The degraded path still has to describe THIS room. A fallback naming a
 * placeholder venue at a made-up headcount is not a degraded plan, it is a
 * confidently wrong one -- and it is the path a live demo hits whenever OpenAI
 * is slow.
 */
test("the degraded plan describes the room's real venue, not a placeholder", () => {
  const paid = {
    ...INPUT,
    venueName: "The Long Weekend",
    budgetPerHeadCents: 4000,
    anchorPriceCents: 1800,
  };
  const { stops, shareMessage } = parsePlanResponse("no json here", paid);
  expect(stops.some((s) => s.name.includes("The Long Weekend"))).toBe(true);
  expect(shareMessage).toContain("The Long Weekend");
  // $18 -- what the venue costs -- and NOT $40, the budget. The message is
  // pasted into a group chat, so the number in it has to be the night's.
  expect(shareMessage).toContain("$18");
  expect(shareMessage).not.toContain("$40");
  expect(shareMessage).not.toMatch(/your quest/i);
});

/**
 * HONESTY, and the reason `anchorPriceCents` exists at all. The fallback used
 * to price the anchor at 70% of the budget, so the SAME venue on the SAME night
 * cost $21 a head for a $30 room and $49 for a $70 one -- and that number went
 * on to become `plans.totalPerHeadCents` and then the booking total. A budget is
 * what a group will pay, never evidence of what anything costs.
 */
test("the fallback prices the anchor from the venue, not from the group's budget", () => {
  const cheapRoom = fallbackPlan({ ...INPUT, budgetPerHeadCents: 3000, anchorPriceCents: 1800 });
  const richRoom = fallbackPlan({ ...INPUT, budgetPerHeadCents: 7000, anchorPriceCents: 1800 });

  const anchorOf = (p: { stops: Stop[] }) => p.stops.find((s) => s.slot === "main")!;
  expect(anchorOf(cheapRoom).costPerHeadCents).toBe(1800);
  expect(anchorOf(richRoom).costPerHeadCents).toBe(1800);
  // 70% of 3000 and of 7000 -- the two numbers this used to produce.
  expect(anchorOf(cheapRoom).costPerHeadCents).not.toBe(2100);
  expect(anchorOf(richRoom).costPerHeadCents).not.toBe(4900);
});

test("a venue with no known price is not priced at all, and the plan says so", () => {
  const { stops, shareMessage } = fallbackPlan({
    ...INPUT,
    venueName: "Some Gallery",
    budgetPerHeadCents: 5000,
    anchorPriceCents: null,
  });

  const anchor = stops.find((s) => s.slot === "main")!;
  expect(anchor.costPerHeadCents).toBe(0);
  // 0 in the total would otherwise read as "this stop is free".
  expect(anchor.note).toMatch(/could not get a price/i);
  // And the share message must not say "free" either.
  expect(shareMessage).toMatch(/price to confirm/i);
  expect(shareMessage).not.toMatch(/free/i);
});

test("the prompt states the anchor's real price, and refuses one when there is none", () => {
  expect(buildPlanPrompt({ ...INPUT, budgetPerHeadCents: 7000, anchorPriceCents: 1800 })).toContain(
    "$18 per head",
  );
  const unpriced = buildPlanPrompt({ ...INPUT, anchorPriceCents: null });
  expect(unpriced).toMatch(/do not have a price/i);
  expect(unpriced).toMatch(/do not guess/i);
});

test("a garbage slot or duration is coerced, not trusted", () => {
  const json = JSON.stringify({
    stops: [{ slot: "brunch", name: "X", durationMin: -5, costPerHeadCents: "free", note: 7 }],
    shareMessage: 42,
  });
  const { stops, shareMessage } = parsePlanResponse(json, INPUT);
  expect(stops[0].slot).toBe("main");
  expect(stops[0].durationMin).toBeGreaterThan(0);
  expect(stops[0].costPerHeadCents).toBe(0);
  expect(typeof stops[0].note).toBe("string");
  expect(typeof shareMessage).toBe("string");
});

test("the fallback plan is a usable night, not an error state", () => {
  const { stops, shareMessage } = fallbackPlan(INPUT);
  expect(stops.length).toBeGreaterThanOrEqual(2);
  expect(stops.some((s) => s.name.includes("Princes Park"))).toBe(true);
  expect(shareMessage).toContain("Princes Park");
});

test("a $0 room never produces a plan that costs money", () => {
  expect(fallbackPlan(INPUT).stops.every((s) => s.costPerHeadCents === 0)).toBe(true);
});

test("a paid fallback stays in whole cents", () => {
  const { stops } = fallbackPlan({ ...INPUT, budgetPerHeadCents: 3333, anchorPriceCents: 2501 });
  for (const stop of stops) {
    expect(Number.isInteger(stop.costPerHeadCents)).toBe(true);
  }
  // No longer "under the budget by construction": the anchor is priced at what
  // the venue costs, which the group is allowed to decide to overspend on.
  // `rooms.get` projects `plan.overBudget` so they decide knowingly.
  expect(stops.reduce((sum, s) => sum + s.costPerHeadCents, 0)).toBe(2501);
});

// --- writePlan ------------------------------------------------------------

async function seedRoom(
  t: T,
  over: {
    code?: string; headcount?: number; budgetPerHeadCents?: number; title?: string;
    mood?: "grass" | "meet" | "treat" | "new";
  } = {},
) {
  return await t.run(async (ctx) => {
    const roomId = await ctx.db.insert("rooms", {
      hostUserId: "u1",
      mood: over.mood ?? "grass",
      headcount: over.headcount ?? 4,
      budgetPerHeadCents: over.budgetPerHeadCents ?? 3000,
      whenAt: START,
      centreLat: -37.8,
      centreLng: 144.96,
      radiusKm: 5,
      visibility: "private",
      status: "matched",
      code: over.code ?? "4444",
    });
    const questId = await ctx.db.insert("quests", {
      roomId, rank: 0, source: "places", placeId: "p", title: over.title ?? "Princes Park",
      blurb: "", priceLabel: "Free", priceCents: 0, distanceKm: 1, discountPct: 0,
      score: 1, scoreBreakdown: {},
    });
    return { roomId, questId };
  });
}

/**
 * Write a plan the way `plans.generate` does: take the lease first, then write
 * under it. Going through `markGenerating` rather than fabricating a token
 * keeps every test on the same path production uses -- which is the point of
 * the token, since a build whose lease was taken must not be able to write.
 */
async function writePlanUnderLease(
  t: T,
  args: {
    roomId: Id<"rooms">;
    questId: Id<"quests">;
    stops: Stop[];
    shareMessage: string;
  },
) {
  const token = await t.mutation(internal.plans.markGenerating, { roomId: args.roomId });
  expect(token).not.toBeNull();
  return await t.mutation(internal.plans.writePlan, { ...args, token: token as string });
}

test("writePlan stores the plan and totals the cost", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  const { roomId, questId } = await seedRoom(t);

  await writePlanUnderLease(t, {
    roomId, questId,
    stops: [
      { id: "s1", slot: "meet", name: "Gate", startAt: START, durationMin: 20,
        costPerHeadCents: 0, note: "", source: "llm", locked: false },
      { id: "s2", slot: "main", name: "The Long Weekend", startAt: START, durationMin: 60,
        costPerHeadCents: 1400, note: "", source: "llm", locked: false },
    ],
    shareMessage: "see you there",
  });

  const plan = await t.run(async (ctx) =>
    ctx.db.query("plans").withIndex("by_room", (q) => q.eq("roomId", roomId)).unique(),
  );
  expect(plan!.totalPerHeadCents).toBe(1400);
  expect(plan!.stops).toHaveLength(2);
});

test("writePlan twice updates the one plan rather than adding a second", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  const { roomId, questId } = await seedRoom(t, { code: "4445", headcount: 1, budgetPerHeadCents: 0, title: "T" });

  const stop = {
    id: "s1", slot: "main" as const, name: "A", startAt: START, durationMin: 30,
    costPerHeadCents: 0, note: "", source: "llm" as const, locked: false,
  };
  await writePlanUnderLease(t, { roomId, questId, stops: [stop], shareMessage: "one" });
  await writePlanUnderLease(t, { roomId, questId, stops: [stop], shareMessage: "two" });

  const plans = await t.run(async (ctx) => ctx.db.query("plans").collect());
  expect(plans).toHaveLength(1);
  expect(plans[0].shareMessage).toBe("two");
});

// --- generate -------------------------------------------------------------

const modelPlan = {
  stops: [
    { slot: "meet", name: "Royal Pde gate", durationMin: 20, costPerHeadCents: 0, note: "By the gate" },
    { slot: "main", name: "Princes Park lap", durationMin: 60, costPerHeadCents: 1200, note: "3.2km" },
  ],
  shareMessage: "Princes Park, 7pm, twelve bucks each",
};

const chatBody = (payload: unknown) => ({
  choices: [{ message: { content: JSON.stringify(payload) } }],
});

let fetchMock: ReturnType<typeof vi.fn>;
const originalFetch = globalThis.fetch;

const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

beforeEach(() => {
  process.env.OPENAI_API_KEY = OPENAI_KEY;
  // The suggestion actions below fall back to the Places text search, which
  // needs a key of its own before it will even reach the mocked fetch.
  process.env.GOOGLE_MAPS_SERVER_KEY = "test-google-key";
  fetchMock = vi.fn(async (url: string) => {
    if (String(url) === OPENAI_URL) return json(chatBody(modelPlan));
    throw new Error(`Unexpected fetch to ${url}`);
  });
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
  delete process.env.OPENAI_API_KEY;
  delete process.env.GOOGLE_MAPS_SERVER_KEY;
});

const storedPlan = (t: T, roomId: Id<"rooms">) =>
  t.run(async (ctx) =>
    ctx.db.query("plans").withIndex("by_room", (q) => q.eq("roomId", roomId)).first(),
  );

test("generate writes the model's plan and prompts with the real roster", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  const { roomId, questId } = await seedRoom(t);
  await t.run(async (ctx) => {
    await ctx.db.insert("members", { roomId, name: "Bec", userId: "u1", isHost: true, sessionKey: "k1", joinedAt: 1 });
    await ctx.db.insert("members", { roomId, name: "Sam", isHost: false, sessionKey: "k2", joinedAt: 2 });
  });

  await t.action(internal.plans.generate, { roomId, questId });

  const plan = await storedPlan(t, roomId);
  expect(plan!.stops.map((s) => s.name)).toEqual(["Royal Pde gate", "Princes Park lap"]);
  expect(plan!.totalPerHeadCents).toBe(1200);
  expect(plan!.shareMessage).toBe("Princes Park, 7pm, twelve bucks each");
  // Times cascade from the room's own start time, not from the model's guess.
  expect(plan!.stops[0].startAt).toBe(START);
  expect(plan!.stops[1].startAt).toBe(START + (20 + TRAVEL_BUFFER_MIN) * 60_000);

  const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
  expect(body.response_format).toEqual({ type: "json_object" });
  expect(body.max_completion_tokens).toBe(512);
  expect(body).not.toHaveProperty("max_tokens");
  // Two members on the roster, not the four the host guessed at in the lobby.
  expect(body.messages[0].content).toContain("2 people");
  expect(body.messages[0].content).toContain("Princes Park");
});

test("a matched room still gets a plan when OPENAI_API_KEY is missing", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  delete process.env.OPENAI_API_KEY;
  const { roomId, questId } = await seedRoom(t, { title: "The Long Weekend", budgetPerHeadCents: 4000 });

  await t.action(internal.plans.generate, { roomId, questId });

  const plan = await storedPlan(t, roomId);
  expect(plan!.stops.length).toBeGreaterThanOrEqual(2);
  // The canned night names the venue this room actually matched on.
  expect(plan!.stops.some((s) => s.name.includes("The Long Weekend"))).toBe(true);
  expect(plan!.shareMessage).toContain("The Long Weekend");
  expect(plan!.totalPerHeadCents).toBeLessThanOrEqual(4000);
  // The canned night's own shape, not "fetch was not called" -- the key is read
  // before the client is constructed, so that assertion could never have
  // failed. The test above, with the key set, is the positive control that this
  // same path does call the model when it can.
  expect(plan!.stops[0].name).toMatch(/^Meet outside /);
  expect(plan!.stops.every((s) => Number.isInteger(s.costPerHeadCents))).toBe(true);
});

test("an OpenAI outage still leaves the room with a plan", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  fetchMock.mockImplementation(async () => new Response("upstream is unhappy", { status: 503 }));
  const { roomId, questId } = await seedRoom(t);

  await t.action(internal.plans.generate, { roomId, questId });

  const plan = await storedPlan(t, roomId);
  expect(plan!.stops.some((s) => s.name.includes("Princes Park"))).toBe(true);
});

test("a $0 room is never handed a model plan that costs money", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  fetchMock.mockImplementation(async () => json(chatBody(modelPlan))); // $12 a head
  const { roomId, questId } = await seedRoom(t, { budgetPerHeadCents: 0 });

  await t.action(internal.plans.generate, { roomId, questId });

  const plan = await storedPlan(t, roomId);
  expect(plan!.totalPerHeadCents).toBe(0);
  expect(plan!.stops.every((s) => s.costPerHeadCents === 0)).toBe(true);
});

test("a denied plan admission writes the local fallback without calling the provider", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  const { roomId, questId } = await seedRoom(t);
  for (let count = 0; count < 3; count++) {
    await t.mutation(internal.rateLimits.reserveGeneration, { roomId, family: "plan" });
  }

  await t.action(internal.plans.generate, { roomId, questId });

  const plan = await storedPlan(t, roomId);
  expect(plan).not.toBeNull();
  expect(plan!.stops.some((s) => s.name.includes("Princes Park"))).toBe(true);
  expect(fetchMock).not.toHaveBeenCalled();
  expect(
    await t.query(internal.rateLimits.checkGeneration, { roomId, family: "plan" }),
  ).toBe(false);
  expect((await t.run(async (ctx) => ctx.db.get(roomId)))!.planStartedAt).toBeUndefined();
});

test("generate running twice leaves one plan, not two", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  const { roomId, questId } = await seedRoom(t);

  await t.action(internal.plans.generate, { roomId, questId });
  await t.action(internal.plans.generate, { roomId, questId });

  const plans = await t.run(async (ctx) => ctx.db.query("plans").collect());
  expect(plans).toHaveLength(1);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

test("concurrent duplicate generation makes one provider call and one plan", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  const { roomId, questId } = await seedRoom(t);

  await Promise.all([
    t.action(internal.plans.generate, { roomId, questId }),
    t.action(internal.plans.generate, { roomId, questId }),
  ]);

  const plans = await t.run(async (ctx) => ctx.db.query("plans").collect());
  expect(plans).toHaveLength(1);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

test("queued match and retry duplicates make one provider call and one plan", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  const { roomId, questId, code } = await unplannedRoom(t, { code: "4470" });

  await t.mutation(api.plans.retry, { code, sessionKey: "k-bec" });
  await t.mutation(api.plans.retry, { code, sessionKey: "k-bec" });
  await runScheduled(t);

  const plans = await t.run(async (ctx) => ctx.db.query("plans").collect());
  expect(plans).toHaveLength(1);
  expect(plans[0].roomId).toBe(roomId);
  expect(plans[0].questId).toBe(questId);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

test("a queued retry denied plan admission writes the local fallback without a provider call", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  const { roomId, code } = await unplannedRoom(t, { code: "4471" });
  for (let count = 0; count < 3; count++) {
    await t.mutation(internal.rateLimits.reserveGeneration, { roomId, family: "plan" });
  }

  await t.mutation(api.plans.retry, { code, sessionKey: "k-bec" });
  await runScheduled(t);

  expect(await storedPlan(t, roomId)).not.toBeNull();
  expect(fetchMock).not.toHaveBeenCalled();
  expect(
    await t.query(internal.rateLimits.checkGeneration, { roomId, family: "plan" }),
  ).toBe(false);
  expect((await t.run(async (ctx) => ctx.db.get(roomId)))!.planStartedAt).toBeUndefined();
});

// --- the plan lease and the host's retry ----------------------------------
//
// A matched room used to have exactly one chance at a plan. `resolveMatch`
// scheduled `generate` once and nothing scheduled it again, so a build killed
// mid-flight -- a deploy, a timeout, the action simply dying -- left the room
// on "Writing the plan..." forever, with no plan, no error, and no way out
// short of a developer opening the database. These are the two halves of the
// cure: a claim that expires, and a host who can ask again.

/**
 * Run the work `retry` handed off. `finishInProgressScheduledFunctions` drains
 * only jobs already in flight, and a `runAfter(0)` posted from a mutation is
 * still pending when that mutation returns -- so without driving the timers the
 * build never starts and the assertion passes over an empty table.
 */
async function runScheduled(t: T) {
  vi.useFakeTimers();
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  vi.useRealTimers();
}

/** A matched room with a host and a guest, and no plan written yet. */
async function unplannedRoom(t: T, over: { code?: string } = {}) {
  const code = over.code ?? "4460";
  const { roomId, questId } = await seedRoom(t, { code });
  await t.run(async (ctx) => {
    await ctx.db.insert("members", {
      roomId, name: "Bec", userId: "u1", isHost: true, sessionKey: "k-bec", joinedAt: 1,
    });
    await ctx.db.insert("members", {
      roomId, name: "Tam", isHost: false, sessionKey: "k-tam", joinedAt: 2,
    });
    await ctx.db.patch(roomId, { matchedQuestId: questId });
  });
  return { roomId, questId, code };
}

test("the plan queue never runs more than eight provider calls at once", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  let active = 0;
  let peak = 0;
  fetchMock.mockImplementation(async (url: string) => {
    if (String(url) !== OPENAI_URL) throw new Error(`Unexpected fetch to ${url}`);
    active += 1;
    peak = Math.max(peak, active);
    await Promise.resolve();
    active -= 1;
    return json(chatBody(modelPlan));
  });

  await t.run(async (ctx) => {
    for (let index = 0; index < 9; index += 1) {
      const roomId = await ctx.db.insert("rooms", {
        hostUserId: "u1",
        mood: "grass",
        headcount: 1,
        budgetPerHeadCents: 3000,
        whenAt: START,
        centreLat: -37.8,
        centreLng: 144.96,
        radiusKm: 5,
        visibility: "private",
        status: "matched",
        code: `45${String(index).padStart(2, "0")}`,
      });
      const questId = await ctx.db.insert("quests", {
        roomId,
        rank: 0,
        source: "places",
        placeId: `queue-${index}`,
        title: "Princes Park",
        blurb: "",
        priceLabel: "Free",
        priceCents: 0,
        distanceKm: 1,
        discountPct: 0,
        score: 1,
        scoreBreakdown: {},
      });
      await enqueuePlanGeneration(ctx, roomId, questId);
    }
  });

  await runScheduled(t);

  expect(peak).toBeLessThanOrEqual(8);
  expect(await t.run(async (ctx) => ctx.db.query("plans").collect())).toHaveLength(9);
});

test("the host can ask again for a plan that never arrived", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  delete process.env.OPENAI_API_KEY; // the canned night, so nothing goes near the wire
  const { roomId, code } = await unplannedRoom(t);

  await t.mutation(api.plans.retry, { code, sessionKey: "k-bec" });
  await runScheduled(t);

  const plan = await storedPlan(t, roomId);
  expect(plan).not.toBeNull();
  expect(plan!.stops.length).toBeGreaterThanOrEqual(2);
  // And the claim is released again, so the room is not left mid-build.
  const room = await t.run(async (ctx) => ctx.db.get(roomId));
  expect(room!.planStartedAt).toBeUndefined();
});

test("only the host can ask again", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  const { code } = await unplannedRoom(t);

  await expectUserError(
    t.mutation(api.plans.retry, { code, sessionKey: "k-tam" }),
    "NOT_THE_HOST",
    /host/i,
  );
  await expectUserError(
    t.mutation(api.plans.retry, { code, sessionKey: "k-nobody" }),
    "NOT_A_MEMBER",
    /not a member/i,
  );
});

// Idempotent, not an error. The button is on a screen the whole room can see
// mid-build; by the time a second tap lands the plan is often already there,
// and telling that host they did something wrong would be a lie.
test("asking again once the plan has landed changes nothing", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  delete process.env.OPENAI_API_KEY;
  const { roomId, questId, code } = await unplannedRoom(t);
  await writePlanUnderLease(t, {
    roomId, questId,
    stops: [stop({ id: "s1", slot: "main", name: "The night they already have" })],
    shareMessage: "already here",
  });

  await t.mutation(api.plans.retry, { code, sessionKey: "k-bec" });
  await runScheduled(t);

  const plans = await t.run(async (ctx) => ctx.db.query("plans").collect());
  expect(plans).toHaveLength(1);
  expect(plans[0].shareMessage).toBe("already here");
});

test("asking again while a build is genuinely in flight is refused, not queued", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  const { roomId, code } = await unplannedRoom(t);
  // A build that started a moment ago and has not finished.
  await t.mutation(internal.plans.markGenerating, { roomId });

  await expectUserError(
    t.mutation(api.plans.retry, { code, sessionKey: "k-bec" }),
    "PLAN_IN_PROGRESS",
    /still being written/i,
  );
});

test("a claim older than the staleness bound may be retried", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  delete process.env.OPENAI_API_KEY;
  const { roomId, code } = await unplannedRoom(t);
  await t.mutation(internal.plans.markGenerating, { roomId });
  // The build that took this claim is gone; nothing will ever release it.
  await t.run(async (ctx) => {
    await ctx.db.patch(roomId, { planStartedAt: Date.now() - 10 * 60 * 1000 });
  });

  await t.mutation(api.plans.retry, { code, sessionKey: "k-bec" });
  await runScheduled(t);

  expect(await storedPlan(t, roomId)).not.toBeNull();
});

// The reason the token exists at all. A stalled build is not stopped when its
// claim is taken -- it is still running, and it still thinks it owns the room.
test("a build whose claim was taken cannot write over the plan that replaced it", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const { roomId, questId } = await unplannedRoom(t);

  const stalled = await t.mutation(internal.plans.markGenerating, { roomId });
  await t.run(async (ctx) => {
    await ctx.db.patch(roomId, { planStartedAt: Date.now() - 10 * 60 * 1000 });
  });
  const live = await t.mutation(internal.plans.markGenerating, { roomId });
  expect(live).not.toBeNull();
  expect(live).not.toBe(stalled);

  await t.mutation(internal.plans.writePlan, {
    roomId, questId, token: live as string,
    stops: [stop({ id: "s1", slot: "main", name: "The night that won" })],
    shareMessage: "the newer plan",
  });

  // The zombie finally finishes and tries to write its own answer.
  const dropped = await t.mutation(internal.plans.writePlan, {
    roomId, questId, token: stalled as string,
    stops: [stop({ id: "s1", slot: "main", name: "The night nobody is on" })],
    shareMessage: "the stale plan",
  });

  expect(dropped).toBeNull();
  const plans = await t.run(async (ctx) => ctx.db.query("plans").collect());
  expect(plans).toHaveLength(1);
  expect(plans[0].shareMessage).toBe("the newer plan");
});

// A build that dies inside its own handler must hand the room back, or the
// retry it needs is refused for a further minute for no reason.
test("a build that throws releases the room instead of holding it", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const { roomId, questId } = await unplannedRoom(t);
  // The quest is gone, so `planContext` throws after the claim is taken.
  await t.run(async (ctx) => ctx.db.delete(questId));

  await expect(t.action(internal.plans.generate, { roomId, questId })).rejects.toBeInstanceOf(
    ConvexError,
  );

  const room = await t.run(async (ctx) => ctx.db.get(roomId));
  expect(room!.planStartedAt).toBeUndefined();
});

test("planContext refuses a room that has been deleted", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  const { roomId, questId } = await seedRoom(t);
  await t.run(async (ctx) => ctx.db.delete(roomId));

  await expectUserError(
    t.query(internal.plans.planContext, { roomId, questId }),
    "ROOM_NOT_FOUND",
    /room is gone/i,
  );
});

// The pair has to belong together. Nothing outside the backend can supply a
// mismatched one today, but a mismatch would plan ANOTHER room's venue against
// this room's budget, party size and start time -- and write it into this
// room's plan without a word. Delete the guard and this is the only thing that
// notices.
test("planContext refuses a quest that belongs to a different room", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  const mine = await seedRoom(t, { code: "4444" });
  const theirs = await seedRoom(t, { code: "5555", title: "Someone else's night" });

  await expectUserError(
    t.query(internal.plans.planContext, { roomId: mine.roomId, questId: theirs.questId }),
    "QUEST_NOT_FOUND",
    /another room/i,
  );
});

// --- applyStopSwap --------------------------------------------------------
//
// Tested here, where it is written, rather than in Task 12 where it is first
// called: it is the shared spine of every plan edit, and both callers depend on
// exactly these times, this total, and this refusal to touch a locked stop.

const stop = (over: Partial<Stop> = {}): Stop => ({
  id: "s1", slot: "main", name: "A", startAt: START, durationMin: 30,
  costPerHeadCents: 0, note: "", source: "llm", locked: false, ...over,
});

async function seedPlan(t: T, stops: Stop[]) {
  const { roomId, questId } = await seedRoom(t);
  await writePlanUnderLease(t, { roomId, questId, stops, shareMessage: "hi" });
  return roomId;
}

test("a swap keeps the stop's id, recomputes the times after it and re-totals", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  const roomId = await seedPlan(t, [
    stop({ id: "a", slot: "meet", name: "Gate", durationMin: 20, costPerHeadCents: 0 }),
    stop({ id: "b", slot: "main", name: "Old main", durationMin: 60, costPerHeadCents: 1000 }),
    stop({ id: "c", slot: "after", name: "Nightcap", durationMin: 45, costPerHeadCents: 500 }),
  ]);

  await t.run(async (ctx) =>
    applyStopSwap(ctx, roomId, "b", stop({
      id: "ignored", slot: "main", name: "New main", durationMin: 90, costPerHeadCents: 1500,
    })),
  );

  const plan = (await storedPlan(t, roomId))!;
  // The id survives, so an open proposal or an on-screen card still points at it.
  expect(plan.stops.map((s) => s.id)).toEqual(["a", "b", "c"]);
  expect(plan.stops[1].name).toBe("New main");
  // The longer main pushes the nightcap back; a stale time would be a lie.
  expect(plan.stops[1].startAt).toBe(START + (20 + TRAVEL_BUFFER_MIN) * 60_000);
  expect(plan.stops[2].startAt).toBe(plan.stops[1].startAt + (90 + TRAVEL_BUFFER_MIN) * 60_000);
  expect(plan.totalPerHeadCents).toBe(0 + 1500 + 500);
});

test("a swap never smuggles a locked flag back in with the replacement", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  const roomId = await seedPlan(t, [stop({ id: "a" })]);

  await t.run(async (ctx) =>
    applyStopSwap(ctx, roomId, "a", stop({ name: "Replacement", locked: true })),
  );

  const plan = (await storedPlan(t, roomId))!;
  expect(plan.stops[0].locked).toBe(false);
});

test("a locked stop refuses the swap and the plan is left untouched", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  const roomId = await seedPlan(t, [stop({ id: "a", name: "Booked table", locked: true })]);

  await expectUserError(
    t.run(async (ctx) => applyStopSwap(ctx, roomId, "a", stop({ name: "Somewhere else" }))),
    "STOP_LOCKED",
    /locked/i,
  );

  const plan = (await storedPlan(t, roomId))!;
  expect(plan.stops[0].name).toBe("Booked table");
});

test("swapping a stop that is not in the plan is refused", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  const roomId = await seedPlan(t, [stop({ id: "a" })]);

  await expectUserError(
    t.run(async (ctx) => applyStopSwap(ctx, roomId, "nope", stop())),
    "STOP_NOT_FOUND",
    /not in this plan/i,
  );
});

test("swapping before the plan exists is refused with something the user can act on", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  const { roomId } = await seedRoom(t);

  await expectUserError(
    t.run(async (ctx) => applyStopSwap(ctx, roomId, "a", stop())),
    "PLAN_NOT_READY",
    /no plan/i,
  );
});

// --- searchStop and suggestStop -------------------------------------------

const PLACES_TEXT_URL = "https://places.googleapis.com/v1/places:searchText";

const placesBody = {
  places: [
    {
      id: "p1",
      displayName: { text: "Bar Liberty" },
      formattedAddress: "234 Johnston St",
      priceLevel: "PRICE_LEVEL_EXPENSIVE",
      editorialSummary: { text: "Wine bar with a short menu" },
    },
    {
      id: "p2",
      displayName: { text: "Napier Hotel" },
      formattedAddress: "210 Napier St",
      priceLevel: "PRICE_LEVEL_MODERATE",
    },
    {
      id: "p3",
      displayName: { text: "Carlton Gardens" },
      formattedAddress: "1 Carlton St",
      priceLevel: "PRICE_LEVEL_FREE",
    },
    {
      id: "p4",
      displayName: { text: "Marion" },
      formattedAddress: "53 Gertrude St",
      priceLevel: "PRICE_LEVEL_EXPENSIVE",
    },
  ],
};

/** Both endpoints answered, so a test can exercise either path. */
function mockBoth(chat: unknown) {
  fetchMock.mockImplementation(async (url: string) => {
    if (String(url) === OPENAI_URL) return json(chat);
    if (String(url) === PLACES_TEXT_URL) return json(placesBody);
    throw new Error(`Unexpected fetch to ${url}`);
  });
}

/** A room the caller is actually a member of, with a plan to edit. */
async function seedMemberRoom(
  t: T,
  over: {
    code?: string; budgetPerHeadCents?: number; stops?: Stop[];
    mood?: "grass" | "meet" | "treat" | "new";
  } = {},
) {
  const code = over.code ?? "4446";
  const { roomId, questId } = await seedRoom(t, {
    code,
    mood: over.mood,
    budgetPerHeadCents: over.budgetPerHeadCents ?? 3000,
  });
  await t.run(async (ctx) => {
    await ctx.db.insert("members", {
      roomId, name: "Bec", userId: "u1", isHost: true, sessionKey: "k-bec", joinedAt: 1,
    });
  });
  await writePlanUnderLease(t, {
    roomId, questId,
    stops: over.stops ?? [
      stop({ id: "a", slot: "meet", name: "Gate", durationMin: 20 }),
      stop({ id: "b", slot: "after", name: "Old nightcap", durationMin: 45, locked: true }),
    ],
    shareMessage: "hi",
  });
  return { roomId, questId, code };
}

test("searchStop returns the typed venues as swap candidates", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  mockBoth(chatBody(modelPlan));
  const { code } = await seedMemberRoom(t);

  const { options } = await t.action(api.plans.searchStop, {
    code, sessionKey: "k-bec", query: "wine bar", slot: "after",
  });

  expect(options.map((o) => o.name)).toEqual([
    "Bar Liberty", "Napier Hotel", "Carlton Gardens", "Marion",
  ]);
  expect(options.every((o) => o.slot === "after")).toBe(true);
  expect(options[0].placeId).toBe("p1");
  // The summary is the note when there is one; the address stands in when not.
  expect(options[0].note).toBe("Wine bar with a short menu");
  expect(options[1].note).toBe("210 Napier St");

  const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
  expect(body.textQuery).toBe("wine bar");
});

/**
 * HONESTY. `deck.ts` may stamp a free room's cards at $0 because it restricts
 * the search to FREE_TYPES first. searchStop takes free text, so the same $0
 * would be a price that is not the price -- a group that typed the name of an
 * expensive restaurant would find out at the table.
 */
test("a $0 room is shown the real price estimate, never a fabricated $0", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  mockBoth(chatBody(modelPlan));
  const { code } = await seedMemberRoom(t, { code: "4447", budgetPerHeadCents: 0 });

  const { options } = await t.action(api.plans.searchStop, {
    code, sessionKey: "k-bec", query: "fancy dinner", slot: "main",
  });

  expect(options[0].costPerHeadCents).toBe(7000);
  expect(options[1].costPerHeadCents).toBe(3500);
  // A genuinely free place is still free -- the estimate is reported as it is.
  expect(options[2].costPerHeadCents).toBe(0);
});

test("a blank search spends nothing and returns nothing", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  mockBoth(chatBody(modelPlan));
  const { code } = await seedMemberRoom(t);

  const { options } = await t.action(api.plans.searchStop, {
    code, sessionKey: "k-bec", query: "   ", slot: "main",
  });
  expect(options).toEqual([]);
  expect(fetchMock).not.toHaveBeenCalled();
});

test("a stranger's session key cannot search against a room's area", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  mockBoth(chatBody(modelPlan));
  const { code } = await seedMemberRoom(t);

  await expectUserError(
    t.action(api.plans.searchStop, {
      code, sessionKey: "k-nobody", query: "wine bar", slot: "main",
    }),
    "NOT_A_MEMBER",
    /not a member/i,
  );
  expect(fetchMock).not.toHaveBeenCalled();
});

test("suggestStop returns the model's three alternatives for that slot", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  mockBoth(
    chatBody({
      options: [
        { name: "Bar Liberty", durationMin: 90, costPerHeadCents: 2500, note: "Short menu" },
        { name: "Napier Hotel", durationMin: 60, costPerHeadCents: 1800, note: "Parma" },
        { name: "Marion", durationMin: 75, costPerHeadCents: 3000, note: "Wine" },
        { name: "A fourth", durationMin: 60, costPerHeadCents: 100, note: "too many" },
      ],
    }),
  );
  const { code } = await seedMemberRoom(t);

  const { options } = await t.action(api.plans.suggestStop, {
    code, sessionKey: "k-bec", stopId: "a",
  });

  expect(options).toHaveLength(3);
  expect(options.map((o) => o.name)).toEqual(["Bar Liberty", "Napier Hotel", "Marion"]);
  // The replacement is for the target stop's slot, not the model's opinion of it.
  expect(options.every((o) => o.slot === "meet")).toBe(true);
  expect(options[0].costPerHeadCents).toBe(2500);

  // The prompt carries the stops that are staying, and says which are locked,
  // so the suggestion fits the night rather than replacing it.
  const prompt = JSON.parse(fetchMock.mock.calls[0][1].body as string).messages[0].content;
  expect(prompt).toContain("Old nightcap");
  expect(prompt).toContain("locked, do not change");
  // The stop being replaced is named as the thing to replace, and is absent
  // from the list of stops that are staying.
  expect(prompt).toContain('Replace the "meet" stop, currently "Gate"');
  expect(prompt).not.toContain("meet: Gate");
});

test("a nonsense cost from the model is sanitised, and a real one is kept", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  mockBoth(
    chatBody({
      options: [
        { name: "Negative", durationMin: 60, costPerHeadCents: -500, note: "" },
        { name: "Not a number", durationMin: -1, costPerHeadCents: "free", note: 7 },
        { name: "Real", durationMin: 45, costPerHeadCents: 2200.4, note: "ok" },
      ],
    }),
  );
  const { code } = await seedMemberRoom(t, { code: "4448", budgetPerHeadCents: 0 });

  const { options } = await t.action(api.plans.suggestStop, {
    code, sessionKey: "k-bec", stopId: "a",
  });

  expect(options[0].costPerHeadCents).toBe(0);
  expect(options[1].costPerHeadCents).toBe(0);
  expect(options[1].durationMin).toBe(60);
  expect(typeof options[1].note).toBe("string");
  // A $0 room does NOT flatten a real estimate to $0. isOverBudget flags it and
  // the group declines knowingly, rather than being told it is free.
  expect(options[2].costPerHeadCents).toBe(2200);
});

test("suggestStop falls back to a nearby search when the model is unavailable", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  fetchMock.mockImplementation(async (url: string) => {
    if (String(url) === OPENAI_URL) return new Response("upstream is unhappy", { status: 503 });
    if (String(url) === PLACES_TEXT_URL) return json(placesBody);
    throw new Error(`Unexpected fetch to ${url}`);
  });
  const { code } = await seedMemberRoom(t);

  const { options } = await t.action(api.plans.suggestStop, {
    code, sessionKey: "k-bec", stopId: "a",
  });

  // Three options, never an empty sheet -- an empty sheet reads as a broken
  // button.
  expect(options).toHaveLength(3);
  expect(options[0].name).toBe("Bar Liberty");
  expect(options.every((o) => o.slot === "meet")).toBe(true);
  // The fallback searches for the stop it is replacing.
  const placesCall = fetchMock.mock.calls.find((c) => String(c[0]) === PLACES_TEXT_URL)!;
  expect(JSON.parse(placesCall[1].body as string).textQuery).toBe("Gate");
  // Degrading silently would hide the outage for the whole of a live demo.
  expect(warn).toHaveBeenCalled();
  expect(String(warn.mock.calls[0][0])).toContain("4446");
});


test("suggestStop refuses a stop that is not in the plan", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  mockBoth(chatBody(modelPlan));
  const { code } = await seedMemberRoom(t);

  await expectUserError(
    t.action(api.plans.suggestStop, { code, sessionKey: "k-bec", stopId: "nope" }),
    "STOP_NOT_FOUND",
    /not in this plan/i,
  );
});

test("suggestStop refuses a room whose plan has not landed yet", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  mockBoth(chatBody(modelPlan));
  const { roomId } = await seedRoom(t, { code: "4449" });
  await t.run(async (ctx) => {
    await ctx.db.insert("members", {
      roomId, name: "Bec", userId: "u1", isHost: true, sessionKey: "k-bec", joinedAt: 1,
    });
  });

  await expectUserError(
    t.action(api.plans.suggestStop, { code: "4449", sessionKey: "k-bec", stopId: "a" }),
    "PLAN_NOT_READY",
    /no plan to edit/i,
  );
});

/**
 * "Suggest another" must not suggest the same place. The fallback searches for
 * the stop it is replacing, so the venue being swapped out is the likeliest hit
 * of all -- and a duplicate listing under a second place id is no more of an
 * alternative than the original.
 */
test("the fallback never offers back the stop it is replacing", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  fetchMock.mockImplementation(async (url: string) => {
    if (String(url) === OPENAI_URL) return new Response("upstream is unhappy", { status: 503 });
    if (String(url) === PLACES_TEXT_URL) {
      return json({
        places: [
          // The target itself, by place id.
          { id: "p1", displayName: { text: "Bar Liberty" }, formattedAddress: "234 Johnston St" },
          // A duplicate listing: different id, same venue.
          { id: "p9", displayName: { text: "bar liberty " }, formattedAddress: "234 Johnston St" },
          { id: "p2", displayName: { text: "Napier Hotel" }, formattedAddress: "210 Napier St" },
          { id: "p3", displayName: { text: "Marion" }, formattedAddress: "53 Gertrude St" },
        ],
      });
    }
    throw new Error(`Unexpected fetch to ${url}`);
  });

  const { code } = await seedMemberRoom(t, {
    code: "4450",
    stops: [stop({ id: "a", slot: "main", name: "Bar Liberty", placeId: "p1" })],
  });

  const { options } = await t.action(api.plans.suggestStop, {
    code, sessionKey: "k-bec", stopId: "a",
  });

  // Two real alternatives, not three where one of them is the stop itself.
  expect(options.map((o) => o.name)).toEqual(["Napier Hotel", "Marion"]);
});

/**
 * Two options instead of three is the right trade. ZERO is the empty sheet the
 * whole fallback exists to prevent, so a filtered-to-nothing result is answered
 * with a fresh search -- on the room's mood, since the target's name is what
 * got us here -- and never by relaxing the filter that was just applied.
 */
test("when the filter empties the sheet, the mood is searched instead", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const textQueries: string[] = [];
  fetchMock.mockImplementation(async (url: string, init: { body: string }) => {
    if (String(url) === OPENAI_URL) return new Response("upstream is unhappy", { status: 503 });
    if (String(url) === PLACES_TEXT_URL) {
      textQueries.push(JSON.parse(init.body).textQuery);
      // The name search finds only the venue being replaced, plus a duplicate
      // listing of it: nothing survives the filter.
      if (textQueries.length === 1) {
        return json({
          places: [
            { id: "p1", displayName: { text: "Gate" }, formattedAddress: "1 Royal Pde" },
            { id: "p9", displayName: { text: "gate " }, formattedAddress: "1 Royal Pde" },
          ],
        });
      }
      return json({
        places: [
          { id: "p2", displayName: { text: "Princes Park" }, formattedAddress: "Royal Pde" },
          { id: "p3", displayName: { text: "Carlton Gardens" }, formattedAddress: "1 Carlton St" },
        ],
      });
    }
    throw new Error(`Unexpected fetch to ${url}`);
  });

  const { code } = await seedMemberRoom(t, {
    code: "4451",
    stops: [stop({ id: "a", slot: "meet", name: "Gate", placeId: "p1" })],
  });

  const { options } = await t.action(api.plans.suggestStop, {
    code, sessionKey: "k-bec", stopId: "a",
  });

  expect(options.map((o) => o.name)).toEqual(["Princes Park", "Carlton Gardens"]);
  // The second query is the room's mood -- "grass" -- not the target's name.
  expect(textQueries[0]).toBe("Gate");
  expect(textQueries[1]).toBe("park hiking area beach garden");
  // And the near miss is in the logs rather than being a silently blank sheet.
  // The log says WHICH near miss this was: results came back, all of them the
  // target. An area that returned nothing gets a different sentence.
  const messages = warn.mock.calls.map((c) => String(c[0]));
  expect(messages.every((m) => m.includes("4451"))).toBe(true);
  expect(messages.some((m) => /returned 2 result\(s\), all of them that same venue/.test(m))).toBe(true);
  expect(messages.some((m) => /returned nothing/.test(m))).toBe(false);
});

test("an area with genuinely nothing to offer returns empty, but says so", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  fetchMock.mockImplementation(async (url: string) => {
    if (String(url) === OPENAI_URL) return new Response("upstream is unhappy", { status: 503 });
    if (String(url) === PLACES_TEXT_URL) return json({ places: [] });
    throw new Error(`Unexpected fetch to ${url}`);
  });

  const { code } = await seedMemberRoom(t, { code: "4452" });
  const { options } = await t.action(api.plans.suggestStop, {
    code, sessionKey: "k-bec", stopId: "a",
  });

  expect(options).toEqual([]);
  const messages = warn.mock.calls.map((c) => String(c[0]));
  // Nothing came back at all, and the log says so rather than claiming the
  // search returned only the venue being replaced.
  expect(messages.some((m) => /returned nothing; trying the room's mood/.test(m))).toBe(true);
  expect(messages.some((m) => /all of them that same venue/.test(m))).toBe(false);
  expect(messages.some((m) => /after a mood search either/.test(m))).toBe(true);
});

// --- the plan tells the room when it is over budget ------------------------

test("a plan inside the room's budget does not read as over it", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  const { code } = await seedMemberRoom(t, {
    code: "4453",
    budgetPerHeadCents: 3000,
    stops: [stop({ id: "a", costPerHeadCents: 1000 })],
  });

  const view = await t.query(api.rooms.get, { code, sessionKey: "k-bec" });
  expect(view!.plan!.totalPerHeadCents).toBe(1000);
  expect(view!.plan!.overBudget).toBe(false);
});

/**
 * The whole point of refusing to fabricate a $0 price. Nothing REFUSES the
 * expensive swap -- the group is allowed to decide to overspend -- so the plan
 * has to carry the fact, or "the group declines knowingly" is a claim with
 * nothing behind it.
 */
test("a $0 room that swaps in a paid venue can see that it is over budget", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  mockBoth(chatBody(modelPlan));
  const { code } = await seedMemberRoom(t, {
    code: "4454",
    budgetPerHeadCents: 0,
    stops: [stop({ id: "a", costPerHeadCents: 0 })],
  });

  const before = await t.query(api.rooms.get, { code, sessionKey: "k-bec" });
  expect(before!.plan!.overBudget).toBe(false);

  // The $70/head option the honesty rule insists on showing at $70.
  const { options } = await t.action(api.plans.searchStop, {
    code, sessionKey: "k-bec", query: "fancy dinner", slot: "main",
  });
  expect(options[0].costPerHeadCents).toBe(7000);

  // A room of one swaps directly, and the swap is allowed to go through.
  await t.mutation(api.plans.replaceStop, {
    code, sessionKey: "k-bec", stopId: "a", replacement: options[0],
  });

  const after = await t.query(api.rooms.get, { code, sessionKey: "k-bec" });
  expect(after!.plan!.totalPerHeadCents).toBe(7000);
  expect(after!.plan!.overBudget).toBe(true);
});

/**
 * The mood fallback picks its search types the way `deck.build` does. A $0
 * "treat" room asked for MOOD_TYPES would be offered restaurants and spas --
 * the fabricated-$0 honesty problem pointed the other way. A group who said
 * they have nothing to spend gets places that are genuinely free to enter.
 */
test("a $0 room's mood fallback asks for free places, not restaurants and spas", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const textQueries: string[] = [];
  fetchMock.mockImplementation(async (url: string, init: { body: string }) => {
    if (String(url) === OPENAI_URL) return new Response("upstream is unhappy", { status: 503 });
    if (String(url) === PLACES_TEXT_URL) {
      textQueries.push(JSON.parse(init.body).textQuery);
      // The name search finds only the venue being replaced, so the filter
      // empties the sheet and the mood search runs.
      if (textQueries.length === 1) {
        return json({ places: [{ id: "p1", displayName: { text: "Gate" }, formattedAddress: "x" }] });
      }
      return json({ places: [{ id: "p2", displayName: { text: "Carlton Gardens" }, formattedAddress: "y" }] });
    }
    throw new Error(`Unexpected fetch to ${url}`);
  });

  const { code } = await seedMemberRoom(t, {
    code: "4455",
    mood: "treat",
    budgetPerHeadCents: 0,
    stops: [stop({ id: "a", slot: "main", name: "Gate", placeId: "p1" })],
  });

  const { options } = await t.action(api.plans.suggestStop, {
    code, sessionKey: "k-bec", stopId: "a",
  });

  // `tourist_attraction` is not on this list any more: Google hangs it on
  // ticketed venues as readily as on public parks, so it was quietly letting
  // paid places into a $0 room.
  expect(textQueries[1]).toBe("park hiking area beach garden");
  expect(textQueries[1]).not.toMatch(/restaurant|spa/);
  expect(options.map((o) => o.name)).toEqual(["Carlton Gardens"]);
});

test("a paid room's mood fallback still asks for that mood's own types", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const textQueries: string[] = [];
  fetchMock.mockImplementation(async (url: string, init: { body: string }) => {
    if (String(url) === OPENAI_URL) return new Response("upstream is unhappy", { status: 503 });
    if (String(url) === PLACES_TEXT_URL) {
      textQueries.push(JSON.parse(init.body).textQuery);
      if (textQueries.length === 1) {
        return json({ places: [{ id: "p1", displayName: { text: "Gate" }, formattedAddress: "x" }] });
      }
      return json({ places: [{ id: "p2", displayName: { text: "Marion" }, formattedAddress: "y" }] });
    }
    throw new Error(`Unexpected fetch to ${url}`);
  });

  const { code } = await seedMemberRoom(t, {
    code: "4456",
    mood: "treat",
    budgetPerHeadCents: 5000,
    stops: [stop({ id: "a", slot: "main", name: "Gate", placeId: "p1" })],
  });

  await t.action(api.plans.suggestStop, { code, sessionKey: "k-bec", stopId: "a" });

  expect(textQueries[1]).toBe("restaurant spa movie theater bakery");
});

// --- setLocked ------------------------------------------------------------
//
// The first tests this mutation has ever had. Issue #11 asked whether locking
// should become host-only or go to a vote; the ruling was that attribution
// comes first and unconditionally -- the stop records WHO locked it, under
// every rule -- and that all three of the issue's answers are then a house
// rule the host sets. See the comment above `plans.setLocked` and section 15
// of `docs/questly-handover.md`.
//
// These pin all of it: that the DEFAULT permission did not change, that the
// attribution works and is not client-supplied, that a room on "vote" cannot
// have a lock land without a majority, and that a room on "host" refuses
// everybody else in both directions.

/** A room with a plan and a roster, so a non-host has a sessionKey to lock with. */
async function seedLockRoom(t: T, names: string[], code = "4460") {
  const { roomId, questId } = await seedRoom(t, { code, budgetPerHeadCents: 3000 });
  await t.run(async (ctx) => {
    for (const [i, name] of names.entries()) {
      await ctx.db.insert("members", {
        roomId, name, isHost: i === 0, sessionKey: `k-${name}`, joinedAt: i,
      });
    }
  });
  await writePlanUnderLease(t, {
    roomId, questId,
    stops: [stop({ id: "a", name: "Gate" }), stop({ id: "b", name: "Nightcap" })],
    shareMessage: "hi",
  });
  return { roomId, code };
}

const planStops = async (t: T, roomId: Id<"rooms">) =>
  (await t.run(async (ctx) =>
    ctx.db.query("plans").withIndex("by_room", (q) => q.eq("roomId", roomId)).first(),
  ))!.stops;

test("locking records who locked it, from the member row and not from the client", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  const { roomId, code } = await seedLockRoom(t, ["Bec", "Tam"]);

  await t.mutation(api.plans.setLocked, {
    code, sessionKey: "k-Tam", stopId: "a", locked: true,
  });

  const stops = await planStops(t, roomId);
  expect(stops[0].locked).toBe(true);
  expect(stops[0].lockedBy).toBe("Tam");
});

test("a NON-host may still lock and unlock in a room that chose no rule", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  const { roomId, code } = await seedLockRoom(t, ["Bec", "Tam", "Sam"], "4461");

  // Tam is not the host. This is the case `lockRule: "host"` refuses -- and the
  // point is that a room which never chose that rule still does not get it.
  await t.mutation(api.plans.setLocked, { code, sessionKey: "k-Tam", stopId: "b", locked: true });
  expect((await planStops(t, roomId))[1].lockedBy).toBe("Tam");

  // And Sam, also not the host, can undo Tam's lock in one tap.
  await t.mutation(api.plans.setLocked, { code, sessionKey: "k-Sam", stopId: "b", locked: false });
  expect((await planStops(t, roomId))[1].locked).toBe(false);
});

test("unlocking clears the name rather than leaving a lie behind", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  const { roomId, code } = await seedLockRoom(t, ["Bec"], "4462");

  await t.mutation(api.plans.setLocked, { code, sessionKey: "k-Bec", stopId: "a", locked: true });
  await t.mutation(api.plans.setLocked, { code, sessionKey: "k-Bec", stopId: "a", locked: false });

  const stops = await planStops(t, roomId);
  expect(stops[0].locked).toBe(false);
  // Not merely falsy -- absent. A stale name on an unlocked stop is the sort of
  // lie that survives because nothing renders it.
  expect(stops[0].lockedBy).toBeUndefined();
});

test("re-locking replaces the previous name rather than keeping the first", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  const { roomId, code } = await seedLockRoom(t, ["Bec", "Tam"], "4463");

  await t.mutation(api.plans.setLocked, { code, sessionKey: "k-Bec", stopId: "a", locked: true });
  await t.mutation(api.plans.setLocked, { code, sessionKey: "k-Tam", stopId: "a", locked: true });
  expect((await planStops(t, roomId))[0].lockedBy).toBe("Tam");
});

test("a stranger is refused, and the plan is left untouched", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  const { roomId, code } = await seedLockRoom(t, ["Bec"], "4464");
  const before = await planStops(t, roomId);

  await expectUserError(
    t.mutation(api.plans.setLocked, { code, sessionKey: "not-a-key", stopId: "a", locked: true }),
    "NOT_A_MEMBER",
    /not a member/i,
  );

  expect(await planStops(t, roomId)).toEqual(before);
});

test("a stop id that is not in the plan is refused, and the plan is left untouched", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  const { roomId, code } = await seedLockRoom(t, ["Bec"], "4465");
  const before = await planStops(t, roomId);

  await expectUserError(
    t.mutation(api.plans.setLocked, { code, sessionKey: "k-Bec", stopId: "nope", locked: true }),
    "STOP_NOT_FOUND",
    /not in this plan/i,
  );

  expect(await planStops(t, roomId)).toEqual(before);
});

test("locking one stop leaves every other stop exactly as it was", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  const { roomId, code } = await seedLockRoom(t, ["Bec"], "4466");
  const before = await planStops(t, roomId);

  await t.mutation(api.plans.setLocked, { code, sessionKey: "k-Bec", stopId: "a", locked: true });

  const after = await planStops(t, roomId);
  expect(after[1]).toEqual(before[1]);
  // And the locked one changed in exactly two fields.
  expect({ ...after[0], locked: false, lockedBy: undefined }).toEqual({
    ...before[0],
    lockedBy: undefined,
  });
});

test("a swap cannot smuggle a lock or somebody else's name onto a stop", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  // Solo, because a group room routes a change through a proposal instead.
  const { roomId, code } = await seedLockRoom(t, ["Bec"], "4467");

  await t.mutation(api.plans.replaceStop, {
    code, sessionKey: "k-Bec", stopId: "a",
    // A client-authored replacement claiming both -- and signing a name that
    // is not even in this room.
    replacement: { ...stop({ id: "a", name: "Somewhere else" }), locked: true, lockedBy: "Tam" },
  });

  const stops = await planStops(t, roomId);
  expect(stops[0].name).toBe("Somewhere else");
  expect(stops[0].locked).toBe(false);
  expect(stops[0].lockedBy).toBeUndefined();
});

// --- setLocked under lockRule: "vote" --------------------------------------
//
// The other half of the #11 ruling. A room that turns this on is saying that a
// reversible signal is still a way to win an argument without having it, so the
// lock stops being a tap and becomes a proposal on the same table a swap uses.

/** Turn on the vote rule for a room that is already seeded. */
async function voteToLock(t: T, roomId: Id<"rooms">) {
  await t.run(async (ctx) => ctx.db.patch(roomId, { lockRule: "vote" }));
}

const openProposals = (t: T, roomId: Id<"rooms">) =>
  t.run(async (ctx) =>
    ctx.db
      .query("proposals")
      .withIndex("by_room_status", (q) => q.eq("roomId", roomId).eq("status", "open"))
      .collect(),
  );

test("under the vote rule a lock is asked for, not taken", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  const { roomId, code } = await seedLockRoom(t, ["Bec", "Tam"], "4470");
  await voteToLock(t, roomId);

  await t.mutation(api.plans.setLocked, { code, sessionKey: "k-Tam", stopId: "a", locked: true });

  // The stop has not moved: two people, so `needed(2)` is 2 and Tam is one.
  expect((await planStops(t, roomId))[0].locked).toBe(false);

  const open = await openProposals(t, roomId);
  expect(open).toHaveLength(1);
  expect(open[0].kind).toBe("lock");
  expect(open[0].stopId).toBe("a");
  // A lock replaces nothing, and the row says so rather than storing the
  // current stop back over itself.
  expect(open[0].replacement).toBeUndefined();
});

test("the majority carries the lock, and it is attributed to whoever asked", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  const { roomId, code } = await seedLockRoom(t, ["Bec", "Tam", "Sam"], "4471");
  await voteToLock(t, roomId);

  // Tam asks. That is one yes of the two `needed(3)` wants.
  await t.mutation(api.plans.setLocked, { code, sessionKey: "k-Tam", stopId: "a", locked: true });
  expect((await planStops(t, roomId))[0].locked).toBe(false);

  const [proposal] = await openProposals(t, roomId);
  await t.mutation(api.proposals.vote, {
    code, sessionKey: "k-Sam", proposalId: proposal._id, vote: "yes",
  });

  const stops = await planStops(t, roomId);
  expect(stops[0].locked).toBe(true);
  // The proposer's name, not the deciding voter's: Tam wanted it locked.
  expect(stops[0].lockedBy).toBe("Tam");
  expect(await openProposals(t, roomId)).toHaveLength(0);
});

test("a room that says no leaves the stop unlocked", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  const { roomId, code } = await seedLockRoom(t, ["Bec", "Tam"], "4472");
  await voteToLock(t, roomId);

  await t.mutation(api.plans.setLocked, { code, sessionKey: "k-Tam", stopId: "a", locked: true });
  const [proposal] = await openProposals(t, roomId);
  await t.mutation(api.proposals.vote, {
    code, sessionKey: "k-Bec", proposalId: proposal._id, vote: "no",
  });

  expect((await planStops(t, roomId))[0].locked).toBe(false);
  expect((await planStops(t, roomId))[0].lockedBy).toBeUndefined();
  expect(await openProposals(t, roomId)).toHaveLength(0);
});

test("unlocking goes to the room too, or the rule would be one-way", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  const { roomId, code } = await seedLockRoom(t, ["Bec", "Tam"], "4473");
  // Locked BEFORE the rule was turned on, which is how a room that switches
  // mid-plan actually looks.
  await t.mutation(api.plans.setLocked, { code, sessionKey: "k-Bec", stopId: "a", locked: true });
  await voteToLock(t, roomId);

  await t.mutation(api.plans.setLocked, { code, sessionKey: "k-Tam", stopId: "a", locked: false });
  // Still locked: asking is not unlocking.
  expect((await planStops(t, roomId))[0].locked).toBe(true);

  const [proposal] = await openProposals(t, roomId);
  expect(proposal.kind).toBe("unlock");
  await t.mutation(api.proposals.vote, {
    code, sessionKey: "k-Bec", proposalId: proposal._id, vote: "yes",
  });

  const stops = await planStops(t, roomId);
  expect(stops[0].locked).toBe(false);
  expect(stops[0].lockedBy).toBeUndefined();
});

test("asking for a lock that is already there opens nothing", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  const { roomId, code } = await seedLockRoom(t, ["Bec", "Tam"], "4474");
  await t.mutation(api.plans.setLocked, { code, sessionKey: "k-Bec", stopId: "a", locked: true });
  await voteToLock(t, roomId);

  // A proposal here would collect yeses for something that has happened, and
  // would hold the stop's one proposal slot while it did it.
  await t.mutation(api.plans.setLocked, { code, sessionKey: "k-Tam", stopId: "a", locked: true });

  expect(await openProposals(t, roomId)).toHaveLength(0);
  expect((await planStops(t, roomId))[0].lockedBy).toBe("Bec");
});

test("a lock vote and a swap vote cannot both be open on one stop", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  const { roomId, code } = await seedLockRoom(t, ["Bec", "Tam"], "4475");
  await voteToLock(t, roomId);

  await t.mutation(api.proposals.open, {
    code, sessionKey: "k-Bec", stopId: "a",
    replacement: stop({ id: "a", name: "Somewhere else" }),
    reason: "closer",
  });

  // Two contradictory votes on one stop would be settled by whichever majority
  // happened to land second.
  await expectUserError(
    t.mutation(api.plans.setLocked, { code, sessionKey: "k-Tam", stopId: "a", locked: true }),
    "PROPOSAL_EXISTS",
    /already an open proposal/i,
  );
  expect(await openProposals(t, roomId)).toHaveLength(1);
});

test("a room of one locks directly however the rule is set", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  const { roomId, code } = await seedLockRoom(t, ["Bec"], "4476");
  await voteToLock(t, roomId);

  await t.mutation(api.plans.setLocked, { code, sessionKey: "k-Bec", stopId: "a", locked: true });

  // `needed(1)` is 1, so a proposal would be opened and carried by its own
  // opening yes in the same transaction -- the same outcome, two rows heavier.
  expect(await openProposals(t, roomId)).toHaveLength(0);
  expect((await planStops(t, roomId))[0].lockedBy).toBe("Bec");
});

test("the vote rule is off unless a room turns it on", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  const { roomId, code } = await seedLockRoom(t, ["Bec", "Tam"], "4477");

  // The regression guard on the shipped ruling: every room that existed before
  // `lockRule` did has no such column, and locking must still be one tap.
  await t.mutation(api.plans.setLocked, { code, sessionKey: "k-Tam", stopId: "a", locked: true });

  expect(await openProposals(t, roomId)).toHaveLength(0);
  expect((await planStops(t, roomId))[0].locked).toBe(true);
});

test("a booked room refuses the ask as flatly as it refuses the tap", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  const { roomId, code } = await seedLockRoom(t, ["Bec", "Tam"], "4478");
  await voteToLock(t, roomId);
  await t.run(async (ctx) => ctx.db.patch(roomId, { status: "booked" }));

  await expectUserError(
    t.mutation(api.plans.setLocked, { code, sessionKey: "k-Tam", stopId: "a", locked: true }),
    "ROOM_BOOKED",
    /./,
  );
  expect(await openProposals(t, roomId)).toHaveLength(0);
});

test("a lock the room agreed to survives the proposer walking out", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  const { roomId, code } = await seedLockRoom(t, ["Bec", "Tam", "Sam"], "4479");
  await voteToLock(t, roomId);

  await t.mutation(api.plans.setLocked, { code, sessionKey: "k-Tam", stopId: "a", locked: true });
  // Tam leaves. Their opening yes goes with them, and `resolveOpenProposals`
  // re-decides against the two who are left: Sam is undecided, so `needed(2)`
  // of 2 is still reachable and the proposal stays open.
  await t.mutation(api.rooms.leave, { code, sessionKey: "k-Tam" });

  const [proposal] = await openProposals(t, roomId);
  expect(proposal).toBeDefined();
  await t.mutation(api.proposals.vote, {
    code, sessionKey: "k-Bec", proposalId: proposal._id, vote: "yes",
  });
  await t.mutation(api.proposals.vote, {
    code, sessionKey: "k-Sam", proposalId: proposal._id, vote: "yes",
  });

  const stops = await planStops(t, roomId);
  expect(stops[0].locked).toBe(true);
  // Nobody left to attribute it to, so it is recorded without a name rather
  // than blocked or signed by whoever happened to decide it.
  expect(stops[0].lockedBy).toBeUndefined();
});

test("a swap cannot be proposed while a lock vote is open on the same stop", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  const { roomId, code } = await seedLockRoom(t, ["Bec", "Tam"], "4480");
  await voteToLock(t, roomId);
  await t.mutation(api.plans.setLocked, { code, sessionKey: "k-Tam", stopId: "a", locked: true });

  // The other direction of the clash. `plans.setLocked` refuses a lock while a
  // swap is open; this is `proposals.open` refusing a swap while a lock is, and
  // it is the direction this feature newly made reachable.
  await expectUserError(
    t.mutation(api.proposals.open, {
      code, sessionKey: "k-Bec", stopId: "a",
      replacement: stop({ id: "a", name: "Somewhere else" }),
      reason: "closer",
    }),
    "PROPOSAL_EXISTS",
    /already an open proposal/i,
  );
  expect(await openProposals(t, roomId)).toHaveLength(1);
});

test("turning the vote off closes the lock votes it was running", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  const { roomId, code } = await seedLockRoom(t, ["Bec", "Tam", "Sam"], "4481");
  await t.run(async (ctx) => ctx.db.patch(roomId, { lockRule: "vote" }));
  await t.mutation(api.plans.setLocked, { code, sessionKey: "k-Tam", stopId: "a", locked: true });
  expect(await openProposals(t, roomId)).toHaveLength(1);

  // Bec is the host (seedLockRoom makes the first name the host).
  await t.mutation(api.rooms.setRules, { code, sessionKey: "k-Bec", lockRule: "anyone" });

  // Left open, the proposal outlives its own premise: the stop is tappable now,
  // and a late yes would re-lock it by a rule nobody is running.
  const open = await openProposals(t, roomId);
  expect(open).toHaveLength(0);
  const closed = await t.run(async (ctx) =>
    ctx.db.query("proposals").withIndex("by_room_status", (q) =>
      q.eq("roomId", roomId).eq("status", "rejected"),
    ).collect(),
  );
  // Rejected, not deleted: a proposal that vanishes is one nobody can see was
  // decided.
  expect(closed).toHaveLength(1);
});

test("a swap vote is not closed by the lock rule moving", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  const { roomId, code } = await seedLockRoom(t, ["Bec", "Tam", "Sam"], "4482");
  await t.mutation(api.proposals.open, {
    code, sessionKey: "k-Tam", stopId: "a",
    replacement: stop({ id: "a", name: "Somewhere else" }),
    reason: "closer",
  });

  await t.mutation(api.rooms.setRules, { code, sessionKey: "k-Bec", lockRule: "vote" });

  // Only the proposals whose question the rule actually governs. A swap vote is
  // the room's ordinary business under either rule.
  expect(await openProposals(t, roomId)).toHaveLength(1);
});

test("a late yes never steals the lock from whoever actually placed it", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  const { roomId, code } = await seedLockRoom(t, ["Bec", "Tam", "Sam"], "4483");
  await t.run(async (ctx) => ctx.db.patch(roomId, { lockRule: "vote" }));
  await t.mutation(api.plans.setLocked, { code, sessionKey: "k-Tam", stopId: "a", locked: true });
  const [proposal] = await openProposals(t, roomId);

  // The rule moves and Bec takes the lock directly, before the vote lands. The
  // proposal is closed by the rule change, so reach past it to the tally --
  // this is the guard in `applyProposal`, not the one in `setRules`.
  await t.run(async (ctx) => ctx.db.patch(roomId, { lockRule: "anyone" }));
  await t.mutation(api.plans.setLocked, { code, sessionKey: "k-Bec", stopId: "a", locked: true });
  await t.mutation(api.proposals.vote, {
    code, sessionKey: "k-Sam", proposalId: proposal._id, vote: "yes",
  });

  // The room got what it asked for, and the name on it is the person who did
  // it. Rewriting to "Tam" would be exactly the lie `lockedBy` exists to end.
  const stops = await planStops(t, roomId);
  expect(stops[0].locked).toBe(true);
  expect(stops[0].lockedBy).toBe("Bec");
});

// --- setLocked under lockRule: "host" --------------------------------------
//
// The third answer issue #11 offered. It was argued against in this codebase
// before it was asked for, and the argument is kept in section 15 of the
// handover rather than deleted -- but it is a rule the host turns on, not a
// default, and what matters here is that the privilege is real: enforced on the
// server, off the member row, in both directions.

test("under the host rule the host locks, in one tap", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  const { roomId, code } = await seedLockRoom(t, ["Bec", "Tam"], "4490");
  await t.run(async (ctx) => ctx.db.patch(roomId, { lockRule: "host" }));

  await t.mutation(api.plans.setLocked, { code, sessionKey: "k-Bec", stopId: "a", locked: true });

  // No vote: this rule names one person, it does not ask the room.
  expect(await openProposals(t, roomId)).toHaveLength(0);
  const stops = await planStops(t, roomId);
  expect(stops[0].locked).toBe(true);
  expect(stops[0].lockedBy).toBe("Bec");
});

test("under the host rule a guest is refused, and nothing moves", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  const { roomId, code } = await seedLockRoom(t, ["Bec", "Tam"], "4491");
  await t.run(async (ctx) => ctx.db.patch(roomId, { lockRule: "host" }));
  const before = await planStops(t, roomId);

  await expectUserError(
    t.mutation(api.plans.setLocked, { code, sessionKey: "k-Tam", stopId: "a", locked: true }),
    "NOT_THE_HOST",
    /host/i,
  );

  // Refused outright, not quietly turned into a proposal.
  expect(await openProposals(t, roomId)).toHaveLength(0);
  expect(await planStops(t, roomId)).toEqual(before);
});

test("the host rule refuses a guest's UNLOCK as well, or it protects nothing", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  const { roomId, code } = await seedLockRoom(t, ["Bec", "Tam"], "4492");
  await t.run(async (ctx) => ctx.db.patch(roomId, { lockRule: "host" }));
  await t.mutation(api.plans.setLocked, { code, sessionKey: "k-Bec", stopId: "a", locked: true });

  // The asymmetric version of this rule -- host locks, anyone unlocks -- would
  // leave the host able to protect nothing, which is not the rule anyone
  // turned on.
  await expectUserError(
    t.mutation(api.plans.setLocked, { code, sessionKey: "k-Tam", stopId: "a", locked: false }),
    "NOT_THE_HOST",
    /host/i,
  );
  expect((await planStops(t, roomId))[0].locked).toBe(true);
});

test("a stranger under the host rule is a stranger, not a guest", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  const { roomId, code } = await seedLockRoom(t, ["Bec", "Tam"], "4493");
  await t.run(async (ctx) => ctx.db.patch(roomId, { lockRule: "host" }));

  // Membership is established before the rule is consulted, so somebody with
  // no key is told they are not in the room rather than being told who the
  // host of a room they are not in is.
  await expectUserError(
    t.mutation(api.plans.setLocked, { code, sessionKey: "not-a-key", stopId: "a", locked: true }),
    "NOT_A_MEMBER",
    /not a member/i,
  );
  expect((await planStops(t, roomId))[0].locked).toBe(false);
});

test("switching to the host rule closes the votes the room was running", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  const { roomId, code } = await seedLockRoom(t, ["Bec", "Tam", "Sam"], "4494");
  await t.run(async (ctx) => ctx.db.patch(roomId, { lockRule: "vote" }));
  await t.mutation(api.plans.setLocked, { code, sessionKey: "k-Tam", stopId: "a", locked: true });
  expect(await openProposals(t, roomId)).toHaveLength(1);

  await t.mutation(api.rooms.setRules, { code, sessionKey: "k-Bec", lockRule: "host" });

  // Any move off "vote", not only the move back to "anyone": the question the
  // proposal is asking is one only that rule was running.
  expect(await openProposals(t, roomId)).toHaveLength(0);
});

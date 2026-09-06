/// <reference types="vite/client" />
import { convexTest, type TestConvex } from "convex-test";
import { ConvexError } from "convex/values";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { applyStopSwap } from "./lib/swap";
import { TRAVEL_BUFFER_MIN, type Stop } from "./lib/stops";
import { buildPlanPrompt, fallbackPlan, parsePlanResponse } from "./lib/planPrompt";

const modules = import.meta.glob("./**/*.ts");
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
  const paid = { ...INPUT, venueName: "The Long Weekend", budgetPerHeadCents: 4000 };
  const { stops, shareMessage } = parsePlanResponse("no json here", paid);
  expect(stops.some((s) => s.name.includes("The Long Weekend"))).toBe(true);
  expect(shareMessage).toContain("The Long Weekend");
  expect(shareMessage).toContain("$40");
  expect(shareMessage).not.toMatch(/your quest/i);
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

test("a paid fallback stays in whole cents and under the room's budget", () => {
  const { stops } = fallbackPlan({ ...INPUT, budgetPerHeadCents: 3333 });
  for (const stop of stops) {
    expect(Number.isInteger(stop.costPerHeadCents)).toBe(true);
  }
  expect(stops.reduce((sum, s) => sum + s.costPerHeadCents, 0)).toBeLessThanOrEqual(3333);
});

// --- writePlan ------------------------------------------------------------

async function seedRoom(
  t: T,
  over: { code?: string; headcount?: number; budgetPerHeadCents?: number; title?: string } = {},
) {
  return await t.run(async (ctx) => {
    const roomId = await ctx.db.insert("rooms", {
      hostUserId: "u1",
      mood: "grass",
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

test("writePlan stores the plan and totals the cost", async () => {
  const t = convexTest(schema, modules);
  const { roomId, questId } = await seedRoom(t);

  await t.mutation(internal.plans.writePlan, {
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
  const { roomId, questId } = await seedRoom(t, { code: "4445", headcount: 1, budgetPerHeadCents: 0, title: "T" });

  const stop = {
    id: "s1", slot: "main" as const, name: "A", startAt: START, durationMin: 30,
    costPerHeadCents: 0, note: "", source: "llm" as const, locked: false,
  };
  await t.mutation(internal.plans.writePlan, { roomId, questId, stops: [stop], shareMessage: "one" });
  await t.mutation(internal.plans.writePlan, { roomId, questId, stops: [stop], shareMessage: "two" });

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
});

const storedPlan = (t: T, roomId: Id<"rooms">) =>
  t.run(async (ctx) =>
    ctx.db.query("plans").withIndex("by_room", (q) => q.eq("roomId", roomId)).first(),
  );

test("generate writes the model's plan and prompts with the real roster", async () => {
  const t = convexTest(schema, modules);
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
  // Two members on the roster, not the four the host guessed at in the lobby.
  expect(body.messages[0].content).toContain("2 people");
  expect(body.messages[0].content).toContain("Princes Park");
});

test("a matched room still gets a plan when OPENAI_API_KEY is missing", async () => {
  const t = convexTest(schema, modules);
  delete process.env.OPENAI_API_KEY;
  const { roomId, questId } = await seedRoom(t, { title: "The Long Weekend", budgetPerHeadCents: 4000 });

  await t.action(internal.plans.generate, { roomId, questId });

  const plan = await storedPlan(t, roomId);
  expect(plan!.stops.length).toBeGreaterThanOrEqual(2);
  // The canned night names the venue this room actually matched on.
  expect(plan!.stops.some((s) => s.name.includes("The Long Weekend"))).toBe(true);
  expect(plan!.shareMessage).toContain("The Long Weekend");
  expect(plan!.totalPerHeadCents).toBeLessThanOrEqual(4000);
  expect(fetchMock).not.toHaveBeenCalled();
});

test("an OpenAI outage still leaves the room with a plan", async () => {
  const t = convexTest(schema, modules);
  fetchMock.mockImplementation(async () => new Response("upstream is unhappy", { status: 503 }));
  const { roomId, questId } = await seedRoom(t);

  await t.action(internal.plans.generate, { roomId, questId });

  const plan = await storedPlan(t, roomId);
  expect(plan!.stops.some((s) => s.name.includes("Princes Park"))).toBe(true);
});

test("a $0 room is never handed a model plan that costs money", async () => {
  const t = convexTest(schema, modules);
  fetchMock.mockImplementation(async () => json(chatBody(modelPlan))); // $12 a head
  const { roomId, questId } = await seedRoom(t, { budgetPerHeadCents: 0 });

  await t.action(internal.plans.generate, { roomId, questId });

  const plan = await storedPlan(t, roomId);
  expect(plan!.totalPerHeadCents).toBe(0);
  expect(plan!.stops.every((s) => s.costPerHeadCents === 0)).toBe(true);
});

test("generate running twice leaves one plan, not two", async () => {
  const t = convexTest(schema, modules);
  const { roomId, questId } = await seedRoom(t);

  await t.action(internal.plans.generate, { roomId, questId });
  await t.action(internal.plans.generate, { roomId, questId });

  const plans = await t.run(async (ctx) => ctx.db.query("plans").collect());
  expect(plans).toHaveLength(1);
});

test("planContext refuses a room that has been deleted", async () => {
  const t = convexTest(schema, modules);
  const { roomId, questId } = await seedRoom(t);
  await t.run(async (ctx) => ctx.db.delete(roomId));

  await expectUserError(
    t.query(internal.plans.planContext, { roomId, questId }),
    "ROOM_NOT_FOUND",
    /room is gone/i,
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
  await t.mutation(internal.plans.writePlan, { roomId, questId, stops, shareMessage: "hi" });
  return roomId;
}

test("a swap keeps the stop's id, recomputes the times after it and re-totals", async () => {
  const t = convexTest(schema, modules);
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
  const roomId = await seedPlan(t, [stop({ id: "a" })]);

  await t.run(async (ctx) =>
    applyStopSwap(ctx, roomId, "a", stop({ name: "Replacement", locked: true })),
  );

  const plan = (await storedPlan(t, roomId))!;
  expect(plan.stops[0].locked).toBe(false);
});

test("a locked stop refuses the swap and the plan is left untouched", async () => {
  const t = convexTest(schema, modules);
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
  const roomId = await seedPlan(t, [stop({ id: "a" })]);

  await expectUserError(
    t.run(async (ctx) => applyStopSwap(ctx, roomId, "nope", stop())),
    "STOP_NOT_FOUND",
    /not in this plan/i,
  );
});

test("swapping before the plan exists is refused with something the user can act on", async () => {
  const t = convexTest(schema, modules);
  const { roomId } = await seedRoom(t);

  await expectUserError(
    t.run(async (ctx) => applyStopSwap(ctx, roomId, "a", stop())),
    "PLAN_NOT_READY",
    /no plan/i,
  );
});

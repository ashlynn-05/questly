/// <reference types="vite/client" />
import { convexTest, type TestConvex } from "convex-test";
import { ConvexError } from "convex/values";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
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
  over: { code?: string; budgetPerHeadCents?: number } = {},
) {
  const code = over.code ?? "4446";
  const { roomId, questId } = await seedRoom(t, {
    code,
    budgetPerHeadCents: over.budgetPerHeadCents ?? 3000,
  });
  await t.run(async (ctx) => {
    await ctx.db.insert("members", {
      roomId, name: "Bec", userId: "u1", isHost: true, sessionKey: "k-bec", joinedAt: 1,
    });
  });
  await t.mutation(internal.plans.writePlan, {
    roomId, questId,
    stops: [
      stop({ id: "a", slot: "meet", name: "Gate", durationMin: 20 }),
      stop({ id: "b", slot: "after", name: "Old nightcap", durationMin: 45, locked: true }),
    ],
    shareMessage: "hi",
  });
  return { roomId, questId, code };
}

test("searchStop returns the typed venues as swap candidates", async () => {
  const t = convexTest(schema, modules);
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

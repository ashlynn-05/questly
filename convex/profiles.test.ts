/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { ConvexError } from "convex/values";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { GOAL_IDS, QUIZ_CARDS, QUIZ_GOALS, tasteSentence, moodAffinity } from "./lib/quiz";

const modules = import.meta.glob("./**/*.ts");

test("the quiz is seven cards and every card names a mood", () => {
  expect(QUIZ_CARDS).toHaveLength(7);
  for (const card of QUIZ_CARDS) {
    expect(["grass", "meet", "treat", "new"]).toContain(card.mood);
  }
});

test("card ids are unique, because they key the answers", () => {
  expect(new Set(QUIZ_CARDS.map((c) => c.id)).size).toBe(QUIZ_CARDS.length);
});

test("the goals question is a small fixed set with unique ids", () => {
  expect(QUIZ_GOALS.length).toBeGreaterThan(0);
  expect(QUIZ_GOALS.length).toBeLessThanOrEqual(6);
  expect(new Set(QUIZ_GOALS.map((g) => g.id)).size).toBe(QUIZ_GOALS.length);
  expect(GOAL_IDS.size).toBe(QUIZ_GOALS.length);
});

test("the taste sentence reflects only what was said yes to", () => {
  const sentence = tasteSentence({ [QUIZ_CARDS[0].id]: "more", [QUIZ_CARDS[1].id]: "less" });
  expect(sentence).toContain(QUIZ_CARDS[0].text);
  expect(sentence).not.toContain(QUIZ_CARDS[1].text);
});

test("an empty quiz still produces something embeddable", () => {
  expect(tasteSentence({}).length).toBeGreaterThan(0);
});

test("goals fold into the taste sentence alongside the cards", () => {
  const sentence = tasteSentence(
    { [QUIZ_CARDS[0].id]: "more" },
    [QUIZ_GOALS[0].id],
  );
  expect(sentence).toContain(QUIZ_CARDS[0].text);
  expect(sentence).toContain(QUIZ_GOALS[0].text);
});

test("goals alone (no card answers) still produce something embeddable", () => {
  const sentence = tasteSentence({}, [QUIZ_GOALS[0].id]);
  expect(sentence).toContain(QUIZ_GOALS[0].text);
});

test("mood affinity moves up on more and down on less", () => {
  const out = moodAffinity({ walk: "more", swim: "less" });
  expect(out.grass).toBe(0); // one up, one down, both grass
  const up = moodAffinity({ walk: "more", swim: "more" });
  expect(up.grass).toBe(2);
});

test("a profile round-trips and is readable by its owner", async () => {
  const t = convexTest(schema, modules);
  const asUser = t.withIdentity({ subject: "u1", name: "Bec" });

  await t.mutation(internal.profiles.write, {
    userId: "u1", displayName: "Bec", tasteVector: [0.1, 0.2],
    tasteSentence: "likes being outside", moodAffinity: { grass: 1 }, goals: ["reset"],
  });

  const me = await asUser.query(api.profiles.me, {});
  expect(me).toMatchObject({ displayName: "Bec", tasteSentence: "likes being outside", goals: ["reset"] });
});

test("profiles.me never ships the taste vector to the browser", async () => {
  const t = convexTest(schema, modules);
  const asUser = t.withIdentity({ subject: "u1", name: "Bec" });
  await t.mutation(internal.profiles.write, {
    userId: "u1", displayName: "Bec", tasteVector: [0.1, 0.2],
    tasteSentence: "x", moodAffinity: {},
  });
  const me = await asUser.query(api.profiles.me, {});
  expect(me).not.toHaveProperty("tasteVector");
});

test("writing a profile twice updates rather than duplicates", async () => {
  const t = convexTest(schema, modules);
  const args = {
    userId: "u1", displayName: "Bec", tasteVector: [0.1],
    tasteSentence: "one", moodAffinity: {},
  };
  await t.mutation(internal.profiles.write, args);
  await t.mutation(internal.profiles.write, { ...args, tasteSentence: "two" });

  const rows = await t.run(async (ctx) => ctx.db.query("profiles").collect());
  expect(rows).toHaveLength(1);
  expect(rows[0].tasteSentence).toBe("two");
});

test("profiles.me is null for a signed-out visitor", async () => {
  const t = convexTest(schema, modules);
  expect(await t.query(api.profiles.me, {})).toBeNull();
});

// --- saveQuiz: the one path in this file that touches OpenAI -------------
//
// OPENAI_API_KEY is not set in this deployment, so every test below stubs
// globalThis.fetch (the openai SDK falls back to the global fetch when one is
// available -- see node_modules/openai/internal/shims.js) rather than making a
// live call, and restores it afterwards.

const API_KEY = "test-openai-key";

// The SDK requests base64-encoded embeddings by default (see
// node_modules/openai/lib/embeddings.js) and decodes them back to numbers via
// Float32Array, so the stub must speak that wire format, not a plain numeric
// array -- otherwise `toFloat32Array` silently decodes it to `[]`. Integers
// are used here (rather than e.g. 0.1) because they round-trip through
// float32 exactly, so the test can assert equality without a tolerance.
function toBase64Float32(vec: number[]): string {
  return Buffer.from(new Float32Array(vec).buffer).toString("base64");
}

function embeddingResponse(vectors: number[][]) {
  return new Response(
    JSON.stringify({
      object: "list",
      data: vectors.map((embedding, index) => ({
        object: "embedding",
        embedding: toBase64Float32(embedding),
        index,
      })),
      model: "text-embedding-3-small",
      usage: { prompt_tokens: 1, total_tokens: 1 },
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

let fetchMock: ReturnType<typeof vi.fn>;
const originalFetch = globalThis.fetch;

beforeEach(() => {
  process.env.OPENAI_API_KEY = API_KEY;
  fetchMock = vi.fn(async () => embeddingResponse([[1, 2, 3]]));
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
  delete process.env.OPENAI_API_KEY;
});

test("saveQuiz derives displayName from the identity's name, embeds the taste sentence, and stores the profile", async () => {
  const t = convexTest(schema, modules);
  const asUser = t.withIdentity({ subject: "u1", name: "Bec Chen" });

  const result = await asUser.action(api.profiles.saveQuiz, {
    answers: { [QUIZ_CARDS[0].id]: "more" },
    goals: [QUIZ_GOALS[0].id],
  });
  expect(result).toBeNull();
  expect(fetchMock).toHaveBeenCalledTimes(1);

  const me = await asUser.query(api.profiles.me, {});
  expect(me).toMatchObject({
    displayName: "Bec Chen",
    tasteSentence: tasteSentence({ [QUIZ_CARDS[0].id]: "more" }, [QUIZ_GOALS[0].id]),
    goals: [QUIZ_GOALS[0].id],
  });
  expect(me).not.toHaveProperty("tasteVector");

  const stored = await t.run(async (ctx) => ctx.db.query("profiles").collect());
  expect(stored).toHaveLength(1);
  expect(stored[0].tasteVector).toEqual([1, 2, 3]);
});

// Onboarding is the first thing a new user does, and it used to dead-end on an
// OpenAI outage: the embedding threw, the whole action rolled back, and the
// person was returned to the quiz with no profile and no explanation. The
// taste vector is an enhancement -- personalised ranking -- not the point of
// the screen, so its absence must not cost them the account.
test("saveQuiz still saves the profile when the embedding service is down", async () => {
  const t = convexTest(schema, modules);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  fetchMock.mockImplementation(async () => new Response("upstream is unhappy", { status: 503 }));
  const asUser = t.withIdentity({ subject: "u1", name: "Bec Chen" });

  await asUser.action(api.profiles.saveQuiz, {
    answers: { [QUIZ_CARDS[0].id]: "more" },
    goals: [QUIZ_GOALS[0].id],
  });

  const me = await asUser.query(api.profiles.me, {});
  expect(me?.displayName).toBe("Bec Chen");
  expect(me?.goals).toEqual([QUIZ_GOALS[0].id]);

  // Stored with no vector rather than a fabricated one: an empty vector
  // contributes nothing to ranking, which is honest about what we know.
  const stored = await t.run(async (ctx) => ctx.db.query("profiles").collect());
  expect(stored).toHaveLength(1);
  expect(stored[0].tasteVector).toEqual([]);
});

test("saveQuiz falls back to the identity's email when it has no name", async () => {
  const t = convexTest(schema, modules);
  const asUser = t.withIdentity({ subject: "u1", email: "bec@example.com" });

  await asUser.action(api.profiles.saveQuiz, { answers: {}, goals: [] });

  const me = await asUser.query(api.profiles.me, {});
  expect(me?.displayName).toBe("bec@example.com");
});

test("saveQuiz falls back to a neutral display name when neither name nor email is available", async () => {
  const t = convexTest(schema, modules);
  const asUser = t.withIdentity({ subject: "u1" });

  await asUser.action(api.profiles.saveQuiz, { answers: {}, goals: [] });

  const me = await asUser.query(api.profiles.me, {});
  expect(me?.displayName).not.toBe("");
  expect(typeof me?.displayName).toBe("string");
  expect(me!.displayName.length).toBeGreaterThan(0);
});

test("saveQuiz refuses an anonymous caller before spending any OpenAI quota", async () => {
  const t = convexTest(schema, modules);

  const promise = t.action(api.profiles.saveQuiz, { answers: {}, goals: [] });
  await expect(promise).rejects.toBeInstanceOf(ConvexError);
  await expect(promise).rejects.toMatchObject({ data: { code: "NOT_SIGNED_IN" } });
  expect(fetchMock).not.toHaveBeenCalled();
});

test("saveQuiz rejects a goal id that is not on offer", async () => {
  const t = convexTest(schema, modules);
  const asUser = t.withIdentity({ subject: "u1", name: "Bec" });

  const promise = asUser.action(api.profiles.saveQuiz, {
    answers: {},
    goals: ["not-a-real-goal"],
  });
  await expect(promise).rejects.toBeInstanceOf(ConvexError);
  await expect(promise).rejects.toMatchObject({ data: { code: "INVALID_GOAL" } });
  expect(fetchMock).not.toHaveBeenCalled();
});

test("saveQuiz updates rather than duplicates a profile on a second submission", async () => {
  const t = convexTest(schema, modules);
  const asUser = t.withIdentity({ subject: "u1", name: "Bec" });

  await asUser.action(api.profiles.saveQuiz, { answers: {}, goals: [] });
  fetchMock.mockImplementation(async () => embeddingResponse([[9, 9, 9]]));
  await asUser.action(api.profiles.saveQuiz, {
    answers: { [QUIZ_CARDS[0].id]: "more" },
    goals: [],
  });

  const rows = await t.run(async (ctx) => ctx.db.query("profiles").collect());
  expect(rows).toHaveLength(1);
  expect(rows[0].tasteVector).toEqual([9, 9, 9]);
});

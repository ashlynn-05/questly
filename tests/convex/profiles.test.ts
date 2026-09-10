/// <reference types="vite/client" />
import { registerComponents } from "./testHelpers";
import { convexTest, type TestConvex } from "convex-test";
import { ConvexError } from "convex/values";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import schema from "../../convex/schema";
import { GOAL_IDS, QUIZ_CARDS, QUIZ_GOALS, tasteSentence, moodAffinity } from "../../convex/lib/account/quiz";
import { rateLimiter } from "../../convex/lib/rateLimits";
import { MOOD_IDS } from "../../convex/lib/deck/scoring";

const modules = import.meta.glob("../../convex/**/*.ts");

test("the quiz is seven cards and every card names a mood", () => {
  expect(QUIZ_CARDS).toHaveLength(7);
  for (const card of QUIZ_CARDS) {
    expect(MOOD_IDS).toContain(card.mood);
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
  registerComponents(t);
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
  registerComponents(t);
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
  registerComponents(t);
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
  registerComponents(t);
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
  registerComponents(t);
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

test("embedding retries reserve quota for each physical SDK attempt", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  let attempts = 0;
  fetchMock.mockImplementation(async () => {
    attempts += 1;
    return attempts === 1
      ? new Response("temporary upstream failure", { status: 503 })
      : embeddingResponse([[4, 5, 6]]);
  });
  const limit = vi.spyOn(rateLimiter, "limit");
  const asUser = t.withIdentity({ subject: "u1", name: "Bec Chen" });

  await asUser.action(api.profiles.saveQuiz, {
    answers: { [QUIZ_CARDS[0].id]: "more" },
    goals: [],
  });

  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(limit).toHaveBeenCalledTimes(4);
  const stored = await t.run(async (ctx) => ctx.db.query("profiles").collect());
  expect(stored[0].tasteVector).toEqual([4, 5, 6]);
});

// Onboarding is the first thing a new user does, and it used to dead-end on an
// OpenAI outage: the embedding threw, the whole action rolled back, and the
// person was returned to the quiz with no profile and no explanation. The
// taste vector is an enhancement -- personalised ranking -- not the point of
// the screen, so its absence must not cost them the account.
test("saveQuiz still saves the profile when the embedding service is down", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
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
  registerComponents(t);
  const asUser = t.withIdentity({ subject: "u1", email: "bec@example.com" });

  await asUser.action(api.profiles.saveQuiz, { answers: {}, goals: [] });

  const me = await asUser.query(api.profiles.me, {});
  expect(me?.displayName).toBe("bec@example.com");
});

test("saveQuiz falls back to a neutral display name when neither name nor email is available", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  const asUser = t.withIdentity({ subject: "u1" });

  await asUser.action(api.profiles.saveQuiz, { answers: {}, goals: [] });

  const me = await asUser.query(api.profiles.me, {});
  expect(me?.displayName).not.toBe("");
  expect(typeof me?.displayName).toBe("string");
  expect(me!.displayName.length).toBeGreaterThan(0);
});

test("saveQuiz refuses an anonymous caller before spending any OpenAI quota", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);

  const promise = t.action(api.profiles.saveQuiz, { answers: {}, goals: [] });
  await expect(promise).rejects.toBeInstanceOf(ConvexError);
  await expect(promise).rejects.toMatchObject({ data: { code: "NOT_SIGNED_IN" } });
  expect(fetchMock).not.toHaveBeenCalled();
});

test("saveQuiz rejects a goal id that is not on offer", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
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
  registerComponents(t);
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

// --- what the settings screen reads back ---------------------------------

test("the raw answers are stored, because none of the derived fields can be inverted", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  const asUser = t.withIdentity({ subject: "u1", name: "Bec" });
  const answers = { [QUIZ_CARDS[0].id]: "more" as const, [QUIZ_CARDS[1].id]: "less" as const };

  await asUser.action(api.profiles.saveQuiz, { answers, goals: [] });

  // `moodAffinity` sums the cards per mood, so "one more, one less" and
  // "neither answered" are both 0 -- which is why showing somebody what they
  // said needed a column and not just a cleverer read.
  expect((await asUser.query(api.profiles.me, {}))?.answers).toEqual(answers);
});

test("an answer key that is not one of the cards is refused before anything is spent", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  const asUser = t.withIdentity({ subject: "u1", name: "Bec" });

  // Harmless while the answers were only summed -- an unknown key matched no
  // mood and fell out. Not harmless now they are stored and rendered back.
  const promise = asUser.action(api.profiles.saveQuiz, {
    answers: { "not-a-real-card": "more" },
    goals: [],
  });
  await expect(promise).rejects.toBeInstanceOf(ConvexError);
  await expect(promise).rejects.toMatchObject({ data: { code: "INVALID_ANSWER" } });
  expect(fetchMock).not.toHaveBeenCalled();
});

test("a retake replaces the answers rather than merging into them", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  const asUser = t.withIdentity({ subject: "u1", name: "Bec" });

  await asUser.action(api.profiles.saveQuiz, {
    answers: { [QUIZ_CARDS[0].id]: "more", [QUIZ_CARDS[1].id]: "more" },
    goals: [],
  });
  await asUser.action(api.profiles.saveQuiz, {
    answers: { [QUIZ_CARDS[0].id]: "less" },
    goals: [],
  });

  expect((await asUser.query(api.profiles.me, {}))?.answers).toEqual({
    [QUIZ_CARDS[0].id]: "less",
  });
});

// --- renaming -------------------------------------------------------------

test("a rename shows up where the product reads a name", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  const asUser = t.withIdentity({ subject: "u1", name: "Bec" });
  await asUser.action(api.profiles.saveQuiz, { answers: {}, goals: [] });

  await asUser.mutation(api.profiles.renameMe, { displayName: "  Bec C.  " });

  expect((await asUser.query(api.profiles.me, {}))?.displayName).toBe("Bec C.");
});

test("a rename survives a retake of the quiz", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  const asUser = t.withIdentity({ subject: "u1", name: "Bec" });
  await asUser.action(api.profiles.saveQuiz, { answers: {}, goals: [] });
  await asUser.mutation(api.profiles.renameMe, { displayName: "Bec C." });

  // `saveQuiz` derives the name from the identity every time, so without
  // `write` dropping it on the update path a retake would silently undo the
  // rename and the person would have no way to tell why.
  await asUser.action(api.profiles.saveQuiz, {
    answers: { [QUIZ_CARDS[0].id]: "more" },
    goals: [],
  });

  expect((await asUser.query(api.profiles.me, {}))?.displayName).toBe("Bec C.");
});

test("an empty name is refused rather than stored", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  const asUser = t.withIdentity({ subject: "u1", name: "Bec" });
  await asUser.action(api.profiles.saveQuiz, { answers: {}, goals: [] });

  const promise = asUser.mutation(api.profiles.renameMe, { displayName: "   " });
  await expect(promise).rejects.toMatchObject({ data: { code: "NAME_REQUIRED" } });
  expect((await asUser.query(api.profiles.me, {}))?.displayName).toBe("Bec");
});

test("a name longer than the field allows is refused", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  const asUser = t.withIdentity({ subject: "u1", name: "Bec" });
  await asUser.action(api.profiles.saveQuiz, { answers: {}, goals: [] });

  const promise = asUser.mutation(api.profiles.renameMe, { displayName: "x".repeat(41) });
  await expect(promise).rejects.toMatchObject({ data: { code: "NAME_REQUIRED" } });
});

test("renaming requires an account", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  const promise = t.mutation(api.profiles.renameMe, { displayName: "Anyone" });
  await expect(promise).rejects.toMatchObject({ data: { code: "NOT_SIGNED_IN" } });
});

test("renaming with no profile yet is a no-op, not a throw", async () => {
  // Reachable only as a race -- two tabs, one of them deleting -- and not
  // worth shouting about when it happens.
  const t = convexTest(schema, modules);
  registerComponents(t);
  const asUser = t.withIdentity({ subject: "u1", name: "Bec" });
  expect(await asUser.mutation(api.profiles.renameMe, { displayName: "Bec C." })).toBeNull();
  expect(await t.run(async (ctx) => ctx.db.query("profiles").collect())).toEqual([]);
});

// --- the way back into your own rooms ------------------------------------

const CREATE = {
  mood: "grass" as const,
  headcount: 4,
  budgetPerHeadCents: 0,
  // A WEEK OUT, relative -- `rooms.create` now refuses a `whenAt` already past,
  // and this used to be the fixed 1_800_000_000_000, which is 2027-01-15. That
  // is future today and would have started failing every test in this file on
  // a date nobody would have connected to the guard.
  whenAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
  centreLat: -37.8,
  centreLng: 144.96,
  radiusKm: 5,
  visibility: "private" as const,
  hostName: "Bec",
};

test("myRooms is empty for a signed-out visitor", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  expect(await t.query(api.profiles.myRooms, {})).toEqual([]);
});

test("a room you host is listed once, not twice", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  const asHost = t.withIdentity({ subject: "u1", name: "Bec" });
  const { code } = await asHost.mutation(api.rooms.create, CREATE);

  // A host is both the room's `hostUserId` and a member row in it, so the two
  // halves of this query both find the same room -- the dedupe is the point.
  const rooms = await asHost.query(api.profiles.myRooms, {});
  expect(rooms).toHaveLength(1);
  expect(rooms[0]).toMatchObject({ code, isHost: true, mood: "grass" });
});

test("a room you were let into is listed, and not as yours to run", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  const asHost = t.withIdentity({ subject: "u1", name: "Bec" });
  const asGuest = t.withIdentity({ subject: "u2", name: "Tam" });
  const { code } = await asHost.mutation(api.rooms.create, CREATE);
  await asGuest.mutation(api.rooms.join, { code, name: "Tam" });

  const rooms = await asGuest.query(api.profiles.myRooms, {});
  expect(rooms).toHaveLength(1);
  expect(rooms[0]).toMatchObject({ code, isHost: false });
});

test("the nights are listed with the furthest ahead first", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  const asHost = t.withIdentity({ subject: "u1", name: "Bec" });
  const early = await asHost.mutation(api.rooms.create, CREATE);
  const late = await asHost.mutation(api.rooms.create, {
    ...CREATE,
    whenAt: CREATE.whenAt + 86_400_000,
  });

  const rooms = await asHost.query(api.profiles.myRooms, {});
  expect(rooms.map((r) => r.code)).toEqual([late.code, early.code]);
});

test("myRooms never leaks somebody else's room", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  const asHost = t.withIdentity({ subject: "u1", name: "Bec" });
  const asStranger = t.withIdentity({ subject: "u2", name: "Tam" });
  await asHost.mutation(api.rooms.create, CREATE);

  expect(await asStranger.query(api.profiles.myRooms, {})).toEqual([]);
});

// --- what a tombstone does to the rest of the product ---------------------

test("profiles.me is null for a deleted account, so nothing resumes it", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  const asUser = t.withIdentity({ subject: "u1", name: "Bec" });
  await asUser.action(api.profiles.saveQuiz, { answers: {}, goals: [] });

  await t.run(async (ctx) => {
    const rows = await ctx.db.query("profiles").collect();
    await ctx.db.patch(rows[0]._id, { deletedAt: Date.now() });
  });

  // `/start` resumes a returning host straight past the quiz on the strength of
  // this query alone, so a tombstoned profile answering it would hand a deleted
  // account back its own taste vector.
  expect(await asUser.query(api.profiles.me, {})).toBeNull();
});

test("finishing the quiz again is itself a restore", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  const asUser = t.withIdentity({ subject: "u1", name: "Bec" });
  await asUser.action(api.profiles.saveQuiz, { answers: {}, goals: [] });
  await asUser.mutation(api.account.deleteAccount, {});

  await asUser.action(api.profiles.saveQuiz, {
    answers: { [QUIZ_CARDS[0].id]: "more" },
    goals: [],
  });

  // Somebody who deleted, signed back in and answered the cards has plainly
  // not left. One path clears the tombstone rather than two that could disagree.
  expect(await asUser.query(api.profiles.me, {})).not.toBeNull();
  expect(await asUser.query(api.account.deletionStatus, {})).toBeNull();
});

test("a rename is refused on a deleted account, so nothing writes to a tombstoned row", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  const asUser = t.withIdentity({ subject: "u1", name: "Bec" });
  await asUser.action(api.profiles.saveQuiz, { answers: {}, goals: [] });
  await asUser.mutation(api.account.deleteAccount, {});

  await asUser.mutation(api.profiles.renameMe, { displayName: "Bec C." });

  const rows = await t.run(async (ctx) => ctx.db.query("profiles").collect());
  expect(rows[0].displayName).toBe("Bec");
});

// --- the picture in the roundel -------------------------------------------
//
// `ctx.storage.store` in convex-test does NOT record a content type -- the
// metadata it writes is `{ size, sha256 }` and nothing else, where a real
// upload records the Content-Type the browser POSTed. So `setAvatar`'s happy
// path cannot be driven through this harness at all: every stored blob looks
// like an upload that declared no type, which is a thing the mutation refuses
// on purpose. The tests below drive what they can and reach past the gate with
// a direct patch where they cannot, rather than weakening the gate to suit the
// harness. `src/lib/avatar.test.ts` covers the type and size rules themselves,
// which are shared by both ends and are pure.

/** A file in storage, the way an upload would have left one (minus the type). */
async function storeImage(t: TestConvex<typeof schema>, bytes = 64) {
  return await t.run(async (ctx) => ctx.storage.store(new Blob([new Uint8Array(bytes)])));
}

/** Attach a picture the way a real, correctly-typed upload would have. */
async function attach(t: TestConvex<typeof schema>, userId: string) {
  return await t.run(async (ctx) => {
    const storageId = await ctx.storage.store(new Blob([new Uint8Array(64)]));
    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    await ctx.db.patch(profile!._id, { avatarId: storageId });
    return storageId;
  });
}

test("a stored picture is read back as a URL, never as the id", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  const asUser = t.withIdentity({ subject: "u1", name: "Bec" });
  await asUser.action(api.profiles.saveQuiz, { answers: {}, goals: [] });
  await attach(t, "u1");

  // The row holds the id; the query resolves the URL per read. A stored URL
  // would be a signed string going stale on its own schedule with nothing here
  // to notice.
  const me = await asUser.query(api.profiles.me, {});
  expect(me?.avatarUrl).toEqual(expect.any(String));
  expect(me).not.toHaveProperty("avatarId");
});

test("profiles.me reports no picture rather than omitting the field", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  const asUser = t.withIdentity({ subject: "u1", name: "Bec" });
  await asUser.action(api.profiles.saveQuiz, { answers: {}, goals: [] });

  // Null, not absent: the badge branches on it, and a missing key is a thing
  // a caller can forget to handle.
  expect((await asUser.query(api.profiles.me, {}))?.avatarUrl).toBeNull();
});

test("an upload that declared no type is refused", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  const asUser = t.withIdentity({ subject: "u1", name: "Bec" });
  await asUser.action(api.profiles.saveQuiz, { answers: {}, goals: [] });
  const storageId = await storeImage(t);

  // A missing Content-Type is exactly how somebody walks an SVG past a list of
  // allowed ones, so an absent type is refused rather than waved through.
  await expect(
    asUser.mutation(api.profiles.setAvatar, { storageId }),
  ).rejects.toMatchObject({ data: { code: "AVATAR_TYPE" } });

  expect((await asUser.query(api.profiles.me, {}))?.avatarUrl).toBeNull();
});

test("a storage id pointing at nothing is refused", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  const asUser = t.withIdentity({ subject: "u1", name: "Bec" });
  await asUser.action(api.profiles.saveQuiz, { answers: {}, goals: [] });
  const storageId = await storeImage(t);
  await t.run(async (ctx) => ctx.storage.delete(storageId));

  await expect(
    asUser.mutation(api.profiles.setAvatar, { storageId }),
  ).rejects.toMatchObject({ data: { code: "AVATAR_MISSING" } });
});

test("removing a picture takes the file with it", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  const asUser = t.withIdentity({ subject: "u1", name: "Bec" });
  await asUser.action(api.profiles.saveQuiz, { answers: {}, goals: [] });
  const storageId = await attach(t, "u1");

  await asUser.mutation(api.profiles.clearAvatar, {});

  // Storage costs per byte HELD, not per byte served.
  expect((await asUser.query(api.profiles.me, {}))?.avatarUrl).toBeNull();
  expect(await t.run(async (ctx) => ctx.db.system.get(storageId))).toBeNull();
});

test("clearing a picture nobody has is a no-op, not a throw", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  const asUser = t.withIdentity({ subject: "u1", name: "Bec" });
  await asUser.action(api.profiles.saveQuiz, { answers: {}, goals: [] });
  expect(await asUser.mutation(api.profiles.clearAvatar, {})).toBeNull();
});

test("removing a picture requires an account", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  await expect(t.mutation(api.profiles.clearAvatar, {})).rejects.toMatchObject({
    data: { code: "NOT_SIGNED_IN" },
  });
});

test("an anonymous caller cannot mint upload URLs against this deployment", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  // Otherwise the storage bill is open to anyone who can reach the API.
  await expect(t.mutation(api.profiles.generateAvatarUploadUrl, {})).rejects.toMatchObject({
    data: { code: "NOT_SIGNED_IN" },
  });
});

test("a deleted account cannot adopt a picture, and the bytes do not linger", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  const asUser = t.withIdentity({ subject: "u1", name: "Bec" });
  await asUser.action(api.profiles.saveQuiz, { answers: {}, goals: [] });
  await asUser.mutation(api.account.deleteAccount, {});
  const storageId = await storeImage(t);

  // Returns rather than throws, which is what lets the delete commit -- a
  // throw would roll it back along with everything else the handler did.
  expect(await asUser.mutation(api.profiles.setAvatar, { storageId })).toBeNull();
  expect(await t.run(async (ctx) => ctx.db.system.get(storageId))).toBeNull();
});

test("a tombstoned profile keeps its picture private", async () => {
  const t = convexTest(schema, modules);
  registerComponents(t);
  const asUser = t.withIdentity({ subject: "u1", name: "Bec" });
  await asUser.action(api.profiles.saveQuiz, { answers: {}, goals: [] });
  await attach(t, "u1");
  await asUser.mutation(api.account.deleteAccount, {});

  // `me` returns null for a deleted account, so there is no URL to resolve --
  // the picture comes back with the account, not before it.
  expect(await asUser.query(api.profiles.me, {})).toBeNull();
  await asUser.mutation(api.account.restoreAccount, {});
  expect((await asUser.query(api.profiles.me, {}))?.avatarUrl).toEqual(expect.any(String));
});

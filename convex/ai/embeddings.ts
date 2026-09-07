"use node";

import { v } from "convex/values";
import OpenAI from "openai";
import { internalAction } from "../_generated/server";

const EMBEDDING_MODEL = "text-embedding-3-small"; // 1536 dims

/**
 * Bounded like every other outbound call in this backend: a hung socket would
 * otherwise hold the calling action open until the platform killed it, and a
 * killed action never runs the caller's fallback. One retry, because a single
 * transient 429 should not cost a new user their taste vector, and two would
 * take longer than anyone will wait on the onboarding screen.
 */
const EMBEDDING_TIMEOUT_MS = 10_000;

/**
 * One request for the whole batch: the embeddings endpoint takes an array, and
 * fifteen sequential calls would be fifteen round trips in front of a swipe.
 *
 * This is the only implementation -- the single-text path below calls it -- so
 * the model name, the key check and the error message can never drift.
 */
const embedBatch = async (inputs: string[]): Promise<number[][]> => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    // A plain `Error`, deliberately: both callers catch it and carry on --
    // `deck.rankByTaste` ranks without the taste term, `profiles.saveQuiz`
    // stores the profile with an empty vector -- so nothing thrown here ever
    // reaches a user for `throwUserError` to talk to.
    throw new Error("OPENAI_API_KEY is not set. Run: npx convex env set OPENAI_API_KEY <key>");
  }
  const openai = new OpenAI({ apiKey, timeout: EMBEDDING_TIMEOUT_MS, maxRetries: 1 });
  const response = await openai.embeddings.create({ model: EMBEDDING_MODEL, input: inputs });
  // Callers pair vectors with inputs positionally, so restore the request order
  // rather than trusting the response to already be in it.
  return [...response.data]
    .sort((a, b) => a.index - b.index)
    .map((datum) => datum.embedding);
};

const embed = async (input: string): Promise<number[]> => (await embedBatch([input]))[0];

/**
 * Batched embeddings for the deck builder's shortlist. Internal: it spends
 * OpenAI quota, and nothing in the browser has a reason to call it.
 */
export const embedMany = internalAction({
  args: { texts: v.array(v.string()) },
  returns: v.array(v.array(v.float64())),
  handler: async (_ctx, { texts }): Promise<number[][]> =>
    texts.length === 0 ? [] : await embedBatch(texts),
});

/** The shared embedder. Lives here because this file already owns the client. */
export const embedText = internalAction({
  args: { text: v.string() },
  returns: v.array(v.float64()),
  handler: async (_ctx, { text }): Promise<number[]> => embed(text),
});

// `addSnippet` and `semanticSearch` used to live here, alongside the `snippets`
// table and `convex/ai/store.ts`. All of it was Create-Next-App scaffolding with
// no product function, and all of it was PUBLIC and entirely unauthenticated:
// anyone holding the deployment URL out of the page source could spend our
// OpenAI quota in a loop, write unbounded rows, and read back everything anyone
// else had written. It has been deleted rather than gated -- there was no
// feature underneath to protect.
//
// `embedMany` and `embedText` above are what Questly actually uses
// (`convex/deck.ts` and `convex/profiles.ts`), and both are internal.

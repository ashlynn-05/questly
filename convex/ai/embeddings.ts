"use node";

import { v } from "convex/values";
import OpenAI from "openai";
import { action, internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";

const EMBEDDING_MODEL = "text-embedding-3-small"; // 1536 dims, matches schema.ts

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
    throw new Error("OPENAI_API_KEY is not set. Run: npx convex env set OPENAI_API_KEY <key>");
  }
  const openai = new OpenAI({ apiKey });
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

export const addSnippet = action({
  args: { text: v.string() },
  handler: async (ctx, { text }): Promise<null> => {
    const trimmed = text.trim();
    if (!trimmed) throw new Error("Text is required");
    const embedding = await embed(trimmed);
    await ctx.runMutation(internal.ai.store.save, { text: trimmed, embedding });
    return null;
  },
});

export const semanticSearch = action({
  args: { query: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, args): Promise<Array<{ _id: Id<"snippets">; text: string; score: number }>> => {
    const embedding = await embed(args.query);

    const matches = await ctx.vectorSearch("snippets", "by_embedding", {
      vector: embedding,
      limit: args.limit ?? 5,
    });

    const docs = await ctx.runQuery(internal.ai.store.byIds, {
      ids: matches.map((match) => match._id),
    });

    const scores = new Map(matches.map((match) => [match._id, match._score]));
    return docs.map((doc) => ({ ...doc, score: scores.get(doc._id) ?? 0 }));
  },
});

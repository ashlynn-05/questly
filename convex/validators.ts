import { v } from "convex/values";

export const moodValidator = v.union(
  v.literal("grass"),
  v.literal("meet"),
  v.literal("treat"),
  v.literal("new"),
);

export const slotValidator = v.union(
  v.literal("meet"),
  v.literal("main"),
  v.literal("after"),
);

export const stopValidator = v.object({
  id: v.string(),
  slot: slotValidator,
  placeId: v.optional(v.string()),
  name: v.string(),
  startAt: v.number(),
  durationMin: v.number(),
  costPerHeadCents: v.number(),
  note: v.string(),
  source: v.union(
    v.literal("llm"),
    v.literal("places"),
    v.literal("manual"),
    v.literal("partner"),
  ),
  locked: v.boolean(),
  /**
   * The name of whoever locked this stop, cleared when it is unlocked.
   *
   * OPTIONAL, and it must stay optional: every plan document stored before this
   * field existed has no such key, and a required field would fail validation
   * for all of them.
   *
   * A name, not a member id. A lock is a social signal shown on a screen where
   * names are how people are identified, and a member who leaves takes their
   * row with them -- an id would go dangling and the lock would stop saying
   * who left it, which is the whole point of recording it.
   */
  lockedBy: v.optional(v.string()),
});

// The `events` and `snippets` tables were Create-Next-App scaffolding and are
// gone, along with `convex/events.ts` and `convex/ai/store.ts`. Both were
// reachable from public, unauthenticated functions -- `events.remove` let any
// signed-in user delete any row, and the snippet actions spent OpenAI quota for
// anyone holding the deployment URL. Neither had a product feature underneath.
/** One more-likely / less-likely card answer. */
export const answerValidator = v.union(v.literal("more"), v.literal("less"));

/** What a room is being asked to agree to. See the `proposals` table below. */
export const proposalKindValidator = v.union(
  v.literal("swap"),
  v.literal("lock"),
  v.literal("unlock"),
);

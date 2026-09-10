import { defineTable } from "convex/server";
import { v } from "convex/values";
import { answerValidator } from "../validators";

export const profileTables = {
  profiles: defineTable({
    userId: v.string(),
    displayName: v.string(),
    tasteVector: v.array(v.float64()),
    tasteSentence: v.string(),
    moodAffinity: v.record(v.string(), v.number()),
    // RETIRED. The goals question was folded into the eight cards, and
    // `saveQuiz` now clears this on every write. It stays declared, and stays
    // optional, only so rows that still carry one do not fail schema
    // validation; nothing reads it. Drop the column once none are left.
    //
    // Optional: the table predates the goals question, and older rows never
    // wrote one. New writes always include it (as `[]` at minimum).
    goals: v.optional(v.array(v.string())),
    /**
     * The raw card answers, kept so a person can be shown what they said.
     *
     * They used to be thrown away at the door: only the derived artefacts
     * survived (`tasteSentence`, `moodAffinity`, `tasteVector`), and not one of
     * them is invertible. `moodAffinity` sums the two cards that share a mood,
     * so a stored `0` means "one more, one less" and "neither answered" alike --
     * a settings screen reading it back would have to guess, and guessing at
     * somebody's own answers is worse than not showing them.
     *
     * Optional because every row written before this column existed has no
     * answers to show; `profiles.me` hands back `undefined` for those and the
     * screen says so rather than inventing a set.
     */
    answers: v.optional(v.record(v.string(), answerValidator)),
    /**
     * When this account was deleted, and the whole of the tombstone.
     *
     * Deletion is soft on purpose: the person has a window in which signing
     * back in restores them, and `account.purgeExpired` erases the row for good
     * once that window closes. So this field is a date, not a flag -- the date
     * IS the deadline. `profiles.me` returns null while it is set, so a deleted
     * account looks signed-out to the rest of the product without any other
     * screen having to know this column exists.
     */
    deletedAt: v.optional(v.number()),
    // The picture in this person's roundel, as a storage id and never a URL.
    // A stored URL would be a signed, expiring string baked into a row: it goes
    // stale on its own schedule and nothing here would know. `profiles.me`
    // resolves it through `ctx.storage.getUrl` on every read instead, which is
    // the only value that is true at the moment it is used.
    avatarId: v.optional(v.id("_storage")),
    createdAt: v.number(),
  })
    .index("by_user", ["userId"])
    // The purge job's read path. Without it, the daily cron is a full scan of
    // a table that grows with every account the product ever had.
    .index("by_deletedAt", ["deletedAt"]),

};

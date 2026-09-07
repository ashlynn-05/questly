import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

/**
 * The only scheduled work in the product.
 *
 * A soft delete is a promise with a deadline on it -- "gone in fourteen days"
 * is not true unless something actually comes along and makes it true -- and
 * nothing else in this backend runs without a person triggering it. So the
 * deletion window needs a clock of its own, and this is it.
 *
 * Daily rather than hourly, and at a quiet hour: the job is the enforcement of
 * a fourteen-day deadline, so a few hours either side of it changes nothing for
 * anybody, and `purgeExpired` deliberately takes a bounded batch per run
 * (a backlog drains over the following days rather than in one transaction that
 * cannot commit).
 *
 * 15:00 UTC is 1am or 2am in Melbourne depending on daylight saving, which is
 * this product's only audience.
 */
const crons = cronJobs();

crons.daily(
  "purge deleted accounts",
  { hourUTC: 15, minuteUTC: 0 },
  internal.account.purgeExpired,
);

export default crons;

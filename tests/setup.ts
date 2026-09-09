/**
 * Suite-wide invariant: NO TEST IN THIS REPO REACHES THE NETWORK.
 *
 * This is not a nicety. `plans.generate`, `deck.writeBlurbs`,
 * `plans.suggestStop` and `profiles.saveQuiz` all call OpenAI and all swallow
 * their own failures by design, so a test that reaches the wire is a live,
 * billable call that reports nothing and leaves the suite green. That is
 * exactly what happened: `convex/swipes.test.ts` scheduled `plans.generate` via
 * `runAfter(0)`, never drained it, and its `afterEach` handed the still-pending
 * job the real `fetch` and the real `OPENAI_API_KEY` back. One request to
 * `https://api.openai.com/v1/chat/completions` per run, 318/318 passing.
 *
 * Two per-file fixes were applied at the same time, but per-file discipline is
 * what failed here -- the identical restore-the-real-key pattern had already
 * been copied into a second file. So the invariant is enforced here instead,
 * once, for every test file, including ones nobody is looking at.
 *
 * HOW IT WORKS. `setupFiles` runs before any test module is imported, so the
 * guard below is what every `const originalFetch = globalThis.fetch` in those
 * modules captures. A test that stubs `fetch` and restores it therefore
 * restores the GUARD, not the real thing -- the network stays unreachable for
 * the whole run, including during and after teardown. Tests that want a
 * response still stub `globalThis.fetch` themselves; that is unaffected.
 *
 * Reaching the guard is a failure, not a warning: every attempt is recorded and
 * `afterEach`/`afterAll` fail the run with the offending URLs. The throw alone
 * would prove nothing -- callers here catch and continue.
 *
 * Every attempt is ALSO appended to the log file `tests/globalsetup.ts` hands
 * down in `QUESTLY_NETGUARD_LOG`, which is what makes the guard trustworthy: a
 * job posted with `runAfter(0)` and never drained fires after the last hook in
 * this file has already run, so the hooks below cannot see it and the run would
 * otherwise stay green. The global teardown reads that log and fails the run.
 * Set the variable yourself to inspect the log directly:
 *
 *     QUESTLY_NETGUARD_LOG=/tmp/outbound.log OPENAI_API_KEY=sk-dummy npm test
 *     wc -l /tmp/outbound.log   # must be 0
 *
 * A green suite is NOT evidence on its own. It was green throughout the defect.
 */
import { appendFileSync } from "node:fs";
import { afterAll, afterEach } from "vitest";

/** URLs any test tried to reach, drained by the hooks below. */
const attempts: string[] = [];

function urlOf(input: unknown): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  if (typeof input === "object" && input !== null && "url" in input) {
    return String((input as { url: unknown }).url);
  }
  return String(input);
}

globalThis.fetch = ((input: unknown) => {
  const url = urlOf(input);
  attempts.push(url);
  const logPath = process.env.QUESTLY_NETGUARD_LOG;
  if (logPath) appendFileSync(logPath, `${url}\n`);
  // Rejected rather than thrown synchronously: callers `await` this, and a
  // synchronous throw from a stubbed `fetch` does not land in the same place.
  return Promise.reject(
    new Error(
      `Network access from a test: ${url}. Tests must stub globalThis.fetch. ` +
      "See tests/setup.ts.",
    ),
  );
}) as unknown as typeof fetch;

function failOnAttempts(when: string) {
  if (attempts.length === 0) return;
  const urls = [...new Set(attempts)].join(", ");
  const count = attempts.length;
  attempts.length = 0;
  throw new Error(
    `${count} outbound network request(s) attempted ${when}: ${urls}. ` +
      "No test in this suite may reach the network -- stub globalThis.fetch, and " +
      "drain scheduled functions (runScheduled/finishAllScheduledFunctions) inside " +
      "the test that posts them so nothing fires after teardown. See tests/setup.ts.",
  );
}

// Both hooks: a job posted with `runAfter(0)` and never drained can fire after
// the test that posted it has already finished, so the last test in a file
// needs the `afterAll` net as well as the per-test one.
afterEach(() => failOnAttempts("during a test"));
afterAll(() => failOnAttempts("in this test file"));

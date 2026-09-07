/**
 * The half of the network guard that can still fail the run after every hook
 * has finished. `vitest.setup.ts` has the full story; this file exists because
 * of one timing fact discovered while fixing it.
 *
 * A Convex job posted with `runAfter(0)` and never drained fires AFTER the test
 * that posted it, and -- if it was the last test in the file -- after that
 * file's `afterAll` too. Measured: with the guard installed and the defect
 * still in place, the request was blocked and recorded, and both in-file hooks
 * had already run, so the suite reported 318/318 passed. Detection has to
 * outlive the worker.
 *
 * `globalSetup` runs in the main process, before any worker starts and after
 * every one of them ends. It hands each worker a log path through `process.env`
 * (the documented way to pass data down), then reads the log at teardown and
 * throws. Throwing here fails the run.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export default function setup() {
  const dir = mkdtempSync(join(tmpdir(), "questly-netguard-"));
  const logPath = join(dir, "outbound.log");
  writeFileSync(logPath, "");
  // Read by the fetch guard in every worker. Workers are started after this
  // returns, so they inherit it.
  process.env.QUESTLY_NETGUARD_LOG = logPath;

  return () => {
    const attempts = readFileSync(logPath, "utf8").split("\n").filter(Boolean);
    rmSync(dir, { recursive: true, force: true });
    if (attempts.length === 0) return;
    const urls = [...new Set(attempts)].join(", ");
    const message =
      `NETWORK GUARD FAILED: ${attempts.length} outbound request(s) were attempted ` +
      `by the test suite: ${urls}. No test in this suite may reach the network. The ` +
      "usual cause is a scheduled function left undrained by the test that posted " +
      "it, firing after teardown. See vitest.setup.ts.";
    // A throw here is reported as "error during close" and STILL EXITS 0 --
    // measured, vitest 4.1.11. The exit code is the only part CI reads, so set
    // it explicitly; the throw is kept for the stack trace next to the message.
    process.exitCode = 1;
    console.error(`\n${message}\n`);
    throw new Error(message);
  };
}

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // convex-test runs functions in Convex's own runtime, not Node.
    environment: "edge-runtime",
    server: { deps: { inline: ["convex-test"] } },
    // One invariant for the whole suite: no test reaches the network. The two
    // files are one guard -- `setupFiles` blocks and reports inside each
    // worker, `globalSetup` catches what fires after the worker's last hook.
    // Read them; they say why per-file discipline was not enough.
    setupFiles: ["./vitest.setup.ts"],
    globalSetup: ["./vitest.globalsetup.ts"],
    // Every convex-test file builds the whole convex/ module graph via
    // `import.meta.glob("./**/*.ts")` before its first assertion. That has
    // already flaked once under parallel load against the 5s default, and the
    // graph only grows as more tasks land -- a generous explicit ceiling beats
    // a false red that sends someone chasing a failure that isn't theirs.
    testTimeout: 30_000,
  },
});

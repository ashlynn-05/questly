import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // convex-test runs functions in Convex's own runtime, not Node.
    environment: "edge-runtime",
    server: { deps: { inline: ["convex-test"] } },
    // The smoke test (convex/smoke.test.ts) builds the whole convex/ module
    // graph inside one test body. That has already flaked once under
    // parallel load against the 5s default, and the graph only grows as more
    // tasks land -- a generous explicit ceiling here beats a false red that
    // sends someone chasing a failure that isn't theirs.
    testTimeout: 30_000,
  },
});

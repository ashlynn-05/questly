import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // The two path aliases `tsconfig.json` declares. Vitest resolves neither on
  // its own, so a `src/lib` module that imports a constant from `convex/lib`
  // -- which is the point of putting shared constants there -- typechecks and
  // then fails to import under test. Declared here rather than reached for
  // with `../../convex/...` in one file, because the next one would do it too.
  resolve: {
    alias: {
      "@convex": fileURLToPath(new URL("./convex", import.meta.url)),
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    // convex-test runs functions in Convex's own runtime, not Node.
    environment: "edge-runtime",
    server: { deps: { inline: ["convex-test"] } },
    // One invariant for the whole suite: no test reaches the network. The two
    // files are one guard -- `setupFiles` blocks and reports inside each
    // worker, `globalSetup` catches what fires after the worker's last hook.
    // Read them; they say why per-file discipline was not enough.
    setupFiles: ["./tests/setup.ts"],
    globalSetup: ["./tests/globalsetup.ts"],
    // Every convex-test file builds the whole convex/ module graph via
    // `import.meta.glob("./**/*.ts")` before its first assertion. That has
    // already flaked once under parallel load against the 5s default, and the
    // graph only grows as more tasks land -- a generous explicit ceiling beats
    // a false red that sends someone chasing a failure that isn't theirs.
    testTimeout: 30_000,
  },
});

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // convex-test runs functions in Convex's own runtime, not Node.
    environment: "edge-runtime",
    server: { deps: { inline: ["convex-test"] } },
  },
});

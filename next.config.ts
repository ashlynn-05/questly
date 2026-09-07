import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";

const nextConfig: NextConfig = {
  // A stray package-lock.json in the home directory makes Turbopack infer
  // ~/ as the workspace root. Tailwind v4's automatic source detection follows
  // that root, so every utility class in src/ silently compiles to nothing --
  // the app renders with only hand-written CSS and inline styles. Pin the root.
  turbopack: {
    root: fileURLToPath(new URL(".", import.meta.url)),
  },

  async headers() {
    return [
      {
        // A service worker outlives the page that registered it, so a bad one
        // served from the HTTP cache is a bad one the browser keeps choosing --
        // and the only thing that dislodges it is a fresh fetch of this exact
        // file. `updateViaCache: "none"` at the registration in
        // src/app/ServiceWorker.tsx asks for the same guarantee from the other
        // side; either alone is a promise, both is a fact.
        source: "/sw.js",
        headers: [{ key: "Cache-Control", value: "no-cache, no-store, must-revalidate" }],
      },
    ];
  },
};

export default nextConfig;

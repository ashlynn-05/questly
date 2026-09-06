import { httpRouter } from "convex/server";
import { authComponent, createAuth } from "./auth";
import { photo } from "./places";

const http = httpRouter();

// Mounts Better Auth's routes inside Convex. The Next.js route handler at
// src/app/api/auth/[...all]/route.ts proxies browser requests here.
authComponent.registerRoutes(http, createAuth);

// Venue photos. Cards store Google's opaque photo name, never a media URL, so
// GOOGLE_MAPS_SERVER_KEY is attached here and never leaves the deployment.
http.route({ path: "/places/photo", method: "GET", handler: photo });

export default http;

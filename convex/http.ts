import { httpRouter } from "convex/server";
import { authComponent, createAuth } from "./auth";

const http = httpRouter();

// Mounts Better Auth's routes inside Convex. The Next.js route handler at
// src/app/api/auth/[...all]/route.ts proxies browser requests here.
authComponent.registerRoutes(http, createAuth);

export default http;

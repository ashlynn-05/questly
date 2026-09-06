import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { isAuthenticated } from "@/lib/auth-server";

// Next.js 16 renamed Middleware to Proxy. Same behaviour, new file convention.
// This is an optimistic redirect only -- convex/events.ts still enforces auth
// on every mutation, which is where authorization actually belongs.
const PROTECTED = ["/dashboard"];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (!PROTECTED.some((path) => pathname.startsWith(path))) {
    return NextResponse.next();
  }

  if (await isAuthenticated()) {
    return NextResponse.next();
  }

  const signIn = new URL("/sign-in", request.url);
  signIn.searchParams.set("redirect", pathname);
  return NextResponse.redirect(signIn);
}

export const config = {
  matcher: ["/dashboard/:path*"],
};

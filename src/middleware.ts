import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Returns true when the request is from a performance-test runner.
 *
 * NEXT_PUBLIC_PERF_BYPASS is a build-time env var used exclusively by the
 * Playwright performance suite. It must never be set in production. When it
 * is set any middleware auth checks are skipped so tests can reach board pages
 * without going through the OAuth flow.
 */
function isPerfBypass(): boolean {
  return process.env.NEXT_PUBLIC_PERF_BYPASS === "true";
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Root → dashboard
  if (pathname === "/") {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  // Board routes (/board/:boardId) — included in the matcher so that
  // middleware can gate access (e.g. verify a session cookie) in the future.
  // When the perf-test bypass is active, short-circuit immediately so no
  // middleware auth check can block the test runner from reaching the canvas.
  if (pathname.startsWith("/board/")) {
    if (isPerfBypass()) {
      return NextResponse.next();
    }
    // No server-side auth redirect today — auth is enforced client-side in
    // src/app/board/[boardId]/page.tsx. Future: validate session cookie here.
    return NextResponse.next();
  }

  return NextResponse.next();
}

export const config = {
  // Include board routes so the bypass guard above is evaluated without
  // requiring a separate middleware deployment when auth is added later.
  matcher: ["/", "/board/:path*"],
};

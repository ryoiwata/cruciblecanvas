import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Root → dashboard
  if (pathname === "/") {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  // Guest users hitting /dashboard → redirect to board creation route
  if (pathname === "/dashboard") {
    const guestUid = request.cookies.get("__guest_uid");
    if (guestUid?.value) {
      return NextResponse.redirect(new URL("/api/boards/new", request.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/", "/dashboard"],
};

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createBoardMetadata } from "@/lib/firebase/firestore";

export async function GET(request: NextRequest) {
  const guestUid = request.cookies.get("__guest_uid")?.value;

  if (!guestUid) {
    // No guest cookie — send to dashboard
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  const boardId = crypto.randomUUID();
  await createBoardMetadata(boardId, guestUid, "Untitled Board");

  const response = NextResponse.redirect(
    new URL(`/board/${boardId}`, request.url)
  );
  response.cookies.delete("__guest_uid");
  return response;
}

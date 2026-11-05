import { NextResponse, type NextRequest } from "next/server";
import { decideGeofence } from "./lib/geofence.ts";

/** Geofence (Next 16 `proxy`, formerly `middleware`). Blocked countries are rewritten to /restricted. */
export function proxy(request: NextRequest): NextResponse {
  const decision = decideGeofence(request.headers.get("x-vercel-ip-country"), request.nextUrl.pathname);
  if (decision.action === "rewrite") {
    const url = request.nextUrl.clone();
    url.pathname = decision.to;
    return NextResponse.rewrite(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};

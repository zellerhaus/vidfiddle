import { NextRequest, NextResponse } from "next/server";
import { verifySessionCookie, COOKIE_NAME } from "@/lib/auth";

const PUBLIC_PATHS = ["/login"];
const PUBLIC_PATH_PREFIXES = ["/media/"]; // Media keys include UUIDs, so direct access is effectively unguessable.
const PUBLIC_API_PATHS = ["/api/auth/"];
const SELF_AUTHED_API_PATHS = ["/api/cron/", "/api/webhooks/"];

function isPublicPath(pathname: string): boolean {
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname.includes(".")
  ) {
    return true;
  }

  if (PUBLIC_PATHS.some((p) => pathname === p)) {
    return true;
  }

  if (PUBLIC_PATH_PREFIXES.some((p) => pathname.startsWith(p))) {
    return true;
  }

  if (PUBLIC_API_PATHS.some((p) => pathname.startsWith(p))) {
    return true;
  }

  if (SELF_AUTHED_API_PATHS.some((p) => pathname.startsWith(p))) {
    return true;
  }

  return false;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  const sessionCookie = request.cookies.get(COOKIE_NAME)?.value;

  if (!sessionCookie) {
    return handleUnauthorized(request);
  }

  const isValid = await verifySessionCookie(sessionCookie);

  if (!isValid) {
    return handleUnauthorized(request);
  }

  return NextResponse.next();
}

function handleUnauthorized(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const loginUrl = new URL("/login", request.url);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

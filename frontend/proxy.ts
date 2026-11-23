import { type NextRequest, NextResponse } from "next/server";

const SESSION_COOKIE = "thinq_session";
const PUBLIC_PATHS = ["/sign-in", "/status", "/welcome"];

/**
 * Fast redirect for visitors with no session cookie. This is a convenience only:
 * every API call is authorised by the backend, which is the real gatekeeper.
 */
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return NextResponse.next();
  }
  if (!request.cookies.has(SESSION_COOKIE)) {
    // Signed-out visitors to the home page see the public landing page, at the same URL.
    if (pathname === "/") return NextResponse.rewrite(new URL("/welcome", request.url));
    const url = request.nextUrl.clone();
    url.pathname = "/sign-in";
    url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api/|healthz|_next/|favicon.ico|.*\\.(?:svg|png|ico|txt|webmanifest)$).*)"],
};

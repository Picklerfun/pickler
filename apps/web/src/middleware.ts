import { NextResponse, type NextRequest } from "next/server";
import { authConfigured, hasSessionCookie, requiresSession, signInPath } from "./server/guard";
import { ownerOf, productFor, type ProductHosts } from "./server/hosts";

export type Decision =
  | { kind: "serve" }
  | { kind: "notFound" }
  | { kind: "rewrite"; to: string }
  /** A permanent move: this screen's address is elsewhere, for everyone, always. 308. */
  | { kind: "redirect"; to: string }
  /** This request has no session. 307 — a 308 would cache "/account is /signin" past signing in. */
  | { kind: "signIn"; to: string };

/** What the request says about authentication. Arguments, not reads: see below. */
export interface AuthState {
  /** Whether Supabase is configured at all. When it is not, the guard is inert. */
  configured: boolean;
  /** Whether the request carries a session cookie. */
  session: boolean;
}

/**
 * Pure, so both products are testable in both positions without a browser.
 *
 * Authentication arrives as an argument for the same reason `previewAllowed(nodeEnv,
 * authConfigured)` takes both of its conditions rather than reading them: a gate exercised only
 * through the environment the test happens to run in is a gate tested in one position.
 *
 * Three rules, in this order, and the order is the point:
 *
 * 1. One screen, one URL. A studio path asked of the marketplace redirects, because links and
 *    bookmarks to /console and /account predate the split. A marketplace path asked of the studio
 *    is 404: redirecting would give every marketplace screen a second URL on a host it does not
 *    belong to. The studio lives at the root of its own host, so /console there is that same
 *    duplication in the other direction and redirects to it.
 * 2. Which host serves this path, settled before the guard. Guarding first would answer /account on
 *    the marketplace with a sign-in page served from the wrong host, and would bounce a studio-host
 *    404 to sign-in instead of refusing it — telling anyone who asked which paths exist.
 * 3. Whether this request may see it, which is the only one of the three that reads a cookie.
 */
export function decide(
  host: string | null,
  pathname: string,
  hosts: ProductHosts,
  auth: AuthState,
): Decision {
  const product = productFor(host, hosts);

  if (product === "studio" && pathname === "/console") {
    return { kind: "redirect", to: "/" };
  }

  // The studio has no landing page of its own, so its root IS the console. Settled before ownership
  // rather than inside it: `/` is a marketplace path, so on the studio host it fails the ownership
  // check and would 404 the studio's own homepage before any rewrite could be reached.
  const studioRoot = product === "studio" && pathname === "/";

  if (!studioRoot && product !== "either") {
    const owner = ownerOf(pathname);
    if (owner !== "either" && owner !== product) {
      return owner === "studio"
        ? { kind: "redirect", to: `https://${hosts.studio}${pathname}` }
        : { kind: "notFound" };
    }
  }

  // Against what the path resolves to, not what was typed: leaving `/` unguarded on the studio host
  // would leave the studio's own front door open. `pathname` is what goes into `next`, so whoever
  // comes back lands on the address they asked for.
  if (auth.configured && !auth.session && requiresSession(studioRoot ? "/console" : pathname)) {
    return { kind: "signIn", to: signInPath(pathname) };
  }

  return studioRoot ? { kind: "rewrite", to: "/console" } : { kind: "serve" };
}

const hosts: ProductHosts = {
  marketplace: process.env.NEXT_PUBLIC_MARKETPLACE_HOST ?? "pickler.fun",
  studio: process.env.NEXT_PUBLIC_STUDIO_HOST ?? "app.pickler.fun",
};

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const configured = authConfigured(supabaseUrl, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);

export function middleware(request: NextRequest) {
  const decision = decide(request.headers.get("host"), request.nextUrl.pathname, hosts, {
    configured,
    session: hasSessionCookie(
      request.cookies.getAll().map((cookie) => cookie.name),
      supabaseUrl,
    ),
  });
  switch (decision.kind) {
    case "serve":
      return NextResponse.next();
    case "notFound":
      return NextResponse.rewrite(new URL("/not-found", request.url), { status: 404 });
    case "rewrite":
      return NextResponse.rewrite(new URL(decision.to, request.url));
    case "redirect":
      return NextResponse.redirect(new URL(decision.to, request.url), 308);
    case "signIn": {
      // Temporary and uncacheable: this answer is about one request's cookies, not about the URL.
      const response = NextResponse.redirect(new URL(decision.to, request.url), 307);
      response.headers.set("Cache-Control", "private, no-store");
      return response;
    }
  }
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};

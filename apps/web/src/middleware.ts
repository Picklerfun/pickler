import { NextResponse, type NextRequest } from "next/server";
import { authConfigured, hasSessionCookie, requiresSession, signInPath } from "./server/guard";
import { PRODUCT_HOSTS, originFor, ownerOf, productFor, type ProductHosts } from "./server/hosts";

export type Decision =
  | { kind: "serve" }
  | { kind: "notFound" }
  | { kind: "rewrite"; to: string }
  /** This request has no session. 307 — a 308 would cache "/account is /signin" past signing in. */
  | { kind: "signIn"; to: string }
  /** The same path and query, on the studio's own host. Absolute, and as temporary as sign-in. */
  | { kind: "toStudio"; to: string };

/**
 * Where Supabase sends someone back after Google or a magic link. It is the one studio path that
 * can arrive on the marketplace: the provider falls back to the project's Site URL when the
 * `redirectTo` it was given is not on its allow list, and the Site URL is the apex. The same path
 * as `AUTH_CALLBACK_PATH` in features/auth/lib/account.ts, which is a client module the edge
 * middleware does not import; test/middleware.test.ts holds the two equal.
 */
export const AUTH_CALLBACK = "/auth/callback";

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
 * 1. One screen, one URL, on the studio host. The studio lives at that host's root, so `/studio`
 *    there is a second address for the screen `/` already renders, and it is refused.
 * 2. Which host owns this path, settled before the guard. The two hosts are symmetric: each 404s
 *    what it does not own, in both directions. Nothing has ever been deployed, so there is no link
 *    or bookmark anywhere that a cross-host redirect would rescue — and a redirect kept for nobody
 *    is a branch, a test and a behaviour somebody has to keep true forever. Links inside this
 *    repository that cross products resolve through `studioHref`, which builds an absolute URL
 *    rather than relying on a rewrite. Settled before the guard because guarding first would answer
 *    /account on the marketplace with a sign-in page served from the wrong host, and would bounce a
 *    studio-host 404 to sign-in instead of refusing it — telling anyone who asked which paths exist.
 * 3. Whether this request may see it, which is the only one of the three that reads a cookie.
 */
export function decide(
  host: string | null,
  pathname: string,
  hosts: ProductHosts,
  auth: AuthState,
  search = "",
): Decision {
  const product = productFor(host, hosts);

  // The callback is where the session cookie is set, and a cookie belongs to the host that sets it.
  // Exchanged on the marketplace, the session would live on the wrong host: the studio would see a
  // signed-out person and send them back to sign in. So the whole callback, code and all, goes to
  // the studio first, and is exchanged there. Before the ownership rule, which would 404 it.
  if (product === "marketplace" && pathname === AUTH_CALLBACK) {
    return { kind: "toStudio", to: `${originFor(hosts.studio)}${pathname}` };
  }

  if (product === "studio" && pathname === "/studio") {
    return { kind: "notFound" };
  }

  // The studio has no landing page of its own, so its root IS the studio page. Settled before ownership
  // rather than inside it: `/` is a marketplace path, so on the studio host it fails the ownership
  // check and would 404 the studio's own homepage before any rewrite could be reached.
  const studioRoot = product === "studio" && pathname === "/";

  if (!studioRoot && product !== "either") {
    const owner = ownerOf(pathname);
    if (owner !== "either" && owner !== product) {
      return { kind: "notFound" };
    }
  }

  // Against what the path resolves to, not what was typed: leaving `/` unguarded on the studio host
  // would leave the studio's own front door open. `pathname` is what goes into `next`, so whoever
  // comes back lands on the address they asked for.
  if (auth.configured && !auth.session && requiresSession(studioRoot ? "/studio" : pathname)) {
    return { kind: "signIn", to: signInPath(pathname + search) };
  }

  return studioRoot ? { kind: "rewrite", to: "/studio" } : { kind: "serve" };
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const configured = authConfigured(supabaseUrl, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);

export function middleware(request: NextRequest) {
  const decision = decide(
    request.headers.get("host"),
    request.nextUrl.pathname,
    PRODUCT_HOSTS,
    {
      configured,
      session: hasSessionCookie(
        request.cookies.getAll().map((cookie) => cookie.name),
        supabaseUrl,
      ),
    },
    request.nextUrl.search,
  );
  switch (decision.kind) {
    case "serve":
      return NextResponse.next();
    case "notFound":
      return NextResponse.rewrite(new URL("/not-found", request.url), { status: 404 });
    case "rewrite": {
      // The address changes and the query does not: neither Next nor the OpenNext adapter merges
      // the original query into a rewrite's target, and the studio reads `?agent=` on the server.
      // Not so for the refusal above, which answers with a page that was never asked anything.
      const target = request.nextUrl.clone();
      target.pathname = decision.to;
      return NextResponse.rewrite(target);
    }
    case "toStudio": {
      // The query is the point: it carries the one-time `code` the studio exchanges.
      const target = new URL(decision.to);
      target.search = request.nextUrl.search;
      const response = NextResponse.redirect(target, 307);
      response.headers.set("Cache-Control", "private, no-store");
      return response;
    }
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

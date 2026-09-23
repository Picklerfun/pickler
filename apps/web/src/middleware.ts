import { NextResponse, type NextRequest } from "next/server";
import { ownerOf, productFor, type ProductHosts } from "./server/hosts";

export type Decision =
  | { kind: "serve" }
  | { kind: "notFound" }
  | { kind: "rewrite"; to: string }
  | { kind: "redirect"; to: string };

/**
 * Pure, so both products are testable in both positions without a browser.
 *
 * A studio path asked of the marketplace redirects, because links and bookmarks to /console and
 * /account predate the split. A marketplace path asked of the studio is 404: redirecting would
 * give every marketplace screen a second URL on a host it does not belong to, which is worse for
 * search and for anyone reading a link.
 */
export function decide(host: string | null, pathname: string, hosts: ProductHosts): Decision {
  const product = productFor(host, hosts);
  if (product === "either") {
    return { kind: "serve" };
  }
  // The studio has no landing page of its own, so its root is the console. This is settled before
  // ownership rather than inside it: `/` is a marketplace path, so on the studio host it fails the
  // ownership check and would 404 the studio's own homepage before any rewrite could be reached.
  if (product === "studio" && pathname === "/") {
    return { kind: "rewrite", to: "/console" };
  }
  const owner = ownerOf(pathname);
  if (owner === "either" || owner === product) {
    return { kind: "serve" };
  }
  return owner === "studio"
    ? { kind: "redirect", to: `https://${hosts.studio}${pathname}` }
    : { kind: "notFound" };
}

const hosts: ProductHosts = {
  marketplace: process.env.NEXT_PUBLIC_MARKETPLACE_HOST ?? "pickler.fun",
  studio: process.env.NEXT_PUBLIC_STUDIO_HOST ?? "app.pickler.fun",
};

export function middleware(request: NextRequest) {
  const decision = decide(request.headers.get("host"), request.nextUrl.pathname, hosts);
  switch (decision.kind) {
    case "serve":
      return NextResponse.next();
    case "notFound":
      return NextResponse.rewrite(new URL("/not-found", request.url), { status: 404 });
    case "rewrite":
      return NextResponse.rewrite(new URL(decision.to, request.url));
    case "redirect":
      return NextResponse.redirect(decision.to, 308);
  }
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};

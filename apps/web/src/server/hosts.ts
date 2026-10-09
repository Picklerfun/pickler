/** Which of the two products a request belongs to, or neither. */
export type Product = "marketplace" | "studio" | "either";

export interface ProductHosts {
  marketplace: string;
  studio: string;
}

/** The two configured hostnames, read once. `decide` and every link across products uses these. */
// `||`, not `??`: a copied .env.example leaves these set to "", which means "not configured".
export const PRODUCT_HOSTS: ProductHosts = {
  marketplace: process.env.NEXT_PUBLIC_MARKETPLACE_HOST || "pickler.fun",
  studio: process.env.NEXT_PUBLIC_STUDIO_HOST || "app.pickler.fun",
};

/**
 * `either` is the honest answer for any host that is not one of the two configured ones —
 * localhost, a preview deployment, an IP. Serving everything there is right: the alternative is a
 * preview build that silently loses half the application, which looks exactly like a broken build.
 *
 * The comparison is equality on the hostname with the port removed, never a suffix match:
 * `evilpickler.fun` ends with `pickler.fun` and is not this product.
 */
export function productFor(host: string | null | undefined, hosts: ProductHosts): Product {
  if (!host) {
    return "either";
  }
  const hostname = hostnameOf(host);
  if (hostname === hostnameOf(hosts.marketplace)) {
    return "marketplace";
  }
  if (hostname === hostnameOf(hosts.studio)) {
    return "studio";
  }
  return "either";
}

/** A host without its port, lower-cased. A configured host may carry one: `app.pickler.localhost:3001`. */
function hostnameOf(host: string): string {
  return host.split(":")[0]!.toLowerCase();
}

/**
 * The origin a configured host is reached at. `*.localhost` is this machine in every browser and
 * has no certificate, so it is plain http, port and all — which is what lets the two products be
 * rehearsed on two local hosts before production. Everything else is https.
 */
export function originFor(host: string): string {
  const hostname = hostnameOf(host);
  const local = hostname === "localhost" || hostname.endsWith(".localhost");
  return `${local ? "http" : "https"}://${host}`;
}

/**
 * The studio's origin, for a server answer that must land there (the auth callback, which sets the
 * session cookie). On a configured host it is the studio's configured origin, never `request.url`'s,
 * which names whatever the server was started on: `next start` answers `localhost` for every host,
 * and a proxy may answer its own. On a shared host (localhost, a preview) both products live there,
 * so it is the host the request came in on.
 */
export function studioOrigin(product: Product, requestHost: string, hosts: ProductHosts): string {
  return product === "either" ? originFor(requestHost) : originFor(hosts.studio);
}

/**
 * First path segments the studio owns. Everything else that is not shared is the marketplace.
 *
 * Three of these are also behind a session: `PROTECTED_SEGMENTS` in ./guard.ts is a subset of this
 * set, and the three that are not — signin, signup, auth — are the ones that have to stay
 * open for anyone to reach the other three.
 */
const STUDIO_SEGMENTS = new Set(["studio", "account", "signin", "signup", "auth", "passkey"]);

/**
 * Shared by both hosts: the API proxy, Next's assets, and the static files under `public/`.
 *
 * Every entry is a real path in this repository. An earlier draft of this set listed `favicon.ico`,
 * `robots.txt` and `sitemap.xml`, none of which exist here — no file, no route handler, no metadata
 * export — which made the set a false description of the project as much as dead weight. The icon
 * is `/brand/logo.png` (`app/layout.tsx`), requested from the *root* layout and so rendered on both
 * products; a studio that did not own it would 404 its own favicon on every page.
 *
 * `.well-known/apple-app-site-association` carries the iOS passkey association. Universal links
 * need it served from a fixed origin as a direct 200, so it must be shared rather than redirected.
 *
 * A file at the root (`_headers`) and a dotted directory (`.well-known`) need no rule of their own:
 * the first segment of `/_headers` is the whole filename and the first segment of `/.well-known/x`
 * is `.well-known`, dot included, so whole-segment equality already matches both.
 */
const SHARED_SEGMENTS = new Set(["api", "_next", "brand", ".well-known", "_headers"]);

/**
 * The first path segment, which is what every set in this file and in ./guard.ts is keyed on.
 *
 * Whole segment, never a prefix of the path: `/accounts-of-agents` starts with `/account` and is
 * not the account screen. Shared so that ownership and protection can never disagree about where
 * one path ends and another begins.
 */
export function firstSegment(pathname: string): string {
  return pathname.split("?")[0]!.split("/")[1] ?? "";
}

export function ownerOf(pathname: string): Product {
  const segment = firstSegment(pathname);
  if (SHARED_SEGMENTS.has(segment)) {
    return "either";
  }
  return STUDIO_SEGMENTS.has(segment) ? "studio" : "marketplace";
}

/**
 * Where the studio's home page is, from a page being rendered for this product.
 *
 * Three answers, because no single string is right on all three hosts:
 *
 * - On the studio host the studio IS `/`, and `/studio` there is a second address `decide` refuses.
 * - On the marketplace the studio is on another origin, so the link has to be absolute. Nothing
 *   rewrites it any more: the cross-host redirect that used to carry `pickler.fun/studio` was
 *   deleted, and a link that relied on it would 404.
 * - Anywhere else — localhost, a preview — both products are served together and `/` is the
 *   marketplace, so the studio is where its route actually is.
 *
 * Pure, and takes the product rather than reading a host, so all three answers are pinned in tests
 * rather than only the one the test environment happens to be.
 */
export function studioHref(product: Product, hosts: ProductHosts): string {
  if (product === "studio") {
    return "/";
  }
  return product === "marketplace" ? `${originFor(hosts.studio)}/` : "/studio";
}

/**
 * Any other studio path, addressed from a page being rendered for `product`.
 *
 * Only the marketplace needs an origin on it — from the studio host and from a shared host the path
 * is already where it says it is. The creator application used to be the live case, until it
 * moved to the marketplace as `/create`; `decide` 404s studio paths on the marketplace rather than
 * forwarding them, so a cross-product link has to carry its origin.
 *
 * The studio's home is not one of these, because its address is `/` on one host and `/studio` on
 * another; `studioHref` above is the function for it.
 */
export function studioUrl(product: Product, hosts: ProductHosts, path: string): string {
  return product === "marketplace" ? `${originFor(hosts.studio)}${path}` : path;
}

/**
 * A marketplace path, addressed from a page being rendered for `product`. The mirror of `studioUrl`.
 *
 * Only the studio host needs an origin on it: `decide` 404s there everything the marketplace owns,
 * so the studio's links to the directory, the leaderboard and an agent's public page have to name
 * the other origin. From the marketplace and from a shared host the path is where it says it is.
 */
export function marketplaceUrl(product: Product, hosts: ProductHosts, path: string): string {
  return product === "studio" ? `${originFor(hosts.marketplace)}${path}` : path;
}

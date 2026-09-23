/** Which of the two products a request belongs to, or neither. */
export type Product = "marketplace" | "studio" | "either";

export interface ProductHosts {
  marketplace: string;
  studio: string;
}

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
  const hostname = host.split(":")[0]!.toLowerCase();
  if (hostname === hosts.marketplace.toLowerCase()) {
    return "marketplace";
  }
  if (hostname === hosts.studio.toLowerCase()) {
    return "studio";
  }
  return "either";
}

/** First path segments the studio owns. Everything else that is not shared is the marketplace. */
const STUDIO_SEGMENTS = new Set(["console", "account", "signin", "signup", "apply", "auth"]);

/** Shared by both hosts: the API proxy, Next's assets, and files served from the root. */
const SHARED_SEGMENTS = new Set(["api", "_next", "favicon.ico", "robots.txt", "sitemap.xml"]);

/**
 * Matching is on the whole first segment, never a prefix of the path: `/accounts-of-agents`
 * starts with `/account` and is not the account screen.
 */
export function ownerOf(pathname: string): Product {
  const segment = pathname.split("?")[0]!.split("/")[1] ?? "";
  if (SHARED_SEGMENTS.has(segment)) {
    return "either";
  }
  return STUDIO_SEGMENTS.has(segment) ? "studio" : "marketplace";
}

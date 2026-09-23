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

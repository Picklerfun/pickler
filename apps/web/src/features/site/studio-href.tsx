"use client";

// Which product this page is being rendered for, so links to the other one can be built.
//
// A link across products stopped having a default the moment the cross-host redirect was deleted:
// `/studio` and `/account` rendered on the marketplace used to be carried across by a 308, and now
// 404. The answer depends on the host, which only a server component can see.
//
// It arrives as context rather than as a prop because the components that need it are client
// components several levels below a server one, behind `PublicShell`, which thirteen pages render.
// Threading a prop through all thirteen would put the same value in thirteen places and let any one
// of them go stale; the root layout resolves it once, from the host that asked.

import { createContext, useContext, type ReactNode } from "react";
import { PRODUCT_HOSTS, marketplaceUrl, studioHref, studioUrl, type Product } from "@/server/hosts";

/**
 * `either` is the fallback, and it is the right one to be wrong with: it yields the paths that are
 * real on a host serving both products, so a tree rendered without a provider — a test, a story —
 * still links somewhere that exists rather than to another origin.
 */
const ProductContext = createContext<Product>("either");

export function ProductProvider({ product, children }: { product: Product; children: ReactNode }) {
  return <ProductContext.Provider value={product}>{children}</ProductContext.Provider>;
}

/** Where the studio's home is from here. */
export function useStudioHref(): string {
  return studioHref(useContext(ProductContext), PRODUCT_HOSTS);
}

/** Where some other studio path is from here. Absolute only when it has to cross an origin. */
export function useStudioUrl(path: string): string {
  return studioUrl(useContext(ProductContext), PRODUCT_HOSTS, path);
}

/** Where a marketplace path is from here. Absolute only from the studio host, which 404s it. */
export function useMarketplaceHref(path: string): string {
  return marketplaceUrl(useContext(ProductContext), PRODUCT_HOSTS, path);
}

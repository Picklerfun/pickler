/**
 * Public PostHog configuration for the web app.
 *
 * The project token is a client-side key (`phc_`). Environment variables override the Pickler Fun
 * fallback so a hosting provider can point a build at another project without a code change.
 * Next inlines `NEXT_PUBLIC_*` at build time.
 */

/** Pickler Fun, US cloud, project 677170. */
export const POSTHOG_KEY_FALLBACK = "phc_yKbE6movrvGzTe2ixgp5qZCRqzi7Hsvp7T3xAjFf6Fjy";

export const POSTHOG_API_HOST_FALLBACK = "https://us.i.posthog.com";

/** Same-origin path the browser sends to. `next.config.ts` rewrites it to PostHog. */
export const POSTHOG_PROXY_PATH = "/ingest";

const API_HOSTS: Record<string, { assets: string; ui: string }> = {
  "https://us.i.posthog.com": {
    assets: "https://us-assets.i.posthog.com",
    ui: "https://us.posthog.com",
  },
  "https://eu.i.posthog.com": {
    assets: "https://eu-assets.i.posthog.com",
    ui: "https://eu.posthog.com",
  },
};

export function posthogProjectKey(): string {
  const configured = (
    process.env.NEXT_PUBLIC_POSTHOG_KEY || process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN
  )?.trim();
  return configured || POSTHOG_KEY_FALLBACK;
}

/** US or EU ingestion origin. Anything else keeps the Pickler Fun US host. */
export function posthogApiHost(): string {
  const configured = process.env.NEXT_PUBLIC_POSTHOG_HOST?.trim().replace(/\/$/, "");
  if (configured && API_HOSTS[configured]) {
    return configured;
  }
  return POSTHOG_API_HOST_FALLBACK;
}

export function posthogAssetsHost(apiHost = posthogApiHost()): string {
  return API_HOSTS[apiHost]?.assets ?? API_HOSTS[POSTHOG_API_HOST_FALLBACK]!.assets;
}

export function posthogUiHost(apiHost = posthogApiHost()): string {
  return API_HOSTS[apiHost]?.ui ?? API_HOSTS[POSTHOG_API_HOST_FALLBACK]!.ui;
}

export interface PostHogRewrite {
  source: string;
  destination: string;
}

/**
 * Rewrites for the same-origin proxy. Static and array routes stay ahead of the catch-all:
 * Next uses the first match, and those two belong on the asset host.
 */
export function posthogRewrites(apiHost = posthogApiHost()): PostHogRewrite[] {
  const assets = posthogAssetsHost(apiHost);
  return [
    {
      source: `${POSTHOG_PROXY_PATH}/static/:path*`,
      destination: `${assets}/static/:path*`,
    },
    {
      source: `${POSTHOG_PROXY_PATH}/array/:path*`,
      destination: `${assets}/array/:path*`,
    },
    {
      source: `${POSTHOG_PROXY_PATH}/:path*`,
      destination: `${apiHost}/:path*`,
    },
  ];
}

/**
 * Share one anonymous id between pickler.fun and app.pickler.fun.
 * Other hosts — localhost, a preview — keep a host-only cookie.
 */
export function shareAnalyticsCookie(hostname: string): boolean {
  const host = hostname.split(":")[0]?.toLowerCase() ?? "";
  return host === "pickler.fun" || host.endsWith(".pickler.fun");
}

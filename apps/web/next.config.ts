import type { NextConfig } from "next";
import { posthogRewrites } from "./src/features/analytics/config";

const config: NextConfig = {
  transpilePackages: ["@pickler/ui", "@pickler/api-schema"],
  // PostHog's capture API uses a trailing slash (`/ingest/e/`). Next would otherwise 308 that
  // POST and drop the body. The app's own links do not rely on the trailing-slash redirect.
  skipTrailingSlashRedirect: true,
  async rewrites() {
    return posthogRewrites();
  },
};
export default config;

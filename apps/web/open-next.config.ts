import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// Private pages are dynamic. Do not persist authenticated output in a shared cache.
export default defineCloudflareConfig({
  incrementalCache: "dummy",
  tagCache: "dummy",
  queue: "dummy",
});

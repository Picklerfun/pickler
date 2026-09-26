import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { unstable_dev } from "wrangler";

test("the pinned SDK signs and hashes offline inside workerd", async () => {
  const worker = await unstable_dev(fileURLToPath(new URL("./sdk-fixture.ts", import.meta.url)), {
    config: fileURLToPath(new URL("./wrangler.jsonc", import.meta.url)),
    local: true,
    ip: "127.0.0.1",
    port: 0,
    inspectorPort: 0,
    persist: false,
    logLevel: "error",
    experimental: { disableExperimentalWarning: true, disableDevRegistry: true, watch: false },
  });
  try {
    const response = await worker.fetch();
    assert.equal(response.status, 200);
    const result = (await response.json()) as { signature: string; hash: string };
    assert.match(result.signature, /^0x[0-9a-f]{130}$/i);
    assert.match(result.hash, /^0x[0-9a-f]{64}$/i);
  } finally {
    await worker.stop();
  }
});

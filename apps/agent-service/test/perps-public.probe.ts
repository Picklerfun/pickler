/** Explicit public GET simulation acceptance; never included in automatic *.test.ts discovery. */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
import { DEFAULT_CONFIG, PERP_TOOLS, type PerpNetwork } from "@pickler/core";
import { type PerpsPaperScope } from "@pickler/trading/perps";
import { createTestStore } from "@pickler/infrastructure/testing";
import { PostgresPerpsPaperStore } from "@pickler/infrastructure";
import { createPerpsPaperRuntime } from "@pickler/agent-runtime/composition/perps-paper";
const network = process.argv[2],
  attempt = process.argv[3];
if (
  (network !== "mainnet" && network !== "testnet") ||
  !attempt ||
  !/^[a-zA-Z0-9_-]+$/.test(attempt)
) {
  throw new Error(
    "Usage: node --import tsx apps/agent-service/test/perps-public.probe.ts mainnet|testnet UNIQUE_ATTEMPT",
  );
}
test("actual public Perpl reads with isolated virtual positions", async (t) => {
  const directory = resolve("apps/agent-service/.data/perps-public-probes", attempt);
  await mkdir(resolve(directory, ".."), { recursive: true, mode: 0o700 });
  await mkdir(directory, { mode: 0o700 });
  const research = await createTestStore(t);
  // alpha exists only in this disposable, newly migrated test database. No existing tenant is changed.
  const scope: PerpsPaperScope = {
    tenantId: "alpha",
    agentId: "pickle-alpha",
    sessionId: attempt,
    network: network as PerpNetwork,
  };
  await research.updateConfig(scope, 1, {
    ...DEFAULT_CONFIG,
    tools: [...PERP_TOOLS],
    perpl: { version: 1, network: network as PerpNetwork, markets: ["BTC", "ETH"] },
    perpsPaper: { version: 1, policy: "conservative-1x-v1" },
    plugins: { version: 1, enabled: ["perpl", "perps-paper"] },
  });
  const repo = new PostgresPerpsPaperStore(research.pool);
  await repo.initialize(scope, 2);
  const originals: { file: string; url: string; sha256: string }[] = [];
  const runtime = createPerpsPaperRuntime(repo, research, {
    onResponse: async (response) => {
      const file = `original-${originals.length + 1}.json`;
      await writeFile(join(directory, file), response.body, { flag: "wx", mode: 0o600 });
      originals.push({
        file,
        url: response.url,
        sha256: createHash("sha256").update(response.body).digest("hex"),
      });
    },
  });
  let complete = false;
  try {
    const signal = AbortSignal.timeout(180000);
    for (const [symbol, side] of [
      ["BTC", "long"],
      ["ETH", "short"],
    ] as const) {
      let view = await runtime.service.trade(scope, `open-${symbol}`, "open", symbol, side, signal);
      assert.equal(view.attempts.find((a) => a.key === `open-${symbol}`)!.status, "filled");
      view = await runtime.service.trade(scope, `close-${symbol}`, "close", symbol, side, signal);
      assert.equal(view.attempts.find((a) => a.key === `close-${symbol}`)!.status, "filled");
    }
    await runtime.service.tick(scope, "reconcile", signal);
    complete = true;
  } finally {
    const result = { complete, scope, report: await runtime.service.report(scope), originals };
    await writeFile(join(directory, "result.json"), JSON.stringify(result, null, 2), {
      flag: "wx",
      mode: 0o600,
    });
    console.log(
      JSON.stringify({
        directory,
        complete,
        requests: originals.length,
        cash: result.report.account.cash,
        positions: result.report.account.positions.length,
        fundingPending: result.report.account.fundingPending,
      }),
    );
  }
});

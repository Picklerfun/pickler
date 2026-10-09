import test from "node:test";
import assert from "node:assert/strict";
import { PERPL_LAB_SYMBOLS } from "@pickler/core";
import type { PerpsSmaReentryConfig } from "@pickler/trading/evaluation";
import { PostgresPerpsStudyStore } from "../src/persistence/perps-study-store.js";
import { createTestStore } from "./database.js";

const ids = [1, 10, 20, 31, 40, 50, 60, 70, 90, 100, 110];
function config(sessionId: string): PerpsSmaReentryConfig {
  return {
    version: 7,
    protocol: "perps-sma-reentry-latency-v1",
    tenantId: "alpha",
    sessionId,
    network: "mainnet",
    hours: 6,
    budgetUsd: "5",
    markets: PERPL_LAB_SYMBOLS.map((symbol, i) => ({ symbol, marketId: ids[i]! })),
  };
}

test("explicit v7 acquisition policy is persisted from frozen configuration and inherited by diagnostics", async (t) => {
  const research = await createTestStore(t);
  const store = new PostgresPerpsStudyStore(research.pool);
  const configured = {
    ...config("fresh-batch"),
    acquisitionPolicy: "rest-universe-coherent-20s-v2" as const,
  };

  const prepared = await store.initialize(configured, { version: 1 });
  await store.initializeDiagnostic(configured, "fresh-batch-diagnostic", { version: 1 });
  const diagnostic = await store.view({ ...configured, sessionId: "fresh-batch-diagnostic" });

  assert.equal(prepared.record.dataPolicy, "rest-universe-coherent-20s-v2");
  assert.equal(diagnostic.record.dataPolicy, "rest-universe-coherent-20s-v2");
  assert.equal(diagnostic.record.config.version, 7);
  assert.equal(diagnostic.record.config.acquisitionPolicy, "rest-universe-coherent-20s-v2");
  assert.equal(diagnostic.record.decisionStopReason, "DIAGNOSTIC_ONLY");
  assert.equal(diagnostic.rounds.length, 0);
});

test("historical defaults are retained and metadata cannot silently select or contradict v2", async (t) => {
  const research = await createTestStore(t);
  const store = new PostgresPerpsStudyStore(research.pool);
  const original = config("original-default");

  const defaulted = await store.initialize(original, {});
  const legacy = await store.initialize(config("original-universe"), {
    acquisition: { policy: "rest-universe-20s-v1" },
  });

  assert.equal(defaulted.record.dataPolicy, "coherent-20s-v1");
  assert.equal(legacy.record.dataPolicy, "rest-universe-20s-v1");
  assert.equal("acquisitionPolicy" in defaulted.record.config, false);
  await assert.rejects(
    store.initialize(config("implicit-v2"), {
      acquisition: { policy: "rest-universe-coherent-20s-v2" },
    }),
    { code: "INVALID_INPUT" },
  );
  await assert.rejects(
    store.initialize(
      { ...config("contradictory-v2"), acquisitionPolicy: "rest-universe-coherent-20s-v2" },
      {
        acquisition: { policy: "rest-universe-20s-v1" },
      },
    ),
    { code: "INVALID_INPUT" },
  );
  await assert.rejects(
    store.initializeDiagnostic(original, "contradictory-diagnostic", {
      acquisition: { policy: "rest-universe-coherent-20s-v2" },
    }),
    { code: "INVALID_INPUT" },
  );

  const refused = await research.pool.query(
    "SELECT session_id FROM pickler.perps_studies WHERE session_id = ANY($1)",
    [["implicit-v2", "contradictory-v2", "contradictory-diagnostic"]],
  );
  assert.deepEqual(refused.rows, []);
  assert.deepEqual((await store.view(original)).record, defaulted.record);
});

test("an independent diagnostic can explicitly select v2 without changing the historical v1 study or accounts", async (t) => {
  const research = await createTestStore(t);
  const store = new PostgresPerpsStudyStore(research.pool);
  const original = config("historical-v1-source");
  const source = await store.initialize(original, {
    acquisition: { policy: "rest-universe-20s-v1" },
  });
  const inventory = async () => ({
    agents: (await research.pool.query("SELECT id,config FROM pickler.agents ORDER BY id")).rows,
    accounts: (
      await research.pool.query("SELECT id,document FROM pickler.perps_paper_accounts ORDER BY id")
    ).rows,
  });
  const before = await inventory();

  const selected = await store.initializeDiagnostic(
    original,
    "independent-v2-diagnostic",
    { acquisitionPolicy: "rest-universe-coherent-20s-v2" },
    { ...original, acquisitionPolicy: "rest-universe-coherent-20s-v2" },
  );
  const diagnostic = await store.view(selected);
  const lease = await store.claim(selected);
  await store.guard(selected, lease);
  await store.renew(selected, lease);
  await assert.rejects(store.guard(selected, lease, true));
  await store.release(selected, lease);

  assert.equal(selected.sessionId, "independent-v2-diagnostic");
  assert.equal(diagnostic.record.dataPolicy, "rest-universe-coherent-20s-v2");
  assert.ok(diagnostic.record.config.version === 7);
  assert.equal(diagnostic.record.config.acquisitionPolicy, "rest-universe-coherent-20s-v2");
  assert.equal(diagnostic.record.decisionStopReason, "DIAGNOSTIC_ONLY");
  assert.deepEqual(diagnostic.record.agentIds, source.record.agentIds);
  assert.deepEqual(diagnostic.record.agentVersions, source.record.agentVersions);
  assert.deepEqual(diagnostic.rounds, []);
  assert.deepEqual(await inventory(), before);
  assert.deepEqual(await store.view(original), source);
  assert.equal((await store.view(selected)).rounds.length, 0);
});

test("diagnostic overrides reject changed frozen fields, invalid configuration and contradictory metadata", async (t) => {
  const research = await createTestStore(t);
  const store = new PostgresPerpsStudyStore(research.pool);
  const original = config("override-source");
  const source = await store.initialize(original, {
    acquisition: { policy: "rest-universe-20s-v1" },
  });
  const selected = {
    ...original,
    acquisitionPolicy: "rest-universe-coherent-20s-v2" as const,
  };
  const changed = [
    { ...selected, tenantId: "beta" },
    { ...selected, network: "testnet" as const },
    { ...selected, markets: [...selected.markets].reverse() },
    { ...selected, acquisitionPolicy: "rest-universe-20s-v1" as const },
  ];

  for (const [index, value] of changed.entries()) {
    await assert.rejects(
      store.initializeDiagnostic(original, `rejected-change-${index}`, {}, value),
      { code: "INVALID_INPUT" },
    );
  }
  await assert.rejects(
    store.initializeDiagnostic(
      original,
      "rejected-invalid",
      {},
      {
        ...selected,
        markets: selected.markets.map((market, index) =>
          index === 0 ? { ...market, marketId: 999 } : market,
        ),
      },
    ),
    { code: "INVALID_INPUT" },
  );
  await assert.rejects(
    store.initializeDiagnostic(
      original,
      "rejected-metadata",
      { acquisitionPolicy: "rest-universe-20s-v1" },
      selected,
    ),
    { code: "INVALID_INPUT" },
  );

  const diagnostics = await research.pool.query(
    "SELECT session_id FROM pickler.perps_studies WHERE session_id <> $1",
    [original.sessionId],
  );
  assert.deepEqual(diagnostics.rows, []);
  assert.deepEqual(await store.view(original), source);
});

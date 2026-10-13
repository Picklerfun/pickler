import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test, { type TestContext } from "node:test";
import type { Pool } from "pg";
import { PilotError } from "@pickler/core";
import type { PerpsStudyConfig, PerpsStudyLease } from "@pickler/trading/evaluation";
import { PTS_CATALOG } from "@pickler/trading/pts";
import { PostgresPerpsStudyStore } from "../src/persistence/perps-study-store.js";
import { exportPerpsAudit } from "../src/persistence/perps-audit-export.js";
import { guardPerpsLabPool } from "../src/persistence/perps-lab-pool.js";
import { createTestStore } from "./database.js";

const initialTime = 1_791_791_460_000;

function configuration(version: 1 | 8 | 9): PerpsStudyConfig {
  const common = {
    tenantId: "alpha",
    sessionId: "controlled-control-reads",
    network: "mainnet" as const,
    budgetUsd: "5" as const,
  };
  if (version === 1) {
    return {
      ...common,
      version,
      protocol: "perps-comparison-v1",
      hours: 24,
      deepseek: {
        model: "controlled-deepseek",
        baseUrl: "https://example.invalid/v1",
        inputPerMillion: "0.30",
        outputPerMillion: "1.20",
      },
      jev: { model: "jev-1.13.0", inputPerMillion: "0.042", outputPerMillion: "0" },
      pricingVerifiedAt: "2026-09-28T00:00:00Z",
      pricingSources: ["https://example.invalid/deepseek", "https://example.invalid/jev"],
    };
  }
  const pts = {
    ...common,
    markets: PTS_CATALOG.map((market) => ({ ...market })),
    acquisitionPolicy: "stream-universe-component-paper-20s-v1" as const,
    history: { file: "history.json", sha256: "a".repeat(64) },
    preparedFor: "local-paper-only" as const,
  };
  return version === 8
    ? {
        ...pts,
        version,
        hours: 336,
        protocol: "perps-pts-sma-v1",
        candidate: "pts-trend-reversal@0.2.0",
      }
    : {
        ...pts,
        version,
        hours: 24,
        protocol: "perps-pts-intraday-sma-v1",
        candidate: "pts-intraday@0.2.0-fast.1",
      };
}

async function fixture(t: TestContext, version: 1 | 8 | 9 = 9) {
  let now = initialTime;
  const db = await createTestStore(t, () => now);
  const config = configuration(version);
  const study = new PostgresPerpsStudyStore(db.pool, () => now);
  const metadata = {
    purpose: "controlled-control-reads",
    publicCapture: Array.from({ length: 8192 }, (_, i) =>
      createHash("sha256")
        .update("controlled-" + i)
        .digest("hex"),
    ),
  };
  await study.initialize(config, metadata);
  const lease = await study.claim(config);
  return {
    db,
    config,
    study,
    lease,
    metadata,
    clock: () => now,
    advance: (ms: number) => (now += ms),
  };
}

function observedPool(
  pool: Pool,
  after: (text: string, rows: Record<string, unknown>[]) => void = () => {},
  timeout?: number,
) {
  const statements: string[] = [];
  const controlRows: Record<string, unknown>[][] = [];
  return {
    statements,
    controlRows,
    pool: new Proxy(pool, {
      get(object, property) {
        if (property === "connect") {
          return async () => {
            const client = await object.connect();
            if (timeout !== undefined) {
              await client.query("SET statement_timeout=" + timeout);
            }
            return new Proxy(client, {
              get(target, key) {
                if (key === "query") {
                  return async (...args: unknown[]) => {
                    const text = typeof args[0] === "string" ? args[0] : "OTHER";
                    statements.push(text);
                    const result = await Reflect.apply(target.query, target, args);
                    if (/^SELECT id,(document|owner)/.test(text)) {
                      controlRows.push(structuredClone(result.rows));
                    }
                    after(text, result.rows);
                    return result;
                  };
                }
                const value = Reflect.get(target, key, target);
                return typeof value === "function" ? value.bind(target) : value;
              },
            });
          };
        }
        const value = Reflect.get(object, property, object);
        return typeof value === "function" ? value.bind(object) : value;
      },
    }) as Pool,
  };
}

for (const version of [1, 8, 9] as const) {
  test(
    "v" + version + " guards omit only metadata and renewal locks ownership without loading it",
    async (t) => {
      const f = await fixture(t, version);
      const before = await exportPerpsAudit(f.db.pool, f.config);
      const observer = observedPool(f.db.pool);
      const store = new PostgresPerpsStudyStore(observer.pool, f.clock);

      await store.guard(f.config, f.lease);
      f.advance(1000);
      await store.renew(f.config, f.lease);

      const document = observer.controlRows[0]![0]!.document as Record<string, unknown>;
      const expected = structuredClone(before.study.record) as unknown as Record<string, unknown>;
      delete expected.metadata;
      assert.deepEqual(document, expected);
      assert.equal(Object.hasOwn(document, "metadata"), false);
      assert.equal(Buffer.byteLength(JSON.stringify(document)) < 16_384, true);
      assert.equal(Object.hasOwn(observer.controlRows[1]![0]!, "document"), false);
      assert.equal(observer.statements[0], "BEGIN ISOLATION LEVEL READ COMMITTED READ ONLY");
      assert.equal(
        observer.statements.some((text) => text.includes("network=$3 FOR UPDATE")),
        true,
      );
      assert.equal(
        observer.statements.filter(
          (text) => text === "SELECT owner, expires_at FROM pickler.perps_studies WHERE id=$1",
        ).length,
        2,
      );
      assert.equal(f.lease.expiresAt, f.clock() + 90_000);
      assert.deepEqual(await exportPerpsAudit(f.db.pool, f.config), before);
      await f.study.release(f.config, f.lease);
    },
  );
}

test("projection preserves paid admission, stopped-decision and paper-only errors", async (t) => {
  const paid = await fixture(t, 1);
  await paid.study.guard(paid.config, paid.lease, true);
  await paid.study.stop(paid.config);
  await assert.rejects(paid.study.guard(paid.config, paid.lease, true), {
    code: "DECISIONS_STOPPED",
  });
  await paid.study.guard(paid.config, paid.lease);
  await paid.study.release(paid.config, paid.lease);

  const paper = await fixture(t, 9);
  await assert.rejects(paper.study.guard(paper.config, paper.lease, true), {
    code: "MODELS_DISABLED",
  });
  await paper.study.release(paper.config, paper.lease);
});

test("missing scope, changed agent version, revoked permission and pause remain rejected", async (t) => {
  const f = await fixture(t);
  await assert.rejects(f.study.guard({ ...f.config, sessionId: "other-study" }, f.lease), {
    code: "NOT_FOUND",
  });
  const record = (await exportPerpsAudit(f.db.pool, f.config)).study.record;
  const agentId = record.agentIds["sma-reference"]!;
  const agent = (
    await f.db.pool.query("SELECT version,config FROM pickler.agents WHERE id=$1", [agentId])
  ).rows[0]!;

  await f.db.pool.query("UPDATE pickler.agents SET version=version+1 WHERE id=$1", [agentId]);
  await assert.rejects(f.study.guard(f.config, f.lease), { code: "CONFIG_CHANGED" });
  await f.db.pool.query("UPDATE pickler.agents SET version=$2,paused=true WHERE id=$1", [
    agentId,
    agent.version,
  ]);
  await assert.rejects(f.study.guard(f.config, f.lease), { code: "PAUSED" });
  const revoked = {
    ...agent.config,
    plugins: { version: 1, enabled: ["perps-paper"] },
  };
  await f.db.pool.query("UPDATE pickler.agents SET paused=false,config=$2 WHERE id=$1", [
    agentId,
    revoked,
  ]);
  await assert.rejects(f.study.guard(f.config, f.lease), { code: "PLUGIN_DISABLED" });
  await f.study.release(f.config, f.lease);
});

test("ownership mismatch, deadline and final commit liveness cannot be bypassed by projection", async (t) => {
  const f = await fixture(t);
  const wrong = { ...f.lease, owner: "another-owner" };
  await assert.rejects(f.study.guard(f.config, wrong), { code: "LEASE_LOST" });
  await assert.rejects(f.study.renew(f.config, wrong), { code: "LEASE_LOST" });
  const before = await exportPerpsAudit(f.db.pool, f.config);
  const observer = observedPool(f.db.pool, (text) => {
    if (text.startsWith("SELECT id,owner,expires_at")) {
      f.advance(90_001);
    }
  });
  const store = new PostgresPerpsStudyStore(observer.pool, f.clock);
  const expiry = f.lease.expiresAt;

  await assert.rejects(store.renew(f.config, f.lease), { code: "LEASE_LOST" });

  assert.equal(f.lease.expiresAt, expiry);
  assert.equal(observer.statements.includes("ROLLBACK"), true);
  assert.equal(observer.statements.includes("COMMIT"), false);
  assert.deepEqual(await exportPerpsAudit(f.db.pool, f.config), before);
  await assert.rejects(f.study.guard(f.config, f.lease), { code: "LEASE_LOST" });
});

test("cancellation after a renewal update rolls back and keeps its original error and lease", async (t) => {
  const f = await fixture(t);
  const before = (
    await f.db.pool.query("SELECT expires_at FROM pickler.perps_studies WHERE session_id=$1", [
      f.config.sessionId,
    ])
  ).rows;
  let checks = 0;
  const cancellation = new PilotError("SYSTEM_SUSPENDED", "Controlled cancellation");
  const lease: PerpsStudyLease = {
    ...f.lease,
    assertActive: () => {
      if (++checks === 2) {
        throw cancellation;
      }
    },
  };
  const observer = observedPool(f.db.pool);
  const store = new PostgresPerpsStudyStore(observer.pool, f.clock);
  f.advance(1000);

  await assert.rejects(store.renew(f.config, lease), (error) => error === cancellation);

  assert.equal(lease.expiresAt, f.lease.expiresAt);
  assert.equal(
    observer.statements.some((text) =>
      text.startsWith("UPDATE pickler.perps_studies SET expires_at"),
    ),
    true,
  );
  assert.equal(observer.statements.includes("ROLLBACK"), true);
  const after = (
    await f.db.pool.query("SELECT expires_at FROM pickler.perps_studies WHERE session_id=$1", [
      f.config.sessionId,
    ])
  ).rows;
  assert.deepEqual(after, before);
  await f.study.release(f.config, f.lease);
});

test("a blocked projected read keeps the statement-timeout classification and writes no history", async (t) => {
  const f = await fixture(t);
  const before = await exportPerpsAudit(f.db.pool, f.config);
  const blocker = await f.db.pool.connect();
  await blocker.query("BEGIN");
  await blocker.query("LOCK TABLE pickler.perps_studies IN ACCESS EXCLUSIVE MODE");
  const observer = observedPool(f.db.pool, undefined, 100);
  const store = new PostgresPerpsStudyStore(guardPerpsLabPool(observer.pool), f.clock);
  try {
    await assert.rejects(store.guard(f.config, f.lease), { code: "PERSISTENCE_QUERY_TIMEOUT" });
  } finally {
    await blocker.query("ROLLBACK");
    blocker.release();
  }
  assert.equal(
    observer.statements.some((text) => text.startsWith("UPDATE") || text.startsWith("INSERT")),
    false,
  );
  assert.deepEqual(await exportPerpsAudit(f.db.pool, f.config), before);
  await f.study.release(f.config, f.lease);
});

import assert from "node:assert/strict";
import test from "node:test";
import type { PoolClient } from "pg";
import { createLocalPerpsLabStore } from "../src/persistence/perps-lab-local.js";
import type { PerpsLabQueryDiagnostic } from "../src/persistence/perps-lab-query.js";
import { PostgresResearchStore } from "../src/persistence/research-store.js";
import { createTestStore } from "./database.js";

const url = "postgresql://fixture:fixture@127.0.0.1:25432/fixture";
test("local workload partition rejects hosted URLs and unknown roles before connecting", async () => {
  assert.throws(() => createLocalPerpsLabStore(url, "unknown" as "execution"), {
    code: "INVALID_INPUT",
  });
  assert.throws(
    () =>
      createLocalPerpsLabStore("postgresql://fixture:fixture@remote.invalid/fixture", "execution"),
    /loopback/,
  );
  const legacy = new PostgresResearchStore(url);
  const execution = createLocalPerpsLabStore(url, "execution");
  const report = createLocalPerpsLabStore(url, "report");
  try {
    assert.equal(legacy.pool.options.max, 5);
    assert.equal(execution.pool.options.max, 4);
    assert.equal(report.pool.options.max, 1);
    assert.equal(execution.pool.options.max! + report.pool.options.max!, 5);
    for (const pool of [legacy.pool, execution.pool, report.pool]) {
      assert.equal(pool.options.connectionTimeoutMillis, 10_000);
      assert.equal(pool.options.statement_timeout, 10_000);
      assert.equal(pool.totalCount, 0);
    }
  } finally {
    await Promise.all([legacy.close(), execution.close(), report.close()]);
  }
});

test("report connections are read-only at PostgreSQL, including Drizzle permission reads", async (t) => {
  const fixture = await createTestStore(t);
  const notices: PerpsLabQueryDiagnostic[] = [];
  const report = createLocalPerpsLabStore(fixture.pool.options.connectionString!, "report", {
    query: (n) => notices.push(n),
  });
  try {
    const before = await fixture.agent({ tenantId: "alpha", agentId: "pickle-alpha" });
    assert.equal(
      (await report.pool.query("SHOW default_transaction_read_only")).rows[0]!
        .default_transaction_read_only,
      "on",
    );
    assert.deepEqual(await report.agent({ tenantId: "alpha", agentId: "pickle-alpha" }), before);
    const reads = notices.filter((n) => n.phase === "finished" && n.statement === "SELECT");
    assert.ok(reads.length > 0, "Drizzle was composed with the observed pool");
    await assert.rejects(
      report.pool.query("UPDATE pickler.agents SET paused=true WHERE tenant_id='alpha'"),
      { code: "25006" },
    );
    assert.deepEqual(await fixture.agent({ tenantId: "alpha", agentId: "pickle-alpha" }), before);
    assert.deepEqual(await report.agent({ tenantId: "alpha", agentId: "pickle-alpha" }), before);
  } finally {
    await report.close();
  }
});

test("one borrowed-client failure blocks new permission reads and financial pool operations", async (t) => {
  const fixture = await createTestStore(t);
  const notices: PerpsLabQueryDiagnostic[] = [];
  const failures: string[] = [];
  const execution = createLocalPerpsLabStore(fixture.pool.options.connectionString!, "execution", {
    query: (n) => notices.push(n),
    failed: (e) => failures.push(e.code),
  });
  let client: PoolClient | undefined;
  try {
    await execution.agent({ tenantId: "alpha", agentId: "pickle-alpha" });
    client = await execution.pool.connect();
    client.emit("error", new Error("controlled private disconnect"));
    const observedBefore = notices.length;
    await assert.rejects(
      execution.agent({ tenantId: "alpha", agentId: "pickle-alpha" }),
      (e: unknown) => {
        const error = e as { code?: string; cause?: { code?: string } };
        return (error.code ?? error.cause?.code) === "PERSISTENCE_CONNECTION_FAILED";
      },
    );
    await assert.rejects(execution.pool.query("SELECT 1"), {
      code: "PERSISTENCE_CONNECTION_FAILED",
    });
    await assert.rejects(execution.pool.connect(), { code: "PERSISTENCE_CONNECTION_FAILED" });
    assert.equal(notices.length, observedBefore);
    assert.deepEqual(failures, ["PERSISTENCE_CONNECTION_FAILED"]);
    assert.equal(JSON.stringify(notices).includes("controlled private disconnect"), false);
  } finally {
    client?.release();
    await execution.close();
  }
});

test("real pg-pool queue exhaustion remains a connection timeout and identifies its driver branch", async (t) => {
  const fixture = await createTestStore(t);
  const notices: PerpsLabQueryDiagnostic[] = [];
  const execution = createLocalPerpsLabStore(fixture.pool.options.connectionString!, "execution", {
    query: (n) => notices.push(n),
  });
  const held: PoolClient[] = [];
  try {
    for (let i = 0; i < 4; i++) {
      held.push(await execution.pool.connect());
    }
    // Fixture-only short wait; production deadlines remain ten seconds.
    execution.pool.options.connectionTimeoutMillis = 60;
    await assert.rejects(execution.pool.connect(), { code: "PERSISTENCE_CONNECTION_TIMEOUT" });
    const failed = notices.at(-1)!;
    assert.equal(failed.operation, "connect");
    assert.equal(failed.checkoutAtStart, "queued");
    assert.equal(failed.connectionDeadlineStage, "pool-queue");
    assert.equal(failed.poolTotal, 4);
    assert.equal(failed.poolIdle, 0);
    assert.equal(failed.poolLimit, 4);
    assert.equal(failed.backendPid, null);
    assert.ok(failed.durationMs! >= 40);
    await assert.rejects(execution.pool.query("SELECT 1"), {
      code: "PERSISTENCE_CONNECTION_TIMEOUT",
    });
  } finally {
    for (const client of held) {
      client.release();
    }
    await execution.close();
  }
});

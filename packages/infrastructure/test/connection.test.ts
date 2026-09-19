import assert from "node:assert/strict";
import { test } from "node:test";
import { databasePoolConfig } from "../src/persistence/connection.js";
import { PostgresResearchStore } from "../src/persistence/research-store.js";

const local =
  process.env.TEST_DATABASE_URL ??
  "postgresql://pickler:pickler_local_only@127.0.0.1:55432/pickler";
const remote =
  "postgresql://postgres.project:secret@aws-0-us-east-1.pooler.supabase.com:5432/postgres";

test("deployed connections enforce TLS and reject overrides without disclosing credentials", () => {
  const config = databasePoolConfig(remote, { environment: "staging" });
  assert.equal(config.max, 2);
  assert.equal(config.connectionTimeoutMillis, 10_000);
  assert.equal(config.statement_timeout, 10_000);
  assert.deepEqual(config.ssl, {
    rejectUnauthorized: true,
    servername: "aws-0-us-east-1.pooler.supabase.com",
  });
  for (const url of [
    remote + "?sslmode=disable",
    remote.replace(":5432", ":6543"),
    local,
    "password-not-a-url",
  ]) {
    assert.throws(
      () => databasePoolConfig(url, { environment: "staging" }),
      (error: Error) => {
        assert.ok(!error.message.includes("secret"));
        assert.ok(!error.message.includes("password-not-a-url"));
        return true;
      },
    );
  }
  assert.throws(() => databasePoolConfig(remote, { environment: "local" }), /loopback/);
  assert.equal(databasePoolConfig(local, { environment: "local" }).ssl, false);
});

test("invocation pools are independent, allow a second query and close after failures", async () => {
  const first = new PostgresResearchStore(local, undefined, { environment: "local" });
  const second = new PostgresResearchStore(local, undefined, { environment: "local" });
  try {
    assert.notEqual(first.pool, second.pool);
    const held = await first.pool.connect();
    try {
      await held.query("BEGIN");
      const result = await first.pool.query("SELECT 1 AS alive");
      assert.equal(result.rows[0].alive, 1);
      assert.equal(first.pool.totalCount, 2);
      await assert.rejects(second.pool.query("SELECT missing_column"));
      assert.equal((await second.pool.query("SELECT 1 AS alive")).rows[0].alive, 1);
    } finally {
      await held.query("ROLLBACK");
      held.release();
    }
  } finally {
    await Promise.all([first.close(), second.close()]);
  }
  assert.equal(first.pool.totalCount, 0);
  assert.equal(second.pool.totalCount, 0);
});

test("a lease renews using the second connection while the first is occupied", async (t) => {
  const { createTestStore } = await import("./database.js");
  const repository = await createTestStore(t);
  repository.pool.options.max = 2;
  const scope = { tenantId: "alpha", agentId: "pickle-alpha" };
  const agent = await repository.agent(scope);
  await repository.updateConfig(scope, agent.version, { ...agent.config, categoryIds: ["1"] });
  await repository.enqueue(scope, "two-connection-lease", "1", Date.now());
  const run = (await repository.claim(Date.now()))!;
  const held = await repository.pool.connect();
  try {
    await held.query("BEGIN");
    await repository.renew(run);
    await repository.assertOwnership(run);
    assert.equal(repository.pool.totalCount, 2);
  } finally {
    await held.query("ROLLBACK");
    held.release();
  }
});

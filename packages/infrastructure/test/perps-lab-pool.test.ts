import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import type { Pool } from "pg";
import { guardPerpsLabPool } from "../src/persistence/perps-lab-pool.js";
import { exportPerpsAuditParts } from "../src/persistence/perps-audit-export.js";
import { createTestStore } from "./database.js";

class ControlledClient extends EventEmitter {
  statements: string[] = [];
  releases: (Error | boolean | undefined)[] = [];
  async query(statement: string) {
    this.statements.push(statement);
    return { rows: [] };
  }
  release(error?: Error | boolean) {
    this.releases.push(error);
    if (error) {
      this.emit("end");
    }
  }
}
class ControlledPool extends EventEmitter {
  client = new ControlledClient();
  connections = 0;
  statements: string[] = [];
  ended = false;
  async connect() {
    this.connections++;
    return this.client;
  }
  async query(statement: string) {
    this.statements.push(statement);
    return { rows: [] };
  }
  async end() {
    this.ended = true;
  }
}
const lost = { code: "PERSISTENCE_CONNECTION_FAILED" };

test("borrowed PostgreSQL errors abort once and prohibit new queries and admissions", async () => {
  const original = new ControlledPool();
  const failures: unknown[] = [];
  const pool = guardPerpsLabPool(original as unknown as Pool, (error) => failures.push(error));
  const client = await pool.connect();
  await client.query("BEGIN");

  assert.doesNotThrow(() => original.client.emit("error", new Error("private driver text")));
  original.client.emit("error", new Error("another private driver message"));

  assert.equal(failures.length, 1);
  assert.equal(JSON.stringify(failures).includes("private driver"), false);
  await assert.rejects(client.query("INSERT forbidden"), lost);
  await assert.rejects(client.query("COMMIT"), lost);
  await assert.rejects(pool.query("UPDATE forbidden"), lost);
  await assert.rejects(pool.connect(), lost);
  assert.deepEqual(original.client.statements, ["BEGIN"]);
  assert.deepEqual(original.statements, []);
  assert.equal(original.connections, 1);

  client.release();
  assert.deepEqual(original.client.releases, [true]);
  await pool.end();
  assert.equal(original.ended, true);
  assert.equal(original.listenerCount("error"), 0);
  assert.equal(original.client.listenerCount("error"), 0);
});

test("idle pool failures stop the same scope rather than silently creating another connection", async () => {
  const original = new ControlledPool();
  let failures = 0;
  const pool = guardPerpsLabPool(original as unknown as Pool, () => failures++);

  original.emit("error", new Error("Connection terminated unexpectedly"));
  original.emit("error", new Error("second error"));

  await assert.rejects(pool.connect(), lost);
  assert.equal(failures, 1);
  assert.equal(original.connections, 0);
  await pool.end();
});

test("successful borrowed clients retain results and do not accumulate listeners on reuse", async () => {
  const original = new ControlledPool();
  let failures = 0;
  const pool = guardPerpsLabPool(original as unknown as Pool, () => failures++);

  for (let i = 0; i < 3; i++) {
    const client = await pool.connect();
    assert.equal(original.client.listenerCount("error"), 1);
    assert.deepEqual(await client.query("SELECT 1"), { rows: [] });
    client.release();
    assert.equal(original.client.listenerCount("error"), 0);
  }

  assert.equal(failures, 0);
  assert.deepEqual(original.client.releases, [undefined, undefined, undefined]);
  await pool.end();
});

test("a pending query cannot acknowledge success after the financial scope lost its connection", async () => {
  const original = new ControlledPool();
  let complete!: () => void;
  const pending = new Promise<void>((resolve) => {
    complete = resolve;
  });
  original.client.query = async (statement) => {
    original.client.statements.push(statement);
    await pending;
    return { rows: [] };
  };
  const pool = guardPerpsLabPool(original as unknown as Pool);
  const client = await pool.connect();
  const result = client.query("SELECT pending");

  original.client.emit("error", new Error("Connection terminated unexpectedly"));
  complete();

  await assert.rejects(result, lost);
  client.release();
  await pool.end();
});

test(
  "real PostgreSQL disconnect during a read-only audit sink is contained and leaves history intact",
  { timeout: 20000 },
  async (t) => {
    const store = await createTestStore(t);
    const peer = store.connectPeer();
    const scope = {
      tenantId: "controlled-pool",
      sessionId: "read-only-disconnect",
      network: "mainnet" as const,
    };
    await store.pool.query(
      "INSERT INTO pickler.perps_studies (id,tenant_id,session_id,network,document) VALUES ('controlled-disconnect',$1,$2,$3,$4)",
      [scope.tenantId, scope.sessionId, scope.network, JSON.stringify({ fixture: "unchanged" })],
    );
    const before = (
      await store.pool.query("SELECT document FROM pickler.perps_studies WHERE tenant_id=$1", [
        scope.tenantId,
      ])
    ).rows;
    const controller = new AbortController();
    const pool = guardPerpsLabPool(store.pool, (error) => controller.abort(error));
    const aborted = new Promise<void>((resolve) => {
      controller.signal.addEventListener("abort", () => resolve(), { once: true });
    });
    let emitted = 0;

    await assert.rejects(
      exportPerpsAuditParts(pool, scope, async () => {
        emitted++;
        const backend = await peer.pool.query(
          "SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND state='idle in transaction' AND query LIKE 'SELECT id, document FROM pickler.perps_studies%'",
        );
        assert.equal(backend.rows.length, 1);
        await peer.pool.query("SELECT pg_terminate_backend($1)", [backend.rows[0].pid]);
        await aborted;
      }),
      lost,
    );

    assert.equal(emitted, 1);
    assert.equal(controller.signal.aborted, true);
    const after = (
      await peer.pool.query("SELECT document FROM pickler.perps_studies WHERE tenant_id=$1", [
        scope.tenantId,
      ])
    ).rows;
    assert.deepEqual(after, before);
    await assert.rejects(pool.query("DELETE FROM pickler.perps_studies"), lost);
  },
);

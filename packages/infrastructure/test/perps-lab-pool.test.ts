import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import type { Pool } from "pg";
import { guardPerpsLabPool } from "../src/persistence/perps-lab-pool.js";
import { exportPerpsAuditParts } from "../src/persistence/perps-audit-export.js";
import { createTestStore } from "./database.js";

class ControlledClient extends EventEmitter {
  processID = 42;
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

test("a fatal query response latches before any client error event and preserves safe diagnostics", async () => {
  const original = new ControlledPool();
  const failure = Object.assign(new Error("private SQL and driver body"), { code: "57P01" });
  original.client.query = async (statement) => {
    original.client.statements.push(statement);
    throw failure;
  };
  const notices: unknown[] = [];
  const pool = guardPerpsLabPool(original as unknown as Pool, (error, diagnostic) => {
    notices.push({ code: error.code, diagnostic });
  });
  const client = await pool.connect();

  await assert.rejects(client.query("SELECT shutdown"), lost);
  await assert.rejects(client.query("COMMIT forbidden"), lost);
  await assert.rejects(pool.connect(), lost);
  original.client.emit("error", failure);

  assert.equal(notices.length, 1);
  assert.deepEqual(original.client.statements, ["SELECT shutdown"]);
  assert.equal(original.connections, 1);
  assert.deepEqual(notices[0], {
    code: "PERSISTENCE_CONNECTION_FAILED",
    diagnostic: {
      version: 1,
      code: "PERSISTENCE_CONNECTION_FAILED",
      operation: "client-query",
      at: (notices[0] as { diagnostic: { at: number } }).diagnostic.at,
      driverCode: "57P01",
      backendPid: 42,
    },
  });
  assert.equal(JSON.stringify(notices).includes("private SQL"), false);

  client.release();
  await pool.end();
});

test("direct pool connection exceptions cannot be retried in the same financial scope", async () => {
  const original = new ControlledPool();
  original.query = async (statement) => {
    original.statements.push(statement);
    throw Object.assign(new Error("private transport message"), { code: "08006" });
  };
  const notices: unknown[] = [];
  const pool = guardPerpsLabPool(original as unknown as Pool, (_, diagnostic) => {
    notices.push(diagnostic);
  });

  await assert.rejects(pool.query("SELECT connection lost"), lost);
  await assert.rejects(pool.query("UPDATE forbidden"), lost);

  assert.deepEqual(original.statements, ["SELECT connection lost"]);
  assert.equal(notices.length, 1);
  assert.equal((notices[0] as { operation: string }).operation, "pool-query");
  assert.equal((notices[0] as { driverCode: string }).driverCode, "08006");
  assert.equal((notices[0] as { backendPid: unknown }).backendPid, null);
  await pool.end();
});

test("exact pg disconnection messages without driver codes still latch pooled queries", async () => {
  for (const message of [
    "Connection terminated",
    "Connection terminated unexpectedly",
    "Client has encountered a connection error and is not queryable",
    "Client was closed and is not queryable",
  ]) {
    const original = new ControlledPool();
    original.query = async (statement) => {
      original.statements.push(statement);
      throw new Error(message);
    };
    const notices: unknown[] = [];
    const pool = guardPerpsLabPool(original as unknown as Pool, (_, diagnostic) => {
      notices.push(diagnostic);
    });

    await assert.rejects(pool.query("SELECT disconnected"), lost);
    await assert.rejects(pool.query("UPDATE forbidden"), lost);

    assert.deepEqual(original.statements, ["SELECT disconnected"]);
    assert.equal(notices.length, 1);
    assert.equal((notices[0] as { driverCode: unknown }).driverCode, null);
    assert.equal(JSON.stringify(notices).includes(message), false);
    await pool.end();
  }
});

test("recovery rejection during connect notifies once without a borrowed client", async () => {
  const original = new ControlledPool();
  original.connect = async () => {
    original.connections++;
    throw Object.assign(new Error("private server recovery detail"), { code: "57P03" });
  };
  const notices: unknown[] = [];
  const pool = guardPerpsLabPool(original as unknown as Pool, (_, diagnostic) => {
    notices.push(diagnostic);
  });

  await assert.rejects(pool.connect(), lost);
  await assert.rejects(pool.connect(), lost);

  assert.equal(original.connections, 1);
  assert.equal(notices.length, 1);
  assert.equal((notices[0] as { operation: string }).operation, "connect");
  assert.equal((notices[0] as { driverCode: string }).driverCode, "57P03");
  await pool.end();
});

test("the known connection deadline remains a timeout rather than generic connection loss", async () => {
  const original = new ControlledPool();
  original.connect = async () => {
    original.connections++;
    throw new Error("Connection terminated due to connection timeout");
  };
  const codes: string[] = [];
  const pool = guardPerpsLabPool(original as unknown as Pool, (error) => codes.push(error.code));

  await assert.rejects(pool.connect(), { code: "PERSISTENCE_CONNECTION_TIMEOUT" });
  await assert.rejects(pool.query("INSERT forbidden"), {
    code: "PERSISTENCE_CONNECTION_TIMEOUT",
  });

  assert.deepEqual(codes, ["PERSISTENCE_CONNECTION_TIMEOUT"]);
  assert.deepEqual(original.statements, []);
  await pool.end();
});

test("statement timeout and explicit cancellation retain their existing distinct codes", async () => {
  for (const scenario of [
    { message: "canceling statement due to statement timeout", code: "PERSISTENCE_QUERY_TIMEOUT" },
    { message: "canceling statement due to user request", code: "PERSISTENCE_QUERY_CANCELLED" },
  ]) {
    const original = new ControlledPool();
    original.query = async () => {
      throw Object.assign(new Error(scenario.message), { code: "57014" });
    };
    let notified = 0;
    const pool = guardPerpsLabPool(original as unknown as Pool, () => notified++);

    await assert.rejects(pool.query("SELECT cancelled"), { code: scenario.code });

    assert.equal(notified, 0);
    await pool.end();
  }
});

test("unrelated programmer errors are not relabeled as connection failures", async () => {
  const original = new ControlledPool();
  const failure = new TypeError("controlled unrelated failure");
  original.query = async () => {
    throw failure;
  };
  let notified = 0;
  const pool = guardPerpsLabPool(original as unknown as Pool, () => notified++);

  await assert.rejects(pool.query("SELECT unrelated"), (error) => error === failure);

  assert.equal(notified, 0);
  await pool.end();
});

test("a throwing diagnostic observer cannot escape an idle error event or undo the latch", async () => {
  const original = new ControlledPool();
  const pool = guardPerpsLabPool(original as unknown as Pool, () => {
    throw new Error("controlled observer failure");
  });

  assert.doesNotThrow(() => original.emit("error", new Error("private driver detail")));
  await assert.rejects(pool.connect(), lost);

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
  "real PostgreSQL socket loss in a pooled query latches without an idle error event",
  { timeout: 20000 },
  async (t) => {
    const store = await createTestStore(t);
    const peer = store.connectPeer();
    const client = await store.pool.connect();
    const pid: unknown = Reflect.get(client, "processID");
    assert.equal(typeof pid, "number");
    const connection = Reflect.get(client, "connection") as { stream: { destroy(): void } };
    client.release();
    const notices: unknown[] = [];
    const pool = guardPerpsLabPool(store.pool, (_, diagnostic) => {
      notices.push(diagnostic);
    });

    const failedQuery = assert.rejects(pool.query("SELECT pg_sleep(10)"), lost);
    let active = false;
    try {
      for (let attempt = 0; attempt < 40; attempt++) {
        const result = await peer.pool.query(
          "SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND pid=$1 AND state='active' AND query='SELECT pg_sleep(10)'",
          [pid],
        );
        if (result.rows.length === 1) {
          active = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      assert.equal(active, true);
      connection.stream.destroy();
      await failedQuery;

      assert.equal(notices.length, 1);
      assert.equal((notices[0] as { operation: string }).operation, "pool-query");
      assert.equal((notices[0] as { driverCode: unknown }).driverCode, null);
      await assert.rejects(pool.query("SELECT forbidden"), lost);
      await assert.rejects(pool.connect(), lost);
    } finally {
      connection.stream.destroy();
      await peer.pool.query("SELECT pg_terminate_backend($1)", [pid]);
      await failedQuery;
    }
  },
);

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

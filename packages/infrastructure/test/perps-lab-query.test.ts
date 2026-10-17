import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import test from "node:test";
import type { Pool } from "pg";
import { guardPerpsLabPool } from "../src/persistence/perps-lab-pool.js";
import {
  observePerpsLabPool,
  type PerpsLabQueryDiagnostic,
} from "../src/persistence/perps-lab-query.js";
import { createTestStore } from "./database.js";

class ControlledClient extends EventEmitter {
  processID = 123;
  released = false;
  failure: unknown;
  async query() {
    if (this.failure) {
      throw this.failure;
    }
    return { rows: [{ result: "private result" }] };
  }
  release() {
    this.released = true;
  }
}
class ControlledPool extends EventEmitter {
  client = new ControlledClient();
  failure: unknown;
  async connect() {
    if (this.failure) {
      throw this.failure;
    }
    return this.client;
  }
  async query() {
    return this.client.query();
  }
}
function observed(original: ControlledPool, notices: PerpsLabQueryDiagnostic[]) {
  let tick = 0;
  return observePerpsLabPool(original as unknown as Pool, (notice) => notices.push(notice), {
    now: () => 100 + tick,
    monotonic: () => ++tick,
  });
}

test("local query evidence has monotonic duration and static SQL fingerprint without text, parameters, results or credentials", async () => {
  const original = new ControlledPool();
  const notices: PerpsLabQueryDiagnostic[] = [];
  const pool = observed(original, notices);
  const text = "SELECT private_column FROM private_table WHERE id=$1";
  const client = await pool.connect();
  const result = await client.query({ text, values: ["private credential"] });
  await pool.query(text, ["another credential"]);
  client.release();

  assert.deepEqual(result.rows, [{ result: "private result" }]);
  assert.equal(original.client.released, true);
  assert.equal(notices.length, 6);
  assert.deepEqual(
    notices.map((d) => d.queryId),
    [1, 1, 2, 2, 3, 3],
  );
  assert.deepEqual(
    notices.map((d) => d.phase),
    ["started", "finished", "started", "finished", "started", "finished"],
  );
  assert.equal(notices[0]!.backendPid, null);
  assert.equal(notices[1]!.backendPid, 123);
  assert.equal(notices[2]!.backendPid, 123);
  assert.equal(notices[4]!.backendPid, null);
  assert.equal(notices[2]!.sqlHash, createHash("sha256").update(text).digest("hex"));
  assert.equal(notices[2]!.sqlHash, notices[4]!.sqlHash);
  for (const notice of notices.filter((d) => d.phase === "finished")) {
    assert.equal(notice.durationMs, 1);
    assert.equal(notice.code, null);
  }
  assert.equal(/private_|credential|private result/.test(JSON.stringify(notices)), false);
});

test("timeouts and explicit cancellation retain distinct codes and observers cannot replace failures or successful results", async () => {
  for (const [message, code] of [
    ["canceling statement due to statement timeout", "PERSISTENCE_QUERY_TIMEOUT"],
    ["canceling statement due to user request", "PERSISTENCE_QUERY_CANCELLED"],
  ]) {
    const original = new ControlledPool();
    const notices: PerpsLabQueryDiagnostic[] = [];
    const pool = guardPerpsLabPool(observed(original, notices));
    original.client.failure = Object.assign(new Error(message), { code: "57014" });

    await assert.rejects(pool.query("SELECT private"), { code });

    assert.equal(notices[1]!.code, code);
    assert.equal(notices[1]!.driverCode, "57014");
    original.client.failure = undefined;
    assert.deepEqual((await pool.query("SELECT cleanup")).rows, [{ result: "private result" }]);
  }
  const original = new ControlledPool();
  const pool = observePerpsLabPool(original as unknown as Pool, () => {
    throw new Error("observer failed");
  });
  assert.deepEqual((await pool.query("SELECT result")).rows, [{ result: "private result" }]);
  const failure = new Error("original failure");
  original.client.failure = failure;
  await assert.rejects(pool.query("SELECT failed"), (error) => error === failure);
});

test("connection observation does not undo the fatal pool latch or grant another query", async () => {
  const original = new ControlledPool();
  const notices: PerpsLabQueryDiagnostic[] = [];
  const pool = guardPerpsLabPool(observed(original, notices));
  const client = await pool.connect();
  original.client.emit("error", new Error("private disconnect"));

  await assert.rejects(client.query("UPDATE forbidden"), { code: "PERSISTENCE_CONNECTION_FAILED" });
  await assert.rejects(pool.connect(), { code: "PERSISTENCE_CONNECTION_FAILED" });
  assert.equal(notices.length, 2);
  client.release();
});

test("a controlled PostgreSQL row lock timeout identifies the real waiting backend and leaves the original record unchanged", async (t) => {
  const db = await createTestStore(t);
  await db.pool.query(
    "CREATE TABLE pickler.controlled_query_lock (id integer PRIMARY KEY, value text NOT NULL)",
  );
  await db.pool.query("INSERT INTO pickler.controlled_query_lock VALUES(1,'preserved')");
  const holder = await db.pool.connect();
  const notices: PerpsLabQueryDiagnostic[] = [];
  const pool = guardPerpsLabPool(observePerpsLabPool(db.pool, (notice) => notices.push(notice)));
  const waiting = await pool.connect();
  try {
    await holder.query("BEGIN");
    await holder.query("SELECT id FROM pickler.controlled_query_lock WHERE id=1 FOR UPDATE");
    await waiting.query("SET statement_timeout=1000");
    await waiting.query("BEGIN");
    const blocked = waiting.query(
      "SELECT id FROM pickler.controlled_query_lock WHERE id=$1 FOR UPDATE",
      [1],
    );
    const rejected = assert.rejects(blocked, { code: "PERSISTENCE_QUERY_TIMEOUT" });
    const started = notices.at(-1)!;
    assert.equal(started.phase, "started");
    assert.ok(started.backendPid);
    let blockers: number[] = [];
    const deadline = performance.now() + 750;
    while (!blockers.length && performance.now() < deadline) {
      blockers = (
        await holder.query("SELECT pg_blocking_pids($1) AS blockers", [started.backendPid])
      ).rows[0]!.blockers;
      if (!blockers.length) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    }
    assert.ok(blockers.length > 0, "the controlled query really waited on the held row");
    await rejected;
    const failure = notices.at(-1)!;
    assert.equal(failure.queryId, started.queryId);
    assert.equal(failure.backendPid, started.backendPid);
    assert.equal(failure.sqlHash, started.sqlHash);
    assert.equal(failure.driverCode, "57014");
    assert.equal(failure.code, "PERSISTENCE_QUERY_TIMEOUT");
    assert.ok(failure.durationMs! >= 900);
    await waiting.query("ROLLBACK");
    await holder.query("ROLLBACK");
    assert.deepEqual(
      (await waiting.query("SELECT value FROM pickler.controlled_query_lock")).rows,
      [{ value: "preserved" }],
    );
  } finally {
    await holder.query("ROLLBACK").catch(() => {});
    await waiting.query("ROLLBACK").catch(() => {});
    holder.release();
    waiting.release();
  }
});

test("an observer cannot mutate the identity of the completion or leak a failing driver's message", async () => {
  const original = new ControlledPool();
  const notices: PerpsLabQueryDiagnostic[] = [];
  const pool = observePerpsLabPool(original as unknown as Pool, (notice) => {
    notices.push({ ...notice });
    notice.queryId = 999;
    notice.sqlHash = "changed";
  });
  const client = await pool.connect();
  original.client.failure = Object.assign(new Error("private connection detail"), {
    code: "ECONNRESET",
  });
  await assert.rejects(
    client.query("SELECT original"),
    (error) => error === original.client.failure,
  );

  assert.deepEqual(
    notices.map((d) => d.queryId),
    [1, 1, 2, 2],
  );
  assert.equal(notices[2]!.sqlHash, notices[3]!.sqlHash);
  assert.equal(notices[3]!.driverCode, "ECONNRESET");
  assert.equal(JSON.stringify(notices).includes("private connection detail"), false);
  client.release();
});

test("exact queue and new-client deadlines retain separate safe diagnostics and initial pool state", async () => {
  for (const [message, stage] of [
    ["timeout exceeded when trying to connect", "pool-queue"],
    ["Connection terminated due to connection timeout", "new-client"],
  ] as const) {
    const original = new ControlledPool();
    Object.assign(original, { totalCount: 4, idleCount: 0, waitingCount: 1, options: { max: 4 } });
    original.failure = new Error(message);
    const notices: PerpsLabQueryDiagnostic[] = [];
    const pool = observed(original, notices);
    await assert.rejects(pool.connect(), { code: "PERSISTENCE_CONNECTION_TIMEOUT" });
    assert.equal(notices[0]!.checkoutAtStart, "queued");
    assert.equal(notices[1]!.connectionDeadlineStage, stage);
    assert.equal(notices[1]!.poolTotal, 4);
    assert.equal(JSON.stringify(notices).includes(message), false);
  }
});

test("pool counters are optional, resistant to observer mutation and never break successful queries", async () => {
  const original = new ControlledPool();
  Object.assign(original, { totalCount: 1, idleCount: 1, waitingCount: 0, options: { max: 4 } });
  const notices: PerpsLabQueryDiagnostic[] = [];
  const pool = observePerpsLabPool(original as unknown as Pool, (notice) => {
    notices.push({ ...notice });
    notice.poolTotal = 999;
    notice.checkoutAtStart = "queued";
  });
  const client = await pool.connect();
  assert.equal(notices[0]!.checkoutAtStart, "idle");
  assert.equal(notices[1]!.checkoutAtStart, "idle");
  assert.equal(notices[1]!.poolTotal, 1);
  client.release();
  Object.defineProperty(original, "totalCount", {
    get() {
      throw new Error("private getter");
    },
  });
  assert.deepEqual((await pool.query("SELECT 1")).rows, [{ result: "private result" }]);
  assert.equal(notices.at(-1)!.poolTotal, undefined);
  assert.equal(JSON.stringify(notices).includes("private getter"), false);
});

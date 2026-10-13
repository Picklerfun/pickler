import test from "node:test";
import assert from "node:assert/strict";
import { createServer, type Socket } from "node:net";
import { PilotError } from "@pickler/core";
import { createLocalPerpsLabStore, warmLocalPerpsLabStore } from "../src/perps-lab.js";
import { createTestStore } from "./database.js";

test("execution readiness keeps four verified clients across idle gaps without changing limits or financial rows", async (t) => {
  const db = await createTestStore(t);
  const connectionString = db.pool.options.connectionString!;
  const store = createLocalPerpsLabStore(connectionString, "execution");
  const pids = new Set<number>();
  store.pool.on("connect", (client) => pids.add(Number(Reflect.get(client, "processID"))));
  // Shorten only this fixture's idle wait. Production remains 30 seconds.
  store.pool.options.idleTimeoutMillis = 25;
  try {
    const before = (
      await db.pool.query("SELECT count(*)::int AS count FROM pickler.perps_paper_accounts")
    ).rows[0]!.count;
    const readiness = await warmLocalPerpsLabStore(store);
    assert.equal(readiness.readyConnections, 4);
    assert.equal(readiness.limit, 4);
    assert.equal(pids.size, 4);
    assert.equal(store.pool.totalCount, 4);
    assert.equal(store.pool.idleCount, 4);
    assert.equal(store.pool.options.connectionTimeoutMillis, 10000);
    assert.equal(store.pool.options.statement_timeout, 10000);
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(store.pool.totalCount, 4);
    const clients = await Promise.all(Array.from({ length: 4 }, () => store.pool.connect()));
    try {
      const results = await Promise.all(clients.map((client) => client.query("SELECT 1 AS ready")));
      assert.ok(results.every((result) => result.rows[0]!.ready === 1));
      assert.equal(pids.size, 4);
    } finally {
      clients.forEach((client) => client.release());
    }
    const after = (
      await db.pool.query("SELECT count(*)::int AS count FROM pickler.perps_paper_accounts")
    ).rows[0]!.count;
    assert.equal(after, before);
  } finally {
    await store.close();
  }
  assert.equal(store.pool.totalCount, 0);
});

test("readiness rejects legacy/report stores and changed capacity rather than warming arbitrary consumers", async (t) => {
  const db = await createTestStore(t);
  await assert.rejects(warmLocalPerpsLabStore(db), { code: "INVALID_INPUT" });
  const report = createLocalPerpsLabStore(db.pool.options.connectionString!, "report");
  const execution = createLocalPerpsLabStore(db.pool.options.connectionString!, "execution");
  try {
    await assert.rejects(warmLocalPerpsLabStore(report), { code: "INVALID_INPUT" });
    assert.equal(report.pool.options.max, 1);
    assert.notEqual(report.pool.options.min, 4);
    execution.pool.options.max = 3;
    await assert.rejects(warmLocalPerpsLabStore(execution), { code: "INVALID_INPUT" });
    assert.equal(execution.pool.totalCount, 0);
  } finally {
    await report.close();
    await execution.close();
  }
});

test("an aborted readiness request creates no clients and preserves its specific cancellation", async (t) => {
  const db = await createTestStore(t);
  const store = createLocalPerpsLabStore(db.pool.options.connectionString!, "execution");
  const controller = new AbortController();
  controller.abort(new PilotError("LEASE_LOST", "Controlled cancellation"));
  try {
    await assert.rejects(warmLocalPerpsLabStore(store, controller.signal), { code: "LEASE_LOST" });
    assert.equal(store.pool.totalCount, 0);
  } finally {
    await store.close();
  }
});

test("an unresponsive controlled startup remains a new-client timeout and releases partial readiness", async () => {
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on("data", () => {}); // Fixture protocol bytes are discarded, never inspected or retained.
    socket.on("error", () => {});
    socket.once("close", () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const store = createLocalPerpsLabStore(
    `postgresql://fixture:fixture_only@127.0.0.1:${address.port}/fixture`,
    "execution",
  );
  store.pool.options.connectionTimeoutMillis = 50; // Fixture only; production is unchanged.
  try {
    await assert.rejects(warmLocalPerpsLabStore(store), { code: "PERSISTENCE_CONNECTION_TIMEOUT" });
    await assert.rejects(store.pool.connect(), { code: "PERSISTENCE_CONNECTION_TIMEOUT" });
    assert.equal(store.pool.totalCount, 0);
  } finally {
    await store.close();
    sockets.forEach((socket) => socket.destroy());
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

test("partial startup success is discarded when another fixed-capacity client fails", async (t) => {
  const db = await createTestStore(t);
  const store = createLocalPerpsLabStore(db.pool.options.connectionString!, "execution");
  let connected = 0;
  // Installed pg-pool's controlled fixture hook fails only the fourth authenticated client.
  Reflect.set(store.pool.options, "onConnect", () => {
    connected++;
    if (connected === 4) {
      throw new PilotError("PERSISTENCE_CONNECTION_FAILED", "Controlled startup failure");
    }
  });
  try {
    await assert.rejects(warmLocalPerpsLabStore(store), { code: "PERSISTENCE_CONNECTION_FAILED" });
    assert.equal(connected, 4);
    assert.equal(store.pool.totalCount, 0);
    await assert.rejects(store.pool.connect(), { code: "PERSISTENCE_CONNECTION_FAILED" });
  } finally {
    await store.close();
  }
});

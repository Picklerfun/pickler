import assert from "node:assert/strict";
import test from "node:test";
import { createServer, type Socket } from "node:net";
import { Client, Pool } from "pg";
import {
  createLocalPerpsLabStore,
  warmLocalPerpsLabStore,
  type PerpsLabConnectionDiagnostic,
} from "../src/perps-lab.js";
import { observeLocalPerpsConnections } from "../src/persistence/perps-lab-connection.js";
import { createTestStore } from "./database.js";

test("local readiness records four original socket/authentication/protocol lifecycles despite a throwing observer", async (t) => {
  const db = await createTestStore(t);
  const events: PerpsLabConnectionDiagnostic[] = [];
  const ended: Promise<void>[] = [];
  const store = createLocalPerpsLabStore(db.pool.options.connectionString!, "execution", {
    connection(value) {
      events.push(value);
      throw new Error("Controlled diagnostic failure");
    },
  });
  store.pool.on("connect", (client) => {
    ended.push(new Promise<void>((resolve) => client.once("end", resolve)));
  });

  try {
    await warmLocalPerpsLabStore(store);
    assert.equal(store.pool.totalCount, 4);
    for (let id = 1; id <= 4; id++) {
      const lifecycle = events.filter((value) => value.connectionId === id);
      assert.deepEqual(
        lifecycle.map((value) => value.phase),
        ["created", "socket-connected", "authentication-observed", "protocol-ready"],
      );
      assert.equal(lifecycle[0]!.backendPid, null);
      assert.ok(lifecycle[3]!.backendPid! > 0);
      assert.ok(
        lifecycle.every((value) => value.workload === "execution" && value.driverCode === null),
      );
      assert.ok(
        lifecycle.every(
          (value, index) => value.elapsedMs >= (lifecycle[index - 1]?.elapsedMs ?? 0),
        ),
      );
    }
    assert.deepEqual(Object.keys(events[0]!).sort(), [
      "at",
      "backendPid",
      "connectionId",
      "driverCode",
      "elapsedMs",
      "phase",
      "version",
      "workload",
    ]);
  } finally {
    await store.close();
  }

  // pg-pool removal completes before the individual transport end callbacks.
  assert.equal(ended.length, 4);
  await Promise.all(ended);
  assert.equal(events.filter((value) => value.phase === "closed").length, 4);
});

test("an unresponsive synthetic startup records socket connection without manufacturing authentication or protocol readiness", async () => {
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on("data", () => {});
    socket.on("error", () => {});
    socket.once("close", () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const events: PerpsLabConnectionDiagnostic[] = [];
  const store = createLocalPerpsLabStore(
    `postgresql://fixture:fixture_only@127.0.0.1:${address.port}/fixture`,
    "execution",
    {
      connection: (value) => {
        events.push(value);
      },
    },
  );
  store.pool.options.connectionTimeoutMillis = 75; // Fixture only; production retains ten seconds.

  try {
    await assert.rejects(warmLocalPerpsLabStore(store), { code: "PERSISTENCE_CONNECTION_TIMEOUT" });
    assert.equal(events.filter((value) => value.phase === "created").length, 4);
    assert.equal(events.filter((value) => value.phase === "socket-connected").length, 4);
    assert.equal(events.filter((value) => value.phase === "authentication-observed").length, 0);
    assert.equal(events.filter((value) => value.phase === "protocol-ready").length, 0);
    assert.ok(events.every((value) => value.backendPid === null));
    await assert.rejects(store.pool.connect(), { code: "PERSISTENCE_CONNECTION_TIMEOUT" });
    assert.equal(events.filter((value) => value.phase === "created").length, 4);
  } finally {
    await store.close();
    sockets.forEach((socket) => socket.destroy());
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
  }
});

test("connection diagnostics discard unsafe codes and contain failing metadata getters without replacing driver events", async () => {
  const pool = new Pool();
  const events: PerpsLabConnectionDiagnostic[] = [];
  observeLocalPerpsConnections(pool, "report", (value) => {
    events.push(value);
  });
  const Observed = Reflect.get(pool, "Client") as typeof Client;
  const client = new Observed();
  const connection = Reflect.get(client, "connection") as {
    emit(name: string, value?: unknown): boolean;
  };
  const invalidCode = { code: "private url and secret", message: "Do not retain this" };

  assert.doesNotThrow(() => connection.emit("error", invalidCode));
  assert.equal(events.at(-1)!.driverCode, null);
  assert.doesNotThrow(() => connection.emit("error", { code: "ECONNRESET" }));
  assert.equal(events.at(-1)!.driverCode, "ECONNRESET");
  const before = events.length;
  assert.doesNotThrow(() =>
    connection.emit("error", {
      get code() {
        throw new Error("Controlled getter failure");
      },
    }),
  );
  assert.equal(events.length, before);
  assert.ok(!JSON.stringify(events).includes(invalidCode.message));
  assert.ok(!JSON.stringify(events).includes(invalidCode.code));
  client.emit("end");
  await pool.end();
});

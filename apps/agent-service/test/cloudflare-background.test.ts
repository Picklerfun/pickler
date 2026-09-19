import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_CONFIG, type RunRecord, type MarketData } from "@pickler/core";
import { createTestStore } from "@pickler/infrastructure/testing";
import { consumeWakeup, reconcile } from "../src/cloudflare/background/handlers";
import { createApi } from "../src/api/app";

const scope = { tenantId: "alpha", agentId: "pickle-alpha" };
const unavailable = async () => {
  throw new Error("No providers in lifecycle tests");
};
const markets: MarketData = {
  categories: unavailable,
  list: unavailable,
  get: unavailable,
  book: unavailable,
};

test("202 remains durable after notification failure; polling and duplicate wakeups do not repeat execution", async (t) => {
  const store = await createTestStore(t);
  await store.updateConfig(scope, 1, { ...DEFAULT_CONFIG, categoryIds: ["1"] });
  const close = t.mock.method(store, "close", async () => {});
  const log = t.mock.method(console, "error", () => {});
  try {
    let notifications = 0;
    const queue = {
      send: async () => {
        notifications++;
      },
    };
    const api = createApi({
      repository: store,
      markets,
      tokens: { alpha: "a".repeat(32), beta: "b".repeat(32) },
      checkConnections: unavailable,
      notifyQueued: unavailable,
    });
    const headers = {
      Authorization: `Bearer ${"a".repeat(32)}`,
      "Content-Type": "application/json",
      "Idempotency-Key": "same-request",
    };
    const submit = () =>
      api.request("/agents/pickle-alpha/runs", { method: "POST", headers, body: "{}" });
    const response = await submit();
    assert.equal(response.status, 202);
    const { runId } = await response.json();
    assert.equal((await store.run("alpha", runId)).status, "queued");
    assert.equal((await (await submit()).json()).runId, runId);
    assert.equal(log.mock.callCount(), 2);

    await reconcile(store, queue, () => 1234);
    assert.equal(notifications, 1);
    let calls = 0;
    const execute = async (run: RunRecord) => {
      calls++;
      assert.equal((await store.run("alpha", run.id)).status, "running");
      await store.event(run, "partial_evidence", { url: "https://example.test" }, Date.now());
      await store.finish(run, null, "PROVIDER_TEST_FAILURE", Date.now());
    };
    await consumeWakeup(store, execute, queue);
    await consumeWakeup(store, execute, queue);
    assert.equal(calls, 1);
    const poll = await api.request(`/runs/${runId}`, { headers });
    assert.equal((await poll.json()).error, "PROVIDER_TEST_FAILURE");
    assert.equal(
      (
        await api.request(`/runs/${runId}`, {
          headers: { Authorization: `Bearer ${"b".repeat(32)}` },
        })
      ).status,
      404,
    );
    assert.equal((await store.events("alpha", runId)).length, 1);
  } finally {
    close.mock.restore();
  }
});

test("ownership prevents premature recovery; interrupted runs retain evidence and are never executed again", async (t) => {
  const store = await createTestStore(t);
  await store.updateConfig(scope, 1, { ...DEFAULT_CONFIG, categoryIds: ["1"] });
  const close = t.mock.method(store, "close", async () => {});
  const queue = { send: async () => {} };
  try {
    const orphan = await store.enqueue(scope, "interrupted", null, Date.now());
    await store.claim(Date.now());
    await store.event(orphan, "partial_evidence", { preserved: true }, Date.now());
    await consumeWakeup(store, unavailable, queue);
    assert.equal((await store.run("alpha", orphan.id)).status, "running");
    await store.pool.query("UPDATE pickler.runs SET lease_expires_at = 0 WHERE status = 'running'");
    await consumeWakeup(store, unavailable, queue);
    assert.equal((await store.run("alpha", orphan.id)).error, "INTERRUPTED");
    assert.equal((await store.events("alpha", orphan.id)).length, 1);
    const pending = await store.enqueue(scope, "paused", null, Date.now());
    await store.pause(scope, true);
    await consumeWakeup(store, unavailable, queue);
    assert.equal((await store.run("alpha", pending.id)).status, "cancelled");
  } finally {
    close.mock.restore();
  }
});

test("consumer closes repository even when recovery fails", async () => {
  let closed = false;
  const repository = {
    renew: async () => {},
    recover: async () => {
      throw new Error("recovery failed");
    },
    claim: async () => null,
    tick: async () => {},
    close: async () => {
      closed = true;
    },
  };
  await assert.rejects(
    consumeWakeup(repository, unavailable, { send: async () => {} }),
    /recovery failed/,
  );
  assert.equal(closed, true);
});

test("queue fanout starts a second tenant before the first research completes", async (t) => {
  const store = await createTestStore(t);
  const peer = store.connectPeer();
  for (const tenantId of ["alpha", "beta"]) {
    const scope = { tenantId, agentId: `pickle-${tenantId}` };
    await store.updateConfig(scope, 1, { ...DEFAULT_CONFIG, categoryIds: ["1"] });
    await store.enqueue(scope, "parallel", null, Date.now());
  }
  const closeA = t.mock.method(store, "close", async () => {});
  const closeB = t.mock.method(peer, "close", async () => {});
  let wakeups = 0;
  const queue = {
    send: async () => {
      wakeups++;
    },
  };
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let started!: () => void;
  const firstStarted = new Promise<void>((resolve) => {
    started = resolve;
  });
  let active = 0;
  let maximum = 0;
  try {
    const a = consumeWakeup(
      store,
      async (run) => {
        active++;
        maximum = Math.max(maximum, active);
        started();
        await gate;
        await store.finish(run, null, "TEST_DONE", Date.now());
        active--;
      },
      queue,
    );
    await firstStarted;
    assert.equal(wakeups, 1);
    await consumeWakeup(
      peer,
      async (run) => {
        active++;
        maximum = Math.max(maximum, active);
        await peer.finish(run, null, "TEST_DONE", Date.now());
        active--;
      },
      queue,
    );
    release();
    await a;
    assert.equal(maximum, 2);
    assert.equal(wakeups, 4);
    await consumeWakeup(peer, unavailable, queue);
    assert.equal(wakeups, 4);
  } finally {
    release();
    closeA.mock.restore();
    closeB.mock.restore();
  }
});

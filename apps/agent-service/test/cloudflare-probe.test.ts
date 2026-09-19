import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_CONFIG } from "@pickler/core";
import { createTestStore } from "@pickler/infrastructure/testing";
import { createProbe } from "../src/cloudflare/probe";

const env = {
  DATABASE_URL: "postgresql://unused:unused@localhost/pickler_cf_probe_test",
  MODEL_BASE_URL: "https://model.invalid/v1",
  MODEL_ID: "unused-test-model",
  MODEL_API_KEY: "unused-test-key",
  EXA_API_KEY: "unused-test-key",
  TENANT_ALPHA_TOKEN: "a".repeat(32),
  TENANT_BETA_TOKEN: "b".repeat(32),
  PROBE_TOKEN: "p".repeat(32),
};
const scope = { tenantId: "beta", agentId: "pickle-beta" };
const interruptRequest = () =>
  new Request("https://probe.invalid/interrupt", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.PROBE_TOKEN}` },
  });

test("database probe recovers the stale-claim failure chain without executing orphaned jobs", async (t) => {
  const store = await createTestStore(t);
  await store.updateConfig(scope, 1, { ...DEFAULT_CONFIG, categoryIds: ["1"] });
  const fetch = t.mock.method(globalThis, "fetch", async () => {
    throw new Error("No provider calls are allowed during interruption recovery");
  });

  // Reproduce the old endpoint's failure: enqueue B, claim older A, then reject the mismatch.
  const orphanA = await store.enqueue(scope, "orphan-a", null, Date.now() - 2000);
  const orphanB = await store.enqueue(scope, "orphan-b", null, Date.now() - 1000);
  const wronglyClaimed = await store.claim(Date.now());
  assert.equal(wronglyClaimed?.id, orphanA.id);
  assert.notEqual(wronglyClaimed?.id, orphanB.id);
  await store.event(orphanA, "preserved_test_evidence", { partial: true }, Date.now());

  // This test owns the store lifetime; production still closes its request-scoped pool.
  const close = t.mock.method(store, "close", async () => {});
  await store.pool.query("UPDATE pickler.runs SET lease_expires_at = 0 WHERE status = 'running'");
  const probe = createProbe(() => store);
  try {
    const response = await probe.fetch(interruptRequest(), env);
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.notEqual(result.run.id, orphanA.id);
    assert.notEqual(result.run.id, orphanB.id);
    assert.equal(result.run.status, "failed");
    assert.equal(result.run.error, "DEADLINE_OR_CANCELLED");
    assert.equal((await store.run("beta", orphanA.id)).error, "INTERRUPTED");
    assert.equal((await store.run("beta", orphanB.id)).error, "PROBE_REQUEST_INTERRUPTED");
    assert.deepEqual(
      (await store.events("beta", orphanA.id)).map((event) => event.type),
      ["preserved_test_evidence"],
    );
    assert.deepEqual(await store.events("beta", orphanB.id), []);
    assert.equal(await store.claim(Date.now()), null);

    const nextResponse = await probe.fetch(interruptRequest(), env);
    assert.equal(nextResponse.status, 200);
    const next = await nextResponse.json();
    assert.notEqual(next.run.id, result.run.id);
    assert.equal(next.run.error, "DEADLINE_OR_CANCELLED");
    assert.equal(await store.claim(Date.now()), null);
    assert.equal(fetch.mock.callCount(), 0);
    assert.equal(close.mock.callCount(), 2);
  } finally {
    close.mock.restore();
  }
});

test("database probe closes its pool when recovery rejects", async (t) => {
  const store = await createTestStore(t);
  const close = t.mock.method(store, "close", async () => {});
  t.mock.method(store, "recover", async () => {
    throw new Error("recovery failed");
  });
  try {
    const response = await createProbe(() => store).fetch(interruptRequest(), env);
    assert.equal(response.status, 500);
    assert.equal(close.mock.callCount(), 1);
  } finally {
    close.mock.restore();
  }
});

import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { DEFAULT_CONFIG } from "@pickler/core";
import { PostgresResearchStore } from "@pickler/infrastructure";
import { createTestStore } from "@pickler/infrastructure/testing";
import { assertControlledDatabaseUrl } from "./fixture-isolation.js";
import { ControlledResearchStore } from "./fixture-repository.js";
import fixtureWorker from "./fixture-worker.js";
import type { Env } from "../src/index.js";

const dedicatedUrl = "postgresql://postgres:disposable@127.0.0.1:55522/postgres";

test("controlled storage rejects regular local, remote and URL override destinations", () => {
  for (const url of [
    "postgresql://postgres:local@127.0.0.1:54522/postgres",
    "postgresql://pickler:local@127.0.0.1:55432/pickler",
    "postgresql://postgres:local@example.com:55522/postgres",
    dedicatedUrl + "?host=another-database",
  ]) {
    assert.throws(() => assertControlledDatabaseUrl(url), /dedicated Supabase database/);
  }
  assert.doesNotThrow(() => assertControlledDatabaseUrl(dedicatedUrl));
});

test("every background mutation checks the marker before delegating to production", async (t) => {
  const identity = randomUUID();
  const store = new ControlledResearchStore(dedicatedUrl, identity);
  t.after(() => store.close());
  let matches = false;
  t.mock.method(store.pool, "query", async () => ({
    rows: [{ identity: matches ? identity : randomUUID() }],
  }));
  const mutations = ["claim", "recover", "tick"] as const;
  for (const method of mutations) {
    const production = t.mock.method(PostgresResearchStore.prototype, method, async () => null);
    await assert.rejects(store[method](Date.now()), /identity does not match/);
    assert.equal(production.mock.callCount(), 0);
    matches = true;
    await store[method](Date.now());
    assert.equal(production.mock.callCount(), 1);
    matches = false;
  }
});

test("refused fixture Queue and Cron leave foreign queued work and history untouched", async (t) => {
  const store = await createTestStore(t);
  const scope = { tenantId: "alpha", agentId: "pickle-alpha" };
  await store.pool.query("UPDATE pickler.agents SET config=$1 WHERE tenant_id=$2 AND id=$3", [
    { ...DEFAULT_CONFIG, categoryIds: ["1"] },
    scope.tenantId,
    scope.agentId,
  ]);
  const history = await store.enqueue(scope, "foreign-history", null, Date.now());
  const claimed = await store.claim(Date.now());
  assert.equal(claimed!.id, history.id);
  await store.event(claimed!, "foreign_evidence", { provenance: "real local history" }, Date.now());
  await store.finish(claimed!, null, "FOREIGN_HISTORY", Date.now());
  await store.enqueue(scope, "foreign-queued", null, Date.now());
  const snapshot = async () => ({
    runs: (await store.pool.query("SELECT * FROM pickler.runs ORDER BY id")).rows,
    events: (await store.pool.query("SELECT * FROM pickler.events ORDER BY id")).rows,
    agents: (await store.pool.query("SELECT * FROM pickler.agents ORDER BY tenant_id, id")).rows,
  });
  const before = await snapshot();
  const url = new URL(
    process.env.TEST_DATABASE_URL ??
      "postgresql://pickler:pickler_local_only@127.0.0.1:55432/pickler",
  );
  url.pathname = store.pool.options.database!;
  const env = { DATABASE_URL: url.toString(), ADMISSIONS_ENABLED: "true" } as Env;
  t.mock.method(console, "error", () => {});
  let retried = false;

  await fixtureWorker.queue!(
    {
      messages: [
        {
          body: { kind: "research-wakeup" },
          ack: () => assert.fail("Unsafe connection must not be acknowledged"),
          retry: () => {
            retried = true;
          },
        },
      ],
    } as never,
    env,
    {} as never,
  );
  assert.equal(retried, true);
  for (const enabled of ["true", "false"]) {
    await assert.rejects(
      fixtureWorker.scheduled!(
        {} as never,
        { ...env, ADMISSIONS_ENABLED: enabled },
        {} as never,
      ) as Promise<void>,
      /dedicated Supabase database/,
    );
  }

  assert.deepEqual(await snapshot(), before);
});

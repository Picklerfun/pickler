import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  prepareDraft,
  DEFAULT_BRIEF,
  STARTER_CAPS,
  createAdviceService,
  buildUserPrincipal,
  type AdvicePolicy,
} from "@pickler/core";
import { PostgresAdviceStore } from "../src/persistence/advice-store.js";
import { PostgresStudioDirectory } from "../src/studio/directory.js";
import { createTestStore } from "./database.js";
export const policy: AdvicePolicy = {
  version: 1,
  jevModel: "jev-1.13.0",
  deepseekModel: "deepseek-chat",
  inputRates: { jev: "0.1", deepseek: "0.1" },
  outputRates: { jev: "0", deepseek: "0.2" },
  webSearchUsd: "0.01",
  requestLimitUsd: "0.1",
  dailyLimitUsd: "1",
  pricingVerifiedAt: "2026-10-02T00:00:00Z",
  pricingSources: ["https://example.test/controlled-pricing"],
};
async function setup(t: TestContext) {
  let clock = Date.now();
  const db = await createTestStore(t);
  const advice = new PostgresAdviceStore(db.pool, () => clock);
  const peer = new PostgresAdviceStore(db.pool, () => clock);
  const owner = randomUUID(),
    id = randomUUID();
  await db.pool.query("SELECT identity.create_profile($1,'Maker','advice_owner')", [owner]);
  const studio = new PostgresStudioDirectory(db.pool);
  await studio.onboard(owner);
  await db.pool.query("UPDATE pickler.research_access SET enabled=true WHERE user_id=$1", [owner]);
  const access = (await studio.access(owner, null))!;
  const { config } = prepareDraft({
    markets: ["BTC", "ETH"],
    name: "Analyst",
    handle: "analyst",
    voice: "analyst",
    avatar: { accent: "lime", pattern: 0 },
    sources: { web: null },
    brief: DEFAULT_BRIEF,
    caps: STARTER_CAPS,
    walletId: "unused",
  });
  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "INSERT INTO agents.agents(id,workspace_id,name,handle,status,visibility,published_at) VALUES($1,$2,'Analyst','analyst','active','public',now())",
      [id, access.workspaceId],
    );
    await client.query("INSERT INTO identity.handles(handle,agent_id) VALUES('analyst',$1)", [id]);
    await client.query("COMMIT");
  } finally {
    client.release();
  }
  await db.pool.query(
    "INSERT INTO pickler.agents(tenant_id,id,version,config) VALUES($1,$2,1,$3)",
    [access.tenantId, "runtime-advice", JSON.stringify(config)],
  );
  await db.pool.query(
    "INSERT INTO pickler.product_agents(product_agent_id,workspace_id,tenant_id,runtime_agent_id,request_key,request) VALUES($1,$2,$3,'runtime-advice','advice-create','{}')",
    [id, access.workspaceId, access.tenantId],
  );
  return {
    db,
    advice,
    peer,
    id,
    owner,
    tenant: access.tenantId,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}
test("concurrent idempotent admission reserves once; conflicting content and other users cannot share an active agent", async (t) => {
  const f = await setup(t);
  const user = randomUUID();
  const jobs = await Promise.all(
    Array.from({ length: 8 }, (_, i) =>
      (i % 2 ? f.peer : f.advice).enqueue(user, f.id, "BTC", "same", policy),
    ),
  );
  assert.equal(new Set(jobs.map((j) => j.id)).size, 1);
  assert.equal(
    (await f.db.pool.query("SELECT count(*)::int AS n FROM pickler.advice_calls")).rows[0].n,
    4,
  );
  await assert.rejects(f.advice.enqueue(user, f.id, "ETH", "same", policy), { code: "CONFLICT" });
  await assert.rejects(f.peer.enqueue(randomUUID(), f.id, "BTC", "other", policy), {
    code: "ADVICE_BUSY",
  });
  const job = (await f.advice.claim())!;
  await assert.rejects(f.peer.guard(job), { code: "LEASE_LOST" });
  await assert.rejects(f.advice.guard({ ...job, tenantId: "other" }), { code: "LEASE_LOST" });
});
test("unknown started costs survive interrupted leases and block future admissions", async (t) => {
  const f = await setup(t);
  await f.advice.enqueue(randomUUID(), f.id, "BTC", "first", policy);
  const job = (await f.advice.claim())!;
  await f.advice.startCall(job, "jev", "a".repeat(64));
  await assert.rejects(f.advice.startCall(job, "jev", "a".repeat(64)), { code: "CONFLICT" });
  f.advance(60001);
  await f.peer.recover();
  assert.equal((await f.peer.get(job.id)).error, "ANALYSIS_INTERRUPTED");
  await assert.rejects(
    f.advice.usage(job, "jev", { inputTokens: 10, outputTokens: 0, costMicros: "1" }),
    { code: "LEASE_LOST" },
  );
  await assert.rejects(f.peer.enqueue(randomUUID(), f.id, "BTC", "new", policy), {
    code: "ADVICE_COST_UNKNOWN",
  });
  const row = (
    await f.db.pool.query(
      "SELECT status,cost_micros FROM pickler.advice_calls WHERE job_id=$1 AND lane='jev'",
      [job.id],
    )
  ).rows[0];
  assert.deepEqual(row, { status: "started", cost_micros: null });
  assert.equal(await f.peer.claim(), null);
});
test("completed results are shared but pending/failed status is private; history is paginated and internal fields stay private at the service boundary", async (t) => {
  const f = await setup(t);
  const caller = buildUserPrincipal({ user: { id: randomUUID() } }),
    other = buildUserPrincipal({ user: { id: randomUUID() } });
  const service = createAdviceService(f.advice, { enabled: true, policy });
  const queued = await service.request(caller, f.id, "BTC", "first");
  await assert.rejects(service.get(other, queued.id), { code: "NOT_FOUND" });
  const job = (await f.advice.claim())!;
  await f.advice.startCall(job, "jev", "b".repeat(64));
  await f.advice.usage(job, "jev", { inputTokens: 10, outputTokens: 0, costMicros: "1" });
  await f.advice.finish(job, { orientation: "wait" });
  assert.equal((await service.get(other, job.id)).status, "completed");
  assert.equal((await service.history(other, f.id)).items.length, 1);
  assert.equal((await service.history(other, f.id, "ETH")).items.length, 0);
  await assert.rejects(service.history(other, f.id, undefined, "bad cursor"), {
    code: "INVALID_INPUT",
  });
  await f.db.pool.query("UPDATE pickler.agents SET paused=true WHERE tenant_id=$1", [f.tenant]);
  assert.equal((await service.request(caller, f.id, "BTC", "first")).id, job.id);
  const disabled = createAdviceService(f.peer, { enabled: false, policy: null });
  assert.equal((await disabled.request(caller, f.id, "BTC", "first")).id, job.id);
  await assert.rejects(disabled.request(caller, f.id, "ETH", "first"), { code: "CONFLICT" });
  await assert.rejects(service.request(caller, f.id, "BTC", "fresh"), {
    code: "ADVICE_UNAVAILABLE",
  });
});
test("expiry, revocation and changed configurations cannot produce new analyses", async (t) => {
  const f = await setup(t);
  const user = randomUUID();
  const low = { ...policy, dailyLimitUsd: "0.1" };
  await f.advice.enqueue(user, f.id, "BTC", "old", low);
  f.advance(600001);
  await f.advice.recover();
  assert.equal(
    (await f.db.pool.query("SELECT error FROM pickler.advice_jobs")).rows[0].error,
    "ANALYSIS_EXPIRED",
  );
  await f.advice.enqueue(user, f.id, "BTC", "new", low);
  const job = (await f.advice.claim())!;
  await f.db.pool.query("UPDATE pickler.agents SET version=version+1 WHERE tenant_id=$1", [
    f.tenant,
  ]);
  await assert.rejects(f.advice.guard(job), { code: "CONFIG_CHANGED" });
  await f.advice.finish(job, null, "CONFIG_CHANGED");
  await f.db.pool.query("UPDATE pickler.research_access SET enabled=false WHERE user_id=$1", [
    f.owner,
  ]);
  await assert.rejects(f.advice.enqueue(user, f.id, "BTC", "revoked", low), {
    code: "ADVICE_UNAVAILABLE",
  });
});

test("daily USD costs and held reserves reject new work without touching other budgets; audited reconciliation cannot replay work", async (t) => {
  const f = await setup(t);
  const expensive = {
    ...policy,
    inputRates: { jev: "1", deepseek: "1" },
    outputRates: { jev: "0", deepseek: "1" },
    dailyLimitUsd: "0.1",
  };
  await f.advice.enqueue(randomUUID(), f.id, "BTC", "spent", expensive);
  const job = (await f.advice.claim())!;
  await f.advice.startCall(job, "deepseek", "c".repeat(64));
  await f.advice.usage(job, "deepseek", {
    inputTokens: 30000,
    outputTokens: 2000,
    costMicros: "32000",
  });
  await f.advice.finish(job, null, "MODEL_OUTPUT_INVALID");

  // Web is off: 62,000 micros per reservation; 32,000 known + 62,000 fits once.
  await f.advice.enqueue(randomUUID(), f.id, "BTC", "second", expensive);
  const next = (await f.advice.claim())!;
  await f.advice.startCall(next, "deepseek", "d".repeat(64));
  await f.advice.finish(next, null, "MODEL_HTTP_FAILURE");
  await assert.rejects(f.peer.enqueue(randomUUID(), f.id, "BTC", "blocked", expensive), {
    code: "ADVICE_COST_UNKNOWN",
  });
  await f.peer.reconcileCall(
    next.id,
    "deepseek",
    { inputTokens: 30000, outputTokens: 2000, costMicros: "32000" },
    "e".repeat(64),
  );
  await assert.rejects(f.peer.enqueue(randomUUID(), f.id, "BTC", "exhausted", expensive), {
    code: "ADVICE_BUDGET_EXCEEDED",
  });
  assert.equal((await f.peer.get(next.id)).status, "failed");
  await assert.rejects(
    f.peer.reconcileCall(
      next.id,
      "deepseek",
      { inputTokens: 30000, outputTokens: 2000, costMicros: "32000" },
      "e".repeat(64),
    ),
    { code: "CONFLICT" },
  );
  assert.equal(
    (
      await f.db.pool.query(
        "SELECT count(*)::int AS n FROM pickler.advice_events WHERE kind='cost_reconciled'",
      )
    ).rows[0].n,
    1,
  );
});

test("same runtime ID in two tenants has isolated reservations, ownership and history; one user cannot start a second active job", async (t) => {
  const f = await setup(t);
  const owner = randomUUID(),
    publicId = randomUUID();
  await f.db.pool.query("SELECT identity.create_profile($1,'Other','other_owner')", [owner]);
  const studio = new PostgresStudioDirectory(f.db.pool);
  await studio.onboard(owner);
  const access = (await studio.access(owner, null))!;
  await f.db.pool.query("UPDATE pickler.research_access SET enabled=true WHERE user_id=$1", [
    owner,
  ]);
  const config = (await f.advice.resolve(f.id)).config;
  const client = await f.db.pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "INSERT INTO agents.agents(id,workspace_id,name,handle,status,visibility,published_at) VALUES($1,$2,'Other','other_agent','active','public',now())",
      [publicId, access.workspaceId],
    );
    await client.query("INSERT INTO identity.handles(handle,agent_id) VALUES('other_agent',$1)", [
      publicId,
    ]);
    await client.query("COMMIT");
  } finally {
    client.release();
  }
  await f.db.pool.query(
    "INSERT INTO pickler.agents(tenant_id,id,version,config) VALUES($1,'runtime-advice',1,$2)",
    [access.tenantId, JSON.stringify(config)],
  );
  await f.db.pool.query(
    "INSERT INTO pickler.product_agents(product_agent_id,workspace_id,tenant_id,runtime_agent_id,request_key,request) VALUES($1,$2,$3,'runtime-advice','other-create','{}')",
    [publicId, access.workspaceId, access.tenantId],
  );
  await f.db.pool.query(
    "UPDATE pickler.execution_policy SET global_limit=2,tenant_limit=1 WHERE id=1",
  );
  const user = randomUUID();
  const first = await f.advice.enqueue(user, f.id, "BTC", "same-key", policy);
  await assert.rejects(f.peer.enqueue(user, publicId, "BTC", "same-key", policy), {
    code: "ADVICE_BUSY",
  });
  const second = await f.peer.enqueue(randomUUID(), publicId, "ETH", "same-key", policy);
  assert.notEqual(first.tenantId, second.tenantId);
  assert.equal(first.agentId, second.agentId);
  const one = (await f.advice.claim())!,
    two = (await f.peer.claim())!;
  await assert.rejects(f.advice.guard({ ...one, tenantId: two.tenantId }), { code: "LEASE_LOST" });
  await f.peer.finish(two, { orientation: "wait" });
  assert.equal((await f.peer.history(publicId)).items.length, 1);
  assert.equal((await f.peer.history(f.id)).items.length, 0);
  await f.advice.finish(one, null, "CONTROLLED_FAILURE");
  await f.db.pool.query(
    "UPDATE agents.agents SET visibility='private',published_at=NULL WHERE id=$1",
    [publicId],
  );
  await assert.rejects(f.peer.enqueue(randomUUID(), publicId, "BTC", "private", policy), {
    code: "NOT_FOUND",
  });
});

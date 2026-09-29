import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  DEFAULT_CONFIG,
  createResearchRunner,
  type Market,
  type MarketData,
  type ModelAssessment,
  type ResearchModel,
  type Source,
} from "@pickler/core";
import { PostgresPreviewStore } from "../src/persistence/preview-store.js";
import { PostgresStudioDirectory } from "../src/studio/directory.js";
import { createTestStore } from "./database.js";

const HOUR = 3_600_000;
const config = { ...DEFAULT_CONFIG, categoryIds: ["7"] };

async function setup(t: TestContext) {
  let clock = 1_000_000;
  const store = await createTestStore(t, () => clock);
  const directory = new PostgresStudioDirectory(store.pool);
  const previews = new PostgresPreviewStore(store.pool, () => clock);
  const person = async (handle: string) => {
    const userId = randomUUID();
    if ((await store.pool.query("SELECT to_regclass('auth.users') AS name")).rows[0].name) {
      await store.pool.query("INSERT INTO auth.users (id) VALUES ($1)", [userId]);
    }
    await store.pool.query("SELECT identity.create_profile($1,'Maker',$2)", [userId, handle]);
    await directory.onboard(userId);
    await store.pool.query("UPDATE pickler.research_access SET enabled=true WHERE user_id=$1", [
      userId,
    ]);
    const access = (await directory.access(userId, null))!;
    return { userId, workspaceId: access.workspaceId, tenantId: access.tenantId };
  };
  const create = (owner: Awaited<ReturnType<typeof person>>, now = clock) =>
    previews.create({ ...owner, config, fingerprint: "fp" }, now);
  return {
    store,
    previews,
    person,
    create,
    now: () => clock,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

test("the owner reads a queued run; anyone else gets NOT_FOUND", async (t) => {
  const f = await setup(t);
  const owner = await f.person("owner_one");
  const other = await f.person("other_one");
  const { id } = await f.create(owner);
  const read = await f.previews.read(owner.userId, id, f.now());
  assert.equal(read.run.status, "queued");
  assert.equal(read.run.adopted, false);
  assert.equal(read.run.expiresAt, f.now() + 24 * HOUR);
  assert.deepEqual(read.events, []);
  await assert.rejects(f.previews.read(other.userId, id, f.now()), { code: "NOT_FOUND" });
});

test("the sixth run in an hour is refused with the time the next one opens", async (t) => {
  const f = await setup(t);
  const owner = await f.person("owner_one");
  const first = f.now();
  for (let i = 0; i < 5; i++) {
    await f.create(owner, first + i * 60_000);
  }
  await assert.rejects(f.create(owner, first + 10 * 60_000), {
    code: "PREVIEW_RATE_LIMITED",
    retryAt: first + HOUR,
  });
  await f.create(owner, first + HOUR + 1);
});

test("an expired run cannot be read, and recovery deletes it", async (t) => {
  const f = await setup(t);
  const owner = await f.person("owner_one");
  const { id } = await f.create(owner);
  f.advance(24 * HOUR);
  await assert.rejects(f.previews.read(owner.userId, id, f.now()), { code: "NOT_FOUND" });
  await f.previews.recover(f.now());
  const left = await f.store.pool.query("SELECT 1 FROM pickler.preview_runs WHERE id=$1", [id]);
  assert.equal(left.rows.length, 0);
});

test("the real runner executes a preview with no agent row", async (t) => {
  const f = await setup(t);
  const owner = await f.person("owner_one");
  const { id } = await f.create(owner);
  const run = await f.previews.claim(f.now());
  assert.ok(run);
  assert.equal(run.id, id);
  assert.equal(run.agentId, id);
  assert.equal(run.status, "running");

  const market: Market = {
    id: "1",
    question: "Test?",
    rules: "Resolve by the test source.",
    categoryIds: ["7"],
    active: true,
    closesAt: new Date(f.now() + HOUR).toISOString(),
    liquidity: 10,
    outcomes: [{ id: "99", label: "Yes" }],
  };
  const source: Source = {
    id: "source",
    url: "https://example.com",
    title: "Evidence",
    content: "Content",
    provider: "test",
    publishedAt: null,
    retrievedAt: new Date(f.now()).toISOString(),
    truncated: false,
  };
  const decision: ModelAssessment = {
    action: "ABSTAIN",
    marketId: "1",
    outcomeId: null,
    thesis: "Nothing yet",
    counterEvidence: "None",
    uncertainty: "Unknown",
    sourceIds: ["source"],
    probability: null,
    uncertaintyLevel: "LOW",
    missingInformation: [],
    observedPrice: null,
    limitPrice: null,
    expiresAt: null,
    abstentionReason: "Insufficient evidence",
  };
  const markets: MarketData = {
    categories: async () => [{ id: "7", label: "Test" }],
    list: async () => [market],
    get: async () => market,
    book: async (outcomeId) => ({
      outcomeId,
      observedAt: new Date(f.now()).toISOString(),
      bids: [],
      asks: [{ price: "0.4", size: "2" }],
    }),
  };
  const model: ResearchModel = {
    metadata: () => ({ model: "test", provider: "test", prompts: {} as never }),
    select: async () => ({ marketId: "1", reason: "Only one", usage: {} }),
    research: async ({ tools }) => {
      await tools.searchWeb!("for", "supporting");
      await tools.searchWeb!("against", "contradicting");
      return { decision: structuredClone(decision), usage: {} };
    },
  };
  await createResearchRunner({
    repository: f.previews,
    markets,
    model,
    search: { search: async () => ({ sources: [source], usage: null }) },
    reader: { read: async () => source },
    now: f.now,
  })(run);

  const read = await f.previews.read(owner.userId, id, f.now());
  assert.equal(read.run.status, "completed");
  assert.equal(read.run.decision?.action, "ABSTAIN");
  assert.equal(read.events[0]?.type, "runtime");
  assert.ok(read.events.some((event) => event.type === "policy_evaluation"));
  const rows = await f.store.pool.query("SELECT 1 FROM pickler.agents WHERE id=$1", [id]);
  assert.equal(rows.rows.length, 0);
});

test("a run whose owner lost research access is cancelled at claim", async (t) => {
  const f = await setup(t);
  const owner = await f.person("owner_one");
  const { id } = await f.create(owner);
  await f.store.pool.query("UPDATE pickler.research_access SET enabled=false WHERE user_id=$1", [
    owner.userId,
  ]);
  assert.equal(await f.previews.claim(f.now()), null);
  const read = await f.previews.read(owner.userId, id, f.now());
  assert.equal(read.run.status, "cancelled");
  assert.equal(read.run.error, "RESEARCH_ACCESS_DENIED");
});

test("an expired lease is recovered as INTERRUPTED", async (t) => {
  const f = await setup(t);
  const owner = await f.person("owner_one");
  const { id } = await f.create(owner);
  const run = await f.previews.claim(f.now());
  assert.ok(run);
  f.advance(61_000);
  await f.previews.recover(f.now());
  const read = await f.previews.read(owner.userId, id, f.now());
  assert.equal(read.run.status, "failed");
  assert.equal(read.run.error, "INTERRUPTED");
  await assert.rejects(f.previews.assertOwnership(run), { code: "LEASE_LOST" });
});

test("two claims at the shared limit: only one preview starts", async (t) => {
  const f = await setup(t);
  await f.store.setConcurrency(1, 1);
  await f.create(await f.person("owner_one"));
  await f.create(await f.person("other_one"));
  const peer = new PostgresPreviewStore(f.store.pool, f.now);
  const claims = await Promise.all([f.previews.claim(f.now()), peer.claim(f.now())]);
  assert.equal(claims.filter((run) => run !== null).length, 1);
});

test("research runs and previews share the global limit both ways", async (t) => {
  const f = await setup(t);
  await f.store.setConcurrency(1, 1);
  const agent = { tenantId: "alpha", agentId: "alpha-0" };
  await f.store.pool.query("INSERT INTO pickler.agents (tenant_id,id,config) VALUES ($1,$2,$3)", [
    agent.tenantId,
    agent.agentId,
    config,
  ]);
  await f.store.enqueue(agent, "first", null, f.now());
  await f.create(await f.person("owner_one"));

  const research = await f.store.claim(f.now());
  assert.ok(research);
  assert.equal(await f.previews.claim(f.now()), null);

  await f.store.finish(research, null, "TEST_DONE", f.now());
  const preview = await f.previews.claim(f.now());
  assert.ok(preview);
  await f.store.enqueue(agent, "second", null, f.now());
  assert.equal(await f.store.claim(f.now()), null);
});

test("a tenant at its limit waits; the overdue claim takes only old previews", async (t) => {
  const f = await setup(t);
  await f.store.setConcurrency(5, 1);
  const owner = await f.person("owner_one");
  await f.create(owner);
  await f.create(owner);
  assert.equal(await f.previews.claim(f.now(), f.now() - 120_000), null);
  f.advance(120_001);
  assert.ok(await f.previews.claim(f.now(), f.now() - 120_000));
  assert.equal(await f.previews.claim(f.now()), null);
});

test("two creations racing for the fifth slot: only one is queued", async (t) => {
  const f = await setup(t);
  const owner = await f.person("owner_one");
  for (let i = 0; i < 4; i++) {
    await f.create(owner);
  }
  const results = await Promise.allSettled([f.create(owner), f.create(owner)]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  const rejected = results.find((result) => result.status === "rejected");
  assert.equal((rejected as PromiseRejectedResult).reason.code, "PREVIEW_RATE_LIMITED");
  const rows = await f.store.pool.query("SELECT 1 FROM pickler.preview_runs WHERE user_id = $1", [
    owner.userId,
  ]);
  assert.equal(rows.rows.length, 5);
});

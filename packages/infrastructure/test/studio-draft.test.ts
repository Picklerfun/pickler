import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { MAX_DRAFTS_PER_WORKSPACE, PilotError, preparePreview, type Decision } from "@pickler/core";
import { PostgresPreviewStore } from "../src/persistence/preview-store.js";
import { PostgresStudioDirectory } from "../src/studio/directory.js";
import { createTestStore } from "./database.js";

const input = {
  brief: {
    thesis: "Injury news moves the books first.",
    reads: ["espn.com"],
    entersWhen: ["A starter is ruled out"],
    exitsWhen: [],
    never: [],
  },
  spend: { perCallAusd: 5, perDayAusd: 20 },
  maxLeverage: 2,
};
const decision = { action: "ABSTAIN", marketId: "1" } as unknown as Decision;

async function setup(t: TestContext) {
  const clock = 1_000_000;
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
    return { userId, access: (await directory.access(userId, null))! };
  };
  const { config, fingerprint } = preparePreview(input);
  /** A preview that ran to completion, with two trace events. */
  const completed = async (owner: Awaited<ReturnType<typeof person>>, status = "completed") => {
    const { id } = await previews.create(
      {
        userId: owner.userId,
        workspaceId: owner.access.workspaceId,
        tenantId: owner.access.tenantId,
        config,
        fingerprint,
      },
      clock,
    );
    await store.pool.query(
      `UPDATE pickler.preview_runs SET status=$2, started_at=$3, finished_at=$4, decision=$5::jsonb
      WHERE id=$1`,
      [id, status, clock + 1, clock + 2, JSON.stringify(decision)],
    );
    await store.pool.query(
      `INSERT INTO pickler.preview_events (preview_run_id, type, data, created_at)
      VALUES ($1,'runtime','{}'::jsonb,$2), ($1,'policy_evaluation','{"finalAction":"ABSTAIN"}'::jsonb,$3)`,
      [id, clock + 1, clock + 2],
    );
    return id;
  };
  return { store, directory, previews, person, completed, fingerprint, config, clock };
}

const agentCount = async (f: Awaited<ReturnType<typeof setup>>, handle: string) =>
  (await f.store.pool.query("SELECT 1 FROM agents.agents WHERE handle=$1", [handle])).rows.length;

test("create adopts the run: a private draft with no wallet, the run as its first run", async (t) => {
  const f = await setup(t);
  const owner = await f.person("owner_one");
  const id = await f.completed(owner);
  const created = await f.directory.createDraft(
    owner.access,
    owner.userId,
    { name: "Halftime", handle: "halftime", previewRunId: id, fingerprint: f.fingerprint },
    f.clock,
  );

  const agent = await f.store.pool.query("SELECT status, name FROM agents.agents WHERE id=$1", [
    created.productId,
  ]);
  assert.deepEqual(agent.rows[0], { status: "draft", name: "Halftime" });
  const wallets = await f.store.pool.query(
    "SELECT 1 FROM wallets.agent_wallets WHERE agent_id=$1",
    [created.productId],
  );
  assert.equal(wallets.rows.length, 0);
  const runtime = await f.store.agent(created.scope);
  assert.deepEqual(runtime.config, f.config);
  const run = await f.store.run(created.scope.tenantId, id);
  assert.equal(run.status, "completed");
  assert.equal(run.trigger, "manual");
  assert.equal(run.configVersion, 1);
  assert.deepEqual(run.decision, decision);
  const events = await f.store.events(created.scope.tenantId, id);
  assert.deepEqual(
    events.map((event) => event.type),
    ["runtime", "policy_evaluation"],
  );
  assert.equal((await f.store.readiness(created.scope)).manualSucceeded, true);
  const preview = await f.store.pool.query(
    "SELECT adopted_at::double precision AS at, adopted_agent_id AS agent FROM pickler.preview_runs WHERE id=$1",
    [id],
  );
  assert.deepEqual(preview.rows[0], { at: f.clock, agent: created.scope.agentId });
  // The trace now lives with the run; the preview keeps its row for a retried create.
  const trace = await f.store.pool.query(
    "SELECT 1 FROM pickler.preview_events WHERE preview_run_id=$1",
    [id],
  );
  assert.equal(trace.rows.length, 0);
  const listed = await f.directory.list(owner.access);
  assert.deepEqual(
    listed.map((item) => [item.handle, item.draft]),
    [["halftime", true]],
  );
});

test("a different brief is RUN_STALE and writes nothing", async (t) => {
  const f = await setup(t);
  const owner = await f.person("owner_one");
  const id = await f.completed(owner);
  await assert.rejects(
    f.directory.createDraft(
      owner.access,
      owner.userId,
      { name: "Halftime", handle: "halftime", previewRunId: id, fingerprint: "other" },
      f.clock,
    ),
    { code: "RUN_STALE" },
  );
  assert.equal(await agentCount(f, "halftime"), 0);
});

test("a taken handle is HANDLE_TAKEN and writes nothing", async (t) => {
  const f = await setup(t);
  const owner = await f.person("owner_one");
  await f.person("halftime");
  const id = await f.completed(owner);
  await assert.rejects(
    f.directory.createDraft(
      owner.access,
      owner.userId,
      { name: "Halftime", handle: "halftime", previewRunId: id, fingerprint: f.fingerprint },
      f.clock,
    ),
    { code: "HANDLE_TAKEN" },
  );
  const preview = await f.store.pool.query(
    "SELECT adopted_at FROM pickler.preview_runs WHERE id=$1",
    [id],
  );
  assert.equal(preview.rows[0].adopted_at, null);
});

test("expired, adopted, unfinished or someone else's is PREVIEW_UNUSABLE", async (t) => {
  const f = await setup(t);
  const owner = await f.person("owner_one");
  const other = await f.person("other_one");
  const draft = (id: string, handle: string, now = f.clock, who = owner) =>
    f.directory.createDraft(
      who.access,
      who.userId,
      { name: "Agent", handle, previewRunId: id, fingerprint: f.fingerprint },
      now,
    );

  const expired = await f.completed(owner);
  await assert.rejects(draft(expired, "agent_one", f.clock + 86_400_000), {
    code: "PREVIEW_UNUSABLE",
  });

  const adopted = await f.completed(owner);
  await draft(adopted, "agent_two");
  await assert.rejects(draft(adopted, "agent_three"), { code: "PREVIEW_UNUSABLE" });

  const failed = await f.completed(owner, "failed");
  await assert.rejects(draft(failed, "agent_four"), { code: "PREVIEW_UNUSABLE" });

  const theirs = await f.completed(owner);
  await assert.rejects(draft(theirs, "agent_five", f.clock, other), {
    code: "PREVIEW_UNUSABLE",
  });

  await assert.rejects(draft(randomUUID(), "agent_six"), { code: "PREVIEW_UNUSABLE" });
});

test("a failure mid-way leaves no agent, and the run is not adopted", async (t) => {
  const f = await setup(t);
  const owner = await f.person("owner_one");
  const id = await f.completed(owner);
  // Copying the trace is the last write before adoption; make it fail.
  await f.store.pool.query(`CREATE FUNCTION pickler.refuse_events() RETURNS trigger
    LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'refused for the test'; END $$`);
  await f.store.pool.query(`CREATE TRIGGER refuse_events BEFORE INSERT ON pickler.events
    FOR EACH ROW EXECUTE FUNCTION pickler.refuse_events()`);

  await assert.rejects(
    f.directory.createDraft(
      owner.access,
      owner.userId,
      { name: "Halftime", handle: "halftime", previewRunId: id, fingerprint: f.fingerprint },
      f.clock,
    ),
  );
  assert.equal(await agentCount(f, "halftime"), 0);
  const runtime = await f.store.pool.query("SELECT 1 FROM pickler.runs WHERE id=$1", [id]);
  assert.equal(runtime.rows.length, 0);
  const handles = await f.store.pool.query(
    "SELECT 1 FROM identity.handles WHERE handle='halftime'",
  );
  assert.equal(handles.rows.length, 0);
  const preview = await f.store.pool.query(
    "SELECT adopted_at FROM pickler.preview_runs WHERE id=$1",
    [id],
  );
  assert.equal(preview.rows[0].adopted_at, null);
});

test("two concurrent drafts serialize on the create lock: the draft limit admits only one", async (t) => {
  const f = await setup(t);
  const owner = await f.person("owner_one");
  // The route's lock over this directory: drafts are refused at their limit.
  const admit = async () => {
    const drafts = (await f.directory.list(owner.access)).filter((agent) => agent.draft);
    if (drafts.length >= MAX_DRAFTS_PER_WORKSPACE) {
      throw new PilotError("DRAFT_LIMIT", "At most 3 drafts at a time");
    }
  };
  const draft = async (handle: string) =>
    f.directory.createDraft(
      owner.access,
      owner.userId,
      {
        name: "Agent",
        handle,
        previewRunId: await f.completed(owner),
        fingerprint: f.fingerprint,
      },
      f.clock,
      admit,
    );
  await draft("agent_one");
  await draft("agent_two");

  const results = await Promise.allSettled([draft("agent_three"), draft("agent_four")]);

  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  const refused = results.find((result) => result.status === "rejected");
  assert.equal((refused as PromiseRejectedResult).reason.code, "DRAFT_LIMIT");
  assert.equal((await f.directory.list(owner.access)).length, MAX_DRAFTS_PER_WORKSPACE);
});

test("while a create holds the workspace lock, a paper run for that workspace still starts", async (t) => {
  const f = await setup(t);
  const owner = await f.person("owner_one");
  const id = await f.completed(owner);
  let entered!: () => void;
  const inside = new Promise<void>((resolve) => (entered = resolve));
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  // The route's lock reads balances over the network; this one waits until the test lets it go.
  const creating = f.directory.createDraft(
    owner.access,
    owner.userId,
    { name: "Halftime", handle: "halftime", previewRunId: id, fingerprint: f.fingerprint },
    f.clock,
    async () => {
      entered();
      await held;
    },
  );
  await inside;

  const insert = f.previews.create(
    {
      userId: owner.userId,
      workspaceId: owner.access.workspaceId,
      tenantId: owner.access.tenantId,
      config: f.config,
      fingerprint: f.fingerprint,
    },
    f.clock,
  );
  const outcome = await Promise.race([
    insert.then(() => "inserted"),
    new Promise((resolve) => setTimeout(() => resolve("blocked"), 2_000)),
  ]);
  release();
  await creating;
  await insert;

  assert.equal(outcome, "inserted");
});

test("a retried create whose first attempt committed answers the same draft, past the lock", async (t) => {
  const f = await setup(t);
  const owner = await f.person("owner_one");
  const id = await f.completed(owner);
  const terms = {
    name: "Halftime",
    handle: "halftime",
    previewRunId: id,
    fingerprint: f.fingerprint,
  };
  const created = await f.directory.createDraft(owner.access, owner.userId, terms, f.clock);
  // The draft now exists, so the route's lock could refuse a new one; a replay never meets it.
  const admit = async () => {
    throw new PilotError("DRAFT_LIMIT", "At most 3 drafts at a time");
  };

  // Past the preview's 24 hours: a replay reads what was created, not whether it could be again.
  const replayed = await f.directory.createDraft(
    owner.access,
    owner.userId,
    terms,
    f.clock + 86_400_000,
    admit,
  );

  assert.deepEqual(replayed, created);
  assert.equal(await agentCount(f, "halftime"), 1);
});

test("a retry with a different handle or brief is not a replay and is refused", async (t) => {
  const f = await setup(t);
  const owner = await f.person("owner_one");
  const id = await f.completed(owner);
  const terms = {
    name: "Halftime",
    handle: "halftime",
    previewRunId: id,
    fingerprint: f.fingerprint,
  };
  await f.directory.createDraft(owner.access, owner.userId, terms, f.clock);

  await assert.rejects(
    f.directory.createDraft(owner.access, owner.userId, { ...terms, handle: "fulltime" }, f.clock),
    { code: "PREVIEW_UNUSABLE" },
  );
  await assert.rejects(
    f.directory.createDraft(
      owner.access,
      owner.userId,
      { ...terms, fingerprint: "other" },
      f.clock,
    ),
    { code: "PREVIEW_UNUSABLE" },
  );
  assert.equal(await agentCount(f, "fulltime"), 0);
  assert.equal((await f.directory.list(owner.access)).length, 1);
});

test("someone else's adopted preview is PREVIEW_UNUSABLE, even with the same terms", async (t) => {
  const f = await setup(t);
  const owner = await f.person("owner_one");
  const other = await f.person("other_one");
  const id = await f.completed(owner);
  const terms = {
    name: "Halftime",
    handle: "halftime",
    previewRunId: id,
    fingerprint: f.fingerprint,
  };
  await f.directory.createDraft(owner.access, owner.userId, terms, f.clock);

  await assert.rejects(f.directory.createDraft(other.access, other.userId, terms, f.clock), {
    code: "PREVIEW_UNUSABLE",
  });
  assert.equal((await f.directory.list(other.access)).length, 0);
});

test("the run is checked before the lock: a stale brief is RUN_STALE even when the lock is closed", async (t) => {
  const f = await setup(t);
  const owner = await f.person("owner_one");
  const id = await f.completed(owner);
  const admit = async () => {
    throw new PilotError("UNFUNDED_AGENT", "Fund your other agent first");
  };

  await assert.rejects(
    f.directory.createDraft(
      owner.access,
      owner.userId,
      { name: "Halftime", handle: "halftime", previewRunId: id, fingerprint: "other" },
      f.clock,
      admit,
    ),
    { code: "RUN_STALE" },
  );
});

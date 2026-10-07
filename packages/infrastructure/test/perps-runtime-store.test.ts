import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  DEFAULT_BRIEF,
  STARTER_CAPS,
  prepareDraft,
  type AgentConfig,
  type PerpMarketInfo,
  type PerpSymbol,
} from "@pickler/core";
import {
  CHECK_OUTCOMES,
  CLOSE_REASONS,
  PERPS_CHECK_TRIGGERS,
  PRODUCT_PAPER_SESSION,
  PROPOSAL_TTL_MS,
  createPerpsPaperService,
  paperDecimal,
  paperUnits,
  perpsCheckMinute,
  simulatePerpsFill,
  type PerpsPaperFrame,
  type PerpsPaperScope,
} from "@pickler/trading/perps";
import { PostgresPerpsRuntimeStore } from "../src/persistence/perps-runtime-store.js";
import { PostgresPerpsPaperStore } from "../src/persistence/perps-paper-store.js";
import { PostgresStudioDirectory } from "../src/studio/directory.js";
import { PERPS_CLOSE_REASON_VALUES } from "../src/persistence/schema.js";
import {
  PERPS_CHECK_OUTCOME_VALUES,
  PERPS_CHECK_TRIGGER_VALUES,
} from "../src/persistence/product/perps-checks.js";
import { createTestStore } from "./database.js";

const HOUR = 3_600_000;
/** 2026-10-03T12:00:00Z, the top of an hour. */
const NOON = Date.UTC(2026, 9, 3, 12);

/** A product agent id whose hourly check runs at `minute`. */
const idAt = (minute: number) => `${minute.toString(16).padStart(8, "0")}-${randomUUID().slice(9)}`;

test("complete current Studio preparation records connections without the research-only probe", async (t) => {
  const f = await setup(t);
  const agent = await f.agent({ id: idAt(0) });
  const key = `connections_checked:${agent.scope.tenantId}:${agent.scope.agentId}:1`;
  for (const decision of [
    { protocol: "perps-check-v1" },
    { protocol: "studio-perps-check-v2", incomplete: true },
    { protocol: "studio-perps-check-v2", incomplete: false },
  ]) {
    const check = await f.store.startCheck({ productAgentId: agent.id, trigger: "manual" });
    const claim = (await f.store.claimAgent(check.id))!;
    await f.store.finishCheck(claim.lease, { outcome: "held", outcomeText: "Prepared", decision });
    const checked = await f.db.pool.query("SELECT value FROM pickler.metadata WHERE key=$1", [key]);
    assert.equal(checked.rows[0]?.value === "true", decision.incomplete === false);
  }
  const history = await f.db.pool.query(
    "SELECT count(*)::int AS n FROM pickler.perps_checks WHERE product_agent_id=$1",
    [agent.id],
  );
  assert.equal(history.rows[0].n, 3);
  assert.equal((await f.db.readiness(agent.scope)).connectionsChecked, true);
  await f.db.pool.query(
    `UPDATE pickler.research_access SET enabled=true WHERE user_id IN (
    SELECT owner_user_id FROM identity.workspaces WHERE id IN (
      SELECT workspace_id FROM pickler.product_agents WHERE product_agent_id=$1))`,
    [agent.id],
  );
  await f.db.schedule(agent.scope, true, NOON);
  assert.equal((await f.db.agent(agent.scope)).scheduleEnabled, true);
  await f.db.schedule(agent.scope, false, NOON);
  await f.db.pool.query("DELETE FROM pickler.metadata WHERE key=$1", [key]);
  const failed = await f.store.startCheck({ productAgentId: agent.id, trigger: "manual" });
  const failedClaim = (await f.store.claimAgent(failed.id))!;
  await f.store.finishCheck(failedClaim.lease, {
    outcome: "failed",
    outcomeText: "Transport failed",
    decision: { protocol: "studio-perps-check-v2", incomplete: false },
  });
  assert.equal((await f.db.readiness(agent.scope)).connectionsChecked, false);
  await f.db.pool.query("UPDATE pickler.agents SET version=2 WHERE tenant_id=$1 AND id=$2", [
    agent.scope.tenantId,
    agent.scope.agentId,
  ]);
  assert.deepEqual(await f.db.readiness(agent.scope), {
    connectionsChecked: false,
    manualSucceeded: false,
  });
});

test("hourly admission requires current preparation; manual preparation remains available", async (t) => {
  const f = await setup(t);
  const agent = await f.agent({ id: idAt(0) });
  assert.equal((await f.store.dueAgents()).length, 0);
  await assert.rejects(f.store.startCheck({ productAgentId: agent.id, trigger: "hourly" }), {
    code: "NOT_READY",
  });
  const manual = await f.store.startCheck({ productAgentId: agent.id, trigger: "manual" });
  const claim = (await f.store.claimAgent(manual.id))!;
  await f.store.finishCheck(claim.lease, { outcome: "held", outcomeText: "Prepared" });
  await f.prepareHourly(agent);
  assert.equal((await f.store.dueAgents()).length, 1);

  for (const change of [
    "config_version=0",
    "decision='{}'",
    'decision=\'{"protocol":"studio-perps-check-v2","incomplete":true}\'',
    "outcome='failed'",
  ]) {
    await f.db.pool.query(`UPDATE pickler.perps_checks SET ${change} WHERE id=$1`, [manual.id]);
    assert.equal((await f.store.dueAgents()).length, 0, change);
    await assert.rejects(f.store.startCheck({ productAgentId: agent.id, trigger: "hourly" }), {
      code: "NOT_READY",
    });
    await f.db.pool.query(
      "UPDATE pickler.perps_checks SET config_version=1,decision=$2,outcome='held' WHERE id=$1",
      [manual.id, { protocol: "studio-perps-check-v2", incomplete: false }],
    );
  }
  await f.db.pool.query("DELETE FROM pickler.metadata WHERE key=$1", [
    `connections_checked:${agent.scope.tenantId}:${agent.scope.agentId}:1`,
  ]);
  assert.equal((await f.store.dueAgents()).length, 0);
  assert.equal((await f.db.readiness(agent.scope)).connectionsChecked, false);
});

test("schedule revocation after dispatch finishes a queued hourly check without a lease", async (t) => {
  const f = await setup(t);
  const agent = await f.agent({ id: idAt(0) });
  await f.prepareHourly(agent);
  assert.equal((await f.store.dueAgents()).length, 1);
  const queued = await f.store.startCheck({
    productAgentId: agent.id,
    trigger: "hourly",
    requestKey: "hourly:controlled",
  });
  await f.disableHourly(agent.scope);
  assert.equal(await f.store.claimAgent(queued.id), null);
  const finished = (await f.store.getCheck(queued.id))!;
  assert.equal(finished.status, "finished");
  assert.equal(finished.outcome, "skipped");
  assert.equal(finished.error, "NOT_READY");
  const lease = await f.db.pool.query(
    "SELECT lease_owner,lease_expires_at FROM pickler.perps_checks WHERE id=$1",
    [queued.id],
  );
  assert.equal(lease.rows[0].lease_owner, null);
  assert.equal(lease.rows[0].lease_expires_at, null);
  const replay = await f.store.startCheck({
    productAgentId: agent.id,
    trigger: "hourly",
    requestKey: "hourly:controlled",
  });
  assert.equal(replay.id, queued.id);
  assert.ok(await f.store.claimSupervision(agent.id));
});

test("a concurrent schedule disable wins before an hourly claim can acquire ownership", async (t) => {
  const f = await setup(t);
  const agent = await f.agent();
  await f.prepareHourly(agent);
  const queued = await f.store.startCheck({ productAgentId: agent.id, trigger: "hourly" });
  const writer = await f.db.pool.connect();
  await writer.query("BEGIN");
  const pid = (await writer.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
  let claiming: Promise<Awaited<ReturnType<typeof f.peer.claimAgent>>> | undefined;
  try {
    await writer.query(
      "UPDATE pickler.agents SET schedule_enabled=false WHERE tenant_id=$1 AND id=$2",
      [agent.scope.tenantId, agent.scope.agentId],
    );
    claiming = f.peer.claimAgent(queued.id);
    let blocked = false;
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const waiting = await f.db.pool.query(
        "SELECT 1 FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))",
        [pid],
      );
      if (waiting.rowCount) {
        blocked = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.ok(blocked, "Claim must wait for the schedule writer's row lock");
    await writer.query("COMMIT");
  } finally {
    await writer.query("ROLLBACK");
    writer.release();
    if (claiming) {
      await claiming;
    }
  }
  assert.equal(await claiming, null);
  assert.equal((await f.store.getCheck(queued.id))!.outcome, "skipped");
});

test("disabling hourly decisions blocks later calls while started usage settles", async (t) => {
  const { PostgresPerpsCheckCostStore } =
    await import("../src/persistence/perps-check-cost-store.js");
  const f = await setup(t);
  const agent = await f.agent();
  await f.prepareHourly(agent);
  const queued = await f.store.startCheck({ productAgentId: agent.id, trigger: "hourly" });
  const claim = (await f.store.claimAgent(queued.id))!;
  const costs = new PostgresPerpsCheckCostStore(f.db.pool, f.now);
  const scope = { ...agent.scope, checkId: queued.id, configVersion: 1, lease: claim.lease };
  const plan = {
    provider: "controlled",
    model: "controlled",
    promptVersion: "2.0.0",
    promptSha256: "a".repeat(64),
    maxInputTokens: 1000,
    maxOutputTokens: 100,
    inputMicrosPerMillion: "1000000",
    outputMicrosPerMillion: "0",
  };
  await costs.reserve(
    scope,
    { id: "combined", version: "2.0.0" },
    {
      version: 1,
      enabled: true,
      reviewedAt: new Date(f.now()).toISOString(),
      perOperationMicros: "2000",
      perDayMicros: "4000",
    },
    [
      { ...plan, key: "direct" },
      { ...plan, key: "review" },
    ],
  );
  await costs.start(scope, "direct", { sha256: "b".repeat(64), bytes: 100 });
  await f.disableHourly(agent.scope);
  await assert.rejects(costs.start(scope, "review", { sha256: "c".repeat(64), bytes: 100 }), {
    code: "NOT_READY",
  });
  await costs.complete(scope, "direct", { input: 10, output: 0 });
  assert.deepEqual(await costs.finish(scope), { costMicros: "10", accountedMicros: "10" });
});

test("hourly financial admission blocks exposure after disable but permits closes", async (t) => {
  const f = await setup(t);
  const agent = await f.agent();
  await f.prepareHourly(agent);
  const queued = await f.store.startCheck({ productAgentId: agent.id, trigger: "hourly" });
  const claim = (await f.store.claimAgent(queued.id))!;
  const bound = new PostgresPerpsPaperStore(f.db.pool, f.now, undefined, () => ({
    scope: agent.scope,
    configVersion: 1,
    lease: claim.lease,
    requireReservation: false,
  }));
  await bound.initialize(agent.scope, 1, "100");
  const intent = {
    kind: "open" as const,
    symbol: "ETH" as const,
    side: "long" as const,
    notional: "1",
    feeReserve: "0.1",
    leverage: 1,
  };
  const pending = await bound.begin(agent.scope, 1, "pending-before-disable", intent);
  assert.ok(pending.lease);
  const before = await bound.snapshot(agent.scope);
  const fill = simulatePerpsFill(before.account, intent, frame("ETH", f.now(), "3000"), f.now());
  await f.disableHourly(agent.scope);
  await assert.rejects(bound.complete(agent.scope, pending.lease!, fill), { code: "NOT_READY" });
  await bound.fail(agent.scope, pending.lease!, "NOT_READY");
  await assert.rejects(
    open({ ...f, paper: bound }, agent.scope, "blocked-open", "ETH", {
      notional: "1",
      leverage: 1,
    }),
    {
      code: "NOT_READY",
    },
  );
  await f.prepareHourly(agent);
  const opened = await open({ ...f, paper: bound }, agent.scope, "controlled-open", "BTC", {
    notional: "1",
    leverage: 1,
    price: "1000",
    stop: "970",
    target: "1060",
  });
  const position = opened.account.positions[0]!;
  assert.ok(position);
  await f.disableHourly(agent.scope);
  const closed = await bound.closePosition(
    agent.scope,
    position.id,
    "owner",
    frame("BTC", f.now(), "1000"),
  );
  assert.ok(closed.view.account.positions.find((p) => p.id === position.id)!.closedAt);
});

async function setup(t: TestContext) {
  let clock = NOON;
  const db = await createTestStore(t);
  const store = new PostgresPerpsRuntimeStore(db.pool, () => clock);
  const peer = new PostgresPerpsRuntimeStore(db.pool, () => clock);
  const paper = new PostgresPerpsPaperStore(db.pool, () => clock);
  const owner = randomUUID();
  await db.pool.query("SELECT identity.create_profile($1,'Maker','perps_owner')", [owner]);
  const studio = new PostgresStudioDirectory(db.pool);
  await studio.onboard(owner);
  const access = (await studio.access(owner, null))!;
  const { config } = prepareDraft({
    markets: ["BTC", "ETH"],
    name: "Trader",
    handle: "trader",
    voice: "analyst",
    avatar: { accent: "lime", pattern: 0 },
    sources: { web: null },
    brief: DEFAULT_BRIEF,
    caps: STARTER_CAPS,
    walletId: "unused",
  });
  let count = 0;
  async function agent(
    options: {
      id?: string;
      visibility?: "public" | "private";
      paused?: boolean;
      perpl?: boolean;
    } = {},
  ) {
    count += 1;
    const id = options.id ?? idAt(count);
    const runtimeId = `runtime-${count}`;
    const handle = `trader${count}`;
    const visibility = options.visibility ?? "public";
    const agentConfig: AgentConfig =
      options.perpl === false ? { ...config, perpl: undefined } : config;
    // The agent and its handle reference each other (deferred): one transaction.
    const client = await db.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO agents.agents(id,workspace_id,name,handle,status,visibility,published_at)
         VALUES($1,$2,'Trader',$3,'active',$4::agents.agent_visibility,
           CASE WHEN $4 = 'public' THEN now() END)`,
        [id, access.workspaceId, handle, visibility],
      );
      await client.query("INSERT INTO identity.handles(handle,agent_id) VALUES($1,$2)", [
        handle,
        id,
      ]);
      await client.query("COMMIT");
    } finally {
      client.release();
    }
    await db.pool.query(
      "INSERT INTO pickler.agents(tenant_id,id,version,config,paused) VALUES($1,$2,1,$3,$4)",
      [access.tenantId, runtimeId, JSON.stringify(agentConfig), options.paused ?? false],
    );
    await db.pool.query(
      `INSERT INTO pickler.product_agents(product_agent_id,workspace_id,tenant_id,runtime_agent_id,request_key,request)
       VALUES($1,$2,$3,$4,$5,'{}')`,
      [id, access.workspaceId, access.tenantId, runtimeId, `create-${count}`],
    );
    const scope: PerpsPaperScope = {
      tenantId: access.tenantId,
      agentId: runtimeId,
      sessionId: PRODUCT_PAPER_SESSION,
      network: "testnet",
    };
    return { id, scope };
  }
  return {
    db,
    store,
    peer,
    paper,
    agent,
    async disableHourly(scope: PerpsPaperScope) {
      await db.pool.query(
        "UPDATE pickler.agents SET schedule_enabled=false WHERE tenant_id=$1 AND id=$2",
        [scope.tenantId, scope.agentId],
      );
    },
    async prepareHourly(agent: { id: string; scope: PerpsPaperScope }) {
      const current = await db.agent(agent.scope);
      const decision = { protocol: "studio-perps-check-v2", incomplete: false };
      const existing = await db.pool.query(
        "SELECT id FROM pickler.perps_checks WHERE tenant_id=$1 AND agent_id=$2 AND trigger='manual' AND status='finished' LIMIT 1",
        [agent.scope.tenantId, agent.scope.agentId],
      );
      if (existing.rowCount) {
        await db.pool.query(
          "UPDATE pickler.perps_checks SET decision=$2,config_version=$3 WHERE id=$1",
          [existing.rows[0].id, decision, current.version],
        );
      } else {
        await store.recordCheck({
          productAgentId: agent.id,
          trigger: "manual",
          configVersion: current.version,
          outcome: "held",
          outcomeText: "Preparation completed",
          decision,
        });
      }
      await db.pool.query(
        "INSERT INTO pickler.metadata(key,value) VALUES($1,'true') ON CONFLICT(key) DO UPDATE SET value='true'",
        [`connections_checked:${agent.scope.tenantId}:${agent.scope.agentId}:${current.version}`],
      );
      await db.pool.query(
        "UPDATE pickler.agents SET schedule_enabled=true WHERE tenant_id=$1 AND id=$2",
        [agent.scope.tenantId, agent.scope.agentId],
      );
    },
    config,
    now: () => clock,
    set: (at: number) => {
      clock = at;
    },
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

function frame(symbol: PerpSymbol, at: number, price: string): PerpsPaperFrame {
  const provenance = {
    provider: "perpl" as const,
    pluginVersion: "1.1.0" as const,
    network: "testnet" as const,
    chainId: 10143,
    url: "https://perpl.test/data",
    receivedAt: at,
    providerTimestamp: at,
    block: Math.floor(at / 1000),
  };
  const market: PerpMarketInfo = {
    symbol,
    marketId: symbol === "BTC" ? 1 : 2,
    perpetualId: 1,
    instanceId: 1,
    exchangeAddress: "0xexchange",
    collateral: { tokenId: 1, address: "0xcollateral", symbol: "AUSD", decimals: 6 },
    configVersion: 1,
    priceDecimals: 2,
    sizeDecimals: 4,
    open: true,
    fundingIntervalSeconds: 3600,
    fundingIntervalBlocks: 100,
    initialMarginRaw: 100,
    maintenanceMarginRaw: 50,
    fees: { basis: "public-base-tier", maker: "0", taker: "0.0002" },
    provenance,
  };
  return {
    snapshot: {
      market,
      ticker: {
        mark: price,
        index: price,
        last: price,
        bid: price,
        ask: price,
        openInterestBase: "20",
        freshness: "fresh",
        provenance,
      },
      funding: null,
    },
    book: {
      market,
      requestedLevels: 20,
      depthLimited: true,
      bids: [{ price, size: "100", orders: 1 }],
      asks: [{ price, size: "100", orders: 1 }],
      freshness: "fresh",
      provenance,
    },
    hash: "a".repeat(64),
  };
}

/** Opens a product position through the shared service, as the runtime will. */
async function open(
  f: Awaited<ReturnType<typeof setup>>,
  scope: PerpsPaperScope,
  key: string,
  symbol: PerpSymbol,
  options: {
    price?: string;
    notional?: string;
    leverage?: number;
    checkId?: string;
    exitDueAt?: number;
    stop?: string;
    target?: string;
  } = {},
) {
  const price = options.price ?? "60000";
  const service = createPerpsPaperService(
    f.paper,
    {
      observation: async () => ({ frames: [], funding: [] }),
      frame: async () => frame(symbol, f.now(), price),
    },
    f.now,
  );
  return service.trade(
    scope,
    key,
    "open",
    symbol,
    "long",
    AbortSignal.timeout(5000),
    frame(symbol, f.now(), price),
    {
      notional: options.notional ?? "500",
      leverage: options.leverage ?? 5,
      checkId: options.checkId,
      exits: () => ({
        stopPrice: options.stop ?? "58000",
        takeProfitPrice: options.target ?? "64000",
        exitDueAt: options.exitDueAt ?? f.now() + 4 * HOUR,
      }),
    },
  );
}

test("the schema's spelled-out lists match trading's", () => {
  assert.deepEqual([...PERPS_CLOSE_REASON_VALUES], [...CLOSE_REASONS]);
  assert.deepEqual([...PERPS_CHECK_OUTCOME_VALUES], [...CHECK_OUTCOMES]);
  assert.deepEqual([...PERPS_CHECK_TRIGGER_VALUES], [...PERPS_CHECK_TRIGGERS]);
});

test("a check is queued, claimed once, records its steps in order and finishes", async (t) => {
  const f = await setup(t);
  const { id } = await f.agent();

  const check = await f.store.startCheck({ productAgentId: id, trigger: "manual" });
  const claims = await Promise.all([f.store.claimAgent(check.id), f.peer.claimAgent(check.id)]);
  const claimed = claims.find((c) => c !== null)!;

  assert.equal(check.status, "queued");
  assert.equal(claims.filter((c) => c !== null).length, 1);
  assert.equal(claimed.check.status, "running");

  await f.store.appendStep(claimed.lease, { text: "Read the brief · 3 entries", ms: null });
  f.advance(1400);
  await f.store.appendStep(claimed.lease, { text: "Read Perpl BTC, ETH", ms: 1400 });
  await assert.rejects(f.store.startCheck({ productAgentId: id, trigger: "manual" }), {
    code: "CHECK_RUNNING",
  });
  const done = await f.store.finishCheck(claimed.lease, {
    outcome: "held",
    outcomeText: "ENTRY 1 HELD",
    decision: { instrument: "BTC", action: "hold" },
    inputs: { instruments: ["BTC", "ETH"], web: false },
    configVersion: 1,
    costMicros: "1234",
  });

  assert.equal(done.status, "finished");
  assert.equal(done.outcome, "held");
  assert.equal(done.costMicros, "1234");
  assert.deepEqual(
    done.steps.map((s) => [s.text, s.ms, s.at]),
    [
      ["Read the brief · 3 entries", null, NOON],
      ["Read Perpl BTC, ETH", 1400, NOON + 1400],
    ],
  );
  assert.deepEqual((await f.store.getCheck(check.id))!.inputs, {
    instruments: ["BTC", "ETH"],
    web: false,
  });
  await assert.rejects(f.store.appendStep(claimed.lease, { text: "late" }), { code: "LEASE_LOST" });
  assert.equal(await f.store.claimAgent(check.id), null);
});

test("manual checks replay by request key and refuse agents without Perpl", async (t) => {
  const f = await setup(t);
  const { id } = await f.agent();
  const { id: plain } = await f.agent({ perpl: false });

  const first = await f.store.startCheck({
    productAgentId: id,
    trigger: "manual",
    requestKey: "k1",
  });
  const again = await f.peer.startCheck({
    productAgentId: id,
    trigger: "manual",
    requestKey: "k1",
  });

  assert.equal(again.id, first.id);
  await assert.rejects(f.store.startCheck({ productAgentId: plain, trigger: "manual" }), {
    code: "NOT_A_PERPL_AGENT",
  });
  await assert.rejects(f.store.startCheck({ productAgentId: randomUUID(), trigger: "manual" }), {
    code: "NOT_FOUND",
  });
});

test("an expired lease frees the agent; the old owner can no longer write", async (t) => {
  const f = await setup(t);
  const agent = await f.agent();
  await f.prepareHourly(agent);
  const { id } = agent;
  const check = await f.store.startCheck({ productAgentId: id, trigger: "hourly" });
  const { lease } = (await f.store.claimAgent(check.id))!;

  f.advance(30_000);
  const renewed = await f.store.renewAgent(lease);
  f.advance(59_000);
  await f.store.appendStep(renewed, { text: "still mine" });
  f.advance(2000);

  await assert.rejects(f.store.appendStep(renewed, { text: "too late" }), { code: "LEASE_LOST" });
  const next = await f.peer.startCheck({ productAgentId: id, trigger: "manual" });
  const interrupted = (await f.store.getCheck(check.id))!;

  assert.equal(next.status, "queued");
  assert.equal(interrupted.outcome, "failed");
  assert.equal(interrupted.error, "CHECK_INTERRUPTED");
  const claimed = (await f.peer.claimAgent(next.id))!;
  const released = await f.peer.releaseAgent(claimed.lease, "MODEL_INVALID");
  assert.equal(released.outcome, "failed");
  assert.equal(released.error, "MODEL_INVALID");
});

test("a queued check nobody claims expires", async (t) => {
  const f = await setup(t);
  const { id } = await f.agent();
  const check = await f.store.startCheck({ productAgentId: id, trigger: "manual" });

  f.advance(600_000);

  assert.equal(await f.store.claimAgent(check.id), null);
  assert.equal((await f.store.getCheck(check.id))!.error, "CHECK_EXPIRED");
});

test("the feed lists newest first in pages of 50 and filters by outcome", async (t) => {
  const f = await setup(t);
  const { id } = await f.agent();
  for (let i = 0; i < 55; i += 1) {
    f.advance(1000);
    await f.store.recordCheck({
      productAgentId: id,
      trigger: "exits",
      outcome: i % 5 === 0 ? "exited" : "held",
      outcomeText: `row ${i}`,
      steps: [{ text: `step ${i}` }],
    });
  }

  const first = await f.store.listChecks(id);
  const second = await f.store.listChecks(id, { before: first.nextCursor });
  const exits = await f.store.listChecks(id, { outcomes: ["exited"] });

  assert.equal(first.items.length, 50);
  assert.equal(first.items[0]!.outcomeText, "row 54");
  assert.equal(second.items.length, 5);
  assert.equal(second.nextCursor, null);
  assert.equal(second.items.at(-1)!.outcomeText, "row 0");
  assert.equal(exits.items.length, 11);
  assert.equal(first.items[0]!.steps[0]!.text, "step 54");
  await assert.rejects(f.store.listChecks(id, { before: "nonsense" }), { code: "INVALID_INPUT" });
});

test("the due list is staggered by id and skips private, paused, non-Perpl and busy agents", async (t) => {
  const f = await setup(t);
  const at5 = await f.agent({ id: idAt(5) });
  const at20 = await f.agent({ id: idAt(20) });
  await f.agent({ id: idAt(6), visibility: "private" });
  await f.agent({ id: idAt(7), paused: true });
  await f.agent({ id: idAt(8), perpl: false });
  const busy = await f.agent({ id: idAt(9) });
  await f.prepareHourly(at5);
  await f.prepareHourly(at20);
  await f.prepareHourly(busy);
  assert.equal(perpsCheckMinute(at5.id), 5);

  f.set(NOON + 4 * 60_000);
  assert.deepEqual(await f.store.dueAgents(), []);

  await f.store.startCheck({ productAgentId: busy.id, trigger: "manual" });
  f.set(NOON + 12 * 60_000);
  const due = await f.store.dueAgents();
  assert.deepEqual(
    due.map((d) => d.productAgentId),
    [at5.id],
  );
  assert.equal(due[0]!.agentId, at5.scope.agentId);

  const check = await f.store.startCheck({ productAgentId: at5.id, trigger: "hourly" });
  const { lease } = (await f.store.claimAgent(check.id))!;
  await f.store.finishCheck(lease, { outcome: "held", outcomeText: "HOLD" });
  assert.deepEqual(await f.store.dueAgents(), []);

  f.set(NOON + 16 * 60_000);
  assert.deepEqual(
    (await f.store.dueAgents()).map((d) => d.productAgentId),
    [busy.id],
    "the busy agent's unclaimed check expired; 5 already ran this hour",
  );
  f.set(NOON + 21 * 60_000);
  assert.deepEqual(
    (await f.store.dueAgents()).map((d) => d.productAgentId),
    [at20.id],
  );
  f.set(NOON + HOUR + 6 * 60_000);
  assert.ok((await f.store.dueAgents()).some((d) => d.productAgentId === at5.id));
});

test("proposals go pending → approved, skipped or expired, and are decided once", async (t) => {
  const f = await setup(t);
  const { id } = await f.agent();
  const check = await f.store.startCheck({ productAgentId: id, trigger: "manual" });
  const { lease } = (await f.store.claimAgent(check.id))!;
  const input = {
    instrument: "BTC" as const,
    side: "long" as const,
    margin: "12.5",
    leverage: 3,
    kind: "enter" as const,
  };

  const a = await f.store.createProposal(lease, input);
  const b = await f.store.createProposal(lease, { ...input, instrument: "ETH" });
  const c = await f.store.createProposal(lease, { ...input, kind: "size_up", positionId: "p1" });
  await f.store.finishCheck(lease, { outcome: "proposed", outcomeText: "PROPOSED" });

  assert.equal(a.status, "pending");
  assert.equal(a.expiresAt, NOON + PROPOSAL_TTL_MS);
  assert.equal(a.margin, "12.5");
  assert.equal(c.positionId, "p1");
  assert.equal((await f.store.listProposals(id)).length, 3);
  await assert.rejects(f.store.createProposal(lease, input), { code: "LEASE_LOST" });

  const approved = await Promise.allSettled([
    f.store.decideProposal(a.id, "approved"),
    f.peer.decideProposal(a.id, "skipped"),
  ]);
  assert.equal(approved.filter((r) => r.status === "fulfilled").length, 1);
  await assert.rejects(f.store.decideProposal(a.id, "approved"), { code: "PROPOSAL_DECIDED" });
  assert.equal((await f.store.decideProposal(b.id, "skipped")).status, "skipped");

  f.advance(PROPOSAL_TTL_MS);
  await assert.rejects(f.store.decideProposal(c.id, "approved"), { code: "PROPOSAL_EXPIRED" });
  assert.equal((await f.store.getProposal(c.id))!.status, "expired");
  assert.deepEqual(await f.store.listProposals(id), []);
});

test("expireProposals expires exactly the pending ones past their time, once", async (t) => {
  const f = await setup(t);
  const { id } = await f.agent();
  const check = await f.store.startCheck({ productAgentId: id, trigger: "manual" });
  const { lease } = (await f.store.claimAgent(check.id))!;
  const input = {
    instrument: "BTC" as const,
    side: "long" as const,
    margin: "10",
    leverage: 2,
    kind: "enter" as const,
  };
  const old = await f.store.createProposal(lease, input);
  f.advance(30_000);
  const young = await f.store.createProposal(lease, input);

  f.set(NOON + PROPOSAL_TTL_MS);
  const expired = await Promise.all([f.store.expireProposals(), f.peer.expireProposals()]);

  assert.deepEqual(
    expired.flat().map((p) => p.id),
    [old.id],
  );
  assert.equal((await f.store.getProposal(young.id))!.status, "pending");
});

test("counts and cost of today, per agent and global", async (t) => {
  const f = await setup(t);
  const one = await f.agent();
  const two = await f.agent();
  async function run(productAgentId: string, trigger: "hourly" | "manual", cost: string | null) {
    const check = await f.store.startCheck({ productAgentId, trigger });
    const { lease } = (await f.store.claimAgent(check.id))!;
    await f.store.finishCheck(lease, { outcome: "held", outcomeText: "HOLD", costMicros: cost });
  }
  f.set(NOON - 13 * HOUR);
  await run(one.id, "manual", "999");
  await f.prepareHourly(one);
  f.set(NOON);
  await run(one.id, "manual", "100");
  await run(one.id, "hourly", "50");
  await run(one.id, "hourly", null);
  await run(two.id, "manual", "7");
  await f.store.recordCheck({
    productAgentId: one.id,
    trigger: "exits",
    outcome: "exited",
    outcomeText: "STOP",
  });

  assert.equal(await f.store.checksToday(one.id), 3);
  assert.equal(await f.store.manualChecksToday(one.id), 1);
  assert.equal(await f.store.globalChecksToday(), 4);
  assert.equal(await f.store.costToday(one.id), "150");
  assert.equal(await f.store.costToday(two.id), "7");
});

test("pauseAgent pauses and writes a system row together", async (t) => {
  const f = await setup(t);
  const { id, scope } = await f.agent();

  const row = await f.store.pauseAgent(id, "Paused itself · day-loss stop");
  // Racing closers (two exits runs, an exit and a check) pause it once, with one row.
  const again = await Promise.all([
    f.store.pauseAgent(id, "Paused itself · day-loss stop"),
    f.store.pauseAgent(id, "Paused itself · day-loss stop"),
  ]);

  assert.equal(row!.outcome, "system");
  assert.equal(row!.trigger, "system");
  assert.deepEqual(again, [null, null]);
  const paused = await f.db.pool.query("SELECT paused FROM pickler.agents WHERE id=$1", [
    scope.agentId,
  ]);
  assert.equal(paused.rows[0].paused, true);
  const rows = (await f.store.listChecks(id)).items.filter((c) => c.trigger === "system");
  assert.equal(rows.length, 1);
});

test("a product account follows the agent across config versions; each position keeps its own", async (t) => {
  const f = await setup(t);
  const { scope } = await f.agent();
  const checkId = randomUUID();

  await assert.rejects(f.paper.initialize(scope, 1, "9.99"), { code: "WALLET_UNFUNDED" });
  await assert.rejects(f.paper.initialize({ ...scope, sessionId: "operator" }, 1, "250"), {
    code: "INVALID_INPUT",
  });
  const initial = await f.paper.initialize(scope, 1, "250");
  assert.equal(initial.account.cash, "250");
  assert.equal(initial.movements[0]!.delta, "250");

  await open(f, scope, "c1-open-btc", "BTC", { checkId });
  await f.db.pool.query(
    "UPDATE pickler.agents SET version=2, config=$3 WHERE tenant_id=$1 AND id=$2",
    [scope.tenantId, scope.agentId, JSON.stringify({ ...f.config, intervalHours: 3 })],
  );
  const again = await f.paper.initialize(scope, 2, "999");
  assert.deepEqual(
    again.movements.filter((m) => m.kind === "initial").map((m) => m.delta),
    ["250"],
    "the stake is set once",
  );
  const view = await open(f, scope, "c2-open-eth", "ETH");

  const btc = view.account.positions.find((p) => p.symbol === "BTC")!;
  const eth = view.account.positions.find((p) => p.symbol === "ETH")!;
  assert.equal(btc.configVersion, 1);
  assert.equal(eth.configVersion, 2);
  assert.equal(btc.leverage, 5);
  assert.equal(btc.checkId, checkId);
  assert.equal(btc.stopPrice, "58000");
  assert.equal(btc.margin, "98.4");
  const rows = await f.db.pool.query(
    `SELECT id, check_id::text, config_version, leverage, margin::text, stop_price::text,
       take_profit_price::text, exit_due_at::double precision AS due
     FROM pickler.perps_paper_positions ORDER BY id`,
  );
  assert.deepEqual(rows.rows[0], {
    id: "c1-open-btc",
    check_id: checkId,
    config_version: 1,
    leverage: 5,
    margin: "98.400000000000000000",
    stop_price: "58000.000000000000000000",
    take_profit_price: "64000.000000000000000000",
    due: NOON + 4 * HOUR,
  });
  assert.equal(rows.rows[1].config_version, 2);
});

test("closePosition closes once with its reason; the exits read finds stop, target and time", async (t) => {
  const f = await setup(t);
  const { id, scope } = await f.agent();
  await f.paper.initialize(scope, 1, "1000");
  await open(f, scope, "open-btc", "BTC", { exitDueAt: NOON + HOUR });
  await open(f, scope, "open-eth", "ETH", {
    price: "3000",
    notional: "300",
    stop: "2900",
    target: "3200",
    exitDueAt: NOON + 4 * HOUR,
  });

  const none = await f.paper.openDuePositions([
    { network: "testnet", symbol: "BTC", mark: "60000" },
    { network: "testnet", symbol: "ETH", mark: "3000" },
  ]);
  assert.deepEqual(none, []);

  const stop = await f.paper.openDuePositions([
    { network: "testnet", symbol: "BTC", mark: "57999" },
  ]);
  assert.deepEqual(
    stop.map((d) => [d.position.id, d.reason, d.productAgentId, d.scope.sessionId]),
    [["open-btc", "stop", id, PRODUCT_PAPER_SESSION]],
  );
  const target = await f.paper.openDuePositions([
    { network: "mainnet", symbol: "BTC", mark: "57999" },
    { network: "testnet", symbol: "BTC", mark: "64000" },
  ]);
  assert.deepEqual(
    target.map((d) => d.reason),
    ["take_profit"],
  );
  f.set(NOON + HOUR);
  const time = await f.paper.openDuePositions([]);
  assert.deepEqual(
    time.map((d) => [d.position.id, d.reason]),
    [["open-btc", "time"]],
  );

  const closes = await Promise.all([
    f.paper.closePosition(scope, "open-btc", "time", frame("BTC", f.now(), "61000")),
    new PostgresPerpsPaperStore(f.db.pool, f.now).closePosition(
      scope,
      "open-btc",
      "owner",
      frame("BTC", f.now(), "61000"),
    ),
  ]);

  assert.equal(closes.filter((c) => c.closed).length, 1);
  const closed = closes.find((c) => c.closed)!;
  assert.equal(closed.position.closedAt, NOON + HOUR);
  const reason = closed.position.closeReason;
  assert.ok(reason === "time" || reason === "owner");
  const row = await f.db.pool.query(
    "SELECT close_reason, closed_at::double precision AS closed FROM pickler.perps_paper_positions WHERE id='open-btc'",
  );
  assert.deepEqual(row.rows[0], { close_reason: reason, closed: NOON + HOUR });
  const view = await f.paper.view(scope);
  assert.equal(view.movements.filter((m) => m.kind === "realized-pnl").length, 1);
  assert.deepEqual(await f.paper.openDuePositions([]), []);
  await assert.rejects(
    f.paper.closePosition(scope, "missing", "owner", frame("BTC", f.now(), "1")),
    {
      code: "NOT_FOUND",
    },
  );
});

test("stop-all closes every open position and pauses the agent", async (t) => {
  const f = await setup(t);
  const { id, scope } = await f.agent();
  await f.paper.initialize(scope, 1, "1000");
  await open(f, scope, "open-btc", "BTC");
  await open(f, scope, "open-eth", "ETH", {
    price: "3000",
    notional: "300",
    stop: "2900",
    target: "3200",
  });

  for (const p of (await f.paper.view(scope)).account.positions.filter(
    (p) => p.closedAt === null,
  )) {
    const price = p.symbol === "BTC" ? "60000" : "3000";
    await f.paper.closePosition(scope, p.id, "stop_all", frame(p.symbol, f.now(), price));
  }
  await f.store.pauseAgent(id, "Stopped · closed all");

  const view = await f.paper.view(scope);
  assert.ok(
    view.account.positions.every((p) => p.closedAt !== null && p.closeReason === "stop_all"),
  );
  await assert.rejects(open(f, scope, "after-stop", "BTC"), { code: "PAUSED" });
});

test("newMarginSince sums margin of positions opened since, and their size-ups", async (t) => {
  const f = await setup(t);
  const { scope } = await f.agent();
  await f.paper.initialize(scope, 1, "1000");
  f.set(NOON - 13 * HOUR);
  await open(f, scope, "yesterday", "BTC", { notional: "100", leverage: 2 });
  await f.paper.closePosition(scope, "yesterday", "owner", frame("BTC", f.now(), "60000"));
  f.set(NOON);
  const view = await open(f, scope, "today", "BTC", { notional: "500", leverage: 5 });
  const today = view.account.positions.find((p) => p.id === "today")!;

  assert.equal(await f.paper.newMarginSince(scope, NOON - 12 * HOUR), today.margin);
  assert.equal(await f.paper.newMarginSince(scope, NOON + 1), "0");
});

test("a size-up adds margin at the position's leverage once, and counts as new margin", async (t) => {
  const f = await setup(t);
  const { scope } = await f.agent();
  await f.paper.initialize(scope, 1, "200");
  const opened = await open(f, scope, "small", "BTC", { notional: "50", leverage: 5 });
  const before = opened.account.positions.find((p) => p.id === "small")!;
  f.advance(60_000);

  const added = await f.paper.sizeUp(
    scope,
    "small",
    { key: "sizeup:one", margin: "40" },
    frame("BTC", f.now(), "61000"),
  );
  const repeat = await f.paper.sizeUp(
    scope,
    "small",
    { key: "sizeup:one", margin: "40" },
    frame("BTC", f.now(), "61000"),
  );

  assert.equal(added.added, true);
  assert.equal(repeat.added, false);
  const after = added.position;
  assert.equal(after.leverage, 5);
  assert.ok(Number(after.quantity) > Number(before.quantity));
  assert.equal(
    Number(after.entryNotional),
    Number(before.entryNotional) + 5 * Number(after.sizeUps![0]!.margin),
  );
  assert.ok(Number(after.entryPrice) > 60000 && Number(after.entryPrice) < 61000);
  assert.equal(Number(after.margin), Number(before.margin) + Number(after.sizeUps![0]!.margin));
  assert.equal(after.sizeUps!.length, 1);
  assert.equal(after.stopPrice, before.stopPrice);
  assert.equal(
    await f.paper.newMarginSince(scope, NOON),
    String(Number(before.margin) + Number(after.sizeUps![0]!.margin)),
  );
  const view = await f.paper.view(scope);
  assert.equal(view.movements.filter((m) => m.kind === "fee").length, 2);
  assert.deepEqual(await f.paper.openNetworks(), ["testnet"]);

  await assert.rejects(
    f.paper.sizeUp(
      scope,
      "small",
      { key: "sizeup:big", margin: "500" },
      frame("BTC", f.now(), "61000"),
    ),
    { code: "INSUFFICIENT_AVAILABLE" },
  );
  await f.paper.closePosition(scope, "small", "owner", frame("BTC", f.now(), "61000"));
  await assert.rejects(
    f.paper.sizeUp(
      scope,
      "small",
      { key: "sizeup:two", margin: "10" },
      frame("BTC", f.now(), "61000"),
    ),
    { code: "POSITION_CLOSED" },
  );
  assert.deepEqual(await f.paper.openNetworks(), []);
});

test("closes ignore the agent's current plugins, policy, network and markets", async (t) => {
  const f = await setup(t);
  const { scope } = await f.agent();
  await f.paper.initialize(scope, 1, "1000");
  await open(f, scope, "open-btc", "BTC");
  await open(f, scope, "open-eth", "ETH", {
    price: "3000",
    notional: "300",
    stop: "2900",
    target: "3200",
  });
  // The owner moves it to mainnet, drops both markets and turns the plugins off.
  const edited = {
    ...f.config,
    perpl: { ...f.config.perpl!, network: "mainnet", markets: [] },
    plugins: { version: 1, enabled: [] },
  };
  await f.db.pool.query(
    "UPDATE pickler.agents SET version=2, config=$3 WHERE tenant_id=$1 AND id=$2",
    [scope.tenantId, scope.agentId, JSON.stringify(edited)],
  );

  const closed = await f.paper.closePosition(
    scope,
    "open-btc",
    "owner",
    frame("BTC", f.now(), "60000"),
  );
  assert.equal(closed.closed, true);

  // The service's leased close path admits it too; opens are still refused.
  const service = createPerpsPaperService(
    f.paper,
    {
      observation: async () => ({ frames: [], funding: [] }),
      frame: async () => frame("ETH", f.now(), "3000"),
    },
    f.now,
  );
  const view = await service.trade(
    scope,
    "close-eth",
    "close",
    "ETH",
    "long",
    AbortSignal.timeout(5000),
    frame("ETH", f.now(), "3000"),
  );
  assert.ok(view.account.positions.every((p) => p.closedAt !== null));
  await assert.rejects(open(f, scope, "reopen", "BTC"), { code: "PLUGIN_DISABLED" });

  await assert.rejects(
    f.paper.closePosition({ ...scope, sessionId: "operator" }, "x", "owner", frame("BTC", 1, "1")),
    { code: "INVALID_INPUT" },
  );
});

test("a mark beyond the liquidation estimate is a stop, even without a stop price", async (t) => {
  const f = await setup(t);
  const { scope } = await f.agent();
  await f.paper.initialize(scope, 1, "1000");
  const service = createPerpsPaperService(
    f.paper,
    {
      observation: async () => ({ frames: [], funding: [] }),
      frame: async () => frame("BTC", f.now(), "60000"),
    },
    f.now,
  );
  const view = await service.trade(
    scope,
    "open-btc",
    "open",
    "BTC",
    "long",
    AbortSignal.timeout(5000),
    frame("BTC", f.now(), "60000"),
    {
      notional: "1000",
      leverage: 10,
      exits: () => ({ stopPrice: null, takeProfitPrice: null, exitDueAt: null }),
    },
  );
  const entry = Number(view.account.positions[0]!.entryPrice);
  const liquidation = entry - entry / 10;

  assert.deepEqual(
    await f.paper.openDuePositions([
      { network: "testnet", symbol: "BTC", mark: (liquidation + 1).toFixed(2) },
    ]),
    [],
  );
  const due = await f.paper.openDuePositions([
    { network: "testnet", symbol: "BTC", mark: (liquidation - 1).toFixed(2) },
  ]);
  assert.deepEqual(
    due.map((d) => d.reason),
    ["stop"],
  );
});

test("a large product open reserves a fee that scales with its notional", async (t) => {
  const f = await setup(t);
  const { scope } = await f.agent();
  await f.paper.initialize(scope, 1, "5000");

  const view = await open(f, scope, "big", "BTC", { notional: "40000", leverage: 10 });
  const attempt = view.attempts.find((a) => a.key === "big")!;

  assert.equal(attempt.status, "filled");
  assert.equal(attempt.intent.feeReserve, "12");
  assert.ok(view.account.positions.some((p) => p.id === "big" && p.closedAt === null));

  const sized = await f.paper.sizeUp(
    scope,
    "big",
    { key: "sizeup:big", margin: "500" },
    frame("BTC", f.now(), "60000"),
  );
  assert.equal(sized.added, true);
  const record = sized.view.attempts.find((a) => a.key === "sizeup:big")!;
  assert.equal(record.intent.feeReserve, "1.5");
});

test("intents above 10x or with a non-UUID check id are refused", async (t) => {
  const f = await setup(t);
  const { id, scope } = await f.agent();
  await f.paper.initialize(scope, 1, "1000");

  await assert.rejects(open(f, scope, "lev", "BTC", { leverage: 11 }), { code: "INVALID_INPUT" });
  await assert.rejects(open(f, scope, "chk", "BTC", { checkId: "check-1" }), {
    code: "INVALID_INPUT",
  });
  const check = await f.store.startCheck({ productAgentId: id, trigger: "manual" });
  const { lease } = (await f.store.claimAgent(check.id))!;
  await assert.rejects(
    async () =>
      f.store.createProposal(lease, {
        instrument: "BTC",
        side: "long",
        margin: "10",
        leverage: 11,
        kind: "enter",
      }),
    { code: "INVALID_INPUT" },
  );
});

test("recoverChecks ends stuck checks across agents, including paused ones", async (t) => {
  const f = await setup(t);
  const one = await f.agent();
  const two = await f.agent();
  const running = await f.store.startCheck({ productAgentId: one.id, trigger: "manual" });
  await f.store.claimAgent(running.id);
  const queued = await f.store.startCheck({ productAgentId: two.id, trigger: "manual" });
  await f.db.pool.query("UPDATE pickler.agents SET paused = true WHERE id = $1", [
    one.scope.agentId,
  ]);

  assert.equal(await f.store.recoverChecks(), 0);
  f.advance(61_000);
  assert.equal(await f.store.recoverChecks(), 1);
  assert.equal((await f.store.getCheck(running.id))!.error, "CHECK_INTERRUPTED");
  assert.equal((await f.store.getCheck(queued.id))!.status, "queued");
  f.advance(600_000);
  assert.equal(await f.peer.recoverChecks(), 1);
  assert.equal((await f.store.getCheck(queued.id))!.error, "CHECK_EXPIRED");
  assert.equal(await f.store.recoverChecks(), 0);
});

test("the due list carries the slot, skips killed agents, and one key makes one check per slot", async (t) => {
  const f = await setup(t);
  const at5 = await f.agent({ id: idAt(5) });
  const killed = await f.agent({ id: idAt(6) });
  await f.prepareHourly(at5);
  await f.prepareHourly(killed);
  await f.db.pool.query(
    "UPDATE agents.agents SET status = 'killed', killed_at = now() WHERE id = $1",
    [killed.id],
  );

  f.set(NOON + 7 * 60_000);
  const due = await f.store.dueAgents();
  assert.deepEqual(
    due.map((d) => [d.productAgentId, d.slot]),
    [[at5.id, NOON + 5 * 60_000]],
  );

  const key = `hourly:${due[0]!.slot}`;
  const [a, b] = await Promise.all([
    f.store.startCheck({ productAgentId: at5.id, trigger: "hourly", requestKey: key }),
    f.peer.startCheck({ productAgentId: at5.id, trigger: "hourly", requestKey: key }),
  ]);
  assert.equal(a.id, b.id);
  const { lease } = (await f.store.claimAgent(a.id))!;
  await f.store.finishCheck(lease, { outcome: "held", outcomeText: "HOLD" });
  const replay = await f.store.startCheck({
    productAgentId: at5.id,
    trigger: "hourly",
    requestKey: key,
  });
  assert.equal(replay.id, a.id);
  assert.equal(replay.status, "finished");
  const hourly = await f.db.pool.query(
    "SELECT count(*)::int AS n FROM pickler.perps_checks WHERE product_agent_id = $1 AND trigger='hourly'",
    [at5.id],
  );
  assert.equal(hourly.rows[0].n, 1);
});

test("an approval is approving until settled: approved only once the open succeeded", async (t) => {
  const f = await setup(t);
  const { id } = await f.agent();
  const check = await f.store.startCheck({ productAgentId: id, trigger: "manual" });
  const { lease } = (await f.store.claimAgent(check.id))!;
  const input = {
    instrument: "BTC" as const,
    side: "long" as const,
    margin: "10",
    leverage: 10,
    kind: "enter" as const,
  };
  const a = await f.store.createProposal(lease, input);
  const b = await f.store.createProposal(lease, input);
  const c = await f.store.createProposal(lease, input);

  const approving = await f.store.decideProposal(a.id, "approved");
  assert.equal(approving.status, "approving");
  await assert.rejects(f.store.decideProposal(a.id, "approved"), { code: "PROPOSAL_DECIDED" });
  assert.equal((await f.store.settleProposal(a.id, true)).status, "approved");
  await assert.rejects(f.store.settleProposal(a.id, true), { code: "PROPOSAL_DECIDED" });

  await f.store.decideProposal(b.id, "approved");
  const back = await f.store.settleProposal(b.id, false);
  assert.equal(back.status, "pending");
  assert.equal(back.decidedAt, null);
  await assert.rejects(f.store.settleProposal(c.id, true), { code: "PROPOSAL_DECIDED" });

  // An approval abandoned mid-flight expires five minutes after the proposal would have.
  await f.store.decideProposal(c.id, "approved");
  f.set(NOON + PROPOSAL_TTL_MS);
  assert.deepEqual(
    (await f.store.expireProposals()).map((p) => p.id),
    [b.id],
  );
  f.advance(300_000);
  assert.deepEqual(
    (await f.store.expireProposals()).map((p) => p.id),
    [c.id],
  );
});

test("a close past the liquidation estimate loses the margin, never more: cash stays positive", async (t) => {
  const f = await setup(t);
  const { scope } = await f.agent();
  await f.paper.initialize(scope, 1, "100");
  const service = createPerpsPaperService(
    f.paper,
    {
      observation: async () => ({ frames: [], funding: [] }),
      frame: async () => frame("BTC", f.now(), "60000"),
    },
    f.now,
  );
  const opened = await service.trade(
    scope,
    "open-btc",
    "open",
    "BTC",
    "long",
    AbortSignal.timeout(5000),
    frame("BTC", f.now(), "60000"),
    {
      notional: "900",
      leverage: 10,
      exits: () => ({ stopPrice: null, takeProfitPrice: null, exitDueAt: null }),
    },
  );
  const position = opened.account.positions[0]!;
  const openFee = -Number(opened.movements.find((m) => m.key === "open-btc:fee")!.delta);

  // A gap: the board was stale and the next frame is 30% below entry (liquidation is 10%).
  const closed = await f.paper.closePosition(
    scope,
    position.id,
    "stop",
    frame("BTC", f.now(), "42000"),
  );

  const pnl = closed.view.movements.find((m) => m.key === `close:${position.id}:pnl`)!;
  const fee = closed.view.movements.find((m) => m.key === `close:${position.id}:fee`)!;
  assert.equal(
    paperDecimal(paperUnits(pnl.delta) + paperUnits(fee.delta)),
    paperDecimal(-paperUnits(position.margin!)),
  );
  assert.ok(Number(closed.view.account.cash) > 0);
  assert.equal(
    Number(closed.view.account.cash),
    Number((100 - openFee - Number(position.margin)).toFixed(6)),
  );
});

test("snapshot reads without locks or writes, projecting lapsed attempts", async (t) => {
  const f = await setup(t);
  const { scope } = await f.agent();
  await f.paper.initialize(scope, 1, "100");
  const account = await f.db.pool.query(
    "SELECT id FROM pickler.perps_paper_accounts WHERE agent_id = $1",
    [scope.agentId],
  );
  await f.db.pool.query(
    `INSERT INTO pickler.perps_paper_attempts(account_id,key,document,owner,expires_at)
     VALUES($1,'stale',$2,$3,$4)`,
    [
      account.rows[0].id,
      {
        key: "stale",
        intent: { kind: "open", symbol: "BTC", side: "long", notional: "50", feeReserve: "1" },
        status: "pending",
        reserved: "51",
        createdAt: f.now() - 120_000,
        finishedAt: null,
        reason: null,
        evidence: null,
      },
      randomUUID(),
      f.now() - 60_000,
    ],
  );

  // A writer holds the agent row: a read through view would wait, the snapshot does not.
  const writer = await f.db.pool.connect();
  await writer.query("BEGIN");
  await writer.query("SELECT 1 FROM pickler.agents WHERE tenant_id=$1 AND id=$2 FOR UPDATE", [
    scope.tenantId,
    scope.agentId,
  ]);
  try {
    const snapshot = await f.paper.snapshot(scope);
    const stale = snapshot.attempts.find((a) => a.key === "stale")!;
    assert.equal(stale.status, "interrupted");
    assert.equal(stale.reason, "LEASE_EXPIRED");
    assert.equal(await f.paper.newMarginSince(scope, 0), "0");
  } finally {
    await writer.query("ROLLBACK");
    writer.release();
  }
  const stored = await f.db.pool.query(
    "SELECT document->>'status' AS status, owner FROM pickler.perps_paper_attempts WHERE key = 'stale'",
  );
  assert.equal(stored.rows[0].status, "pending");
  assert.ok(stored.rows[0].owner);
  await assert.rejects(f.paper.snapshot({ ...scope, agentId: "nobody" }), { code: "NOT_FOUND" });
});

test("Studio calls reserve before transport and retain unknown usage across recovery", async (t) => {
  const { PostgresPerpsCheckCostStore } =
    await import("../src/persistence/perps-check-cost-store.js");
  const f = await setup(t);
  const agent = await f.agent();
  const queued = await f.store.startCheck({ productAgentId: agent.id, trigger: "manual" });
  const claim = (await f.store.claimAgent(queued.id))!;
  const costs = new PostgresPerpsCheckCostStore(f.db.pool, f.now);
  const scope = { ...agent.scope, checkId: queued.id, configVersion: 1, lease: claim.lease };
  const policy = {
    version: 1 as const,
    enabled: true,
    reviewedAt: new Date(f.now()).toISOString(),
    perOperationMicros: "1000",
    perDayMicros: "2000",
  };
  const plan = {
    key: "direct",
    provider: "controlled",
    model: "controlled",
    promptVersion: "2.0.0",
    promptSha256: "a".repeat(64),
    maxInputTokens: 1000,
    maxOutputTokens: 100,
    inputMicrosPerMillion: "1000000",
    outputMicrosPerMillion: "0",
  };
  await costs.reserve(scope, { id: "deepseek", version: "2.0.0" }, policy, [plan]);
  const starts = await Promise.allSettled([
    costs.start(scope, "direct", { sha256: "b".repeat(64), bytes: 100 }),
    costs.start(scope, "direct", { sha256: "b".repeat(64), bytes: 100 }),
  ]);
  assert.equal(starts.filter((result) => result.status === "fulfilled").length, 1);
  await costs.unknown(scope, "direct");
  assert.deepEqual(await costs.finish(scope), { costMicros: null, accountedMicros: "1000" });
  await f.store.finishCheck(claim.lease, { outcome: "failed", outcomeText: "COST UNKNOWN" });
  await assert.rejects(f.store.startCheck({ productAgentId: agent.id, trigger: "manual" }), {
    code: "COST_UNKNOWN",
  });
  const observation = await f.store.claimSupervision(agent.id);
  assert.ok(observation, "Unknown USD costs must not block public observation");
  await f.store.finishCheck(observation.lease, {
    outcome: "system",
    outcomeText: "SUPERVISED",
    costMicros: "0",
  });
  await assert.rejects(
    costs.reconcileCall({
      tenantId: scope.tenantId,
      agentId: scope.agentId,
      checkId: scope.checkId,
      key: "direct",
      requestSha256: "f".repeat(64),
      evidence: "controlled billing capture",
      usage: { input: 100, output: 0 },
    }),
    { code: "RECONCILIATION_NOT_ALLOWED" },
  );
  await costs.reconcileCall({
    tenantId: scope.tenantId,
    agentId: scope.agentId,
    checkId: scope.checkId,
    key: "direct",
    requestSha256: "b".repeat(64),
    evidence: "controlled billing capture",
    usage: { input: 100, output: 0 },
  });
  assert.equal((await f.store.getCheck(queued.id))!.costMicros, "100");
  assert.equal(await f.store.costToday(agent.id), "100");
  await assert.rejects(
    costs.reconcileCall({
      tenantId: scope.tenantId,
      agentId: scope.agentId,
      checkId: scope.checkId,
      key: "direct",
      requestSha256: "b".repeat(64),
      evidence: "duplicate billing capture",
      usage: { input: 100, output: 0 },
    }),
    { code: "RECONCILIATION_NOT_ALLOWED" },
  );
});

test("Studio financial fencing rejects a recovered owner within the write transaction", async (t) => {
  const f = await setup(t);
  const agent = await f.agent();
  const queued = await f.store.startCheck({ productAgentId: agent.id, trigger: "manual" });
  const claim = (await f.store.claimAgent(queued.id))!;
  const bound = new PostgresPerpsPaperStore(f.db.pool, f.now, undefined, () => ({
    scope: agent.scope,
    configVersion: 1,
    lease: claim.lease,
    requireReservation: false,
  }));
  await bound.initialize(agent.scope, 1, "100");
  const paid = new PostgresPerpsPaperStore(f.db.pool, f.now, undefined, () => ({
    scope: agent.scope,
    configVersion: 1,
    lease: claim.lease,
    requireReservation: true,
  }));
  await assert.rejects(paid.initialize(agent.scope, 1, "100"), {
    code: "COST_RESERVATION_LOST",
  });
  await f.db.pool.query("UPDATE pickler.agents SET version=2 WHERE tenant_id=$1 AND id=$2", [
    agent.scope.tenantId,
    agent.scope.agentId,
  ]);
  await assert.rejects(bound.initialize(agent.scope, 1, "100"), { code: "CONFIG_CHANGED" });
  await f.db.pool.query("UPDATE pickler.agents SET version=1 WHERE tenant_id=$1 AND id=$2", [
    agent.scope.tenantId,
    agent.scope.agentId,
  ]);
  assert.equal((await f.paper.snapshot(agent.scope)).account.cash, "100");
  f.advance(60_001);
  await f.store.recoverChecks();
  await assert.rejects(bound.initialize(agent.scope, 1, "100"), { code: "LEASE_LOST" });
  assert.equal((await f.paper.snapshot(agent.scope)).account.cash, "100");
});

test("Studio v2 composes the shared strategy, call ledger and simulator without a probability", async (t) => {
  const { runStudioPerpsCheck } = await import("@pickler/trading/perps");
  const { PostgresPerpsCheckCostStore } =
    await import("../src/persistence/perps-check-cost-store.js");
  const { createHash } = await import("node:crypto");
  const f = await setup(t);
  const a = await f.agent();
  const config = {
    ...f.config,
    perpl: { ...f.config.perpl!, markets: ["BTC" as const] },
    perpsStrategy: { id: "deepseek" as const, version: "2.1.0" as const },
    entry: { mode: "auto" as const, meanwhile: "wait" as const, smallAusd: 1 },
    brief: { thesis: "controlled", reads: [], entersWhen: ["trend"], exitsWhen: [], never: [] },
  };
  await f.db.pool.query("UPDATE pickler.agents SET config=$3 WHERE tenant_id=$1 AND id=$2", [
    a.scope.tenantId,
    a.scope.agentId,
    config,
  ]);
  const queued = await f.store.startCheck({ productAgentId: a.id, trigger: "manual" });
  const claim = (await f.store.claimAgent(queued.id))!;
  const holder = { lease: claim.lease };
  let transports = 0;
  const costStore = new PostgresPerpsCheckCostStore(f.db.pool, f.now);
  const completed = await runStudioPerpsCheck(
    {
      store: f.store,
      agents: f.db,
      costs: costStore,
      now: f.now,
      policy: {
        version: 1,
        enabled: true,
        reviewedAt: new Date(f.now()).toISOString(),
        perOperationMicros: "1000",
        perDayMicros: "2000",
      },
      callPlans: [
        {
          key: "direct",
          provider: "controlled",
          model: "controlled",
          promptVersion: "2.0.0",
          promptSha256: "a".repeat(64),
          maxInputTokens: 1000,
          maxOutputTokens: 100,
          inputMicrosPerMillion: "1000000",
          outputMicrosPerMillion: "0",
        },
      ],
      hash: (document) => createHash("sha256").update(JSON.stringify(document)).digest("hex"),
      paper: (scope, version, owner, signal) =>
        new PostgresPerpsPaperStore(f.db.pool, f.now, undefined, () => ({
          scope,
          configVersion: version,
          lease: owner.lease,
          requireReservation: true,
          signal,
        })),
      initialCash: async () => "100",
      web: async () => {
        throw new Error("web must remain off");
      },
      models: {
        direct: async (context, _signal, hooks) => {
          assert.equal(context.account.cash, "100");
          await hooks.before({ sha256: "b".repeat(64), bytes: 100 });
          transports++;
          await hooks.usage(10, 2);
          return [
            {
              symbol: "BTC",
              action: "open-long",
              reason: "controlled",
              sourceIds: ["BTC:candles"],
              brief: {
                entries: [
                  { index: 1, state: "met", reason: "controlled", sourceIds: ["BTC:candles"] },
                ],
                exits: [],
                never: [],
              },
            },
          ];
        },
      },
      data: async () => ({
        frame: async (symbol) => frame(symbol, f.now(), "100"),
        funding: async () => {
          throw new Error("no historical positions yet");
        },
        read: async (symbol) => {
          const current = frame(symbol, f.now(), "100");
          return {
            frame: current,
            sources: [],
            candles: {
              market: current.snapshot.market,
              resolution: 3600,
              from: f.now() - 60 * HOUR,
              to: f.now(),
              missingOpenTimes: [],
              provenance: current.book.provenance,
              candles: Array.from({ length: 60 }, (_, index) => ({
                openTime: f.now() - (60 - index) * HOUR,
                open: "100",
                high: "100",
                low: "100",
                close: "100",
                volumeCollateral: "100",
                trades: 1,
                closed: true,
              })),
            },
          };
        },
      }),
    },
    claim.check,
    holder,
    new AbortController().signal,
  );
  assert.equal(completed.outcome, "entered", completed.error ?? completed.outcomeText ?? "");
  assert.equal(transports, 1);
  assert.equal(completed.costMicros, "10");
  const decision = completed.decision as { protocol: string; actions: { proposal: unknown }[] };
  assert.equal(decision.protocol, "studio-perps-check-v2");
  assert.equal("probability" in (decision.actions[0]!.proposal as object), false);
  const position = (await f.paper.snapshot(a.scope)).account.positions[0]!;
  assert.equal(position.stopPrice, "97");
  assert.equal(position.takeProfitPrice, "106");
  assert.equal(position.exitDueAt, f.now() + 24 * HOUR);
  assert.equal(position.checkId, queued.id);
});

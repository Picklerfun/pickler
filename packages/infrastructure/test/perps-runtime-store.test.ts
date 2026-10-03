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
  perpsCheckMinute,
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
  const { id } = await f.agent();
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

  assert.equal(row.outcome, "system");
  assert.equal(row.trigger, "system");
  const paused = await f.db.pool.query("SELECT paused FROM pickler.agents WHERE id=$1", [
    scope.agentId,
  ]);
  assert.equal(paused.rows[0].paused, true);
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
    "SELECT count(*)::int AS n FROM pickler.perps_checks WHERE product_agent_id = $1",
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

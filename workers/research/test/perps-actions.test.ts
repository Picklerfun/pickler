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
  PostgresPerpsOwnerStore,
  PostgresPerpsPaperStore,
  PostgresPerpsRuntimeStore,
  PostgresStudioDirectory,
} from "@pickler/infrastructure";
import { createTestStore } from "@pickler/infrastructure/testing";
import {
  PRODUCT_PAPER_SESSION,
  type PerpsPaperFrame,
  type PerpsPaperScope,
} from "@pickler/trading/perps";
import {
  consumePerpsAction,
  consumePerpsCheck,
  runPerpsCheck,
  type PerpsActionsBackground,
  type PerpsBackground,
  type PerpsCheckModelAnswer,
} from "@pickler/agent-runtime";
import type { Env } from "../src/index.js";
import { createResearchWorker } from "../src/worker.js";

const HOUR = 3_600_000;
const ON = { enabled: true, dailyChecks: 500 };
const OFF = { enabled: false, dailyChecks: 500 };

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

/** A `perps-check-v1` answer for the test brief (one line per section). */
function answer(instrument: PerpSymbol = "BTC", action = "open-long") {
  return JSON.stringify({
    instrument,
    action,
    probability: 0.7,
    horizonHours: 4,
    stopLossBps: 500,
    entries: [{ index: 1, met: true, why: "The data shows it" }],
    exits: [{ index: 1, met: false, why: "Not yet" }],
    never: [{ index: 1, broken: false }],
    rationale: "Momentum with the brief",
    sources: [],
  });
}

async function setup(t: TestContext) {
  let clock = Date.now();
  const db = await createTestStore(t);
  const store = new PostgresPerpsRuntimeStore(db.pool, () => clock);
  const paper = new PostgresPerpsPaperStore(db.pool, () => clock);
  const owner = new PostgresPerpsOwnerStore(db.pool, () => clock);
  const user = randomUUID();
  await db.pool.query("SELECT identity.create_profile($1,'Maker','perps_actor')", [user]);
  const studio = new PostgresStudioDirectory(db.pool);
  await studio.onboard(user);
  const access = (await studio.access(user, null))!;
  const base = prepareDraft({
    name: "Trader",
    handle: "trader",
    voice: "analyst",
    avatar: { accent: "lime", pattern: 0 },
    sources: { web: null },
    brief: DEFAULT_BRIEF,
    caps: STARTER_CAPS,
    walletId: "unused",
  }).config;
  const prices: Record<PerpSymbol, string> = { BTC: "60000", ETH: "3000" };
  let content = answer();
  let count = 0;

  async function agent(config: Partial<AgentConfig> = {}) {
    count += 1;
    const id = randomUUID();
    const runtimeId = `runtime-${count}`;
    const handle = `actor${count}`;
    const full: AgentConfig = {
      ...base,
      brief: {
        ...base.brief!,
        entersWhen: ["Trend up"],
        exitsWhen: ["Trend breaks"],
        never: ["No news trades"],
      },
      spend: { perCallAusd: 10, perDayAusd: 100 },
      maxLeverage: 2,
      risk: { maxOpenPositions: 2, dayLossStopAusd: 50 },
      entry: { mode: "auto", meanwhile: "wait", smallAusd: 2 },
      ...config,
    };
    const client = await db.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO agents.agents(id,workspace_id,name,handle,status,visibility,published_at)
         VALUES($1,$2,'Trader',$3,'active','public',now())`,
        [id, access.workspaceId, handle],
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
      "INSERT INTO pickler.agents(tenant_id,id,version,config,paused) VALUES($1,$2,1,$3,false)",
      [access.tenantId, runtimeId, JSON.stringify(full)],
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
    const update = async (patch: Partial<AgentConfig>) => {
      await db.pool.query(
        "UPDATE pickler.agents SET config = config || $3::jsonb WHERE tenant_id = $1 AND id = $2",
        [access.tenantId, runtimeId, JSON.stringify(patch)],
      );
    };
    return { id, scope, update };
  }

  const now = () => clock;
  const exitFrame = async (_network: string, symbol: PerpSymbol) =>
    frame(symbol, clock, prices[symbol]);
  function runtime(): PerpsBackground {
    const deps = {
      store,
      paper,
      agents: db,
      wallets: { findAgentWallet: async () => ({ address: "0xwallet" }) },
      balances: { read: async () => 200 },
      market: {
        async open() {
          return {
            async read(symbol: PerpSymbol) {
              const f = frame(symbol, clock, prices[symbol]);
              return {
                frame: f,
                candles: {
                  market: f.snapshot.market,
                  resolution: 3600,
                  from: clock - 48 * HOUR,
                  to: clock,
                  candles: [],
                  provenance: f.snapshot.ticker.provenance,
                } as never,
                sources: [],
              };
            },
            frame: async (symbol: PerpSymbol) => frame(symbol, clock, prices[symbol]),
          };
        },
      },
      marks: async () => [],
      web: {
        search: async () => {
          throw new Error("No web in these agents");
        },
      },
      model: {
        async decide(): Promise<PerpsCheckModelAnswer> {
          return {
            content,
            inputTokens: 1000,
            outputTokens: 200,
            costMicros: "1500",
            requestSha256: "b".repeat(64),
          };
        },
      },
      clock: now,
    };
    return {
      store,
      paper,
      agents: db,
      marks: deps.marks,
      exitFrame,
      check: (check, holder, signal) => runPerpsCheck(deps, check, holder, signal),
      close: async () => {},
      clock: now,
    };
  }
  const actions = (): PerpsActionsBackground => ({
    store,
    paper,
    agents: db,
    marks: async () => [],
    exitFrame,
    owner,
    close: async () => {},
    clock: now,
  });

  /** A manual check, consumed as the Queue would. */
  async function check(id: string) {
    const queued = await store.startCheck({ productAgentId: id, trigger: "manual" });
    await consumePerpsCheck(runtime(), queued.id, ON);
    return (await store.getCheck(queued.id))!;
  }

  return {
    db,
    store,
    paper,
    owner,
    agent,
    check,
    actions,
    prices,
    now,
    advance: (ms: number) => {
      clock += ms;
    },
    answer: (value: string) => {
      content = value;
    },
  };
}

const open = (view: Awaited<ReturnType<PostgresPerpsPaperStore["view"]>>) =>
  view.account.positions.filter((p) => p.closedAt === null);

const APPROVE = { enabled: true, dailyChecks: 500 };

test("approve opens within the caps at a fresh frame, with the proposing check's exits", async (t) => {
  const f = await setup(t);
  const { id, scope } = await f.agent({
    entry: { mode: "approve", meanwhile: "wait", smallAusd: 2 },
  });
  const proposed = await f.check(id);
  const [proposal] = await f.store.listProposals(id);
  f.prices.BTC = "61000";

  const ownerId = await consumePerpsAction(
    f.actions(),
    { kind: "perps-proposal", proposalId: proposal!.id, decision: "approve" },
    APPROVE,
  );

  assert.equal(proposed.outcome, "proposed");
  const row = (await f.store.getCheck(ownerId!))!;
  assert.equal(row.trigger, "owner");
  assert.equal(row.outcome, "entered");
  assert.equal(row.outcomeText, "ENTERED LONG BTC");
  assert.deepEqual(
    row.steps.map((s) => s.text),
    ["You approved ENTRY LONG BTC · 10.00 AUSD", "Opened LONG BTC at 61000 · 9.15 AUSD × 2"],
  );
  const [position] = open(await f.paper.view(scope));
  assert.equal(position!.entryPrice, "61000");
  assert.equal(position!.checkId, ownerId);
  // 500 bps from the proposing check; its 4 h horizon.
  assert.equal(position!.stopPrice, "57950");
  assert.equal(position!.exitDueAt, f.now() + 4 * HOUR);
  assert.equal((await f.store.getProposal(proposal!.id))!.status, "approved");
  assert.deepEqual(await f.store.listProposals(id), []);

  // A repeated delivery does nothing more.
  assert.equal(
    await consumePerpsAction(
      f.actions(),
      { kind: "perps-proposal", proposalId: proposal!.id, decision: "approve" },
      APPROVE,
    ),
    null,
  );
  assert.equal(open(await f.paper.view(scope)).length, 1);
});

test("approve refuses when the caps changed since: blocked with the cap, the proposal waits again", async (t) => {
  const f = await setup(t);
  const agent = await f.agent({ entry: { mode: "approve", meanwhile: "wait", smallAusd: 2 } });
  await f.check(agent.id);
  const [proposal] = await f.store.listProposals(agent.id);
  await agent.update({ spend: { perCallAusd: 5, perDayAusd: 5 } });

  const ownerId = await consumePerpsAction(
    f.actions(),
    { kind: "perps-proposal", proposalId: proposal!.id, decision: "approve" },
    APPROVE,
  );

  const row = (await f.store.getCheck(ownerId!))!;
  assert.equal(row.outcome, "blocked");
  assert.equal(row.outcomeText, "BLOCKED BY CAP · PER TRADE");
  assert.equal(row.error, "CAP_TRADE");
  assert.deepEqual(open(await f.paper.view(agent.scope)), []);
  assert.equal((await f.store.getProposal(proposal!.id))!.status, "pending");

  await agent.update({
    spend: { perCallAusd: 10, perDayAusd: 100 },
    risk: { maxOpenPositions: 0, dayLossStopAusd: 50 },
  });
  const capped = await consumePerpsAction(
    f.actions(),
    { kind: "perps-proposal", proposalId: proposal!.id, decision: "approve" },
    APPROVE,
  );
  // Refused, it waits again: a second approve is re-checked against the caps as they are now.
  const again = (await f.store.getCheck(capped!))!;
  assert.equal(again.outcomeText, "BLOCKED BY CAP · 0 OPEN");
  assert.equal(again.error, "CAP_OPEN");
  assert.equal((await f.store.getProposal(proposal!.id))!.status, "pending");
});

test("approve after 15 minutes is skipped as expired and opens nothing", async (t) => {
  const f = await setup(t);
  const { id, scope } = await f.agent({
    entry: { mode: "approve", meanwhile: "wait", smallAusd: 2 },
  });
  await f.check(id);
  const [proposal] = await f.store.listProposals(id);
  f.advance(15 * 60_000);

  const ownerId = await consumePerpsAction(
    f.actions(),
    { kind: "perps-proposal", proposalId: proposal!.id, decision: "approve" },
    APPROVE,
  );

  const row = (await f.store.getCheck(ownerId!))!;
  assert.equal(row.outcome, "skipped");
  assert.equal(row.outcomeText, "EXPIRED · ENTRY LONG BTC");
  assert.equal(row.error, "PROPOSAL_EXPIRED");
  assert.equal((await f.store.getProposal(proposal!.id))!.status, "expired");
  assert.deepEqual(open(await f.paper.view(scope)), []);
});

test("approve while the runtime is off is blocked and leaves the proposal pending", async (t) => {
  const f = await setup(t);
  const { id } = await f.agent({ entry: { mode: "approve", meanwhile: "wait", smallAusd: 2 } });
  await f.check(id);
  const [proposal] = await f.store.listProposals(id);

  const ownerId = await consumePerpsAction(
    f.actions(),
    { kind: "perps-proposal", proposalId: proposal!.id, decision: "approve" },
    OFF,
  );

  const row = (await f.store.getCheck(ownerId!))!;
  assert.equal(row.outcome, "blocked");
  assert.equal(row.error, "RUNTIME_DISABLED");
  assert.equal((await f.store.getProposal(proposal!.id))!.status, "pending");
});

test("approving a size-up adds its margin to the small position", async (t) => {
  const f = await setup(t);
  const { id, scope } = await f.agent({
    entry: { mode: "approve", meanwhile: "small", smallAusd: 5 },
  });
  await f.check(id);
  const [proposal] = await f.store.listProposals(id);

  const ownerId = await consumePerpsAction(
    f.actions(),
    { kind: "perps-proposal", proposalId: proposal!.id, decision: "approve" },
    APPROVE,
  );

  const row = (await f.store.getCheck(ownerId!))!;
  assert.equal(row.outcome, "entered");
  assert.equal(row.outcomeText, "SIZED UP LONG BTC");
  const [position] = open(await f.paper.view(scope));
  assert.equal(position!.sizeUps!.length, 1);
  assert.equal((await f.store.getProposal(proposal!.id))!.status, "approved");
});

test("close now closes one position as the owner and logs its P&L", async (t) => {
  const f = await setup(t);
  const { id, scope } = await f.agent();
  await f.check(id);
  const [position] = open(await f.paper.view(scope));
  f.prices.BTC = "60600";

  const ownerId = await consumePerpsAction(
    f.actions(),
    { kind: "perps-close", positionId: position!.id, productAgentId: id, reason: "owner" },
    ON,
  );

  const row = (await f.store.getCheck(ownerId!))!;
  assert.equal(row.trigger, "owner");
  assert.equal(row.outcome, "exited");
  assert.equal(row.outcomeText, "CLOSED BY YOU · LONG BTC");
  assert.match(row.steps[0]!.text, /^Closed LONG BTC at 60600 · \+\d+\.\d{2} AUSD$/);
  const view = await f.paper.view(scope);
  assert.deepEqual(open(view), []);
  assert.equal(view.account.positions[0]!.closeReason, "owner");
  assert.deepEqual(await f.owner.findPosition(position!.id), { productAgentId: id, scope });
});

test("stop · close all closes every position with stop_all, even with the runtime off", async (t) => {
  const f = await setup(t);
  const { id, scope } = await f.agent();
  await f.check(id);
  f.advance(60_000);
  f.answer(answer("ETH", "open-short"));
  await f.check(id);
  assert.equal(open(await f.paper.view(scope)).length, 2);

  const ownerId = await consumePerpsAction(
    f.actions(),
    { kind: "perps-close", positionId: null, productAgentId: id, reason: "stop_all" },
    OFF,
  );

  const row = (await f.store.getCheck(ownerId!))!;
  assert.equal(row.outcome, "exited");
  assert.equal(row.outcomeText, "STOPPED · CLOSED 2");
  assert.equal(row.steps.length, 2);
  const view = await f.paper.view(scope);
  assert.deepEqual(open(view), []);
  assert.deepEqual(
    view.account.positions.map((p) => p.closeReason),
    ["stop_all", "stop_all"],
  );
  assert.deepEqual(await f.owner.counts(id), { checks: 2, entries: 2 });

  const again = await consumePerpsAction(
    f.actions(),
    { kind: "perps-close", positionId: null, productAgentId: id, reason: "stop_all" },
    OFF,
  );
  assert.equal((await f.store.getCheck(again!))!.outcomeText, "STOPPED · NOTHING OPEN");
});

test("an action while a check holds the agent is CHECK_RUNNING, and the Queue retries it soon", async (t) => {
  const f = await setup(t);
  const { id } = await f.agent();
  await f.store.startCheck({ productAgentId: id, trigger: "manual" });
  const message = {
    kind: "perps-close" as const,
    positionId: null,
    productAgentId: id,
    reason: "stop_all" as const,
  };

  await assert.rejects(consumePerpsAction(f.actions(), message, ON), /already queued or running/);

  const retries: unknown[] = [];
  const worker = createResearchWorker({
    repository: () => assert.fail("No research expected") as never,
    runtime: () => assert.fail("No research expected") as never,
    perpsActions: () => f.actions(),
  });
  await worker.queue!(
    {
      messages: [
        {
          body: message,
          ack: () => assert.fail("A busy agent is retried"),
          retry: (options: unknown) => retries.push(options),
        },
      ],
    } as never,
    { PERPL_RUNTIME_ENABLED: "true" } as unknown as Env,
    {} as never,
  );
  assert.deepEqual(retries, [{ delaySeconds: 10 }]);
});

test("the worker routes an approve to the actions runtime and acknowledges it", async (t) => {
  const f = await setup(t);
  const { id, scope } = await f.agent({
    entry: { mode: "approve", meanwhile: "wait", smallAusd: 2 },
  });
  await f.check(id);
  const [proposal] = await f.store.listProposals(id);
  let acked = 0;
  const worker = createResearchWorker({
    repository: () => assert.fail("No research expected") as never,
    runtime: () => assert.fail("No research expected") as never,
    perpsActions: () => f.actions(),
  });

  await worker.queue!(
    {
      messages: [
        {
          body: { kind: "perps-proposal", proposalId: proposal!.id, decision: "approve" },
          ack: () => {
            acked++;
          },
          retry: () => assert.fail("Unexpected retry"),
        },
      ],
    } as never,
    { PERPL_RUNTIME_ENABLED: "true" } as unknown as Env,
    {} as never,
  );

  assert.equal(acked, 1);
  assert.equal(open(await f.paper.view(scope)).length, 1);
});

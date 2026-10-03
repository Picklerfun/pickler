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
  PERPS_ACTION_REDRIVE_MS,
  PRODUCT_PAPER_SESSION,
  type PerpsOwnerActionKind,
  type PerpsPaperFrame,
  type PerpsPaperScope,
} from "@pickler/trading/perps";
import {
  consumePerpsAction,
  consumePerpsCheck,
  runPerpsCheck,
  superviseChecks,
  type PerpsActionsBackground,
  type PerpsBackground,
  type PerpsCheckModelAnswer,
} from "@pickler/agent-runtime";
import type { Env } from "../src/index.js";
import { createResearchWorker } from "../src/worker.js";

const HOUR = 3_600_000;
const ON = { enabled: true, dailyChecks: 500 };
const OFF = { enabled: false, dailyChecks: 500 };
/** A busy agent is left pending at once (no polling) unless a test waits. */
const NO_WAIT = { waitMs: 0, pollMs: 1, heartbeatMs: 15_000 };

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
  let exitFails = 0;
  const exitFrame = async (_network: string, symbol: PerpSymbol) => {
    if (exitFails > 0) {
      exitFails--;
      throw new Error("Perpl is unreachable");
    }
    return frame(symbol, clock, prices[symbol]);
  };
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

  let keys = 0;
  /** The API's write: one durable owner action. */
  function request(
    productAgentId: string,
    kind: PerpsOwnerActionKind,
    target: { positionId?: string; proposalId?: string } = {},
  ) {
    keys++;
    return owner.createAction({ productAgentId, kind, requestKey: `key-${keys}`, ...target });
  }
  /** The API's write, then one wakeup consumed as the Queue would. */
  async function act(
    productAgentId: string,
    kind: PerpsOwnerActionKind,
    target: { positionId?: string; proposalId?: string } = {},
    admission = ON,
  ) {
    const action = await request(productAgentId, kind, target);
    const checkId = await consumePerpsAction(actions(), action.id, admission, NO_WAIT);
    return { action, checkId, after: (await owner.getAction(action.id))! };
  }

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
    request,
    act,
    prices,
    failExits: (n: number) => {
      exitFails = n;
    },
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

const APPROVE_MODE = {
  entry: { mode: "approve" as const, meanwhile: "wait" as const, smallAusd: 2 },
};

test("approve opens within the caps at a fresh frame, with the proposing check's exits", async (t) => {
  const f = await setup(t);
  const { id, scope } = await f.agent(APPROVE_MODE);
  const proposed = await f.check(id);
  const [proposal] = await f.store.listProposals(id);
  f.prices.BTC = "61000";

  const { action, checkId, after } = await f.act(id, "approve", { proposalId: proposal!.id });

  assert.equal(proposed.outcome, "proposed");
  const row = (await f.store.getCheck(checkId!))!;
  assert.equal(row.trigger, "owner");
  assert.equal(row.outcome, "entered");
  assert.equal(row.outcomeText, "ENTERED LONG BTC");
  assert.deepEqual(
    row.steps.map((s) => s.text),
    ["You approved ENTRY LONG BTC · 10.00 AUSD", "Opened LONG BTC at 61000 · 9.15 AUSD × 2"],
  );
  assert.equal(after.status, "done");
  assert.equal(after.checkId, checkId);
  assert.equal(after.attempts, 1);
  const [position] = open(await f.paper.view(scope));
  assert.equal(position!.entryPrice, "61000");
  assert.equal(position!.checkId, checkId);
  // 500 bps from the proposing check; its 4 h horizon.
  assert.equal(position!.stopPrice, "57950");
  assert.equal(position!.exitDueAt, f.now() + 4 * HOUR);
  assert.equal((await f.store.getProposal(proposal!.id))!.status, "approved");
  assert.deepEqual(await f.store.listProposals(id), []);

  // A repeated wakeup of the same action does nothing more.
  assert.equal(await consumePerpsAction(f.actions(), action.id, ON, NO_WAIT), null);
  assert.equal(open(await f.paper.view(scope)).length, 1);
});

test("approve refuses when the caps changed since; a redelivery never approves it again", async (t) => {
  const f = await setup(t);
  const agent = await f.agent(APPROVE_MODE);
  await f.check(agent.id);
  const [proposal] = await f.store.listProposals(agent.id);
  await agent.update({ spend: { perCallAusd: 5, perDayAusd: 5 } });

  const refused = await f.act(agent.id, "approve", { proposalId: proposal!.id });

  const row = (await f.store.getCheck(refused.checkId!))!;
  assert.equal(row.outcome, "blocked");
  assert.equal(row.outcomeText, "BLOCKED BY CAP · PER TRADE");
  assert.equal(row.error, "CAP_TRADE");
  assert.equal(refused.after.status, "done");
  assert.equal(refused.after.lastError, "CAP_TRADE");
  assert.deepEqual(open(await f.paper.view(agent.scope)), []);
  assert.equal((await f.store.getProposal(proposal!.id))!.status, "pending");

  // The caps allow it again, but the refused action's redelivery is not the owner's click (#4).
  await agent.update({ spend: { perCallAusd: 10, perDayAusd: 100 } });
  assert.equal(await consumePerpsAction(f.actions(), refused.action.id, ON, NO_WAIT), null);
  assert.deepEqual(open(await f.paper.view(agent.scope)), []);

  // A new click is a new action, re-checked against the caps as they are now.
  await agent.update({ risk: { maxOpenPositions: 0, dayLossStopAusd: 50 } });
  const again = await f.act(agent.id, "approve", { proposalId: proposal!.id });
  const capped = (await f.store.getCheck(again.checkId!))!;
  assert.equal(capped.outcomeText, "BLOCKED BY CAP · 0 OPEN");
  assert.equal(capped.error, "CAP_OPEN");
  assert.equal((await f.store.getProposal(proposal!.id))!.status, "pending");
});

test("approve after 15 minutes is skipped as expired and opens nothing", async (t) => {
  const f = await setup(t);
  const { id, scope } = await f.agent(APPROVE_MODE);
  await f.check(id);
  const [proposal] = await f.store.listProposals(id);
  f.advance(15 * 60_000);

  const { checkId } = await f.act(id, "approve", { proposalId: proposal!.id });

  const row = (await f.store.getCheck(checkId!))!;
  assert.equal(row.outcome, "skipped");
  assert.equal(row.outcomeText, "EXPIRED · ENTRY LONG BTC");
  assert.equal(row.error, "PROPOSAL_EXPIRED");
  assert.equal((await f.store.getProposal(proposal!.id))!.status, "expired");
  assert.deepEqual(open(await f.paper.view(scope)), []);
});

test("approve while the runtime is off is blocked and leaves the proposal pending", async (t) => {
  const f = await setup(t);
  const { id } = await f.agent(APPROVE_MODE);
  await f.check(id);
  const [proposal] = await f.store.listProposals(id);

  const { checkId } = await f.act(id, "approve", { proposalId: proposal!.id }, OFF);

  const row = (await f.store.getCheck(checkId!))!;
  assert.equal(row.outcome, "blocked");
  assert.equal(row.error, "RUNTIME_DISABLED");
  assert.equal((await f.store.getProposal(proposal!.id))!.status, "pending");
});

test("a killed agent's approval is refused by the store and again by the worker", async (t) => {
  const f = await setup(t);
  const { id, scope } = await f.agent(APPROVE_MODE);
  await f.check(id);
  const [proposal] = await f.store.listProposals(id);
  const written = await f.request(id, "approve", { proposalId: proposal!.id });
  await f.db.pool.query(
    "UPDATE agents.agents SET status = 'killed', killed_at = now() WHERE id = $1",
    [id],
  );

  await assert.rejects(f.request(id, "approve", { proposalId: proposal!.id }), /killed/);
  await assert.rejects(f.store.startCheck({ productAgentId: id, trigger: "manual" }), /killed/);
  const checkId = await consumePerpsAction(f.actions(), written.id, ON, NO_WAIT);

  const row = (await f.store.getCheck(checkId!))!;
  assert.equal(row.outcome, "blocked");
  assert.equal(row.error, "AGENT_KILLED");
  assert.deepEqual(open(await f.paper.view(scope)), []);
  // Closing stays allowed.
  assert.equal((await f.act(id, "stop_all")).after.status, "done");
});

test("approving a size-up adds its margin to the small position", async (t) => {
  const f = await setup(t);
  const { id, scope } = await f.agent({
    entry: { mode: "approve", meanwhile: "small", smallAusd: 5 },
  });
  await f.check(id);
  const [proposal] = await f.store.listProposals(id);

  const { checkId } = await f.act(id, "approve", { proposalId: proposal!.id });

  const row = (await f.store.getCheck(checkId!))!;
  assert.equal(row.outcome, "entered");
  assert.equal(row.outcomeText, "SIZED UP LONG BTC");
  const [position] = open(await f.paper.view(scope));
  assert.equal(position!.sizeUps!.length, 1);
  assert.equal((await f.store.getProposal(proposal!.id))!.status, "approved");
});

test("two concurrent deliveries of the same approve enter once", async (t) => {
  const f = await setup(t);
  const { id, scope } = await f.agent(APPROVE_MODE);
  await f.check(id);
  const [proposal] = await f.store.listProposals(id);
  const action = await f.request(id, "approve", { proposalId: proposal!.id });

  const results = await Promise.all([
    consumePerpsAction(f.actions(), action.id, ON, NO_WAIT),
    consumePerpsAction(f.actions(), action.id, ON, NO_WAIT),
  ]);

  const ran = results.filter((r) => r !== null);
  assert.equal(ran.length, 1);
  assert.equal((await f.store.getCheck(ran[0]!))!.outcome, "entered");
  const owners = (await f.store.listChecks(id)).items.filter((c) => c.trigger === "owner");
  assert.deepEqual(
    owners.map((c) => c.outcome),
    ["entered"],
  );
  assert.equal(open(await f.paper.view(scope)).length, 1);
  assert.equal((await f.owner.getAction(action.id))!.attempts, 1);
});

test("close now closes one position as the owner and logs its P&L", async (t) => {
  const f = await setup(t);
  const { id, scope } = await f.agent();
  await f.check(id);
  const [position] = open(await f.paper.view(scope));
  f.prices.BTC = "60600";

  const { checkId, after } = await f.act(id, "close", { positionId: position!.id });

  const row = (await f.store.getCheck(checkId!))!;
  assert.equal(row.trigger, "owner");
  assert.equal(row.outcome, "exited");
  assert.equal(row.outcomeText, "CLOSED BY YOU · LONG BTC");
  assert.match(row.steps[0]!.text, /^Closed LONG BTC at 60600 · \+\d+\.\d{2} AUSD$/);
  assert.equal(after.status, "done");
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

  const { checkId } = await f.act(id, "stop_all", {}, OFF);

  const row = (await f.store.getCheck(checkId!))!;
  assert.equal(row.outcome, "exited");
  assert.equal(row.outcomeText, "STOPPED · CLOSED 2");
  // The API pauses first; here it had not, so the worker paused it (once).
  assert.deepEqual(
    row.steps.map((s) => s.text.split(" at ")[0]),
    ["Paused · you stopped it", "Closed LONG BTC", "Closed SHORT ETH"],
  );
  const view = await f.paper.view(scope);
  assert.deepEqual(open(view), []);
  assert.deepEqual(
    view.account.positions.map((p) => p.closeReason),
    ["stop_all", "stop_all"],
  );
  assert.deepEqual(await f.owner.counts(id), { checks: 2, entries: 2 });

  const again = await f.act(id, "stop_all", {}, OFF);
  const second = (await f.store.getCheck(again.checkId!))!;
  assert.equal(second.outcomeText, "STOPPED · NOTHING OPEN");
  assert.deepEqual(
    second.steps.map((s) => s.text),
    ["Nothing was open"],
  );
});

test("a close that cannot reach Perpl stays pending, and the next attempt closes it", async (t) => {
  const f = await setup(t);
  const { id, scope } = await f.agent();
  await f.check(id);
  f.failExits(1);

  const first = await f.act(id, "stop_all");

  assert.equal((await f.store.getCheck(first.checkId!))!.outcomeText, "CLOSE FAILED");
  assert.equal(first.after.status, "pending");
  assert.equal(first.after.lastError, "CLOSE_FAILED");
  assert.equal(open(await f.paper.view(scope)).length, 1);

  const retried = await consumePerpsAction(f.actions(), first.action.id, ON, NO_WAIT);

  assert.equal((await f.store.getCheck(retried!))!.outcomeText, "STOPPED · CLOSED 1");
  assert.deepEqual(open(await f.paper.view(scope)), []);
  const done = (await f.owner.getAction(first.action.id))!;
  assert.equal(done.status, "done");
  assert.equal(done.attempts, 2);
});

test("an action waits for a running check within its delivery, then runs", async (t) => {
  const f = await setup(t);
  const { id, scope } = await f.agent();
  await f.check(id);
  const [position] = open(await f.paper.view(scope));
  const busy = await f.store.startCheck({ productAgentId: id, trigger: "manual" });
  const claimed = await f.store.claimAgent(busy.id);
  const action = await f.request(id, "close", { positionId: position!.id });
  let polls = 0;

  const checkId = await consumePerpsAction(f.actions(), action.id, ON, {
    waitMs: 60_000,
    pollMs: 5_000,
    sleep: async () => {
      polls++;
      // The running check finishes while the action waits.
      await f.store.releaseAgent(claimed!.lease, "CHECK_RELEASED");
    },
  });

  assert.equal(polls, 1);
  assert.equal((await f.store.getCheck(checkId!))!.outcome, "exited");
  assert.equal((await f.owner.getAction(action.id))!.status, "done");
});

test("a check holding the agent past the wait leaves the action pending; the Cron re-drives it, even off", async (t) => {
  const f = await setup(t);
  const { id, scope } = await f.agent();
  await f.check(id);
  const [position] = open(await f.paper.view(scope));
  const busy = await f.store.startCheck({ productAgentId: id, trigger: "manual" });
  const claimed = await f.store.claimAgent(busy.id);
  const action = await f.request(id, "close", { positionId: position!.id });

  // Four deliveries while the check runs: none is lost, none is acknowledged as done.
  for (let i = 0; i < 4; i++) {
    assert.equal(await consumePerpsAction(f.actions(), action.id, ON, NO_WAIT), null);
  }
  const waiting = (await f.owner.getAction(action.id))!;
  assert.equal(waiting.status, "pending");
  assert.equal(waiting.lastError, "CHECK_RUNNING");
  assert.equal(waiting.attempts, 4);
  assert.equal(open(await f.paper.view(scope)).length, 1);

  // The check ends; 30 s later the minute Cron (runtime off) wakes the action again.
  await f.store.releaseAgent(claimed!.lease, "CHECK_RELEASED");
  const sent: unknown[] = [];
  await superviseChecks({ ...runtimeFor(f), owner: f.owner }, OFF, async (m) => {
    sent.push(m);
  });
  assert.deepEqual(sent, []);
  f.advance(PERPS_ACTION_REDRIVE_MS);
  await superviseChecks({ ...runtimeFor(f), owner: f.owner }, OFF, async (m) => {
    sent.push(m);
  });
  assert.deepEqual(sent, [{ kind: "perps-action", actionId: action.id }]);

  const checkId = await consumePerpsAction(f.actions(), action.id, OFF, NO_WAIT);
  assert.equal((await f.store.getCheck(checkId!))!.outcomeText, "CLOSED BY YOU · LONG BTC");
  assert.equal((await f.owner.getAction(action.id))!.status, "done");
});

test("a claim that lapsed mid-action (a crashed worker) is re-driven and carried out once", async (t) => {
  const f = await setup(t);
  const { id, scope } = await f.agent();
  await f.check(id);
  const action = await f.request(id, "stop_all");
  const crashed = await f.owner.claimAction(action.id);
  assert.ok(crashed);
  assert.equal(await f.owner.claimAction(action.id), null);

  f.advance(180_000);
  assert.deepEqual(await f.owner.pendingActions(), [action.id]);
  const checkId = await consumePerpsAction(f.actions(), action.id, ON, NO_WAIT);

  assert.equal((await f.store.getCheck(checkId!))!.outcomeText, "STOPPED · CLOSED 1");
  assert.deepEqual(open(await f.paper.view(scope)), []);
  // The crashed claim can no longer start a check or put the action back.
  assert.equal(await f.owner.startActionCheck(crashed.claim), null);
  await f.owner.releaseAction(crashed.claim, "CHECK_RUNNING");
  assert.equal((await f.owner.getAction(action.id))!.status, "done");
});

test("the worker routes an action wakeup and acknowledges it, busy or not", async (t) => {
  const f = await setup(t);
  const { id, scope } = await f.agent(APPROVE_MODE);
  await f.check(id);
  const [proposal] = await f.store.listProposals(id);
  const action = await f.request(id, "approve", { proposalId: proposal!.id });
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
          body: { kind: "perps-action", actionId: action.id },
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
  assert.equal((await f.owner.getAction(action.id))!.status, "done");
});

test("createAction replays its key and refuses the key for another action", async (t) => {
  const f = await setup(t);
  const { id } = await f.agent();

  const first = await f.owner.createAction({
    productAgentId: id,
    kind: "stop_all",
    requestKey: "k1",
  });
  const replay = await f.owner.createAction({
    productAgentId: id,
    kind: "stop_all",
    requestKey: "k1",
  });

  assert.equal(replay.id, first.id);
  await assert.rejects(
    f.owner.createAction({ productAgentId: id, kind: "close", positionId: "x", requestKey: "k1" }),
    /another request/,
  );
  await assert.rejects(
    f.owner.createAction({ productAgentId: id, kind: "close", requestKey: "k2" }),
    /Invalid owner action/,
  );
});

/** The checks runtime of the setup, for the Cron. */
function runtimeFor(f: Awaited<ReturnType<typeof setup>>) {
  const actions = f.actions();
  return {
    ...actions,
    check: async () => assert.fail("The Cron runs no check here"),
  };
}

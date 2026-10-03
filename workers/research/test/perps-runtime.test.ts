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
  PostgresPerpsPaperStore,
  PostgresPerpsRuntimeStore,
  PostgresStudioDirectory,
} from "@pickler/infrastructure";
import { createTestStore } from "@pickler/infrastructure/testing";
import {
  PRODUCT_PAPER_SESSION,
  type PerpsPaperFrame,
  type PerpsPaperMark,
  type PerpsPaperScope,
} from "@pickler/trading/perps";
import {
  consumePerpsCheck,
  dispatchDueChecks,
  expirePerpsProposals,
  runExits,
  runPerpsCheck,
  superviseChecks,
  type PerpsBackground,
  type PerpsCheckMessage,
  type PerpsCheckModelAnswer,
} from "@pickler/agent-runtime";

const HOUR = 3_600_000;
const ON = { enabled: true, dailyChecks: 500 };

/** A product agent id whose hourly check runs at `minute`. */
const idAt = (minute: number) => `${minute.toString(16).padStart(8, "0")}-${randomUUID().slice(9)}`;

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

interface Decision {
  instrument?: PerpSymbol;
  action?: string;
  probability?: number;
  met?: boolean;
  exitMet?: boolean;
  broken?: boolean;
  horizonHours?: number;
}

/** A `perps-check-v1` answer for the test brief (one line per section). */
function answer(d: Decision = {}) {
  const action = d.action ?? "open-long";
  return JSON.stringify({
    instrument: d.instrument ?? "BTC",
    action,
    ...(action === "hold" ? {} : { probability: d.probability ?? 0.7 }),
    horizonHours: d.horizonHours ?? 24,
    entries: [{ index: 1, met: d.met ?? true, why: "The data shows it" }],
    exits: [{ index: 1, met: d.exitMet ?? false, why: "Not yet" }],
    never: [{ index: 1, broken: d.broken ?? false }],
    rationale: "Momentum with the brief",
    sources: ["perpl-btc-ticker"],
  });
}

async function setup(t: TestContext) {
  let clock = Date.now();
  const db = await createTestStore(t);
  const store = new PostgresPerpsRuntimeStore(db.pool, () => clock);
  const paper = new PostgresPerpsPaperStore(db.pool, () => clock);
  const owner = randomUUID();
  await db.pool.query("SELECT identity.create_profile($1,'Maker','perps_runner')", [owner]);
  const studio = new PostgresStudioDirectory(db.pool);
  await studio.onboard(owner);
  const access = (await studio.access(owner, null))!;
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
  let board: PerpsPaperMark[] = [];
  let content: string | null = answer();
  let balance = 200;
  let count = 0;
  const calls = { model: 0, perpl: 0 };
  let onModel: () => Promise<void> = async () => {};

  async function agent(
    options: {
      id?: string;
      paused?: boolean;
      config?: Partial<AgentConfig>;
      visibility?: "public" | "private";
    } = {},
  ) {
    count += 1;
    const id = options.id ?? idAt(count);
    const runtimeId = `runtime-${count}`;
    const handle = `runner${count}`;
    const visibility = options.visibility ?? "public";
    const config: AgentConfig = {
      ...base,
      brief: {
        ...base.brief!,
        entersWhen: ["Trend up"],
        exitsWhen: ["Trend breaks"],
        never: ["No news trades"],
      },
      spend: { perCallAusd: 10, perDayAusd: 100 },
      maxLeverage: 2,
      risk: { maxOpenPositions: 2, dayLossStopAusd: 5 },
      entry: { mode: "auto", meanwhile: "wait", smallAusd: 2 },
      ...options.config,
    };
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
      [access.tenantId, runtimeId, JSON.stringify(config), options.paused ?? false],
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

  const now = () => clock;
  function runtime(runtimeStore = store): PerpsBackground {
    const deps = {
      store: runtimeStore,
      paper,
      agents: db,
      wallets: { findAgentWallet: async () => ({ address: "0xwallet" }) },
      balances: { read: async () => balance },
      market: {
        async open() {
          return {
            async read(symbol: PerpSymbol) {
              calls.perpl++;
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
                sources: [
                  {
                    id: `perpl-${symbol.toLowerCase()}-ticker`,
                    name: "Perpl ticker",
                    url: "https://perpl.test/data",
                    observedAt: new Date(clock).toISOString(),
                  },
                ],
              };
            },
            frame: async (symbol: PerpSymbol) => frame(symbol, clock, prices[symbol]),
          };
        },
      },
      marks: async () => board,
      web: {
        search: async () => {
          throw new Error("No web in these agents");
        },
      },
      model: {
        async decide(): Promise<PerpsCheckModelAnswer> {
          calls.model++;
          await onModel();
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
      store: runtimeStore,
      paper,
      agents: db,
      marks: deps.marks,
      exitFrame: async (_network, symbol) => frame(symbol, clock, prices[symbol]),
      check: (check, holder, signal) => runPerpsCheck(deps, check, holder, signal),
      close: async () => {},
      clock: now,
    };
  }

  /** Starts a manual check and consumes it, as the Queue would. */
  async function check(id: string, admission = ON) {
    const queued = await store.startCheck({ productAgentId: id, trigger: "manual" });
    await consumePerpsCheck(runtime(), queued.id, admission);
    return (await store.getCheck(queued.id))!;
  }

  return {
    db,
    store,
    paper,
    agent,
    check,
    runtime,
    calls,
    prices,
    now,
    set: (at: number) => {
      clock = at;
    },
    advance: (ms: number) => {
      clock += ms;
    },
    answer: (value: string | null) => {
      content = value;
    },
    board: (marks: PerpsPaperMark[]) => {
      board = marks;
    },
    balance: (value: number) => {
      balance = value;
    },
    onModel: (hook: () => Promise<void>) => {
      onModel = hook;
    },
  };
}

const open = (view: Awaited<ReturnType<PostgresPerpsPaperStore["view"]>>) =>
  view.account.positions.filter((p) => p.closedAt === null);

test("entered: an auto agent opens a paper position with exits and timed steps", async (t) => {
  const f = await setup(t);
  const { id, scope } = await f.agent();

  const done = await f.check(id);

  assert.equal(done.outcome, "entered");
  assert.equal(done.outcomeText, "ENTERED LONG BTC");
  assert.equal(done.costMicros, "1500");
  assert.deepEqual(done.inputs, { instruments: ["BTC", "ETH"], web: false });
  assert.equal(done.configVersion, 1);
  const texts = done.steps.map((s) => s.text);
  assert.equal(texts[0], "Read the brief · 1 entry, 1 exit, 1 never");
  assert.ok(texts.includes("Opened its paper account · 200.00 AUSD"));
  assert.ok(texts.some((s) => /^Read Perpl BTC, ETH · \d+\.\ds$/.test(s)));
  assert.ok(texts.some((s) => s.startsWith("Asked the model · ")));
  assert.ok(texts.includes("Entry 1 met"));
  assert.equal(texts.at(-1), "ENTERED LONG BTC");
  const [position] = open(await f.paper.view(scope));
  assert.equal(position!.symbol, "BTC");
  assert.equal(position!.leverage, 2);
  assert.equal(position!.checkId, done.id);
  assert.ok(Number(position!.stopPrice) < 60000 && Number(position!.takeProfitPrice) > 60000);
  assert.equal(position!.exitDueAt, f.now() + 24 * HOUR);
});

test("held: an entry line not met holds, and nothing opens", async (t) => {
  const f = await setup(t);
  const { id, scope } = await f.agent();
  f.answer(answer({ met: false }));

  const done = await f.check(id);

  assert.equal(done.outcome, "held");
  assert.equal(done.outcomeText, "ENTRY 1 HELD");
  assert.ok(done.steps.some((s) => s.text === "Entry 1 held"));
  assert.deepEqual(open(await f.paper.view(scope)), []);
});

test("blocked: an unfunded wallet, and the open-positions cap", async (t) => {
  const f = await setup(t);
  const poor = await f.agent();
  f.balance(3.2);

  const unfunded = await f.check(poor.id);

  assert.equal(unfunded.outcome, "blocked");
  assert.equal(unfunded.outcomeText, "FUND ITS WALLET");
  assert.equal(unfunded.error, "WALLET_UNFUNDED");
  assert.equal(f.calls.model, 0);

  f.balance(200);
  const capped = await f.agent({ config: { risk: { maxOpenPositions: 1, dayLossStopAusd: 5 } } });
  f.answer(answer({ instrument: "ETH" }));
  assert.equal((await f.check(capped.id)).outcome, "entered");
  f.answer(answer({ instrument: "BTC" }));
  const blocked = await f.check(capped.id);
  assert.equal(blocked.outcome, "blocked");
  assert.equal(blocked.outcomeText, "BLOCKED BY CAP · 1 OPEN");
  assert.equal(open(await f.paper.view(capped.scope)).length, 1);
});

test("proposed: approve and wait leaves a 15-minute proposal and opens nothing", async (t) => {
  const f = await setup(t);
  const { id, scope } = await f.agent({
    config: { entry: { mode: "approve", meanwhile: "wait", smallAusd: 2 } },
  });

  const done = await f.check(id);

  assert.equal(done.outcome, "proposed");
  const [proposal] = await f.store.listProposals(id);
  assert.equal(proposal!.kind, "enter");
  assert.equal(proposal!.margin, "10");
  assert.equal(proposal!.leverage, 2);
  assert.equal(proposal!.checkId, done.id);
  assert.deepEqual(open(await f.paper.view(scope)), []);

  f.advance(15 * 60_000);
  assert.equal(await expirePerpsProposals(f.runtime()), 1);
  const feed = await f.store.listChecks(id, { outcomes: ["skipped"] });
  assert.equal(feed.items[0]!.outcomeText, "EXPIRED · ENTRY LONG BTC");
});

test("small + size-up: approve and small enters small and proposes the rest", async (t) => {
  const f = await setup(t);
  const { id, scope } = await f.agent({
    config: { entry: { mode: "approve", meanwhile: "small", smallAusd: 5 } },
  });

  const done = await f.check(id);

  assert.equal(done.error, null);
  assert.equal(done.outcome, "entered");
  assert.equal(done.outcomeText, "ENTERED LONG BTC SMALL · SIZE-UP PROPOSED");
  const [position] = open(await f.paper.view(scope));
  // 5 AUSD × 2 at 60,000 fills one 0.0001 BTC step: margin 3.
  assert.equal(position!.margin, "3");
  const [proposal] = await f.store.listProposals(id);
  assert.equal(proposal!.kind, "size_up");
  assert.equal(proposal!.margin, "5");
  assert.equal(proposal!.positionId, position!.id);

  const sized = await f.paper.sizeUp(
    scope,
    position!.id,
    { key: `sizeup:${proposal!.id}`, margin: proposal!.margin },
    frame("BTC", f.now(), "60000"),
  );
  assert.equal(sized.position.margin, "6");
  assert.equal(sized.position.sizeUps!.length, 1);
});

test("failed: a malformed answer is MODEL_INVALID, keeps its cost and never trades", async (t) => {
  const f = await setup(t);
  const { id, scope } = await f.agent();
  f.answer('{"instrument":"BTC","action":"buy everything"}');

  const done = await f.check(id);

  assert.equal(done.outcome, "failed");
  assert.equal(done.error, "MODEL_INVALID");
  assert.equal(done.costMicros, "1500");
  assert.deepEqual(open(await f.paper.view(scope)), []);

  f.answer("not json");
  assert.equal((await f.check(id)).error, "MODEL_INVALID");
});

test("opposite open: the close is its own exited row, then it opens the other side", async (t) => {
  const f = await setup(t);
  const { id, scope } = await f.agent();
  await f.check(id);
  f.advance(60_000);
  f.answer(answer({ action: "open-short" }));

  const done = await f.check(id);

  assert.equal(done.outcome, "entered");
  assert.equal(done.outcomeText, "ENTERED SHORT BTC");
  const exited = await f.store.listChecks(id, { outcomes: ["exited"] });
  assert.equal(exited.items.length, 1);
  assert.equal(exited.items[0]!.outcomeText, "CLOSED LONG BTC · REVERSING");
  const view = await f.paper.view(scope);
  const closed = view.account.positions.find((p) => p.closedAt !== null)!;
  assert.equal(closed.closeReason, "brief");
  assert.deepEqual(
    open(view).map((p) => [p.symbol, p.side]),
    [["BTC", "short"]],
  );
});

test("exits close at stop, target and time, each logged once", async (t) => {
  const f = await setup(t);
  const a = await f.agent();
  const b = await f.agent();
  await f.check(a.id);
  f.answer(answer({ instrument: "ETH" }));
  await f.check(a.id);
  f.answer(answer({ horizonHours: 4 }));
  await f.check(b.id);
  const ethTarget = open(await f.paper.view(a.scope)).find(
    (p) => p.symbol === "ETH",
  )!.takeProfitPrice!;

  f.prices.BTC = "57000";
  f.prices.ETH = String(Number(ethTarget) + 1);
  f.board([
    { network: "testnet", symbol: "BTC", mark: "57000" },
    { network: "testnet", symbol: "ETH", mark: f.prices.ETH },
  ]);
  const first = await runExits(f.runtime(), AbortSignal.timeout(5000));

  assert.equal(first, 3);
  const reasons = (await f.paper.view(a.scope)).account.positions.map((p) => p.closeReason);
  assert.deepEqual(reasons.sort(), ["stop", "take_profit"]);
  assert.equal(await runExits(f.runtime(), AbortSignal.timeout(5000)), 0);

  const c = await f.agent();
  f.prices.BTC = "60000";
  f.board([]);
  f.answer(answer());
  await f.check(c.id);
  f.advance(4 * HOUR);
  assert.equal(await runExits(f.runtime(), AbortSignal.timeout(5000)), 0);
  f.advance(20 * HOUR);
  assert.equal(await runExits(f.runtime(), AbortSignal.timeout(5000)), 1);
  const [timed] = (await f.paper.view(c.scope)).account.positions;
  assert.equal(timed!.closeReason, "time");
  const rows = await f.store.listChecks(c.id, { outcomes: ["exited"] });
  assert.equal(rows.items[0]!.outcomeText, "TIME · LONG BTC");
  assert.equal(rows.items[0]!.trigger, "exits");
});

test("day-loss: an exit past the day-loss stop pauses the agent with a system row", async (t) => {
  const f = await setup(t);
  const { id } = await f.agent();
  await f.check(id);

  f.prices.BTC = "40000";
  f.board([{ network: "testnet", symbol: "BTC", mark: "40000" }]);
  await runExits(f.runtime(), AbortSignal.timeout(5000));

  const paused = await f.db.pool.query("SELECT paused FROM pickler.agents WHERE id='runtime-1'");
  assert.equal(paused.rows[0].paused, true);
  const system = await f.store.listChecks(id, { outcomes: ["system"] });
  assert.equal(system.items[0]!.outcomeText, "Paused itself · day-loss stop");

  f.prices.BTC = "60000";
  const after = await f.check(id);
  assert.equal(after.outcomeText, "PAUSED");
});

test("ceiling and disabled: a refused check never reads Perpl or asks the model", async (t) => {
  const f = await setup(t);
  const { id } = await f.agent();

  const disabled = await f.check(id, { enabled: false, dailyChecks: 500 });
  const ceiling = await f.check(id, { enabled: true, dailyChecks: 1 });

  assert.equal(disabled.outcome, "failed");
  assert.equal(disabled.error, "RUNTIME_DISABLED");
  assert.equal(ceiling.error, "RUNTIME_CEILING");
  assert.deepEqual(f.calls, { model: 0, perpl: 0 });
  const sent: PerpsCheckMessage[] = [];
  await superviseChecks(f.runtime(), { enabled: false, dailyChecks: 500 }, async (m) => {
    sent.push(m);
  });
  assert.equal(
    (
      await dispatchDueChecks(f.runtime(), { enabled: true, dailyChecks: 2 }, async (m) => {
        sent.push(m);
      })
    ).length,
    0,
  );
  assert.deepEqual(sent, []);
});

test("lease conflict: two deliveries run one check; a check that lost its lease never trades", async (t) => {
  const f = await setup(t);
  const { id, scope } = await f.agent();
  const queued = await f.store.startCheck({ productAgentId: id, trigger: "manual" });
  const peer = new PostgresPerpsRuntimeStore(f.db.pool, f.now);

  const claimed = await Promise.all([
    consumePerpsCheck(f.runtime(), queued.id, ON),
    consumePerpsCheck(f.runtime(peer), queued.id, ON),
  ]);

  assert.deepEqual(claimed.sort(), [false, true]);
  assert.equal(f.calls.model, 1);
  assert.equal((await f.store.getCheck(queued.id))!.outcome, "entered");

  const other = await f.agent();
  f.onModel(async () => {
    f.advance(61_000);
  });
  const stalled = await f.check(other.id);
  assert.equal(stalled.status, "running");
  f.onModel(async () => {});
  await f.store.startCheck({ productAgentId: other.id, trigger: "manual" });
  const recovered = (await f.store.getCheck(stalled.id))!;
  assert.equal(recovered.outcome, "failed");
  assert.equal(recovered.error, "CHECK_INTERRUPTED");
  assert.deepEqual(open(await f.paper.view(other.scope)), []);
  assert.equal(open(await f.paper.view(scope)).length, 1);
});

test("the dispatcher queues hourly checks for due agents only", async (t) => {
  const f = await setup(t);
  const hour = Math.floor(Date.now() / HOUR) * HOUR;
  f.set(hour + 7 * 60_000 + 30_000);
  const due = await f.agent({ id: idAt(7) });
  await f.agent({ id: idAt(30) });
  await f.agent({ id: idAt(5), paused: true });
  await f.agent({ id: idAt(6), visibility: "private" });
  const sent: PerpsCheckMessage[] = [];

  const queued = await dispatchDueChecks(f.runtime(), ON, async (m) => {
    sent.push(m);
  });
  const again = await dispatchDueChecks(f.runtime(), ON, async (m) => {
    sent.push(m);
  });

  assert.equal(queued.length, 1);
  assert.deepEqual(again, []);
  assert.deepEqual(sent, [{ kind: "perps-check", checkId: queued[0] }]);
  const check = (await f.store.getCheck(queued[0]!))!;
  assert.equal(check.productAgentId, due.id);
  assert.equal(check.trigger, "hourly");
});

import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CONFIG, PilotError, type AgentRecord } from "@pickler/core";
import {
  PRODUCT_PAPER_SESSION,
  applyPaperFill,
  assertPaperIntent,
  assertPerpsPaperAgent,
  assertPerpsPaperScope,
  createPerpsPaperService,
  initialPaperAccount,
  marginOpenedSince,
  paperOpenReserve,
  paperRisk,
  simulatePerpsFill,
  productFeeReserve,
  type PerpsPaperAttempt,
  type PerpsPaperExits,
  type PerpsPaperFill,
  type PerpsPaperIntent,
  type PerpsPaperRepository,
  type PerpsPaperView,
} from "@pickler/trading/perps";
import { adviceFixture, adviceTime } from "./advice-fixture.js";

const now = adviceTime;
const product = {
  tenantId: "t",
  agentId: "a",
  sessionId: PRODUCT_PAPER_SESSION,
  network: "testnet" as const,
};
const operator = { ...product, sessionId: "operator" };
const open: PerpsPaperIntent = {
  kind: "open",
  symbol: "BTC",
  side: "long",
  notional: "500",
  feeReserve: "1",
  leverage: 5,
  checkId: "d08d112f-c1d1-4130-98cb-8c981883cd09",
};

function agent(version: number): AgentRecord {
  return {
    id: "a",
    tenantId: "t",
    version,
    paused: false,
    scheduleEnabled: false,
    nextDueAt: null,
    config: {
      ...DEFAULT_CONFIG,
      perpl: { version: 1, network: "testnet", markets: ["BTC", "ETH"] },
      perpsPaper: { version: 1, policy: "conservative-1x-v1" },
      plugins: { version: 1, enabled: ["perpl", "perps-paper"] },
    },
  } as AgentRecord;
}

function pending(intent: PerpsPaperIntent, key = "open-btc"): PerpsPaperAttempt {
  return {
    key,
    intent,
    status: "pending",
    reserved: paperOpenReserve(intent),
    createdAt: now,
    finishedAt: null,
    reason: null,
    evidence: null,
  };
}

const fill: PerpsPaperFill = {
  quantity: "0.008",
  price: "60000",
  notional: "480",
  fee: "0.096",
  block: 1,
  timestamp: now,
  mark: { price: "60000", timestamp: now },
  evidence: {},
};

test("product sessions are not pinned to a config version; operator sessions still are", () => {
  assert.doesNotThrow(() => assertPerpsPaperAgent(agent(7), product, 2));
  assert.throws(
    () => assertPerpsPaperAgent(agent(7), operator, 2),
    (error: unknown) => error instanceof PilotError && error.code === "CONFIG_CHANGED",
  );
});

test("a product account starts with the given equity; the operator default stays 1000", () => {
  assert.equal(initialPaperAccount(product, 1, now, "250").cash, "250");
  assert.equal(initialPaperAccount(product, 1, now, "250").peakEquity, "250");
  assert.equal(initialPaperAccount(operator, 1, now).cash, "1000");
});

test("a product open reserves margin (notional / leverage) and is not capped at 100", () => {
  const account = initialPaperAccount(product, 1, now, "250");

  const risk = paperRisk(account, [], now, open);

  assert.equal(paperOpenReserve(open), "101");
  assert.equal(risk.allowed, true, risk.reasons.join(","));

  const tooBig = paperRisk(account, [], now, { ...open, notional: "1500" });
  assert.deepEqual(tooBig.reasons, ["INSUFFICIENT_AVAILABLE"]);
});

test("operator sessions keep the 100 notional cap and refuse leverage", () => {
  const account = initialPaperAccount(operator, 1, now);

  const risk = paperRisk(account, [], now, { ...open, notional: "500", leverage: 5 });

  assert.ok(risk.reasons.includes("OPEN_NOTIONAL_LIMIT"));
  assert.ok(risk.reasons.includes("LEVERAGE_NOT_ALLOWED"));
  assert.equal(paperOpenReserve({ ...open, notional: "100", leverage: undefined }), "101");
});

test("a product fill records leverage, margin and its check; margin counts at the position's margin", () => {
  const account = initialPaperAccount(product, 1, now, "250");

  const result = applyPaperFill(account, pending(open), fill, now);
  const position = result.account.positions[0]!;

  assert.equal(position.leverage, 5);
  assert.equal(position.margin, "96");
  assert.equal(position.checkId, open.checkId);

  const risk = paperRisk(result.account, [], now);
  assert.equal(risk.margin, "96");
  assert.deepEqual(risk.closeSymbols, []);
});

test("product admission ignores stale marks, the day baseline and the conservative stops", () => {
  const account = initialPaperAccount(product, 1, now - 86400000 * 2, "250");
  const opened = applyPaperFill(account, pending(open), fill, now).account;
  opened.positions[0]!.markAt = now - 3600000;
  opened.positions[0]!.mark = "50000";
  opened.positions[0]!.openedAt = now - 5 * 3600000;

  const risk = paperRisk(opened, [], now, { ...open, symbol: "ETH", notional: "100" });

  assert.equal(risk.allowed, true, risk.reasons.join(","));
  assert.deepEqual(risk.closeSymbols, []);
});

test("an operator fill document keeps its historical shape", () => {
  const account = initialPaperAccount(operator, 1, now);
  const intent = { ...open, notional: "100", leverage: undefined, checkId: undefined };

  const result = applyPaperFill(
    account,
    pending(intent),
    { ...fill, quantity: "0.0016", notional: "96" },
    now,
  );

  assert.equal("leverage" in result.account.positions[0]!, false);
  assert.equal("margin" in result.account.positions[0]!, false);
});

test("the service opens at the notional it is given and hands the exits to complete", async () => {
  const { evidence } = adviceFixture(now);
  const view: PerpsPaperView = {
    account: initialPaperAccount(product, 1, now, "250"),
    attempts: [],
    movements: [],
  };
  const begun: PerpsPaperIntent[] = [];
  const completed: (PerpsPaperExits | undefined)[] = [];
  const repository: PerpsPaperRepository = {
    closeAdmissions: async () => {},
    observed: async () => false,
    observe: async () => view,
    initialize: async () => view,
    view: async () => view,
    begin: async (_scope, _version, key, intent) => {
      begun.push(intent);
      return { attempt: pending(intent, key), lease: { key, owner: "o", expiresAt: now + 1 } };
    },
    assertLease: async () => {},
    complete: async (_scope, _lease, _fill, exits) => {
      completed.push(exits);
      return view;
    },
    fail: async () => {},
  };
  const service = createPerpsPaperService(
    repository,
    { observation: async () => ({ frames: [], funding: [] }), frame: async () => evidence.frame },
    () => now,
  );

  await service.trade(
    product,
    "open-btc",
    "open",
    "BTC",
    "long",
    AbortSignal.timeout(1000),
    evidence.frame,
    {
      notional: "500",
      leverage: 5,
      checkId: open.checkId,
      exits: (f) => ({ stopPrice: f.price, takeProfitPrice: null, exitDueAt: now + 3600000 }),
    },
  );
  await service.trade(product, "open-eth", "open", "BTC", "long", AbortSignal.timeout(1000));

  assert.equal(begun[0]!.notional, "500");
  assert.equal(begun[0]!.leverage, 5);
  assert.equal(begun[0]!.checkId, open.checkId);
  assert.equal(completed[0]!.exitDueAt, now + 3600000);
  assert.ok(completed[0]!.stopPrice);
  assert.equal(begun[0]!.feeReserve, "0.15");
  assert.equal(begun[1]!.feeReserve, "0.15");
  assert.equal(begun[1]!.notional, "100");
  assert.equal("leverage" in begun[1]!, false);
  assert.equal(completed[1], undefined);
});

test("closes check only the scope: the agent's plugins, policy and network do not matter", () => {
  const edited = agent(9);
  edited.config = { ...edited.config, perpl: { version: 1, network: "mainnet", markets: [] } };
  edited.config.plugins = { version: 1, enabled: [] };

  assert.doesNotThrow(() => assertPerpsPaperScope(edited, product));
  assert.throws(() => assertPerpsPaperAgent(edited, product, 9), { code: "PLUGIN_DISABLED" });
  assert.throws(() => assertPerpsPaperScope(edited, { ...product, agentId: "b" }), {
    code: "FORBIDDEN",
  });
});

test("intents take leverage up to core's 10 and a UUID check id", () => {
  assert.doesNotThrow(() => assertPaperIntent({ ...open, leverage: 10 }));
  assert.throws(() => assertPaperIntent({ ...open, leverage: 11 }), { code: "INVALID_INPUT" });
  assert.throws(() => assertPaperIntent({ ...open, leverage: 100 }), { code: "INVALID_INPUT" });
  assert.throws(() => assertPaperIntent({ ...open, checkId: "check-1" }), {
    code: "INVALID_INPUT",
  });
  assert.throws(() => assertPaperIntent({ ...open, checkId: open.checkId!.toUpperCase() }), {
    code: "INVALID_INPUT",
  });
});

test("a product fee reserve scales with notional × taker fee × 1.5, past the old 10 AUSD", () => {
  assert.equal(productFeeReserve("500", "0.0002"), "0.15");
  assert.equal(productFeeReserve("10000", "0.0002"), "3");
  assert.equal(productFeeReserve("100000", "0.001"), "150");
  assert.equal(productFeeReserve("0.000001", "0.0002"), "0.000001");
  assert.equal(productFeeReserve("100", "0"), "0");

  // Up to 10 AUSD or 1% of the notional, whichever is larger.
  assert.doesNotThrow(() => assertPaperIntent({ ...open, notional: "100000", feeReserve: "150" }));
  assert.doesNotThrow(() => assertPaperIntent({ ...open, notional: "100", feeReserve: "10" }));
  assert.throws(() => assertPaperIntent({ ...open, notional: "1000", feeReserve: "10.5" }), {
    code: "INVALID_INPUT",
  });
});

test("a large product open fills when its fee fits the scaled reserve", () => {
  const account = initialPaperAccount(product, 1, now, "5000");
  const big = {
    ...open,
    notional: "20000",
    leverage: 10,
    feeReserve: productFeeReserve("20000", "0.0002"),
  };
  const bigFill = { ...fill, quantity: "0.33", notional: "19800", fee: "3.96" };

  assert.equal(big.feeReserve, "6");
  assert.equal(applyPaperFill(account, pending(big), bigFill, now).account.positions.length, 1);
  assert.throws(() => applyPaperFill(account, pending({ ...big, feeReserve: "1" }), bigFill, now), {
    code: "INVALID_FILL",
  });
});

test("marginOpenedSince counts positions opened since, and each size-up on its own day", () => {
  const day = Date.UTC(2026, 9, 3);
  const base = {
    symbol: "BTC" as const,
    side: "long" as const,
    quantity: "0.001",
    entryPrice: "60000",
    entryBlock: 1,
    mark: null,
    markAt: null,
    closedAt: null,
    exitPrice: null,
    exitBlock: null,
  };
  const positions = [
    // Opened yesterday with 10 AUSD, sized up by 4 today: only the 4 is today's.
    {
      ...base,
      id: "old",
      entryNotional: "28",
      margin: "14",
      openedAt: day - 3_600_000,
      sizeUps: [{ at: day + 60_000, margin: "4" }],
    },
    {
      ...base,
      id: "new",
      symbol: "ETH" as const,
      entryNotional: "20",
      margin: "10",
      openedAt: day + 1,
    },
  ];

  assert.equal(marginOpenedSince(positions, day), "14");
  assert.equal(marginOpenedSince(positions, day - 86_400_000), "24");
  assert.equal(marginOpenedSince(positions, day + 120_000), "0");
});

test("dynamic product fills retain identity, use unchanged exact math, and close closed markets", () => {
  const frame = adviceFixture().evidence.frame;
  frame.snapshot.market.symbol = "SOL";
  frame.snapshot.market.marketId = 27;
  frame.snapshot.market.perpetualId = 127;
  const account = initialPaperAccount(product, 1, now, "100");
  const intent = { ...open, symbol: "SOL", notional: "500" };
  const actual = simulatePerpsFill(account, intent, frame, now);
  // Five decimal places are not assumed: the fixture's four-place size step is authoritative.
  assert.equal(actual.quantity, "0.0082");
  assert.equal(actual.notional, "492.0082");
  assert.equal(actual.fee, "0.098402");
  assert.equal(actual.market!.marketId, 27);
  const applied = applyPaperFill(account, pending(intent, "sol-open"), actual, now);
  assert.equal(applied.account.positions[0]!.market!.perpetualId, 127);
  frame.snapshot.market.open = false;
  const close = {
    kind: "close" as const,
    symbol: "SOL",
    side: "long" as const,
    notional: "500",
    feeReserve: "1",
  };
  const closing = simulatePerpsFill(applied.account, close, frame, now);
  const closed = applyPaperFill(applied.account, pending(close, "sol-close"), closing, now);
  assert.ok(closed.account.positions[0]!.closedAt !== null);
  assert.throws(() => simulatePerpsFill(account, intent, frame, now), {
    code: "INVALID_MARKET_DATA",
  });
  const wrong = structuredClone(frame);
  wrong.snapshot.market.marketId = 999;
  wrong.book.market.marketId = 999;
  assert.throws(() => simulatePerpsFill(applied.account, close, wrong, now), {
    code: "PERPL_MARKET_IDENTITY",
  });
});

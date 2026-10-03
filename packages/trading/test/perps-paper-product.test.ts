import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CONFIG, PilotError, type AgentRecord } from "@pickler/core";
import {
  PRODUCT_PAPER_SESSION,
  applyPaperFill,
  assertPerpsPaperAgent,
  createPerpsPaperService,
  initialPaperAccount,
  paperOpenReserve,
  paperRisk,
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
  assert.equal(begun[1]!.notional, "100");
  assert.equal("leverage" in begun[1]!, false);
  assert.equal(completed[1], undefined);
});

import test from "node:test";
import assert from "node:assert/strict";
import {
  initialPaperAccount,
  simulatePerpsFill,
  applyPaperFill,
  applyPaperObservation,
  paperRisk,
  type PerpsPaperAccount,
  type PerpsPaperFrame,
  type PerpsPaperAttempt,
} from "../src/perps.js";
import {
  ptsSize,
  ptsManagement,
  ptsQuantityAtBlock,
  ptsPartialSchedule,
  PTS_ACCOUNT_POLICY,
  recoveryPrice,
  units,
} from "../src/pts.js";
import { adviceFixture } from "./advice-fixture.js";
import { ptsSetup, ptsTime } from "./pts-fixture.js";
function account(): PerpsPaperAccount {
  const a = initialPaperAccount(
    { tenantId: "fixture", agentId: "pts", sessionId: "pts-fixture", network: "testnet" },
    1,
    ptsTime,
  );
  a.positionPolicy = PTS_ACCOUNT_POLICY;
  a.consumedPtsSetups = [];
  a.riskManagement = "buffered-selective-1x-v1";
  return a;
}
function frame(price: string, at: number, block: number): PerpsPaperFrame {
  const f = structuredClone(adviceFixture(at).evidence.frame);
  Object.assign(f.snapshot.ticker, {
    mark: price,
    index: price,
    last: price,
    bid: price,
    ask: price,
  });
  f.book.bids = [{ price, size: "100", orders: 1 }];
  f.book.asks = [{ price, size: "100", orders: 1 }];
  f.snapshot.ticker.provenance.block = block;
  f.book.provenance.block = block;
  return f;
}
function attempt(key: string, intent: PerpsPaperAttempt["intent"], at: number): PerpsPaperAttempt {
  return {
    key,
    intent,
    status: "pending",
    reserved: intent.kind === "open" ? "101" : "0",
    createdAt: at,
    finishedAt: null,
    reason: null,
    evidence: null,
  };
}
export function controlledPtsFinance(short = false) {
  const setup = ptsSetup(short),
    start = ptsTime,
    entry = recoveryPrice(setup.c.price, setup.b.price, "0.40");
  let a = account();
  const size = ptsSize(a, setup, entry, "0.0002", "1000", 4)!;
  const open = attempt(
    "open",
    {
      kind: "open",
      symbol: "BTC",
      side: setup.direction,
      notional: "100",
      feeReserve: "1",
      pts: { version: "0.2.0", setup, quantity: size.quantity },
    },
    start,
  );
  const fill = simulatePerpsFill(a, open.intent, frame(entry, start, 100), start);
  let result = applyPaperFill(a, open, fill, start);
  a = result.account;
  const movements = [...result.movements],
    actions: unknown[] = [{ action: "open", fill }];
  const initial = a.positions[0]!.quantity;
  for (const [i, ratio] of ["0.61", "0.78", "1"].entries()) {
    const now = start + (i + 1) * 60000,
      f = frame(recoveryPrice(setup.c.price, setup.b.price, ratio), now, 101 + i);
    a = applyPaperObservation(
      a,
      movements,
      { frames: [f], funding: [], marksOnly: true },
      "mark-" + i,
      now,
    ).account;
    const decision = ptsManagement(a.positions[0]!, f.snapshot.ticker.mark, now);
    assert.equal(decision.reason, "PTS_TARGET");
    const close = attempt(
      "target-" + i,
      {
        kind: "close",
        symbol: "BTC",
        side: setup.direction,
        notional: "0",
        feeReserve: "1",
        pts: {
          version: "0.2.0",
          quantity: decision.quantity!,
          targets: decision.targets,
          reason: decision.reason,
        },
      },
      now,
    );
    result = applyPaperFill(a, close, simulatePerpsFill(a, close.intent, f, now), now);
    a = result.account;
    movements.push(...result.movements);
    actions.push({ action: "close", decision, fill: a.positions[0]!.pts!.reductions.at(-1) });
  }
  return { account: a, initial, movements, actions, setup };
}
test("real simulator closes 20/20/remainder with proportional basis and immutable setup consumption", () => {
  for (const short of [false, true]) {
    const { account: a, initial, setup } = controlledPtsFinance(short),
      p = a.positions[0]!;
    assert.equal(p.quantity, "0");
    assert.equal(p.entryNotional, "0");
    assert.ok(p.closedAt);
    assert.deepEqual(p.pts!.consumedTargets, [1, 2, 3]);
    assert.deepEqual(
      p.pts!.reductions.map((r) => r.quantity),
      ptsPartialSchedule(initial, p.market!.sizeDecimals),
    );
    assert.equal(
      p.pts!.reductions.reduce((n, r) => n + units(r.costBasis), 0n),
      units(p.pts!.initialNotional),
    );
    assert.deepEqual(a.consumedPtsSetups, [setup.id]);
    assert.equal(p.pts!.stop, p.entryPrice);
    assert.equal(p.pts!.initialStop, setup.initialStop);
  }
});
test("funding quantity follows native block convention including late reconciliation after final close", () => {
  const { account: a, initial, movements } = controlledPtsFinance(),
    p = a.positions[0]!,
    end = ptsTime + 180000;
  assert.equal(ptsQuantityAtBlock(p, 101), initial);
  assert.equal(
    ptsQuantityAtBlock(p, 102),
    String(Number(initial) - Number(p.pts!.reductions[0]!.quantity)),
  );
  assert.equal(ptsQuantityAtBlock(p, 104), "0");
  const market = frame("140", end, 103).snapshot.market;
  const history = {
    market,
    from: ptsTime - 1000,
    to: end,
    complete: true,
    pages: [market.provenance],
    provenance: market.provenance,
    events: [101, 102, 103].map((eventBlock) => ({
      eventBlock,
      appliesAt: end,
      rate: "0.001",
      index: "140",
      estimated: false,
      provenance: { ...market.provenance, block: eventBlock },
    })),
  };
  const result = applyPaperObservation(
    a,
    movements,
    { frames: [], funding: [history] },
    "funding",
    end,
  );
  assert.equal(result.account.fundingPending, false);
  assert.equal(result.movements.length, 3);
  assert.ok(result.movements.every((m) => units(m.delta) < 0n));
  const duplicate = applyPaperObservation(
    result.account,
    [...movements, ...result.movements],
    { frames: [], funding: [history] },
    "duplicate",
    end,
  );
  assert.equal(duplicate.movements.length, 0);
  const missing = applyPaperObservation(a, movements, { frames: [], funding: [] }, "missing", end);
  assert.equal(missing.account.fundingPending, true);
});
test("stops and expiry precede targets, target gaps combine quantities, rejected schedules do not open", () => {
  const setup = ptsSetup(),
    a = account(),
    entry = recoveryPrice(setup.c.price, setup.b.price, "0.40");
  const size = ptsSize(a, setup, entry, "0.0002", "1000", 4)!;
  const open = attempt(
    "setup",
    {
      kind: "open",
      symbol: "BTC",
      side: "long",
      notional: "100",
      feeReserve: "1",
      pts: { version: "0.2.0", setup, quantity: size.quantity },
    },
    ptsTime,
  );
  const filled = applyPaperFill(
    a,
    open,
    simulatePerpsFill(a, open.intent, frame(entry, ptsTime, 100), ptsTime),
    ptsTime,
  ).account;
  const p = filled.positions[0]!;
  assert.deepEqual(
    ptsManagement(p, recoveryPrice(setup.c.price, setup.b.price, "0.80"), ptsTime).targets,
    [1, 2],
  );
  assert.equal(ptsManagement(p, setup.initialStop, ptsTime).reason, "PTS_STOP");
  assert.equal(ptsManagement(p, "200", ptsTime + 7 * 86400000).reason, "PTS_MAX_DURATION");
  assert.throws(() => ptsPartialSchedule("0.0004", 4), { code: "PTS_PARTIAL_NOT_EXECUTABLE" });
  const original = structuredClone(filled);
  delete original.positionPolicy;
  const partial = attempt(
    "bad",
    {
      kind: "close",
      symbol: "BTC",
      side: "long",
      notional: "0",
      feeReserve: "1",
      pts: { version: "0.2.0", quantity: "0.1" },
    },
    ptsTime,
  );
  assert.throws(
    () => simulatePerpsFill(original, partial.intent, frame(entry, ptsTime, 101), ptsTime),
    { code: "INVALID_INPUT" },
  );
  assert.equal(paperRisk(filled, [], ptsTime).closeSymbols.length, 0);
});

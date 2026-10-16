import test from "node:test";
import assert from "node:assert/strict";
import {
  BREAKOUT_NAMESPACE,
  BREAKOUT_PARAMETER_CONTRACT_SHA256,
  assertHourlyBreakoutConfig,
  assertBreakoutAcceptance,
  assertBreakoutHead,
  breakoutAccountNamespace,
  breakoutCloseFenced,
  breakoutCompletionAttempts,
  breakoutEntryBoundary,
  breakoutHash,
  breakoutWindowTimes,
  canonicalBreakoutJson,
  detectBreakoutCloses,
  hourlyBreakoutSignal,
  planBreakoutDiscoveries,
  planBreakoutSmaDiscoveries,
  breakoutSmaProposals,
  perpsStrategies,
  perpsCallCost,
  type BreakoutReservedHead,
  type BreakoutSignal,
} from "../src/evaluation.js";
import { paperRisk, applyPaperFill, simulatePerpsFill } from "../src/perps.js";
import {
  breakoutAcceptance,
  breakoutConfig,
  breakoutDigest,
  breakoutFrame,
  breakoutInitial,
  breakoutSnapshot,
  breakoutT0,
  breakoutWindow,
} from "./hourly-breakout-fixture.js";

test("v10 is disabled and reuses the exact canonical reviewed T1 namespace", () => {
  assert.equal(
    breakoutDigest(canonicalBreakoutJson(BREAKOUT_NAMESPACE)),
    BREAKOUT_PARAMETER_CONTRACT_SHA256,
  );
  assert.equal(Object.isFrozen(BREAKOUT_NAMESPACE), true);
  assert.equal(Object.isFrozen(BREAKOUT_NAMESPACE.cohort[0]), true);
  assert.equal(canonicalBreakoutJson({ z: "é", a: [2, 1] }), '{"a":[2,1],"z":"\\u00e9"}');
  const config = breakoutConfig();
  assertHourlyBreakoutConfig(config);
  assert.deepEqual(perpsStrategies(config), ["hourly-breakout", "sma-reference", "hourly-long"]);
  assert.throws(() => perpsCallCost(config, "jev", 1, 1), { code: "MODELS_DISABLED" });
  for (const patch of [
    { T0: breakoutT0 },
    { enabled: true },
    { financiallyExecutable: true },
    { operator: "unapproved" },
    { agentId: "" },
    { network: "testnet" },
    { extraGate: true },
  ]) {
    assert.throws(() => assertHourlyBreakoutConfig({ ...config, ...patch } as typeof config));
  }
  const accepted = breakoutAcceptance();
  assertBreakoutAcceptance(accepted, breakoutT0);
  assert.throws(() => assertBreakoutAcceptance({ ...accepted, T0: breakoutT0 + 1 }, breakoutT0));
  assert.notEqual(
    breakoutAccountNamespace(accepted, "C", breakoutDigest),
    breakoutAccountNamespace(accepted, "S", breakoutDigest),
  );
  assert.deepEqual(breakoutWindowTimes(breakoutT0), {
    T0: breakoutT0,
    TA: breakoutT0 + 28 * 86400000,
    TV: breakoutT0 + 28 * 86400000 + 4 * 3600000,
    TF: breakoutT0 + 28 * 86400000 + 76 * 3600000,
  });
});

test("exact current/prior raw20 flags exclude own extremes, require known predecessor, and preserve strict equality", () => {
  const window = breakoutWindow();
  const result = hourlyBreakoutSignal(window, breakoutDigest) as BreakoutSignal;
  assert.equal(result.raw, "LONG");
  assert.equal(result.previousRaw, "NONE");
  assert.equal(result.fresh, true);
  assert.equal(result.upper20, "100");
  assert.equal(
    result.episodeKey,
    breakoutHash(
      [BREAKOUT_PARAMETER_CONTRACT_SHA256, "mainnet", 1, "long", breakoutT0],
      breakoutDigest,
    ),
  );
  assert.equal(
    result.attemptId,
    `${breakoutHash([result.episodeKey, "allocation-v1"], breakoutDigest)}:open`,
  );

  const equality = structuredClone(window);
  equality.bars[21]!.candle.close = "100";
  assert.equal((hourlyBreakoutSignal(equality, breakoutDigest) as BreakoutSignal).raw, "NONE");
  const short = structuredClone(window);
  Object.assign(short.bars[21]!.candle, { close: "97", high: "99", low: "96" });
  assert.equal((hourlyBreakoutSignal(short, breakoutDigest) as BreakoutSignal).raw, "SHORT");
  const continuing = structuredClone(window);
  Object.assign(continuing.bars[20]!.candle, { close: "101", high: "102" });
  Object.assign(continuing.bars[21]!.candle, { close: "103", high: "104" });
  assert.equal((hourlyBreakoutSignal(continuing, breakoutDigest) as BreakoutSignal).fresh, false);
  const fine = structuredClone(window);
  fine.bars[21]!.candle.close = "100.000000000000000000001";
  assert.equal((hourlyBreakoutSignal(fine, breakoutDigest) as BreakoutSignal).raw, "LONG");
  for (const mutate of [
    (w: typeof window) => {
      w.bars = w.bars.slice(1);
    },
    (w: typeof window) => {
      w.bars[0]!.candle.openTime += 1;
    },
    (w: typeof window) => {
      w.bars[0]!.provenance.firstReceiptAt = w.D + 1;
    },
    (w: typeof window) => {
      w.bars[0]!.provenance.sourceRecordId = "";
    },
    (w: typeof window) => {
      w.bars[0]!.candle.low = "101";
    },
    (w: typeof window) => {
      w.bars[0]!.candle.closed = false;
    },
    (w: typeof window) => {
      w.H += 3600000;
    },
  ]) {
    const invalid = structuredClone(window);
    mutate(invalid);
    assert.equal(hourlyBreakoutSignal(invalid, breakoutDigest).status, "UNAVAILABLE");
  }
  const changed = structuredClone(window);
  changed.bars[0]!.candle.trades++;
  assert.notEqual(
    (hourlyBreakoutSignal(changed, breakoutDigest) as BreakoutSignal).windowDigest,
    result.windowDigest,
  );
});

test("all known episodes consume in numeric rank independent of books and held positions; later readiness cannot rescue", () => {
  const initial = breakoutInitial(breakoutT0, [110, 20, 1]);
  initial.markets[2]!.financialReady = false;
  initial.markets[2]!.frame = null;
  const snapshot = breakoutSnapshot();
  const rows = planBreakoutDiscoveries({
    role: "C",
    initialOperationId: initial.operationId,
    finalOperationId: "final",
    H: breakoutT0,
    D: initial.D,
    markets: initial.markets,
    snapshot,
    digest: breakoutDigest,
  });
  assert.deepEqual(
    rows.map((r) => r.marketId),
    [1, 20, 110],
  );
  assert.deepEqual(
    rows.map((r) => r.rank),
    [1, 2, 3],
  );
  assert.equal(rows[0]!.state, "INITIAL_BLOCKED");
  assert.ok(rows.every((r) => r.reserved === "0"));
  snapshot.discoveries = rows;
  const repaired = breakoutInitial(breakoutT0, [1, 20, 110]);
  assert.deepEqual(
    planBreakoutDiscoveries({
      role: "C",
      initialOperationId: initial.operationId,
      finalOperationId: "new-final",
      H: breakoutT0,
      D: initial.D,
      markets: repaired.markets,
      snapshot,
      digest: breakoutDigest,
    }),
    [],
  );
  assert.throws(() =>
    planBreakoutDiscoveries({
      role: "C",
      initialOperationId: initial.operationId,
      finalOperationId: "final",
      H: breakoutT0,
      D: initial.D,
      markets: [initial.markets[0]!, initial.markets[0]!],
      snapshot,
      digest: breakoutDigest,
    }),
  );
});

test("native original head accepts a back-inside fill, rejects ancillary revision, and never hides another pending attempt", () => {
  const initial = breakoutInitial(breakoutT0, [1]);
  const snapshot = breakoutSnapshot();
  const discovery = planBreakoutDiscoveries({
    role: "C",
    initialOperationId: initial.operationId,
    finalOperationId: "final",
    H: breakoutT0,
    D: initial.D,
    markets: initial.markets,
    snapshot,
    digest: breakoutDigest,
  })[0]!;
  const account = snapshot.accounts[0]!.view.account;
  const attempt = {
    key: discovery.attemptId,
    intent: {
      kind: "open" as const,
      symbol: "BTC",
      side: "long" as const,
      notional: "100",
      feeReserve: "1",
    },
    status: "pending" as const,
    reserved: "101",
    createdAt: initial.D,
    finishedAt: null,
    reason: null,
    evidence: null,
  };
  const head: BreakoutReservedHead = {
    discovery,
    attempt,
    lease: { key: attempt.key, owner: "controlled-owner", expiresAt: initial.D + 60_000 },
  };
  const at = initial.D + 1000;
  const frame = breakoutFrame(1, at);
  frame.book.asks[0]!.price = "99.9";
  frame.book.bids[0]!.price = "99.8";
  frame.snapshot.ticker.bid = "99.8";
  frame.snapshot.ticker.ask = "99.9";
  const finalSet = {
    operationId: "final",
    H: breakoutT0,
    initialOperationId: initial.operationId,
    financialAt: at,
    receiptAt: at,
    sourceDeadlineAt: at + 20_000,
    frames: [frame],
    windows: [initial.markets[0]!.window!],
    observation: { frames: [frame], funding: [], marksOnly: true },
  };
  Object.assign(finalSet, {
    smaEvidence: { ...initial.smaEvidence, frames: [frame], observedAt: at },
  });
  const input = {
    account,
    attempts: [attempt],
    head,
    authoritativeLease: head.lease,
    finalSet,
    financialAt: at,
    receiptAt: at,
    digest: breakoutDigest,
  };
  const admitted = assertBreakoutHead(input);
  assert.equal(
    breakoutEntryBoundary(
      hourlyBreakoutSignal(initial.markets[0]!.window!, breakoutDigest) as BreakoutSignal,
      admitted.fill,
    ),
    "BACK_INSIDE_U20",
  );
  assert.equal(account.positions.length, 0);
  const foreign = { ...attempt, key: "foreign-original" };
  assert.equal(
    paperRisk(
      account,
      breakoutCompletionAttempts([attempt, foreign], head, head.lease),
      at,
      attempt.intent,
    ).allowed,
    false,
  );
  assert.throws(() => assertBreakoutHead({ ...input, attempts: [attempt, foreign] }), {
    code: "RISK_REJECTED",
  });
  const changed = structuredClone(finalSet);
  changed.windows[0]!.bars[0]!.candle.volumeCollateral = "1001";
  assert.throws(() => assertBreakoutHead({ ...input, finalSet: changed }), {
    code: "FINAL_SIGNAL_INPUT_REJECTED",
  });
  assert.throws(() => assertBreakoutHead({ ...input, financialAt: breakoutT0 + 300000 }), {
    code: "BREAKOUT_FINAL_WINDOW_REJECTED",
  });
  assert.throws(() => assertBreakoutHead({ ...input, unknownBarrier: true }), {
    code: "RISK_REJECTED",
  });
});

test("full close detector retains all coincident stop/age/channel/emergency/terminal reasons while pending", () => {
  const snapshot = breakoutSnapshot();
  const account = snapshot.accounts[0]!.view.account;
  const at = breakoutT0 + 1000;
  const frame = breakoutFrame(1, at);
  const intent = {
    kind: "open" as const,
    symbol: "BTC",
    side: "long" as const,
    notional: "100",
    feeReserve: "1",
  };
  const attempt = {
    key: "original-position",
    intent,
    status: "pending" as const,
    reserved: "101",
    createdAt: at,
    finishedAt: null,
    reason: null,
    evidence: null,
  };
  const opened = applyPaperFill(
    account,
    attempt,
    simulatePerpsFill(account, intent, frame, at),
    at,
  ).account;
  opened.positions[0]!.openedAt = at - 4 * 3600000;
  opened.positions[0]!.mark = "97";
  opened.cash = "940";
  opened.blocked = true;
  const window = breakoutWindow();
  Object.assign(window.bars[21]!.candle, { close: "97", low: "96", high: "99" });
  const obligations = detectBreakoutCloses({
    role: "C",
    account: opened,
    attempts: [{ ...attempt, key: "other" }],
    frames: [frame],
    at,
    operationId: "minute-original",
    digest: breakoutDigest,
    terminal: true,
    signals: [{ symbol: "BTC", signal: hourlyBreakoutSignal(window, breakoutDigest) }],
  });
  assert.equal(obligations.length, 1);
  assert.equal(obligations[0]!.state, "BLOCKED_PENDING");
  for (const reason of [
    "STOP_2_PERCENT",
    "AGE_4_HOURS",
    "CHANNEL_10",
    "DAILY_LOSS",
    "PEAK_DRAWDOWN",
    "BLOCKED",
    "TERMINAL",
  ]) {
    assert.ok(obligations[0]!.reasons.includes(reason as never));
  }
  snapshot.closeObligations = obligations;
  assert.equal(breakoutCloseFenced(snapshot, "C", "BTC", at), true);
  snapshot.closeObligations = [];
  snapshot.closedFences = [
    { role: "C", symbol: "BTC", originatingAt: breakoutT0 - 1, confirmedAt: breakoutT0 + 1 },
  ];
  assert.equal(breakoutCloseFenced(snapshot, "C", "BTC", breakoutT0 + 299999), true);
});

test("S preserves every five-minute decision, native separation rank, preparation and final-direction gates", () => {
  const initial = breakoutInitial();
  const at = breakoutT0 + 301000;
  initial.scheduledAt = breakoutT0 + 300000;
  initial.D = at;
  initial.financialAt = at;
  initial.receiptAt = at;
  initial.sourceDeadlineAt = at + 20000;
  initial.smaEvidence.observedAt = at;
  initial.smaEvidence.frames = [breakoutFrame(1, at), breakoutFrame(20, at)];
  for (const series of initial.smaEvidence.candles) {
    if (series.resolution === 300) {
      for (const bar of series.candles) {
        bar.openTime += 300000;
      }
    }
    if (series.resolution === 3600) {
      for (const bar of series.candles.slice(-20)) {
        Object.assign(bar, { open: "110", high: "111", low: "109", close: "110" });
      }
    }
  }
  const snapshot = breakoutSnapshot();
  const account = snapshot.accounts[1]!.view.account;
  const context = { account, evidence: initial.smaEvidence };
  const rows = planBreakoutSmaDiscoveries({
    config: breakoutConfig(),
    context,
    snapshot,
    initialOperationId: initial.operationId,
    finalOperationId: "five-minute-final",
    digest: breakoutDigest,
  });
  assert.deepEqual(
    rows.map((r) => [r.symbol, r.rank]),
    [
      ["BTC", 1],
      ["ETH", 2],
    ],
  );
  const discovery = rows[0]!;
  const attempt = {
    key: discovery.attemptId,
    intent: {
      kind: "open" as const,
      symbol: "BTC",
      side: "long" as const,
      notional: "100",
      feeReserve: "1",
    },
    status: "pending" as const,
    reserved: "101",
    createdAt: at,
    finishedAt: null,
    reason: null,
    evidence: null,
  };
  const head = {
    discovery,
    attempt,
    lease: { key: attempt.key, owner: "controlled-S-owner", expiresAt: at + 60000 },
  };
  const final = {
    operationId: "five-minute-final",
    H: breakoutT0,
    initialOperationId: initial.operationId,
    financialAt: at,
    receiptAt: at,
    sourceDeadlineAt: at + 20000,
    frames: initial.smaEvidence.frames,
    windows: [],
    observation: { frames: initial.smaEvidence.frames, funding: [], marksOnly: true },
    smaEvidence: initial.smaEvidence,
  };
  const input = {
    account,
    attempts: [attempt],
    head,
    authoritativeLease: head.lease,
    finalSet: final,
    financialAt: at,
    receiptAt: at,
    digest: breakoutDigest,
    config: breakoutConfig(),
  };
  assert.doesNotThrow(() => assertBreakoutHead(input));
  const changed = structuredClone(final);
  for (const bar of changed.smaEvidence.candles
    .find((c) => c.market.symbol === "BTC" && c.resolution === 3600)!
    .candles.slice(-20)) {
    Object.assign(bar, { open: "90", high: "91", low: "89", close: "90" });
  }
  assert.throws(() => assertBreakoutHead({ ...input, finalSet: changed }), {
    code: "SMA_FINAL_GATE_CHANGED",
  });
  const missingNative = structuredClone(initial.smaEvidence);
  missingNative.candles = missingNative.candles.filter(
    (c) => !(c.market.symbol === "BTC" && c.resolution === 900),
  );
  assert.equal(
    breakoutSmaProposals({ account, evidence: missingNative }, breakoutConfig()).find(
      (p) => p.symbol === "BTC",
    )!.action,
    "hold",
  );
  const neutral = breakoutInitial();
  assert.deepEqual(
    planBreakoutSmaDiscoveries({
      config: breakoutConfig(),
      context: { account, evidence: neutral.smaEvidence },
      snapshot,
      initialOperationId: "neutral-original",
      finalOperationId: "neutral-final",
      digest: breakoutDigest,
    }),
    [],
  );
});

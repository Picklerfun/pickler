import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  COMPONENT_PAPER_POLICY,
  PerpsFrameValidationFailure,
  initialPaperAccount,
  simulatePerpsFill,
  applyPaperFill,
  applyPaperObservation,
  paperRisk,
  validatePaperFrame,
  validatePaperFrameSet,
  validateUniverseStream,
  type PerpsPaperIntent,
} from "../src/perps.js";
import { adviceFixture } from "./advice-fixture.js";

const now = 1800000000000;
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
function frame(tickerAge = 20000, bookAge = 0) {
  const source = structuredClone(adviceFixture(now).evidence.frame);
  source.snapshot.ticker.provenance = {
    ...source.snapshot.ticker.provenance,
    providerTimestamp: now - tickerAge,
  };
  source.book.provenance = { ...source.book.provenance, providerTimestamp: now - bookAge };
  const result = validateUniverseStream({
    network: "testnet",
    markets: [{ symbol: "BTC", marketId: 1 }],
    now,
    policy: COMPONENT_PAPER_POLICY,
    hash,
    buffer: {
      generation: 1,
      observedAt: now,
      continuity: { heartbeatSequence: 20, headBlock: 100, heartbeatReceivedAt: now },
      components: [{ symbol: "BTC", snapshot: source.snapshot, book: source.book }],
    },
  });
  return result.frames[0]!;
}
function account() {
  const result = initialPaperAccount(
    { tenantId: "fixture", agentId: "paper", sessionId: "paper", network: "testnet" },
    1,
    now,
  );
  result.marketDataPolicy = COMPONENT_PAPER_POLICY;
  return result;
}
const attempt = (intent: PerpsPaperIntent, key: string) => ({
  key,
  intent,
  status: "pending" as const,
  reserved: "101",
  createdAt: now,
  finishedAt: null,
  reason: null,
  evidence: null,
});

test("explicit account policy allows independently fresh components while legacy remains strict", () => {
  const value = frame();
  assert.equal(value.snapshot.ticker.provenance.providerTimestamp, now - 20000);
  validatePaperFrame(value, "testnet", "BTC", now, COMPONENT_PAPER_POLICY);
  assert.throws(() => validatePaperFrame(value, "testnet", "BTC", now), {
    code: "INCONSISTENT_MARKET_DATA",
  });
  const legacy = account();
  delete legacy.marketDataPolicy;
  assert.throws(
    () =>
      simulatePerpsFill(
        legacy,
        { kind: "open", symbol: "BTC", side: "long", notional: "100", feeReserve: "1" },
        value,
        now,
      ),
    { code: "INCONSISTENT_MARKET_DATA" },
  );
  const product = account();
  product.scope.sessionId = "product";
  assert.throws(
    () =>
      simulatePerpsFill(
        product,
        { kind: "open", symbol: "BTC", side: "long", notional: "100", feeReserve: "1" },
        value,
        now,
      ),
    { code: "INVALID_INPUT" },
  );
});

for (const side of ["long", "short"] as const) {
  test(`component paper ${side} opens, marks risk and closes through unchanged accounting`, () => {
    const a = account();
    const intent = { kind: "open", symbol: "BTC", side, notional: "100", feeReserve: "1" } as const;
    const open = simulatePerpsFill(a, intent, frame(), now);
    const opened = applyPaperFill(a, attempt(intent, "position"), open, now);
    const observation = frame();
    observation.snapshot.ticker.mark = side === "long" ? "58000" : "62000";
    const marked = applyPaperObservation(
      opened.account,
      [],
      { frames: [observation], funding: [], marksOnly: true },
      "marks",
      now,
    );
    assert.deepEqual(paperRisk(marked.account, [], now).closeSymbols, ["BTC"]);
    const closeIntent = {
      kind: "close",
      symbol: "BTC",
      side,
      notional: "0",
      feeReserve: "1",
    } as const;
    const close = simulatePerpsFill(marked.account, closeIntent, observation, now);
    const closed = applyPaperFill(marked.account, attempt(closeIntent, "closed"), close, now);
    assert.equal(closed.account.positions[0]!.closedAt, now);
    assert.ok(closed.movements.some((posting) => posting.kind === "fee"));
    assert.ok(closed.movements.some((posting) => posting.kind === "realized-pnl"));
    assert.equal(marked.account.positions[0]!.markAt, now - 20000);
  });
}

test("component limits, missing proof, invalid native values and common generation fail closed", () => {
  for (const [tickerAge, bookAge, valid] of [
    [30000, 0, true],
    [30001, 0, false],
    [0, 30001, false],
    [-5000, 0, true],
    [-5001, 0, false],
  ] as const) {
    assert.equal(Boolean(frame(tickerAge, bookAge)), valid);
  }
  const value = frame();
  validatePaperFrame(value, "testnet", "BTC", now + 5000, COMPONENT_PAPER_POLICY);
  assert.throws(
    () => validatePaperFrame(value, "testnet", "BTC", now + 5001, COMPONENT_PAPER_POLICY),
    { code: "STALE_MARKET_DATA" },
  );
  const missing = structuredClone(value);
  delete missing.streamEvidence;
  assert.throws(() => validatePaperFrame(missing, "testnet", "BTC", now, COMPONENT_PAPER_POLICY), {
    code: "INVALID_MARKET_DATA",
  });
  for (const invalid of [NaN, Infinity, -1, 0.5]) {
    const altered = structuredClone(value);
    altered.snapshot.ticker.provenance.providerTimestamp = invalid;
    assert.throws(
      () => validatePaperFrame(altered, "testnet", "BTC", now, COMPONENT_PAPER_POLICY),
      { code: "INVALID_MARKET_DATA" },
    );
  }
  const mixed = structuredClone(value);
  mixed.streamEvidence!.generation++;
  assert.throws(
    () => validatePaperFrameSet([value, mixed], "testnet", now, COMPONENT_PAPER_POLICY),
    { code: "INVALID_MARKET_DATA" },
  );
  assert.notEqual(value.hash, hash({ snapshot: value.snapshot, book: value.book }));
});

test("equal inputs retain identical fill/accounting results under legacy and paper policies", () => {
  const value = frame(0);
  const current = account();
  const legacy = structuredClone(current);
  delete legacy.marketDataPolicy;
  const intent = {
    kind: "open",
    symbol: "BTC",
    side: "long",
    notional: "100",
    feeReserve: "1",
  } as const;
  assert.deepEqual(
    simulatePerpsFill(current, intent, value, now),
    simulatePerpsFill(legacy, intent, value, now),
  );
});

test("receipt proof uses its local clock without changing PostgreSQL-native freshness", () => {
  const value = frame();
  const financialAt = now - 1;
  validatePaperFrame(value, "testnet", "BTC", financialAt, COMPONENT_PAPER_POLICY, now);
  validatePaperFrameSet([value], "testnet", financialAt, COMPONENT_PAPER_POLICY, now);
  const intent = {
    kind: "open",
    symbol: "BTC",
    side: "long",
    notional: "100",
    feeReserve: "1",
  } as const;
  assert.deepEqual(
    simulatePerpsFill(account(), intent, value, financialAt, now),
    simulatePerpsFill(account(), intent, value, now),
  );
  applyPaperObservation(
    account(),
    [],
    { frames: [value], funding: [], marksOnly: true },
    "separate-clocks",
    financialAt,
    now,
  );
  assert.throws(
    () => validatePaperFrame(value, "testnet", "BTC", financialAt, COMPONENT_PAPER_POLICY, now - 1),
    { code: "INVALID_MARKET_DATA" },
  );
  assert.throws(
    () =>
      validatePaperFrame(value, "testnet", "BTC", financialAt, COMPONENT_PAPER_POLICY, now + 5001),
    { code: "STALE_MARKET_DATA" },
  );
  assert.throws(
    () => validatePaperFrame(value, "testnet", "BTC", now + 10001, COMPONENT_PAPER_POLICY, now),
    { code: "STALE_MARKET_DATA" },
  );
});

test("component failures retain safe clock provenance and unchanged failure codes", () => {
  const value = frame();
  const financialAt = now - 1;
  let original: unknown;
  try {
    validatePaperFrame(value, "testnet", "BTC", financialAt, COMPONENT_PAPER_POLICY, now - 1);
  } catch (error) {
    original = error;
  }
  assert.ok(original instanceof PerpsFrameValidationFailure);
  assert.equal(original.code, "INVALID_MARKET_DATA");
  assert.deepEqual(original.details, {
    version: 1,
    reason: "buffer-copy-ahead-of-receipt-clock",
    symbol: "BTC",
    frameHash: value.hash,
    financialAt,
    receiptAt: now - 1,
    tickerAt: now - 20000,
    bookAt: now,
    generation: 1,
    copiedAt: now,
    heartbeatReceivedAt: now,
  });
  const invalid = structuredClone(value);
  invalid.hash = "<private-response>";
  invalid.snapshot.ticker.provenance.providerTimestamp = NaN;
  assert.throws(
    () => validatePaperFrame(invalid, "testnet", "BTC", now, COMPONENT_PAPER_POLICY),
    (error: unknown) => {
      assert.ok(error instanceof PerpsFrameValidationFailure);
      assert.equal(error.details.frameHash, null);
      assert.equal(error.details.tickerAt, null);
      assert.equal(error.details.reason, "invalid-native-date-or-block");
      assert.equal(JSON.stringify(error.details).includes("private-response"), false);
      return true;
    },
  );
});

import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { PERPL_LAB_SYMBOLS, PilotError } from "@pickler/core";
import {
  acquireUniverseStream,
  UNIVERSE_COMPONENT_STREAM_POLICY,
  validateUniverseStream,
  type UniverseStreamBuffer,
} from "../src/features/perps-paper/stream-universe.js";
import { validatePaperFrame } from "../src/features/perps-paper/simulation.js";
import { adviceFixture } from "./advice-fixture.js";

const now = 1_800_000_000_000;
const markets = PERPL_LAB_SYMBOLS.map((symbol, index) => ({ symbol, marketId: index + 1 }));
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
function buffer(tickerAge = 10000, bookAge = 0): UniverseStreamBuffer {
  return {
    generation: 1,
    observedAt: now,
    continuity: { heartbeatSequence: 1, headBlock: 100, heartbeatReceivedAt: now },
    components: markets.map(({ symbol, marketId }) => {
      const frame = structuredClone(adviceFixture(now).evidence.frame);
      frame.snapshot.market = { ...frame.snapshot.market, symbol, marketId };
      frame.book.market = { ...frame.book.market, symbol, marketId };
      frame.snapshot.ticker.provenance = {
        ...frame.snapshot.ticker.provenance,
        providerTimestamp: now - tickerAge,
      };
      frame.book.provenance = { ...frame.book.provenance, providerTimestamp: now - bookAge };
      return { symbol, snapshot: frame.snapshot, book: frame.book };
    }),
  };
}
function validate(value: UniverseStreamBuffer, experimental = true) {
  return validateUniverseStream({
    network: "testnet",
    markets,
    buffer: value,
    now,
    hash,
    ...(experimental ? { policy: UNIVERSE_COMPONENT_STREAM_POLICY } : {}),
  });
}

test("independent freshness keeps original dates and financial admission retains the skew gate", () => {
  const value = buffer();
  const before = structuredClone(value);
  const captured = validate(value);

  assert.equal(captured.frames.length, 11);
  assert.equal(validate(value, false).excluded.length, 11);
  assert.deepEqual(value, before);
  assert.equal(captured.frames[0]!.snapshot.ticker.provenance.providerTimestamp, now - 10000);
  assert.throws(() => validatePaperFrame(captured.frames[0]!, "testnet", "BTC", now), {
    code: "INCONSISTENT_MARKET_DATA",
  });
});

for (const [tickerAge, bookAge, valid] of [
  [30000, 0, true],
  [30001, 0, false],
  [0, 30001, false],
  [-5000, 0, true],
  [-5001, 0, false],
  [0, -5001, false],
] as const) {
  test(`component boundaries ticker=${tickerAge} book=${bookAge}`, () => {
    const result = validate(buffer(tickerAge, bookAge));
    assert.equal(result.frames.length, valid ? 11 : 0);
    if (!valid) {
      assert.ok(result.excluded.every((row) => row.code === "STALE_MARKET_DATA"));
    }
  });
}

test("heartbeat has a separate five-second limit and cannot refresh stale prices", () => {
  const value = buffer();
  value.continuity!.heartbeatReceivedAt = now - 5000;
  assert.equal(validate(value).frames.length, 11);
  value.continuity!.heartbeatReceivedAt--;
  assert.equal(validate(value).excluded.length, 11);
  delete value.continuity;
  assert.equal(validate(value).excluded.length, 11);
  assert.equal(validate(buffer(30001)).excluded.length, 11);
});

test("invalid continuity or market identity is fatal, not an availability omission", () => {
  for (const change of [
    { heartbeatSequence: -1 },
    { headBlock: 0.5 },
    { heartbeatReceivedAt: now + 1 },
  ]) {
    const value = buffer();
    Object.assign(value.continuity!, change);
    assert.throws(() => validate(value), { code: "INVALID_MARKET_DATA" });
  }
  const value = buffer();
  value.components[0]!.book!.market.marketId = 999;
  assert.throws(() => validate(value), { code: "INVALID_MARKET_DATA" });
});

test("one stale market remains excluded and cannot be disguised by the other ten", () => {
  const value = buffer();
  value.components[10]!.book!.provenance.providerTimestamp = now - 30001;
  const result = validate(value);
  assert.equal(result.frames.length, 10);
  assert.equal(result.excluded.length, 1);
  assert.equal(result.excluded[0]!.symbol, markets[10]!.symbol);
});

test("missing heartbeat consumes only the bounded acquisition window without fallback", async () => {
  let clock = now;
  let reads = 0;
  const value = buffer();
  delete value.continuity;
  await assert.rejects(
    acquireUniverseStream({
      network: "testnet",
      markets,
      deadlineAt: now + 20000,
      signal: new AbortController().signal,
      now: () => clock,
      guard: async () => {},
      read: async () => {
        reads++;
        return { ...value, observedAt: clock };
      },
      hash,
      wait: async (ms) => {
        clock += ms;
      },
      policy: UNIVERSE_COMPONENT_STREAM_POLICY,
    }),
    { code: "DATA_UNAVAILABLE" },
  );
  assert.equal(clock, now + 20000);
  assert.equal(reads, 80);
});

test("ownership loss prevents buffer reads even when all public components are fresh", async () => {
  let reads = 0;
  await assert.rejects(
    acquireUniverseStream({
      network: "testnet",
      markets,
      deadlineAt: now + 20000,
      signal: new AbortController().signal,
      now: () => now,
      guard: async () => {
        throw new PilotError("LEASE_LOST", "Controlled loss");
      },
      read: async () => {
        reads++;
        return buffer();
      },
      hash,
      wait: async () => {},
      policy: UNIVERSE_COMPONENT_STREAM_POLICY,
    }),
    { code: "LEASE_LOST" },
  );
  assert.equal(reads, 0);
});

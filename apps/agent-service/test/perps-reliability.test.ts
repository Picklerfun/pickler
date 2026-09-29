import test from "node:test";
import assert from "node:assert/strict";
import { PilotError, type PerpSymbol } from "@pickler/core";
import { acquirePerpsFrames } from "@pickler/trading/perps";
import { startLeaseHeartbeat } from "@pickler/trading/evaluation";
import { studyFrame } from "./perps-study-fixtures.js";

const base = 1800000000000;
function fixture(skew = false) {
  let at = base,
    calls = 0,
    revoked = false;
  const inputs: Parameters<typeof acquirePerpsFrames>[0] = {
    network: "mainnet",
    symbols: ["BTC", "ETH"],
    now: () => at,
    signal: new AbortController().signal,
    hash: () => "a".repeat(64),
    guard: async () => {
      if (revoked) {
        throw new PilotError("CONFIG_CHANGED", "revoked");
      }
    },
    book: async (symbol) => {
      calls++;
      at += 1000;
      return studyFrame(at, symbol).book;
    },
    snapshot: async (symbol) => {
      calls++;
      at += 1000;
      return studyFrame(at - (skew && calls < 5 ? 10000 : 0), symbol).snapshot;
    },
  };
  return {
    inputs,
    calls: () => calls,
    now: () => at,
    advance: (ms: number) => {
      at += ms;
    },
    revoke: () => {
      revoked = true;
    },
  };
}
test("acquisition repairs only the older component and validates both at one time", async () => {
  const x = fixture(true);
  const frames = await acquirePerpsFrames(x.inputs);
  assert.equal(frames.length, 2);
  for (const frame of frames) {
    assert.ok(
      Math.abs(
        frame.snapshot.ticker.provenance.providerTimestamp! -
          frame.book.provenance.providerTimestamp!,
      ) <= 5000,
    );
  }
  assert.ok(x.calls() > 4);
});
test("persistent skew exhausts the shared twenty-second deadline without substitutes", async () => {
  const x = fixture();
  x.inputs.snapshot = async (symbol) => {
    x.advance(2500);
    return studyFrame(base - 15000, symbol).snapshot;
  };
  await assert.rejects(acquirePerpsFrames(x.inputs), { code: "DATA_UNAVAILABLE" });
});
test("permission revocation and invalid market identity do not retry", async () => {
  const x = fixture();
  x.inputs.book = async (symbol) => {
    x.revoke();
    return studyFrame(base, symbol).book;
  };
  await assert.rejects(acquirePerpsFrames(x.inputs), { code: "CONFIG_CHANGED" });
  const y = fixture();
  y.inputs.snapshot = async () => studyFrame(base, "ETH").snapshot;
  await assert.rejects(acquirePerpsFrames(y.inputs), { code: "INVALID_MARKET_DATA" });
});
test("timeouts may recover, cancellation cannot", async () => {
  const x = fixture();
  const book = x.inputs.book;
  let first = true;
  x.inputs.book = async (symbol: PerpSymbol) => {
    if (first) {
      first = false;
      x.advance(1000);
      throw new PilotError("PERPL_TIMEOUT", "controlled");
    }
    return book(symbol);
  };
  assert.equal((await acquirePerpsFrames(x.inputs)).length, 2);
  const controller = new AbortController();
  controller.abort(new Error("cancelled"));
  await assert.rejects(
    acquirePerpsFrames({ ...fixture().inputs, signal: controller.signal }),
    /cancelled/,
  );
});
test("heartbeat does not overlap, records timer delay and aborts on renewal failure", async () => {
  let at = base,
    calls = 0;
  let reject: (error: Error) => void = () => {};
  const events: unknown[] = [];
  const heartbeat = startLeaseHeartbeat({
    lease: { expiresAt: base + 90000 },
    now: () => at,
    renew: () => {
      calls++;
      return new Promise<void>((_, fail) => {
        reject = fail;
      });
    },
    diagnostic: (event) => events.push(event),
  });
  at += 95000;
  heartbeat.tick();
  heartbeat.tick();
  assert.equal(calls, 1);
  reject(new PilotError("LEASE_LOST", "expired"));
  await heartbeat.stop();
  assert.equal(heartbeat.signal.aborted, true);
  assert.deepEqual(events, [
    {
      kind: "renewal-failed",
      at,
      durationMs: 0,
      timerDelayMs: 75000,
      lastSuccessAt: null,
      expiresAt: base + 90000,
      code: "LEASE_LOST",
    },
  ]);
});

test("a pair that expires while reading the other symbol is never returned", async () => {
  const x = fixture();
  const book = x.inputs.book;
  x.inputs.book = async (symbol) => {
    if (symbol === "ETH") {
      x.advance(31000);
    }
    return book(symbol);
  };
  await assert.rejects(acquirePerpsFrames(x.inputs), { code: "DATA_UNAVAILABLE" });
});

test("schema failures abort immediately without public-data recovery", async () => {
  const x = fixture();
  let reads = 0;
  x.inputs.book = async () => {
    reads++;
    throw new PilotError("PERPL_INVALID_RESPONSE", "controlled");
  };
  await assert.rejects(acquirePerpsFrames(x.inputs), { code: "PERPL_INVALID_RESPONSE" });
  assert.equal(reads, 1);
});

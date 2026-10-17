import test from "node:test";
import assert from "node:assert/strict";
import {
  PERPL_LAB_SYMBOLS,
  PilotError,
  type PerpMarketInfo,
  type PerpOrderBook,
  type PerpSnapshot,
  type PerpSymbol,
} from "@pickler/core";
import {
  acquireUniverse,
  acquireUniverseV2,
  validatePaperFrame,
  validateUniverseStream,
  acquireUniverseStream,
  type UniverseAcquisitionDiagnostic,
} from "@pickler/trading/perps";

const epoch = 1791493920000;
const hash = () => "a".repeat(64);

test("one stream generation is validated against a common clock at exact age/future/skew limits", () => {
  const markets = PERPL_LAB_SYMBOLS.map((symbol) => ({
    symbol,
    marketId: market(symbol).marketId,
  }));
  const components = PERPL_LAB_SYMBOLS.map((symbol) => ({
    symbol,
    snapshot: snapshot(symbol, 0, 0),
    book: book(symbol, 0, 0),
  }));
  const input = {
    markets,
    network: "mainnet",
    now: epoch,
    hash,
    buffer: { generation: 1, observedAt: epoch, components },
  };
  assert.equal(validateUniverseStream(input).frames.length, 11);
  for (const [tickerTime, bookTime, reference, expected] of [
    [-30000, -30000, 0, true],
    [-30001, -30001, 0, false],
    [5000, 5000, 0, true],
    [5001, 5001, 0, false],
    [-5000, 0, 0, true],
    [-5001, 0, 0, false],
  ] as const) {
    const testInput = { ...input, buffer: structuredClone(input.buffer) };
    testInput.now = epoch + reference;
    testInput.buffer.components[0]!.snapshot = snapshot("BTC", tickerTime, 0);
    testInput.buffer.components[0]!.book = book("BTC", bookTime, 0);
    const result = validateUniverseStream(testInput);
    assert.equal(result.excluded.length, expected ? 0 : 1);
    assert.equal(result.frames.length, expected ? 11 : 10);
  }
  const invalid = { ...input, buffer: structuredClone(input.buffer) };
  invalid.buffer.components[0]!.book.market.marketId = 999;
  assert.throws(() => validateUniverseStream(invalid), { code: "INVALID_MARKET_DATA" });
});

test("stream acquisition waits for the latest ticker and never selects a coherent older book", async () => {
  let elapsed = 0;
  const seen: number[] = [];
  const result = await acquireUniverseStream({
    network: "mainnet",
    markets: [{ symbol: "BTC", marketId: market("BTC").marketId }],
    now: () => epoch + elapsed,
    deadlineAt: epoch + 20000,
    signal: new AbortController().signal,
    guard: async () => {},
    hash,
    read: async () => ({
      generation: 1,
      observedAt: epoch + elapsed,
      components: [
        {
          symbol: "BTC",
          snapshot: snapshot("BTC", elapsed >= 1000 ? 7000 : 0, elapsed),
          book: book("BTC", 7000, elapsed),
        },
      ],
    }),
    wait: async (ms) => {
      elapsed += ms;
    },
    diagnostic: (d) => seen.push(d.bookAt!),
  });
  assert.equal(result.frames.length, 1);
  assert.ok(elapsed >= 1000);
  assert.ok(seen.every((at) => at === epoch + 7000));
});

function market(symbol: PerpSymbol): PerpMarketInfo {
  const marketId = PERPL_LAB_SYMBOLS.indexOf(symbol) + 1;
  return {
    symbol,
    marketId,
    perpetualId: marketId,
    instanceId: 1,
    exchangeAddress: "0x" + "1".repeat(40),
    collateral: { tokenId: 1, address: "0x" + "2".repeat(40), symbol: "AUSD", decimals: 6 },
    configVersion: 1,
    priceDecimals: 2,
    sizeDecimals: 4,
    open: true,
    fundingIntervalSeconds: 3600,
    fundingIntervalBlocks: 100,
    initialMarginRaw: 1,
    maintenanceMarginRaw: 1,
    fees: { basis: "public-base-tier", maker: "0", taker: "0.0005" },
    provenance: provenance(0, 0),
  };
}

function provenance(timestamp: number, received: number) {
  return {
    provider: "perpl" as const,
    pluginVersion: "1.1.0" as const,
    network: "mainnet" as const,
    chainId: 143,
    url: "https://public.example.test",
    receivedAt: epoch + received,
    providerTimestamp: epoch + timestamp,
    block: Math.max(1, Math.floor(timestamp / 1000) + 100),
  };
}

function snapshot(symbol: PerpSymbol, timestamp: number, received: number): PerpSnapshot {
  return {
    market: market(symbol),
    ticker: {
      mark: "100",
      index: "100",
      last: "100",
      bid: "99.9",
      ask: "100.1",
      openInterestBase: "1000",
      freshness: "fresh",
      provenance: provenance(timestamp, received),
    },
    funding: null,
  };
}

function book(symbol: PerpSymbol, timestamp: number, received: number): PerpOrderBook {
  return {
    market: market(symbol),
    requestedLevels: 10,
    depthLimited: true,
    bids: [{ price: "99.9", size: "10", orders: 1 }],
    asks: [{ price: "100.1", size: "10", orders: 1 }],
    freshness: "fresh",
    provenance: provenance(timestamp, received),
  };
}

interface Source {
  ticker(symbol: PerpSymbol, at: number): number | null;
  book(symbol: PerpSymbol, at: number, attempt: number): number;
}

/** Identical virtual provider functions; only v1 caching/scheduling differs from v2. */
function reader(source: Source, symbols: readonly PerpSymbol[] = PERPL_LAB_SYMBOLS, elapsed = 0) {
  let at = elapsed;
  let lastStart = -1000;
  let cached: PerpSnapshot[] | null = null;
  let cacheAt = -Infinity;
  let guardError: PilotError | null = null;
  const abort = new AbortController();
  const starts: { operation: string; at: number }[] = [];
  const waits: { from: number; to: number }[] = [];
  const diagnostics: UniverseAcquisitionDiagnostic[] = [];
  const bookAttempts = new Map<PerpSymbol, number>();

  async function request<T>(operation: string, response: (at: number) => T): Promise<T> {
    abort.signal.throwIfAborted();
    if (starts.length >= 24) {
      throw new PilotError("PERPL_SESSION_LIMIT", "Controlled request cap");
    }
    at = Math.max(at, lastStart + 1000);
    if (at >= 20000) {
      at = 20000;
      abort.abort(new PilotError("PERPL_TIMEOUT", "Controlled deadline"));
      abort.signal.throwIfAborted();
    }
    lastStart = at;
    starts.push({ operation, at });
    const started = at;
    at += 100;
    return response(started);
  }

  async function batch(requested: readonly PerpSymbol[]) {
    return request("ticker", (started) => {
      cached = requested.flatMap((symbol) => {
        const timestamp = source.ticker(symbol, started);
        return timestamp === null ? [] : [snapshot(symbol, timestamp, started + 100)];
      });
      cacheAt = started + 100;
      return cached;
    });
  }

  async function readBook(symbol: PerpSymbol) {
    return request(`book:${symbol}`, (started) => {
      const attempt = (bookAttempts.get(symbol) ?? 0) + 1;
      bookAttempts.set(symbol, attempt);
      return book(symbol, source.book(symbol, started, attempt), started + 100);
    });
  }

  async function guard() {
    if (guardError) {
      throw guardError;
    }
  }

  const common = {
    network: "mainnet" as const,
    symbols,
    now: () => epoch + at,
    signal: abort.signal,
    guard,
    hash,
    book: readBook,
  };

  return {
    starts,
    waits,
    diagnostics,
    get at() {
      return at;
    },
    revoke(code = "LEASE_LOST") {
      guardError = new PilotError(code, "Controlled revocation");
    },
    async v1() {
      return acquireUniverse({
        ...common,
        async snapshot(symbol) {
          if (!cached || at - cacheAt >= 3000) {
            await batch(symbols);
          }
          const value = cached!.find((value) => value.market.symbol === symbol);
          if (!value) {
            throw new PilotError("DATA_UNAVAILABLE", "Controlled missing ticker");
          }
          return value;
        },
        async wait() {
          const from = at;
          at = Math.min(20000, at + 2000);
          waits.push({ from, to: at });
        },
      });
    },
    async v2() {
      return acquireUniverseV2({
        ...common,
        deadlineAt: epoch + 20000,
        snapshots: batch,
        async waitUntil(until) {
          const from = at;
          at = Math.min(20000, until - epoch);
          waits.push({ from, to: at });
        },
        diagnostic: (diagnostic) => diagnostics.push(diagnostic),
      });
    },
  };
}

test("v2 repairs an early invalid pair while v1 defers it until the eleven-market pass", async () => {
  const source: Source = {
    ticker(symbol, at) {
      if (symbol !== "BTC") {
        return 0;
      }
      return at < 2000 ? -11000 : at < 12000 ? 0 : 7000;
    },
    book: (symbol, at) => (symbol === "BTC" ? at : 0),
  };
  const old = reader(source);
  const corrected = reader(source);

  const before = await old.v1();
  const after = await corrected.v2();

  assert.ok(before.excluded.some((value) => value.symbol === "BTC"));
  assert.equal(after.frames.length, 11);
  assert.deepEqual(after.excluded, []);
  const repaired = corrected.diagnostics.find(
    (value) => value.symbol === "BTC" && value.component === "ticker-batch" && value.code === null,
  );
  assert.equal(repaired?.at, epoch + 2100);
  assert.ok(old.starts.filter((value) => value.operation === "book:BTC")[1]!.at >= 15000);
  assert.equal(corrected.starts.length, 13);
  assert.ok(corrected.at < 20000);
});

test("a repeated ticker defers only that component while other unread books progress", async () => {
  const controlled = reader({ ticker: () => -11000, book: () => 0 }, ["BTC", "ETH"]);

  await controlled.v2();

  const eth = controlled.starts.find((value) => value.operation === "book:ETH");
  assert.ok(eth);
  assert.equal(eth.at, 3000);
  assert.ok(controlled.waits.every((value) => value.from >= eth.at));
  const repeats = controlled.diagnostics.filter((value) => value.repeated);
  assert.ok(repeats.length > 0);
  assert.ok(repeats.every((value) => value.nextRetryAt! >= value.at + 2000));
});

test("a repeatedly failing first market cannot starve remaining unread markets", async () => {
  const controlled = reader({
    ticker: (symbol) => (symbol === "BTC" ? -11000 : 0),
    book: () => 0,
  });

  const result = await controlled.v2();

  assert.equal(result.frames.length, 10);
  assert.deepEqual(
    result.excluded.map((value) => value.symbol),
    ["BTC"],
  );
  assert.ok(
    PERPL_LAB_SYMBOLS.every((symbol) =>
      controlled.starts.some((r) => r.operation === `book:${symbol}`),
    ),
  );
  assert.ok(controlled.starts.length <= 24);
  assert.ok(
    controlled.starts.every(
      (value, i) => i === 0 || value.at - controlled.starts[i - 1]!.at >= 1000,
    ),
  );
});

test("new bulk ticker states invalidate earlier pairs instead of retaining an old coherent pair", async () => {
  const source: Source = {
    ticker(symbol, at) {
      if (symbol === "BTC") {
        return at < 2000 ? 0 : 7000;
      }
      return -11000;
    },
    book: () => 0,
  };
  const old = reader(source, ["BTC", "ETH"]);
  const corrected = reader(source, ["BTC", "ETH"]);

  const before = await old.v1();
  const after = await corrected.v2();

  assert.ok(before.frames.some((value) => value.snapshot.market.symbol === "BTC"));
  assert.ok(after.excluded.some((value) => value.symbol === "BTC"));
  assert.ok(
    corrected.diagnostics.some(
      (value) => value.symbol === "BTC" && value.tickerAt === epoch + 7000,
    ),
  );
  assert.ok(!after.frames.some((value) => value.snapshot.market.symbol === "BTC"));
});

test("missing entries in a newer batch discard the old ticker and remain unavailable", async () => {
  const controlled = reader(
    { ticker: (symbol, at) => (symbol === "BTC" ? (at < 2000 ? 0 : null) : -11000), book: () => 0 },
    ["BTC", "ETH"],
  );

  const result = await controlled.v2();

  assert.ok(result.excluded.some((value) => value.symbol === "BTC"));
  assert.ok(
    controlled.diagnostics.some((value) => value.symbol === "BTC" && value.tickerAt === null),
  );
  assert.equal(result.frames.length, 0);
});

test("timestamp regressions reject the asset and never select the previous pair as fallback", async () => {
  const controlled = reader(
    {
      ticker: (symbol, at) => (symbol === "BTC" ? (at < 2000 ? 0 : -1000) : -11000),
      book: () => 0,
    },
    ["BTC", "ETH"],
  );

  const result = await controlled.v2();

  assert.ok(
    result.excluded.some(
      (value) => value.symbol === "BTC" && value.code === "PERPL_INVALID_RESPONSE",
    ),
  );
  assert.ok(
    controlled.diagnostics.some(
      (value) => value.symbol === "BTC" && value.tickerAt === epoch - 1000,
    ),
  );
});

test("continuously current eleven-market states can remain unavailable under unchanged bounds", async () => {
  const controlled = reader({ ticker: (_, at) => at, book: (_, at) => at });

  const result = await controlled.v2();

  assert.ok(result.excluded.length > 0);
  assert.ok(controlled.at <= 20000);
  assert.ok(controlled.starts.length <= 24);
  for (const frame of result.frames) {
    validatePaperFrame(frame, "mainnet", frame.snapshot.market.symbol, epoch + controlled.at);
  }
});

test("the deadline includes metadata elapsed before acquisition, with no late starts", async () => {
  const controlled = reader({ ticker: () => 0, book: () => 0 }, PERPL_LAB_SYMBOLS, 10000);

  const result = await controlled.v2();

  assert.ok(result.excluded.length > 0);
  assert.equal(controlled.at, 20000);
  assert.ok(controlled.starts.every((value) => value.at < 20000));
  assert.equal(controlled.starts.length, 10);
});

test("permission and ownership failures propagate before another request or reuse", async () => {
  for (const code of ["LEASE_LOST", "TOOL_DISABLED", "CONFIG_CHANGED"]) {
    const controlled = reader({ ticker: () => 0, book: () => 0 });
    controlled.revoke(code);

    await assert.rejects(controlled.v2(), { code });

    assert.equal(controlled.starts.length, 0);
  }
});

test("revocation during a read rejects its result before other work can start", async () => {
  for (const code of ["LEASE_LOST", "TOOL_DISABLED", "CONFIG_CHANGED"]) {
    const controlled = reader({
      ticker: () => 0,
      book() {
        controlled.revoke(code);
        return 0;
      },
    });

    await assert.rejects(controlled.v2(), { code });

    assert.deepEqual(
      controlled.starts.map((value) => value.operation),
      ["ticker", "book:BTC"],
    );
    assert.ok(!controlled.diagnostics.some((value) => value.component === "book"));
  }
});

test("common final-clock validation excludes data that aged while other markets were obtained", async () => {
  const controlled = reader({
    ticker: (symbol) => (symbol === "BTC" ? -20000 : 0),
    book: (symbol) => (symbol === "BTC" ? -20000 : 0),
  });

  const result = await controlled.v2();

  assert.ok(controlled.diagnostics.some((value) => value.symbol === "BTC" && value.code === null));
  assert.ok(
    result.excluded.some((value) => value.symbol === "BTC" && value.code === "STALE_MARKET_DATA"),
  );
  assert.ok(!result.frames.some((value) => value.snapshot.market.symbol === "BTC"));
});

test("a regressed book is recorded and excluded without an older coherent fallback", async () => {
  const controlled = reader(
    {
      ticker: (symbol) => (symbol === "BTC" ? 0 : -11000),
      book(symbol, _, attempt) {
        if (symbol === "BTC") {
          return 0;
        }
        return attempt === 1 ? -17000 : -18000;
      },
    },
    ["BTC", "ETH"],
  );

  const result = await controlled.v2();

  assert.ok(
    result.excluded.some(
      (value) => value.symbol === "ETH" && value.code === "PERPL_INVALID_RESPONSE",
    ),
  );
  assert.ok(
    controlled.diagnostics.some(
      (value) => value.symbol === "ETH" && value.bookAt === epoch - 18000,
    ),
  );
});

test("rejected response identities are permanent rather than price substitutions", async () => {
  const abort = new AbortController();

  const result = await acquireUniverseV2({
    network: "mainnet",
    symbols: ["BTC"],
    deadlineAt: epoch + 20000,
    now: () => epoch,
    signal: abort.signal,
    guard: async () => {},
    snapshots: async () => [snapshot("ETH", 0, 0)],
    book: async () => book("BTC", 0, 0),
    hash,
    waitUntil: async () => assert.fail("permanent identity errors cannot retry"),
  });

  assert.deepEqual(result.frames, []);
  assert.deepEqual(result.excluded, [
    { symbol: "BTC", code: "PERPL_MARKET_IDENTITY", phase: "acquisition" },
  ]);
});

test("late parent cancellation is never confused with the acquisition deadline", async () => {
  for (const code of ["LEASE_LOST", "DATA_READER_CLOSED"]) {
    let now = epoch;
    const abort = new AbortController();

    await assert.rejects(
      acquireUniverseV2({
        network: "mainnet",
        symbols: ["BTC"],
        deadlineAt: epoch + 20000,
        now: () => now,
        signal: abort.signal,
        guard: async () => {},
        async snapshots() {
          now += 20000;
          const reason = new PilotError(code, "Controlled late cancellation");
          abort.abort(reason);
          throw reason;
        },
        book: async () => assert.fail("cancelled reader cannot request a book"),
        hash,
        waitUntil: async () => assert.fail("cancelled reader cannot wait"),
      }),
      { code },
    );
  }
});

test("the platform deadline returns only a guarded unavailable subset", async () => {
  let now = epoch;
  let checks = 0;
  const abort = new AbortController();

  const result = await acquireUniverseV2({
    network: "mainnet",
    symbols: ["BTC"],
    deadlineAt: epoch + 20000,
    now: () => now,
    signal: abort.signal,
    guard: async () => {
      checks++;
    },
    async snapshots() {
      now += 20000;
      abort.abort(new DOMException("Controlled elapsed deadline", "TimeoutError"));
      abort.signal.throwIfAborted();
      return [];
    },
    book: async () => assert.fail("deadline cannot request a book"),
    hash,
    waitUntil: async () => assert.fail("deadline cannot wait"),
  });

  assert.equal(checks, 2);
  assert.deepEqual(result.frames, []);
  assert.equal(result.excluded[0]?.code, "DATA_UNAVAILABLE");
});

test("cancellation raised by the final guard cannot return previously valid frames", async () => {
  const abort = new AbortController();
  let checks = 0;

  await assert.rejects(
    acquireUniverseV2({
      network: "mainnet",
      symbols: ["BTC"],
      deadlineAt: epoch + 20000,
      now: () => epoch,
      signal: abort.signal,
      async guard() {
        if (++checks === 6) {
          abort.abort(new PilotError("LEASE_LOST", "Controlled final guard cancellation"));
        }
      },
      snapshots: async () => [snapshot("BTC", 0, 0)],
      book: async () => book("BTC", 0, 0),
      hash,
      waitUntil: async () => assert.fail("valid frames cannot wait"),
    }),
    { code: "LEASE_LOST" },
  );

  assert.equal(checks, 6);
});

test("transient batch failure retains only still-valid original states and records the failure", async () => {
  const controlled = reader(
    {
      ticker(symbol, at) {
        if (at >= 3000) {
          throw new PilotError("PERPL_HTTP_503", "Controlled temporary unavailability");
        }
        return symbol === "BTC" ? 0 : -11000;
      },
      book: () => 0,
    },
    ["BTC", "ETH"],
  );

  const result = await controlled.v2();

  const btc = result.frames.find((value) => value.snapshot.market.symbol === "BTC");
  assert.ok(btc);
  assert.equal(btc.snapshot.ticker.provenance.providerTimestamp, epoch);
  assert.equal(btc.snapshot.ticker.provenance.receivedAt, epoch + 100);
  assert.ok(
    controlled.diagnostics.some(
      (value) => value.symbol === "BTC" && value.code === "PERPL_HTTP_503",
    ),
  );
  assert.ok(result.excluded.some((value) => value.symbol === "ETH"));
  validatePaperFrame(btc, "mainnet", "BTC", epoch + controlled.at);
});

test("a deadline firing concurrently cannot hide a distinct provider or authorization failure", async () => {
  for (const code of [
    "PERPL_HTTP_401",
    "PERMISSION_DENIED",
    "LEASE_LOST",
    "PERPL_HTTP_429",
    "PERPL_INVALID_RESPONSE",
  ]) {
    let now = epoch;
    const abort = new AbortController();
    const original = new PilotError(code, "Controlled failure concurrent with deadline");

    await assert.rejects(
      acquireUniverseV2({
        network: "mainnet",
        symbols: ["BTC"],
        deadlineAt: epoch + 20000,
        now: () => now,
        signal: abort.signal,
        guard: async () => {},
        async snapshots() {
          now += 20000;
          abort.abort(new DOMException("Controlled elapsed deadline", "TimeoutError"));
          throw original;
        },
        book: async () => assert.fail("failed reader cannot request a book"),
        hash,
        waitUntil: async () => assert.fail("failed reader cannot wait"),
      }),
      (error) => error === original,
    );
  }
});

test("only normalized timeout cancellation may return a subset after the actual deadline", async () => {
  for (const code of ["PERPL_TIMEOUT", "PERPL_CANCELLED"]) {
    let now = epoch;
    const abort = new AbortController();

    const result = await acquireUniverseV2({
      network: "mainnet",
      symbols: ["BTC"],
      deadlineAt: epoch + 20000,
      now: () => now,
      signal: abort.signal,
      guard: async () => {},
      async snapshots() {
        now += 20000;
        abort.abort(new DOMException("Controlled elapsed deadline", "TimeoutError"));
        throw new PilotError(code, "Controlled normalized deadline failure");
      },
      book: async () => assert.fail("deadline cannot request a book"),
      hash,
      waitUntil: async () => assert.fail("deadline cannot wait"),
    });

    assert.deepEqual(result.frames, []);
    assert.equal(result.excluded[0]?.code, "DATA_UNAVAILABLE");
  }
});

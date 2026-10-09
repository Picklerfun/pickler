import test from "node:test";
import assert from "node:assert/strict";
import { PerplStreamState, PerplPublicStream, type PerplSocket } from "@pickler/infrastructure";
import { normalizePerplBook, normalizePerplTicker } from "@pickler/infrastructure";
import { choosePerplTransport, acquirePerpsFrames } from "@pickler/trading/perps";
import { PilotError, PERPL_LAB_SYMBOLS } from "@pickler/core";
import { studyFrame } from "./perps-study-fixtures.js";
const now = 1800000000000;
const markets = [studyFrame(now).snapshot.market, studyFrame(now, "ETH").snapshot.market];
const snapshot = (sid = 3, t = now) => ({
  mt: 15,
  sid,
  at: { t, b: 100 },
  bid: [{ p: 999, s: 10000000, o: 1 }],
  ask: [{ p: 1001, s: 10000000, o: 1 }],
});
const ticker = (t = now) => ({
  mt: 9,
  sid: 2,
  d: Object.fromEntries(
    markets.map((m) => [
      m.marketId,
      { at: { t, b: 100 }, mrk: 1000, orl: 1000, lst: 1000, bid: 999, ask: 1001, oi: 1000000 },
    ]),
  ),
});
function ready() {
  const state = new PerplStreamState(markets, "wss://app.perpl.xyz/ws/v1/market-data", 143);
  state.apply(
    {
      mt: 6,
      subs: state.streams().map((stream, i) => ({ stream, sid: i + 1, status: { code: 0 } })),
    },
    now,
  );
  state.apply(snapshot(), now);
  state.apply(snapshot(4), now);
  state.apply(ticker(), now);
  return state;
}
test("snapshot, deltas, deletion and duplicate deltas reconstruct exact depth", () => {
  const state = ready();
  const change = {
    mt: 16,
    sid: 3,
    at: { t: now + 1000, b: 101 },
    bid: [
      { p: 999, s: 0, o: 0 },
      { p: 998, s: 20000000, o: 2 },
    ],
    ask: [],
  };
  state.apply(change, now + 1000);
  state.apply(change, now + 1000);
  assert.deepEqual(state.frame("BTC", now + 1000).book.bids, [
    { price: "99.8", size: "200", orders: 2 },
  ]);
  state.apply({ mt: 100, sn: 1, h: 101 }, now + 5000);
  assert.equal(state.frame("BTC", now + 5000).book.provenance.providerTimestamp, now + 1000);
});
test("stream and REST share decimal, freshness and order normalization", () => {
  const state = ready(),
    market = markets[0]!;
  const response = { url: state.url, body: "", receivedAt: now };
  assert.deepEqual(
    state.frame("BTC", now).snapshot.ticker,
    normalizePerplTicker(market, response, ticker().d[1]!, now),
  );
  assert.deepEqual(
    state.frame("BTC", now).book,
    normalizePerplBook(market, response, snapshot(), 20, now),
  );
});
test("missing snapshots, regression, crossed books, identity and subscriptions fail closed", () => {
  const state = ready();
  assert.throws(() => state.apply({ ...snapshot(), at: { t: now - 1, b: 99 } }, now), {
    code: "PERPL_STREAM_REGRESSION",
  });
  assert.throws(() => state.apply({ ...snapshot(), sid: 99 }, now), {
    code: "PERPL_STREAM_IDENTITY",
  });
  assert.throws(() => state.apply({ ...snapshot(), ask: [{ p: 998, s: 1, o: 1 }] }, now), {
    code: "PERPL_INVALID_RESPONSE",
  });
  assert.throws(() => state.apply({ mt: 6, subs: [] }, now), { code: "PERPL_STREAM_SUBSCRIPTION" });
  state.reset();
  assert.throws(() => state.frame("BTC", now), { code: "DATA_UNAVAILABLE" });
  state.apply({ mt: 6, subs: state.streams().map((stream, i) => ({ stream, sid: i + 1 })) }, now);
  assert.throws(() => state.apply({ ...snapshot(), mt: 16 }, now), {
    code: "PERPL_STREAM_SNAPSHOT_REQUIRED",
  });
});
test("heartbeat gap proves discontinuity; duplicate heartbeat is harmless", () => {
  const state = ready();
  state.apply({ mt: 100, sn: 1, h: 100 }, now);
  state.apply({ mt: 100, sn: 1, h: 100 }, now);
  assert.throws(() => state.apply({ mt: 100, sn: 3, h: 102 }, now), {
    code: "PERPL_STREAM_DISCONTINUITY",
  });
});
test("invalid levels and bounded state reject excessive data", () => {
  const state = ready();
  assert.throws(() => state.apply({ ...snapshot(), bid: [{ p: 999, s: 0, o: 1 }] }, now));
  assert.throws(() =>
    state.apply(
      {
        ...snapshot(),
        bid: Array.from({ length: 10001 }, (_, i) => ({ p: 20000 - i, s: 1, o: 1 })),
      },
      now,
    ),
  );
  const large = {
    ...snapshot(),
    bid: Array.from({ length: 10000 }, (_, i) => ({ p: 20000 - i, s: 1, o: 1 })),
    ask: [{ p: 20001, s: 1, o: 1 }],
  };
  state.apply(large, now);
  assert.throws(
    () =>
      state.apply(
        { mt: 16, sid: 3, at: { t: now + 1, b: 101 }, bid: [{ p: 10000, s: 1, o: 1 }], ask: [] },
        now,
      ),
    { code: "PERPL_STREAM_STATE_LIMIT" },
  );
});
class Socket implements PerplSocket {
  readyState = 0;
  listeners = new Map<string, Array<(event: { data?: unknown }) => void>>();
  sent: string[] = [];
  addEventListener(type: string, fn: (event: { data?: unknown }) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  emit(type: string, event: { data?: unknown } = {}) {
    for (const fn of this.listeners.get(type) ?? []) {
      fn(event);
    }
  }
  send(msg: string) {
    this.sent.push(msg);
  }
  close() {
    this.readyState = 3;
    this.emit("close");
  }
}
test("thirteen subscriptions yield an immutable eleven-market buffer; heartbeat preserves dates", () => {
  const universe = PERPL_LAB_SYMBOLS.map((symbol, index) => ({
    ...structuredClone(markets[0]!),
    symbol,
    marketId: index + 1,
    perpetualId: index + 1,
  }));
  const state = new PerplStreamState(universe, "wss://app.perpl.xyz/ws/v1/market-data", 143);
  assert.equal(state.streams().length, 13);
  state.apply({ mt: 6, subs: state.streams().map((stream, i) => ({ stream, sid: i + 1 })) }, now);
  state.apply(
    { mt: 9, d: Object.fromEntries(universe.map((m) => [m.marketId, ticker().d[1]])) },
    now,
  );
  for (let i = 0; i < 11; i++) {
    state.apply(snapshot(i + 3), now);
  }
  const copy = state.components(PERPL_LAB_SYMBOLS, now);
  copy[0]!.snapshot!.market.marketId = 1000;
  copy[0]!.book!.bids[0]!.price = "0";
  state.apply({ mt: 100, sn: 1, h: 101 }, now + 31000);
  const unchanged = state.components(PERPL_LAB_SYMBOLS, now + 31000);
  assert.equal(unchanged.length, 11);
  assert.equal(unchanged[0]!.snapshot!.market.marketId, 1);
  assert.equal(unchanged[0]!.book!.bids[0]!.price, "99.9");
  assert.ok(
    unchanged.every(
      (c) =>
        c.snapshot!.ticker.provenance.providerTimestamp === now &&
        c.book!.provenance.providerTimestamp === now,
    ),
  );
});

test("queue overflow closes the reader without silently discarding required updates", async () => {
  let release: () => void = () => {};
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  let blocking = false;
  const socket = new Socket();
  const events: unknown[] = [];
  const stream = new PerplPublicStream({
    markets,
    signal: new AbortController().signal,
    now: () => now,
    guard: async () => {
      if (blocking) {
        await blocked;
      }
    },
    event: (event) => events.push(event),
    socket: () => {
      queueMicrotask(() => {
        socket.readyState = 1;
        socket.emit("open");
      });
      return socket;
    },
  });
  await stream.connect(new AbortController().signal);
  blocking = true;
  for (let i = 0; i < 33; i++) {
    socket.emit("message", { data: JSON.stringify({ mt: 100, sn: i + 1, h: i + 100 }) });
  }
  assert.equal(socket.readyState, 3);
  release();
  await stream.close();
  await assert.rejects(stream.latest(["BTC", "ETH"], new AbortController().signal), {
    code: "PERPL_STREAM_MESSAGE_LIMIT",
  });
  assert.match(JSON.stringify(events), /PERPL_STREAM_MESSAGE_LIMIT/);
});

test("queued messages from a disconnected generation cannot seed its replacement", async () => {
  const sockets: Socket[] = [];
  let blocking = false;
  let release: () => void = () => {};
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  const stream = new PerplPublicStream({
    markets,
    signal: new AbortController().signal,
    now: () => now,
    guard: async () => {
      if (blocking) {
        await blocked;
      }
    },
    socket: () => {
      const socket = new Socket();
      sockets.push(socket);
      queueMicrotask(() => {
        socket.readyState = 1;
        socket.emit("open");
      });
      return socket;
    },
  });
  try {
    await stream.connect(new AbortController().signal);
    blocking = true;
    sockets[0]!.emit("message", {
      data: JSON.stringify({
        mt: 6,
        subs: stream.state.streams().map((stream, i) => ({ stream, sid: i + 1 })),
      }),
    });
    sockets[0]!.emit("message", { data: JSON.stringify(snapshot()) });
    sockets[0]!.close();
    blocking = false;
    release();
    await stream.connect(new AbortController().signal);
    const copy = await stream.latest(["BTC", "ETH"], new AbortController().signal);
    assert.ok(copy.components.every((c) => c.snapshot === undefined && c.book === undefined));
    assert.equal(sockets.length, 2);
  } finally {
    await stream.close();
  }
});
test("revocation closes socket, discards buffer and blocks reuse", async () => {
  let revoked = false;
  const socket = new Socket();
  const stream = new PerplPublicStream({
    markets,
    signal: new AbortController().signal,
    guard: async () => {
      if (revoked) {
        throw new PilotError("LEASE_LOST", "lost");
      }
    },
    socket: () => {
      queueMicrotask(() => {
        socket.readyState = 1;
        socket.emit("open");
      });
      return socket;
    },
    now: () => now,
  });
  try {
    await stream.connect(new AbortController().signal);
    assert.equal(JSON.parse(socket.sent[0]!).subs.length, 4);
    revoked = true;
    await assert.rejects(stream.frame("BTC", new AbortController().signal), { code: "LEASE_LOST" });
    // The periodic fence must also revoke an idle connection.
    await new Promise((resolve) => setTimeout(resolve, 1050));
    assert.equal(socket.readyState, 3);
    assert.throws(() => stream.state.frame("BTC", now), { code: "DATA_UNAVAILABLE" });
  } finally {
    await stream.close();
  }
});
test("transport selection is frozen and requires strict superiority", () => {
  const base = { opportunities: 10, reconstructionErrors: 0, ownershipErrors: 0 };
  assert.equal(
    choosePerplTransport({ ...base, restValid: 8, websocketValid: 9 }).policy,
    "stream-20s-v1",
  );
  for (const input of [
    { restValid: 9, websocketValid: 9 },
    { restValid: 7, websocketValid: 8 },
    { restValid: 8, websocketValid: 10, reconstructionErrors: 1 },
    { restValid: 8, websocketValid: 10, ownershipErrors: 1 },
  ]) {
    assert.equal(choosePerplTransport({ ...base, ...input }).policy, "rest-paced-20s-v1");
  }
});
test("repeated timestamp delays only public acquisition; BTC alone cannot return", async () => {
  let clock = now,
    waits = 0;
  const inputs = {
    network: "mainnet" as const,
    symbols: ["BTC", "ETH"] as const,
    now: () => clock,
    signal: new AbortController().signal,
    guard: async () => {},
    hash: () => "a".repeat(64),
    snapshot: async (symbol: "BTC" | "ETH") => {
      clock += 1000;
      return studyFrame(symbol === "BTC" ? clock : now - 15000, symbol).snapshot;
    },
    book: async (symbol: "BTC" | "ETH") => {
      clock += 1000;
      return studyFrame(clock, symbol).book;
    },
    repeatedTimestampWait: async () => {
      waits++;
      clock += 2000;
    },
  };
  await assert.rejects(acquirePerpsFrames(inputs), { code: "DATA_UNAVAILABLE" });
  assert.ok(waits > 0);
});

test("rejected subscription and malformed data cannot produce a frame", () => {
  const state = ready();
  assert.throws(
    () =>
      state.apply(
        {
          mt: 6,
          subs: state
            .streams()
            .map((stream, i) => ({ stream, sid: i + 1, status: { code: i === 1 ? 404 : 0 } })),
        },
        now,
      ),
    { code: "PERPL_STREAM_SUBSCRIPTION" },
  );
  assert.throws(() =>
    state.apply({ mt: 9, d: { 1: { at: { t: now, b: 100 }, mrk: "secret" } } }, now),
  );
  const other = ready();
  other.reset();
  assert.throws(() => other.frame("ETH", now), { code: "DATA_UNAVAILABLE" });
});
test("disconnect discards all state and reconnect requires a new snapshot", async () => {
  const sockets: Socket[] = [];
  const stream = new PerplPublicStream({
    markets,
    signal: new AbortController().signal,
    guard: async () => {},
    now: () => now,
    socket: () => {
      const socket = new Socket();
      sockets.push(socket);
      queueMicrotask(() => {
        socket.readyState = 1;
        socket.emit("open");
      });
      return socket;
    },
  });
  try {
    const signal = new AbortController().signal;
    await stream.connect(signal);
    sockets[0]!.close();
    assert.throws(() => stream.state.frame("BTC", now), { code: "DATA_UNAVAILABLE" });
    await stream.connect(signal);
    sockets[1]!.close();
    await assert.rejects(stream.connect(signal), { code: "DATA_UNAVAILABLE" });
    assert.equal(sockets.length, 2);
  } finally {
    await stream.close();
  }
});
test("message bounds invalidate the socket without retaining an authenticated payload", async () => {
  const socket = new Socket(),
    events: unknown[] = [];
  const stream = new PerplPublicStream({
    markets,
    signal: new AbortController().signal,
    guard: async () => {},
    now: () => now,
    event: (event) => events.push(event),
    socket: () => {
      queueMicrotask(() => {
        socket.readyState = 1;
        socket.emit("open");
      });
      return socket;
    },
  });
  try {
    await stream.connect(new AbortController().signal);
    socket.emit("message", { data: JSON.stringify({ mt: 29, api_key: "must-not-retain" }) });
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(socket.readyState, 3);
    assert.equal(JSON.stringify(events).includes("must-not-retain"), false);
  } finally {
    await stream.close();
  }
  const oversized = new Socket();
  const bounded = new PerplPublicStream({
    markets,
    signal: new AbortController().signal,
    guard: async () => {},
    socket: () => {
      queueMicrotask(() => {
        oversized.readyState = 1;
        oversized.emit("open");
      });
      return oversized;
    },
  });
  try {
    await bounded.connect(new AbortController().signal);
    oversized.emit("message", { data: "x".repeat(2 * 1024 * 1024 + 1) });
    assert.equal(oversized.readyState, 3);
  } finally {
    await bounded.close();
  }
});

test("identical subscription acknowledgments do not regress a reconstructed book", () => {
  const state = ready();
  state.apply(
    {
      mt: 6,
      subs: state.streams().map((stream, i) => ({ stream, sid: i + 1, status: { code: 0 } })),
    },
    now,
  );
  assert.equal(state.frame("BTC", now).book.bids[0]!.price, "99.9");
});

test("proven discontinuity resubscribes within its bound and cannot reuse the prior book", async () => {
  const sockets: Socket[] = [];
  const stream = new PerplPublicStream({
    markets,
    signal: new AbortController().signal,
    guard: async () => {},
    now: () => now,
    socket: () => {
      const socket = new Socket();
      sockets.push(socket);
      queueMicrotask(() => {
        socket.readyState = 1;
        socket.emit("open");
      });
      return socket;
    },
  });
  const signal = new AbortController().signal;
  const message = (socket: Socket, raw: unknown) =>
    socket.emit("message", { data: JSON.stringify(raw) });
  const subscribe = (socket: Socket) =>
    message(socket, {
      mt: 6,
      subs: stream.state
        .streams()
        .map((name, i) => ({ stream: name, sid: i + 1, status: { code: 0 } })),
    });
  try {
    await stream.connect(signal);
    subscribe(sockets[0]!);
    message(sockets[0]!, snapshot());
    message(sockets[0]!, snapshot(4));
    message(sockets[0]!, ticker());
    message(sockets[0]!, { mt: 100, sn: 1, h: 100 });
    message(sockets[0]!, { mt: 100, sn: 3, h: 102 });
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(sockets[0]!.readyState, 3);
    await stream.connect(signal);
    await assert.rejects(stream.frame("BTC", signal), { code: "DATA_UNAVAILABLE" });
    subscribe(sockets[1]!);
    message(sockets[1]!, snapshot());
    message(sockets[1]!, snapshot(4));
    message(sockets[1]!, ticker());
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal((await stream.frame("BTC", signal)).snapshot.market.symbol, "BTC");
    assert.equal(sockets.length, 2);
  } finally {
    await stream.close();
  }
});

test("joint deadline also bounds a blocked ownership lookup without provider calls", async () => {
  const { createPerplAcquisitionReader } =
    await import("@pickler/agent-runtime/plugins/perps-paper");
  const reader = createPerplAcquisitionReader(
    { agent: () => new Promise(() => {}) },
    { policy: "rest-paced-20s-v1" },
  );
  try {
    await assert.rejects(
      reader.read(
        { tenantId: "tenant", agentId: "agent" },
        ["BTC", "ETH"],
        new AbortController().signal,
        undefined,
        Date.now() + 20,
      ),
      { code: "DATA_UNAVAILABLE" },
    );
  } finally {
    await reader.close();
  }
  assert.throws(
    () =>
      createPerplAcquisitionReader(
        { agent: () => new Promise(() => {}) },
        { policy: "unknown" as "stream-20s-v1" },
      ),
    { code: "INVALID_INPUT" },
  );
});

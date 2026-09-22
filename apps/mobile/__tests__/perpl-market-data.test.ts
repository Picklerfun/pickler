import fixture from "./fixtures/perpl/market-data-frames.json";
import { RECONNECT_DELAYS_MS } from "../src/perpl/config";
import {
  applyBookFrame, bestPrices, type Book, type BookFrame, EMPTY_BOOK, MarketDataSocket, type MarketDataEvent, parseBookFrame, spreadBps, subscribeFrame, targetPosition, topLevels,
} from "../src/perpl/marketData";
import type { WebSocketLike } from "../src/perpl/ws";

const raw = fixture.frames as Record<string, unknown>[];
const json = (f: unknown) => JSON.stringify(f);
const SUB = raw.find((f) => f.mt === 6)!;
const SNAP = raw.find((f) => f.mt === 15)!;
const UPDATES = raw.filter((f) => f.mt === 16);
const SID = (SUB.subs as { sid: number }[])[0].sid;

class FakeSocket implements WebSocketLike {
  readyState = 0;
  sent: string[] = [];
  closed = false;
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: { code: number; reason: string }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  send(d: string) { this.sent.push(d); }
  close() { this.closed = true; this.readyState = 3; }
  open() { this.readyState = 1; this.onopen?.({}); }
  receive(f: unknown) { this.onmessage?.({ data: json(f) }); }
  drop(code = 1006) { this.readyState = 3; this.onclose?.({ code, reason: "" }); }
}

function boot(marketId = 16) {
  const fakes: FakeSocket[] = [];
  const events: MarketDataEvent[] = [];
  const socket = new MarketDataSocket({ url: "wss://x.test/md", marketId, onEvent: (e) => events.push(e), createSocket: () => { const f = new FakeSocket(); fakes.push(f); return f; } });
  socket.connect();
  fakes[0].open();
  return { socket, fakes, events, fake: fakes[0] };
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

// --- parser -----------------------------------------------------------------

test("the fixture has the three shapes D11 relies on", () => {
  expect(fixture.stream).toBe("order-book@16");
  expect(UPDATES.length).toBeGreaterThanOrEqual(1);
  expect((SUB.subs as { status: { code: number } }[])[0].status.code).toBe(0);
});

test("parseBookFrame reads mt 6, 15 and 16 from the real frames and ignores the rest", () => {
  const sub = parseBookFrame(json(SUB));
  expect(sub).toEqual({ mt: 6, subs: [{ stream: "order-book@16", sid: SID, code: 0 }] });
  const snap = parseBookFrame(json(SNAP)) as Extract<BookFrame, { mt: 15 }>;
  expect(snap.mt).toBe(15);
  expect(snap.sid).toBe(SID);
  expect(snap.at).toBe((SNAP.at as { t: number }).t);
  expect(snap.bid.length).toBe((SNAP.bid as unknown[]).length);
  expect(snap.ask[0]).toEqual((SNAP.ask as unknown[])[0]);
  const upd = parseBookFrame(json(UPDATES[0])) as Extract<BookFrame, { mt: 16 }>;
  expect(upd.mt).toBe(16);
  expect(upd.sid).toBe(SID);
  expect(parseBookFrame(json({ mt: 2 }))).toBeNull();
  expect(parseBookFrame(json({ mt: 15, sid: 1, bid: [{ p: "x" }], ask: [] }))).toBeNull();
  expect(parseBookFrame(json({ mt: 16, sid: 1, bid: [{ p: 1, s: 2, o: 1 }] }))).toEqual({ mt: 16, sid: 1, at: null, bid: [{ p: 1, s: 2, o: 1 }], ask: [] });
  expect(parseBookFrame("nope")).toBeNull();
  expect(parseBookFrame(42)).toBeNull();
});

test("parseBookFrame keeps per-subscription failures (404/429) with their error", () => {
  expect(parseBookFrame(json({ mt: 6, subs: [{ stream: "order-book@999", status: { code: 404, error: "unknown stream" } }] })))
    .toEqual({ mt: 6, subs: [{ stream: "order-book@999", code: 404, error: "unknown stream" }] });
});

// --- libro ------------------------------------------------------------------

const snapFrame = parseBookFrame(json(SNAP))!;

test("a snapshot replaces the book and keeps best prices first after sorting", () => {
  const book = applyBookFrame(EMPTY_BOOK, snapFrame);
  expect(book).not.toBe(EMPTY_BOOK);
  expect(EMPTY_BOOK.bids.size).toBe(0);
  expect(book.bids.size).toBe(new Set((SNAP.bid as { p: number }[]).map((l) => l.p)).size);
  expect(topLevels(book, "bid", 1)[0].p).toBe((SNAP.bid as { p: number }[])[0].p);
  expect(topLevels(book, "ask", 1)[0].p).toBe((SNAP.ask as { p: number }[])[0].p);
  const bids = topLevels(book, "bid");
  expect(bids.length).toBeLessThanOrEqual(5);
  for (let i = 1; i < bids.length; i++) expect(bids[i].p).toBeLessThan(bids[i - 1].p);
  const asks = topLevels(book, "ask");
  for (let i = 1; i < asks.length; i++) expect(asks[i].p).toBeGreaterThan(asks[i - 1].p);
});

test("updates are deltas per price level: o 0 removes, anything else upserts (P4, real frames)", () => {
  let book = applyBookFrame(EMPTY_BOOK, snapFrame);
  for (const u of UPDATES) book = applyBookFrame(book, parseBookFrame(json(u))!);
  const last = parseBookFrame(json(UPDATES[UPDATES.length - 1])) as Extract<BookFrame, { mt: 16 }>;
  for (const l of last.bid) expect(book.bids.get(l.p)).toEqual(l.o === 0 ? undefined : l);
  for (const l of last.ask) expect(book.asks.get(l.p)).toEqual(l.o === 0 ? undefined : l);
  expect(book.at).toBe(last.at ?? book.at);
});

test("updates are deltas per price level (synthetic: remove, replace, add, unchanged side)", () => {
  const base = applyBookFrame(EMPTY_BOOK, { mt: 15, sid: 1, at: 100, bid: [{ p: 1000, s: 5, o: 1 }, { p: 990, s: 7, o: 2 }], ask: [{ p: 1010, s: 3, o: 1 }] });
  const next = applyBookFrame(base, { mt: 16, sid: 1, at: 101, bid: [{ p: 1000, s: 0, o: 0 }, { p: 995, s: 4, o: 1 }], ask: [{ p: 1010, s: 9, o: 3 }] });
  expect([...next.bids.keys()].sort()).toEqual([990, 995]);
  expect(next.asks.get(1010)).toEqual({ p: 1010, s: 9, o: 3 });
  expect(next.at).toBe(101);
  expect(base.bids.get(1000)).toEqual({ p: 1000, s: 5, o: 1 }); // el anterior no se muta
  expect(applyBookFrame(next, { mt: 6, subs: [] })).toBe(next);
});

test("bestPrices, spreadBps and targetPosition", () => {
  const book: Book = applyBookFrame(EMPTY_BOOK, { mt: 15, sid: 1, at: null, bid: [{ p: 100_000, s: 1, o: 1 }, { p: 99_990, s: 1, o: 1 }], ask: [{ p: 100_010, s: 1, o: 1 }, { p: 100_020, s: 1, o: 1 }] });
  expect(bestPrices(book)).toEqual({ bid: 100_000, ask: 100_010 });
  expect(spreadBps(book)).toBeCloseTo(0.99995, 4);
  expect(targetPosition(book, 100_500)).toBe("above");
  expect(targetPosition(book, 99_000)).toBe("below");
  expect(targetPosition(book, 100_005)).toBe("inside");
  expect(targetPosition(book, 100_000)).toBe("inside");
  expect(targetPosition(book, 100_010)).toBe("inside");
  expect(bestPrices(EMPTY_BOOK)).toEqual({ bid: null, ask: null });
  expect(spreadBps(EMPTY_BOOK)).toBeNull();
  expect(targetPosition(EMPTY_BOOK, 1)).toBeNull();
  const crossed = applyBookFrame(EMPTY_BOOK, { mt: 15, sid: 1, at: null, bid: [{ p: 101, s: 1, o: 1 }], ask: [{ p: 100, s: 1, o: 1 }] });
  expect(spreadBps(crossed)).toBeLessThan(0); // testnet cruza a veces: se muestra tal cual
});

// --- socket -----------------------------------------------------------------

test("the first (and only) frame is the subscription; the snapshot makes it live; no pings ever", () => {
  const { socket, fake, events } = boot();
  expect(fake.sent).toEqual([subscribeFrame(16)]);
  expect(JSON.parse(subscribeFrame(16))).toEqual({ mt: 5, subs: [{ stream: "order-book@16", subscribe: true }] });
  fake.receive(SUB);
  expect(socket.status).toBe("connecting");
  fake.receive(SNAP);
  expect(socket.status).toBe("live");
  expect(topLevels(socket.book, "bid", 1)[0].p).toBe((SNAP.bid as { p: number }[])[0].p);
  jest.advanceTimersByTime(60_000);
  expect(fake.sent.length).toBe(1);
  expect(events.filter((e) => e.type === "status").map((e) => (e as { status: string }).status)).toEqual(["connecting", "live"]);
  expect(events.filter((e) => e.type === "book").length).toBe(1);
});

test("frames from another subscription id are ignored", () => {
  const { socket, fake } = boot();
  fake.receive(SUB);
  fake.receive({ ...SNAP, sid: SID + 1 });
  expect(socket.status).toBe("connecting");
  expect(socket.book.bids.size).toBe(0);
});

test("a rejected stream closes without reconnecting (P6)", () => {
  const { socket, fake, fakes, events } = boot(999);
  fake.receive({ mt: 6, subs: [{ stream: "order-book@999", status: { code: 404, error: "unknown stream" } }] });
  expect(socket.status).toBe("closed");
  expect(fake.closed).toBe(true);
  expect(events).toContainEqual({ type: "rejected", code: 404, error: "unknown stream" });
  jest.advanceTimersByTime(120_000);
  expect(fakes.length).toBe(1);
});

test("a dropped socket reconnects with backoff and resubscribes; the old book stays until the new snapshot", () => {
  const { socket, fake, fakes } = boot();
  fake.receive(SUB);
  fake.receive(SNAP);
  fake.drop();
  expect(socket.status).toBe("reconnecting");
  expect(socket.book.bids.size).toBeGreaterThan(0);
  jest.advanceTimersByTime(RECONNECT_DELAYS_MS[0] - 1);
  expect(fakes.length).toBe(1);
  jest.advanceTimersByTime(1);
  expect(fakes.length).toBe(2);
  fakes[1].open();
  expect(fakes[1].sent).toEqual([subscribeFrame(16)]);
  fakes[1].drop();
  jest.advanceTimersByTime(RECONNECT_DELAYS_MS[1]);
  expect(fakes.length).toBe(3);
  fakes[2].open();
  fakes[2].receive(SUB);
  fakes[2].receive(SNAP);
  expect(socket.status).toBe("live");
});

test("1001 (server going away) reconnects immediately the first time", () => {
  const { fake, fakes } = boot();
  fake.drop(1001);
  expect(fakes.length).toBe(1); // la reconexión sigue pasando por el timer (delay 0), nunca inline en onclose
  jest.advanceTimersByTime(1);
  expect(fakes.length).toBe(2);
});

test("close() by the user never reconnects", () => {
  const { socket, fake, fakes } = boot();
  socket.close();
  expect(fake.closed).toBe(true);
  expect(socket.status).toBe("closed");
  jest.advanceTimersByTime(120_000);
  expect(fakes.length).toBe(1);
});

import { ed25519 } from "@noble/curves/ed25519.js";
import { base64urlnopad } from "@scure/base";
import { hexToBytes } from "viem";
import frames from "./fixtures/perpl/ws-frames.json";
import { generateTradingKey, wsSigninCanonical } from "../src/perpl/apiKey";
import { openIntent } from "../src/perpl/orders";
import { parseContext } from "../src/perpl/context";
import contextJson from "./fixtures/perpl/context.json";
import { type SocketEvent, TradingSocket, type WebSocketLike } from "../src/perpl/ws";

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
  receive(f: unknown) { this.onmessage?.({ data: JSON.stringify(f) }); }
  drop(code = 1006) { this.readyState = 3; this.onclose?.({ code, reason: "" }); }
  frames(): Record<string, unknown>[] { return this.sent.map((s) => JSON.parse(s)); }
}

const MON = parseContext(contextJson).markets.find((m) => m.id === 64)!;
const HEAD = 63177640;

function boot(live = true) {
  const fakes: FakeSocket[] = [];
  const events: SocketEvent[] = [];
  const { privateKey, publicKeyHex } = generateTradingKey();
  const socket = new TradingSocket({
    url: "wss://x.test/ws", chainId: 10143, apiKey: "key-123", privateKey,
    onEvent: (e) => events.push(e), createSocket: () => { const f = new FakeSocket(); fakes.push(f); return f; }, now: () => 1789606875716,
  });
  socket.connect();
  const fake = fakes[0];
  fake.open();
  if (live) {
    fake.receive(frames.walletSnapshot);
    fake.receive(frames.ordersSnapshotEmpty);
    fake.receive(frames.positionsSnapshotEmpty);
    fake.receive({ ...frames.heartbeat, sn: HEAD, h: HEAD });
  }
  return { socket, fakes, events, fake, publicKeyHex };
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

test("the first frame is a verifiable mt 29 sign-in and the snapshot makes the socket live", () => {
  const { socket, fake, events, publicKeyHex } = boot();
  const signin = fake.frames()[0];
  expect(signin).toMatchObject({ mt: 29, chain_id: 10143, api_key: "key-123", timestamp: "1789606875716" });
  const canonical = wsSigninCanonical(10143, signin.timestamp as string, signin.nonce as string);
  expect(ed25519.verify(base64urlnopad.decode(signin.signature as string), new TextEncoder().encode(canonical), hexToBytes(publicKeyHex))).toBe(true);
  expect(socket.status).toBe("live");
  expect(socket.state.account?.id).toBe(619);
  expect(socket.state.head).toBe(HEAD);
  expect(events.filter((e) => e.type === "status").map((e) => e.type === "status" && e.status)).toEqual(["connecting", "live"]);
});

test("pings every 3 s while open", () => {
  const { fake } = boot();
  const before = fake.frames().filter((f) => f.mt === 1).length;
  jest.advanceTimersByTime(3000);
  expect(fake.frames().filter((f) => f.mt === 1).length).toBe(before + 1);
  jest.advanceTimersByTime(3000);
  expect(fake.frames().filter((f) => f.mt === 1).length).toBe(before + 2);
});

test("placeOrder: rq = lfr + 1, lb = head + ttl; resolves filled on the first non-failure mt 24", async () => {
  const { socket, fake } = boot();
  const p = socket.placeOrder(openIntent(MON, 619, "long", 100, 1));
  const sent = fake.frames().find((f) => f.mt === 22)!;
  expect(sent).toMatchObject({ sn: 1, rq: 6, lb: HEAD + 20, mkt: 64, acc: 619, t: 1, s: 100, p: 0, fl: 4, ms: 100, lv: 100 });
  fake.receive({ ...frames.statusAccepted, cid: 1 });
  fake.receive(frames.accountAfterOpen);
  fake.receive(frames.orderFilledOpen);
  await expect(p).resolves.toMatchObject({ kind: "filled", order: { fp: 2221, fs: 100, f: 767n } });
  expect(socket.state.account?.lfr).toBe(6);
});

test("two orders in flight get strictly increasing rq even before lfr moves", () => {
  const { socket, fake } = boot();
  void socket.placeOrder(openIntent(MON, 619, "long", 100, 1)).catch(() => {});
  void socket.placeOrder(openIntent(MON, 619, "long", 100, 1)).catch(() => {});
  const rqs = fake.frames().filter((f) => f.mt === 22).map((f) => f.rq);
  expect(rqs).toEqual([6, 7]);
  const sns = fake.frames().filter((f) => f.mt === 22).map((f) => f.sn);
  expect(sns).toEqual([1, 2]);
});

test("a gateway rejection (mt 3 code ≠ 0) rejects immediately with the gateway error", async () => {
  const { socket, fake } = boot();
  const p = socket.placeOrder(openIntent(MON, 619, "long", 100, 1));
  fake.receive({ ...frames.statusExpiredLb, cid: 1 });
  await expect(p).rejects.toThrow("last exec block already expired");
});

test("sr 32 retries exactly once with a fresh rq, then resolves with the fill", async () => {
  const { socket, fake } = boot();
  const p = socket.placeOrder(openIntent(MON, 619, "long", 100, 1));
  fake.receive({ ...frames.statusAccepted, cid: 1 });
  fake.receive({ ...frames.orderFailedTooLow, d: [{ ...frames.orderFailedTooLow.d[0], rq: 6 }] });
  const sent = fake.frames().filter((f) => f.mt === 22);
  expect(sent).toHaveLength(2);
  expect(sent[1]).toMatchObject({ sn: 2, rq: 7, t: 1, s: 100 });
  fake.receive({ ...frames.statusAccepted, cid: 2 });
  fake.receive({ ...frames.orderFilledOpen, d: [{ ...frames.orderFilledOpen.d[0], rq: 7 }] });
  await expect(p).resolves.toMatchObject({ kind: "filled" });
});

test("a second sr 32 fails the order instead of retrying again", async () => {
  const { socket, fake } = boot();
  const p = socket.placeOrder(openIntent(MON, 619, "long", 100, 1));
  fake.receive({ ...frames.orderFailedTooLow, d: [{ ...frames.orderFailedTooLow.d[0], rq: 6 }] });
  fake.receive({ ...frames.orderFailedTooLow, d: [{ ...frames.orderFailedTooLow.d[0], rq: 7 }] });
  expect(fake.frames().filter((f) => f.mt === 22)).toHaveLength(2);
  await expect(p).resolves.toMatchObject({ kind: "failed", text: "Order id too low — retrying" });
});

test("other failures resolve failed with the described reason (sr 34)", async () => {
  const { socket, fake } = boot();
  const p = socket.placeOrder(openIntent(MON, 619, "long", 100, 1));
  fake.receive({ ...frames.orderFailedTooLow, d: [{ ...frames.orderFailedTooLow.d[0], rq: 6, sr: 34 }] });
  await expect(p).resolves.toMatchObject({ kind: "failed", text: "One-click trading is off. Enable trading again" });
});

test("late frames for an already-resolved rq are ignored", async () => {
  const { socket, fake } = boot();
  const p = socket.placeOrder(openIntent(MON, 619, "long", 100, 1));
  fake.receive(frames.orderFilledOpen);
  await expect(p).resolves.toMatchObject({ kind: "filled" });
  expect(() => fake.receive({ ...frames.orderFailedTooLow, d: [{ ...frames.orderFailedTooLow.d[0], rq: 6 }] })).not.toThrow();
});

test("no mt 24 within 30 s resolves unknown", async () => {
  const { socket } = boot();
  const p = socket.placeOrder(openIntent(MON, 619, "long", 100, 1));
  jest.advanceTimersByTime(30_000);
  await expect(p).resolves.toEqual({ kind: "unknown" });
});

test("placeOrder rejects when the socket is not live", async () => {
  const { socket } = boot(false);
  await expect(socket.placeOrder(openIntent(MON, 619, "long", 100, 1))).rejects.toThrow("Not connected to Perpl");
});

test("a dropped socket reconnects with backoff, moves pending orders to unknown and the new snapshot replaces the state", async () => {
  const { socket, fakes, fake, events } = boot();
  const p = socket.placeOrder(openIntent(MON, 619, "long", 100, 1));
  fake.drop(1008);
  expect(socket.status).toBe("reconnecting");
  await expect(p).resolves.toEqual({ kind: "unknown" });
  expect(fakes).toHaveLength(1);
  jest.advanceTimersByTime(999);
  expect(fakes).toHaveLength(1);
  jest.advanceTimersByTime(1);
  expect(fakes).toHaveLength(2);
  fakes[1].open();
  expect(fakes[1].frames()[0].mt).toBe(29);
  fakes[1].receive({ ...frames.walletSnapshot, as: [{ ...frames.walletSnapshot.as[0], lfr: 9 }] });
  expect(socket.status).toBe("live");
  expect(socket.state.account?.lfr).toBe(9);
  // el segundo drop espera 2 s (backoff) — y tras una conexión viva el contador vuelve a 1 s
  fakes[1].drop();
  jest.advanceTimersByTime(1000);
  expect(fakes).toHaveLength(3);
  expect(events.some((e) => e.type === "keyRejected")).toBe(false);
});

test("backoff grows 1·2·4 s while the socket keeps failing before going live", () => {
  const { fakes, fake } = boot(false);
  fake.drop();
  jest.advanceTimersByTime(1000);
  expect(fakes).toHaveLength(2);
  fakes[1].drop();
  jest.advanceTimersByTime(1999);
  expect(fakes).toHaveLength(2);
  jest.advanceTimersByTime(1);
  expect(fakes).toHaveLength(3);
  fakes[2].drop();
  jest.advanceTimersByTime(4000);
  expect(fakes).toHaveLength(4);
});

test("two consecutive 3401 closes emit keyRejected and stop reconnecting", () => {
  const { socket, fakes, fake, events } = boot(false);
  fake.drop(3401);
  jest.advanceTimersByTime(1000);
  expect(fakes).toHaveLength(2);
  fakes[1].drop(3401);
  expect(events.some((e) => e.type === "keyRejected")).toBe(true);
  expect(socket.status).toBe("closed");
  jest.advanceTimersByTime(60_000);
  expect(fakes).toHaveLength(2);
});

test("close() closes the socket for good: no ping, no reconnect", () => {
  const { socket, fakes, fake } = boot();
  socket.close();
  expect(fake.closed).toBe(true);
  expect(socket.status).toBe("closed");
  const sent = fake.sent.length;
  jest.advanceTimersByTime(60_000);
  expect(fake.sent.length).toBe(sent);
  expect(fakes).toHaveLength(1);
});

test("a retried order (sr 32) still times out after 30 s of silence", async () => {
  const { socket, fake } = boot();
  const p = socket.placeOrder(openIntent(MON, 619, "long", 100, 1));
  fake.receive({ ...frames.orderFailedTooLow, d: [{ ...frames.orderFailedTooLow.d[0], rq: 6 }] });
  expect(fake.frames().filter((f) => f.mt === 22)).toHaveLength(2);
  jest.advanceTimersByTime(30_000);
  await expect(p).resolves.toEqual({ kind: "unknown" });
});

test("a stale onmessage from a closed socket does not mutate state or flip status", () => {
  const { socket, fakes, fake } = boot();
  socket.close();
  socket.connect();
  const newFake = fakes[1];
  fake.receive(frames.walletSnapshot);
  expect(socket.status).not.toBe("live");
  expect(["connecting", "reconnecting"]).toContain(socket.status);
  newFake.open();
  newFake.receive(frames.walletSnapshot);
  newFake.receive(frames.ordersSnapshotEmpty);
  newFake.receive(frames.positionsSnapshotEmpty);
  newFake.receive({ ...frames.heartbeat, sn: HEAD, h: HEAD });
  expect(socket.status).toBe("live");
  expect(socket.state.account?.id).toBe(619);
});

test("connect() while a retry is scheduled does not create a duplicate socket", () => {
  const { socket, fakes, fake } = boot(false);
  fake.drop();
  socket.connect();
  jest.advanceTimersByTime(5000);
  expect(fakes).toHaveLength(2);
});

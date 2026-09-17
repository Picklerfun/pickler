import frames from "./fixtures/perpl/ws-frames.json";
import { applyFrame, EMPTY_STATE, type Frame, parseFrame } from "../src/perpl/ws";

const parse = (f: unknown): Frame => {
  const r = parseFrame(JSON.stringify(f));
  if (r === null) throw new Error("frame not parsed");
  return r;
};

test("parseFrame reads the real wallet snapshot (account 619, lfr 5, balance)", () => {
  const f = parse(frames.walletSnapshot);
  expect(f).toEqual({ mt: 19, sn: 63177628, account: { id: 619, frozen: false, fw: true, lfr: 5, b: 99_942_357n, lb: 0n } });
});

test("parseFrame reads status, heartbeat and pong", () => {
  expect(parse(frames.statusExpiredLb)).toEqual({ mt: 3, cid: 1, code: 400, error: "last exec block already expired" });
  expect(parse(frames.statusAccepted)).toEqual({ mt: 3, cid: 2, code: 0, error: "" });
  expect(parse(frames.heartbeat)).toEqual({ mt: 100, sn: 63177519, h: 63177519 });
  expect(parse(frames.pong)).toEqual({ mt: 2 });
});

test("parseFrame reads failed and filled orders", () => {
  const failed = parse(frames.orderFailedTooLow);
  expect(failed.mt).toBe(24);
  if (failed.mt !== 24) return;
  expect(failed.orders[0]).toMatchObject({ rq: 1, st: 7, sr: 32, oid: 0, r: true, fs: 0, f: 0n });
  const filled = parse(frames.orderFilledOpen);
  if (filled.mt !== 24) throw new Error();
  expect(filled.orders[0]).toMatchObject({ rq: 6, oid: 4140410077221, st: 4, sr: 43, t: 1, fp: 2221, fs: 100, os: 100, f: 767n, lv: 100, r: true });
  expect(filled.orders[0].fr).toBeUndefined();
});

test("parseFrame reads positions and the account update", () => {
  const opened = parse(frames.positionOpened);
  if (opened.mt !== 27) throw new Error();
  expect(opened.positions[0]).toMatchObject({ pid: 4140410077185, mkt: 64, sd: 1, st: 1, s: 100, ep: 2221, c: 2_223_000n, lv: 100, fee: 767n, dpnl: 0n });
  const closed = parse(frames.positionClosed);
  if (closed.mt !== 27) throw new Error();
  expect(closed.positions[0]).toMatchObject({ pid: 4140410077185, st: 2, s: 0, dpnl: -4000n, xp: 2217 });
  const acc = parse(frames.accountAfterOpen);
  expect(acc).toEqual({ mt: 21, account: { id: 619, frozen: false, fw: true, lfr: 6, b: 97_718_590n, lb: 0n } });
  const clamped = parse(frames.positionOpenedLv500Clamped);
  if (clamped.mt !== 27) throw new Error();
  expect(clamped.positions[0].lv).toBe(300);
});

test.each([
  ["not json", "nope"],
  ["no mt", "{}"],
  ["unrelated mt", JSON.stringify({ mt: 28, in: 12 })],
  ["orders without d", JSON.stringify({ mt: 24 })],
  ["order without rq", JSON.stringify({ mt: 24, d: [{ oid: 1 }] })],
  ["position with bad side", JSON.stringify({ mt: 27, d: [{ pid: 1, mkt: 64, sd: 3, st: 1, s: 1, ep: 1, c: "1", lv: 100, fee: "0", dpnl: "0" }] })],
  ["status without code", JSON.stringify({ mt: 3, status: {} })],
  ["binary payload", new ArrayBuffer(2)],
])("parseFrame returns null for %s", (_, data) => {
  expect(parseFrame(data)).toBeNull();
});

test("applyFrame builds the account, head and positions from the real sequence", () => {
  let s = applyFrame(EMPTY_STATE, parse(frames.walletSnapshot));
  expect(s.account?.id).toBe(619);
  expect(s.head).toBe(63177628);
  s = applyFrame(s, parse(frames.heartbeat));
  expect(s.head).toBe(63177519 > 63177628 ? 63177519 : 63177628); // el head nunca retrocede
  s = applyFrame(s, parse({ ...frames.heartbeat, sn: 63177700, h: 63177700 }));
  expect(s.head).toBe(63177700);
  s = applyFrame(s, parse(frames.positionsSnapshotEmpty));
  expect(s.positions.size).toBe(0);
  s = applyFrame(s, parse(frames.positionOpened));
  expect(s.positions.get(4140410077185)?.s).toBe(100);
  s = applyFrame(s, parse(frames.accountAfterOpen));
  expect(s.account).toMatchObject({ lfr: 6, b: 97_718_590n });
  s = applyFrame(s, parse(frames.positionClosed));
  expect(s.positions.size).toBe(0);
  expect(EMPTY_STATE.positions.size).toBe(0); // inmutable: el estado inicial no se tocó
});

test("applyFrame keeps only live orders (r: true removes, snapshot replaces)", () => {
  const open = { ...frames.orderFilledOpen.d[0], oid: 77, st: 2, sr: 35, r: undefined, fs: 0 };
  let s = applyFrame(EMPTY_STATE, parse({ mt: 23, d: [open] }));
  expect(s.orders.get(77)?.st).toBe(2);
  s = applyFrame(s, parse(frames.orderFilledOpen)); // r: true, oid distinto → no se añade
  expect([...s.orders.keys()]).toEqual([77]);
  s = applyFrame(s, parse({ mt: 24, d: [{ ...open, st: 4, r: true }] }));
  expect(s.orders.size).toBe(0);
  s = applyFrame(s, parse(frames.orderFailedTooLow)); // fallo con oid 0 no entra al mapa
  expect(s.orders.size).toBe(0);
  s = applyFrame(applyFrame(EMPTY_STATE, parse({ mt: 23, d: [open] })), parse(frames.ordersSnapshotEmpty));
  expect(s.orders.size).toBe(0);
});

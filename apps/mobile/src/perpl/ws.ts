// Tipos y parsers del WebSocket de trading de Perpl. Puro: sin react-native.
// Formas verificadas contra frames reales (__tests__/fixtures/perpl/ws-frames.json).

export type Account = { id: number; frozen: boolean; fw: boolean; lfr: number; b: bigint; lb: bigint };
export type Order = { rq: number; mkt: number; oid: number; st: number; sr: number; fr?: number; t: number; os: number; fp: number; fs: number; f: bigint; lv: number; r: boolean };
export type Position = { pid: number; mkt: number; sd: 1 | 2; st: number; s: number; ep: number; c: bigint; lv: number; fee: bigint; dpnl: bigint; xp?: number };
export type TradingState = { head: number; account: Account | null; orders: Map<number, Order>; positions: Map<number, Position> };

export const EMPTY_STATE: TradingState = { head: 0, account: null, orders: new Map(), positions: new Map() };

export type Frame =
  | { mt: 2 }
  | { mt: 3; cid?: number; code: number; error: string }
  | { mt: 19; sn: number; account: Account | null }
  | { mt: 21; account: Account }
  | { mt: 23; orders: Order[] }
  | { mt: 24; orders: Order[] }
  | { mt: 26; positions: Position[] }
  | { mt: 27; positions: Position[] }
  | { mt: 100; sn: number; h: number };

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => v !== null && typeof v === "object";
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const amount = (v: unknown): bigint | undefined => (typeof v === "string" && /^-?\d+$/.test(v) ? BigInt(v) : undefined);

function account(v: unknown): Account | undefined {
  if (!isRec(v)) return undefined;
  const id = num(v.id), lfr = num(v.lfr), b = amount(v.b), lb = amount(v.lb);
  if (id === undefined || lfr === undefined || b === undefined || lb === undefined) return undefined;
  return { id, frozen: v.fr === true, fw: v.fw === true, lfr, b, lb };
}

function order(v: unknown): Order | undefined {
  if (!isRec(v)) return undefined;
  const rq = num(v.rq), mkt = num(v.mkt), oid = num(v.oid), st = num(v.st), t = num(v.t), os = num(v.os), fp = num(v.fp), fs = num(v.fs), lv = num(v.lv), f = amount(v.f);
  if (rq === undefined || mkt === undefined || oid === undefined || st === undefined || t === undefined || os === undefined || fp === undefined || fs === undefined || lv === undefined || f === undefined) return undefined;
  const o: Order = { rq, mkt, oid, st, sr: num(v.sr) ?? 0, t, os, fp, fs, f, lv, r: v.r === true };
  const fr = num(v.fr);
  if (fr !== undefined) o.fr = fr;
  return o;
}

function position(v: unknown): Position | undefined {
  if (!isRec(v)) return undefined;
  const pid = num(v.pid), mkt = num(v.mkt), sd = num(v.sd), st = num(v.st), s = num(v.s), ep = num(v.ep), lv = num(v.lv), c = amount(v.c), fee = amount(v.fee), dpnl = amount(v.dpnl);
  if (pid === undefined || mkt === undefined || (sd !== 1 && sd !== 2) || st === undefined || s === undefined || ep === undefined || lv === undefined || c === undefined || fee === undefined || dpnl === undefined) return undefined;
  const p: Position = { pid, mkt, sd, st, s, ep, c, lv, fee, dpnl };
  const xp = num(v.xp);
  if (xp !== undefined) p.xp = xp;
  return p;
}

function list<T>(v: unknown, one: (x: unknown) => T | undefined): T[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: T[] = [];
  for (const x of v) {
    const item = one(x);
    if (item === undefined) return undefined;
    out.push(item);
  }
  return out;
}

/** `ev.data` del WebSocket de RN. Devuelve null para frames ajenos o malformados (se ignoran). */
export function parseFrame(data: unknown): Frame | null {
  if (typeof data !== "string") return null;
  let raw: unknown;
  try {
    raw = JSON.parse(data);
  } catch {
    return null;
  }
  if (!isRec(raw)) return null;
  switch (raw.mt) {
    case 2: return { mt: 2 };
    case 3: {
      if (!isRec(raw.status)) return null;
      const code = num(raw.status.code);
      if (code === undefined) return null;
      const f: Frame = { mt: 3, code, error: typeof raw.status.error === "string" ? raw.status.error : "" };
      const cid = num(raw.cid);
      return cid === undefined ? f : { ...f, cid };
    }
    case 19: {
      const sn = num(raw.sn);
      if (sn === undefined) return null;
      const first = Array.isArray(raw.as) ? raw.as[0] : undefined;
      return { mt: 19, sn, account: account(first) ?? null };
    }
    case 21: {
      const a = account(raw);
      return a === undefined ? null : { mt: 21, account: a };
    }
    case 23: case 24: {
      const orders = list(raw.d, order);
      return orders === undefined ? null : { mt: raw.mt, orders };
    }
    case 26: case 27: {
      const positions = list(raw.d, position);
      return positions === undefined ? null : { mt: raw.mt, positions };
    }
    case 100: {
      const sn = num(raw.sn), h = num(raw.h);
      return sn === undefined || h === undefined ? null : { mt: 100, sn, h };
    }
    default: return null;
  }
}

const LIVE_ORDER = new Set([1, 2, 3, 8, 9]);

/** Nuevo estado; nunca muta el anterior. Los snapshots reemplazan; los updates mezclan. */
export function applyFrame(state: TradingState, frame: Frame): TradingState {
  switch (frame.mt) {
    case 19: return { ...state, head: Math.max(state.head, frame.sn), account: frame.account };
    case 100: return { ...state, head: Math.max(state.head, frame.h) };
    case 21: return { ...state, account: frame.account };
    case 23: return { ...state, orders: new Map(frame.orders.filter((o) => !o.r && o.oid !== 0 && LIVE_ORDER.has(o.st)).map((o) => [o.oid, o])) };
    case 24: {
      const orders = new Map(state.orders);
      for (const o of frame.orders) {
        if (o.r || o.oid === 0 || !LIVE_ORDER.has(o.st)) orders.delete(o.oid);
        else orders.set(o.oid, o);
      }
      return { ...state, orders };
    }
    case 26: return { ...state, positions: new Map(frame.positions.filter((p) => p.st === 1).map((p) => [p.pid, p])) };
    case 27: {
      const positions = new Map(state.positions);
      for (const p of frame.positions) {
        if (p.st === 1) positions.set(p.pid, p);
        else positions.delete(p.pid);
      }
      return { ...state, positions };
    }
    default: return state;
  }
}

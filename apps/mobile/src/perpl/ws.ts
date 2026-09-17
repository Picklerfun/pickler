// Tipos y parsers del WebSocket de trading de Perpl. Puro: sin react-native.
// Formas verificadas contra frames reales (__tests__/fixtures/perpl/ws-frames.json).

import { signWsSignin } from "./apiKey";
import { ORDER_TIMEOUT_MS, PING_MS, RECONNECT_DELAYS_MS } from "./config";
import { describeOrderStatus, type OrderIntent, orderFrame } from "./orders";

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

export type SocketStatus = "connecting" | "live" | "reconnecting" | "closed";
export type OrderOutcome =
  | { kind: "filled"; order: Order }
  | { kind: "open"; order: Order }
  | { kind: "failed"; order?: Order; text: string }
  | { kind: "unknown" };
export type SocketEvent =
  | { type: "status"; status: SocketStatus }
  | { type: "state"; state: TradingState }
  | { type: "keyRejected" };
export type WebSocketLike = {
  readyState: number;
  send(data: string): void;
  close(): void;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: { code: number; reason: string }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
};
export type SocketOptions = {
  url: string; chainId: number; apiKey: string; privateKey: Uint8Array;
  onEvent: (e: SocketEvent) => void;
  createSocket?: (url: string) => WebSocketLike;
  now?: () => number;
};

type Pending = { intent: OrderIntent; sn: number; rq: number; retried: boolean; timer: ReturnType<typeof setTimeout>; resolve: (o: OrderOutcome) => void; reject: (e: Error) => void };

const OPEN = 1;
const AUTH_FAILED = 3401;

/** Un socket por sesión de la pestaña Trade. Sin React: se prueba con un WebSocket falso y timers falsos. */
export class TradingSocket {
  private ws: WebSocketLike | null = null;
  private _status: SocketStatus = "closed";
  private _state: TradingState = EMPTY_STATE;
  private sn = 0;
  private lastRq = 0;
  private attempt = 0;
  private authFailures = 0;
  private closedByUser = false;
  private ping: ReturnType<typeof setInterval> | null = null;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private pending = new Map<number, Pending>(); // por sn
  private readonly createSocket: (url: string) => WebSocketLike;
  private readonly now: () => number;

  constructor(private readonly opts: SocketOptions) {
    this.createSocket = opts.createSocket ?? ((url) => new WebSocket(url) as unknown as WebSocketLike);
    this.now = opts.now ?? (() => Date.now());
  }

  get status(): SocketStatus { return this._status; }
  get state(): TradingState { return this._state; }

  connect(): void {
    this.closedByUser = false;
    if (this.retry) { clearTimeout(this.retry); this.retry = null; }
    if (this.ws) {
      const old = this.ws;
      this.ws = null; // primero: que su onclose no dispare otra reconexión
      this.stopPing();
      old.close();
    }
    this.setStatus(this.attempt === 0 ? "connecting" : "reconnecting");
    const ws = this.createSocket(this.opts.url);
    this.ws = ws;
    ws.onopen = () => {
      // Primer frame: sign-in firmado (idle 10 s en testnet).
      const { timestamp, nonce, signature } = signWsSignin(this.opts.privateKey, this.opts.chainId, this.now());
      ws.send(JSON.stringify({ mt: 29, chain_id: this.opts.chainId, api_key: this.opts.apiKey, timestamp, nonce, signature }));
      this.stopPing();
      this.ping = setInterval(() => { if (ws.readyState === OPEN) ws.send(JSON.stringify({ mt: 1, t: this.now() })); }, PING_MS);
    };
    ws.onmessage = (ev) => { if (this.ws === ws) this.handle(ev.data); };
    ws.onerror = () => { /* onclose sigue */ };
    ws.onclose = (ev) => { if (this.ws === ws) this.handleClose(ev.code); };
  }

  close(): void {
    this.closedByUser = true;
    if (this.retry) { clearTimeout(this.retry); this.retry = null; }
    this.stopPing();
    const ws = this.ws;
    this.ws = null;
    ws?.close();
    this.failPending();
    this.setStatus("closed");
  }

  placeOrder(intent: OrderIntent): Promise<OrderOutcome> {
    const ws = this.ws;
    if (this._status !== "live" || !ws || ws.readyState !== OPEN || !this._state.account) {
      return Promise.reject(new Error("Not connected to Perpl. Wait for the Live badge and try again."));
    }
    return new Promise<OrderOutcome>((resolve, reject) => {
      const sn = ++this.sn;
      const rq = this.nextRq();
      const timer = setTimeout(() => this.settle(sn, { kind: "unknown" }), ORDER_TIMEOUT_MS);
      this.pending.set(sn, { intent, sn, rq, retried: false, timer, resolve, reject });
      ws.send(JSON.stringify(orderFrame(intent, { sn, rq, head: this._state.head })));
    });
  }

  private nextRq(): number {
    this.lastRq = Math.max(this.lastRq, this._state.account?.lfr ?? 0) + 1;
    return this.lastRq;
  }

  private handle(data: unknown): void {
    const frame = parseFrame(data);
    if (frame === null) return;
    this._state = applyFrame(this._state, frame);
    if (frame.mt === 19) {
      this.attempt = 0;
      this.authFailures = 0;
      this.setStatus("live");
    }
    if (frame.mt === 3) {
      const p = frame.cid === undefined ? undefined : this.pending.get(frame.cid);
      if (p && frame.code !== 0) this.fail(p, new Error(frame.error || `Perpl rejected the order (${frame.code})`));
    }
    if (frame.mt === 24) {
      for (const order of frame.orders) {
        const p = [...this.pending.values()].find((x) => x.rq === order.rq);
        if (!p) continue;
        const { kind, text } = describeOrderStatus(order.st, order.sr, order.fr);
        if (kind === "failed" && order.sr === 32 && !p.retried) { this.resend(p); continue; }
        if (kind === "sent") continue; // pending/untriggered: seguimos esperando
        this.settle(p.sn, kind === "filled" ? { kind, order } : kind === "open" ? { kind, order } : { kind: "failed", order, text });
      }
    }
    // El heartbeat (100) solo mueve `head`, que el socket usa internamente para `lb`; no re-renderiza a nadie.
    if (frame.mt !== 2 && frame.mt !== 3 && frame.mt !== 100) this.opts.onEvent({ type: "state", state: this._state });
  }

  /** sr 32: un reintento con rq nuevo y sn nuevo (el sn debe ser único por frame). */
  private resend(p: Pending): void {
    const ws = this.ws;
    if (!ws || ws.readyState !== OPEN) { this.settle(p.sn, { kind: "unknown" }); return; }
    clearTimeout(p.timer);
    this.pending.delete(p.sn);
    const sn = ++this.sn;
    const rq = this.nextRq();
    const timer = setTimeout(() => this.settle(sn, { kind: "unknown" }), ORDER_TIMEOUT_MS);
    const next: Pending = { ...p, sn, rq, retried: true, timer };
    this.pending.set(sn, next);
    ws.send(JSON.stringify(orderFrame(p.intent, { sn, rq, head: this._state.head })));
  }

  private settle(sn: number, outcome: OrderOutcome): void {
    const p = this.pending.get(sn);
    if (!p) return;
    clearTimeout(p.timer);
    this.pending.delete(sn);
    p.resolve(outcome);
  }

  private fail(p: Pending, error: Error): void {
    clearTimeout(p.timer);
    this.pending.delete(p.sn);
    p.reject(error);
  }

  private failPending(): void {
    for (const sn of [...this.pending.keys()]) this.settle(sn, { kind: "unknown" });
  }

  private handleClose(code: number): void {
    this.stopPing();
    this.ws = null;
    this.failPending();
    if (this.closedByUser) return;
    if (code === AUTH_FAILED && ++this.authFailures >= 2) {
      this.setStatus("closed");
      this.opts.onEvent({ type: "keyRejected" });
      return;
    }
    this.setStatus("reconnecting");
    const delay = RECONNECT_DELAYS_MS[Math.min(this.attempt, RECONNECT_DELAYS_MS.length - 1)];
    this.attempt += 1;
    this.retry = setTimeout(() => { this.retry = null; this.connect(); }, delay);
  }

  private stopPing(): void {
    if (this.ping) { clearInterval(this.ping); this.ping = null; }
  }

  private setStatus(status: SocketStatus): void {
    if (this._status === status) return;
    this._status = status;
    this.opts.onEvent({ type: "status", status });
  }
}

// Order book L2 del WebSocket público de market-data de Perpl (D11). Puro: sin react-native.
// Formas verificadas contra la doc (PerplFoundation/api-docs websocket.md, commit 2026-09-02) y frames reales
// (__tests__/fixtures/perpl/market-data-frames.json): mt 15 reemplaza el libro; mt 16 es un delta por nivel de
// precio y `o: 0` borra el nivel (P4 del plan F3). Sin pings: el servidor mantiene vivo el socket por bloque.
import { BOOK_DEPTH, RECONNECT_DELAYS_MS } from "./config";
import type { SocketStatus, WebSocketLike } from "./ws";

export type BookLevel = { p: number; s: number; o: number };
/** Niveles por precio y lado; `at` = timestamp de bloque (ms) del último frame aplicado. */
export type Book = { at: number | null; bids: Map<number, BookLevel>; asks: Map<number, BookLevel> };
export const EMPTY_BOOK: Book = { at: null, bids: new Map(), asks: new Map() };

export type BookFrame =
  | { mt: 6; subs: { stream: string; sid?: number; code: number; error?: string }[] }
  | { mt: 15; sid: number; at: number | null; bid: BookLevel[]; ask: BookLevel[] }
  | { mt: 16; sid: number; at: number | null; bid: BookLevel[]; ask: BookLevel[] };

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => v !== null && typeof v === "object";
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

function level(v: unknown): BookLevel | undefined {
  if (!isRec(v)) return undefined;
  const p = num(v.p), s = num(v.s), o = num(v.o);
  return p === undefined || s === undefined || o === undefined ? undefined : { p, s, o };
}

/** Lado ausente = sin cambios en ese lado. */
function levels(v: unknown): BookLevel[] | undefined {
  if (v === undefined) return [];
  if (!Array.isArray(v)) return undefined;
  const out: BookLevel[] = [];
  for (const x of v) {
    const l = level(x);
    if (l === undefined) return undefined;
    out.push(l);
  }
  return out;
}

/** `ev.data` del WebSocket. null para frames ajenos o malformados (se ignoran). */
export function parseBookFrame(data: unknown): BookFrame | null {
  if (typeof data !== "string") return null;
  let raw: unknown;
  try {
    raw = JSON.parse(data);
  } catch {
    return null;
  }
  if (!isRec(raw)) return null;
  switch (raw.mt) {
    case 6: {
      if (!Array.isArray(raw.subs)) return null;
      const subs: { stream: string; sid?: number; code: number; error?: string }[] = [];
      for (const s of raw.subs) {
        if (!isRec(s) || typeof s.stream !== "string") return null;
        const status = isRec(s.status) ? s.status : {};
        const sid = num(s.sid);
        subs.push({ stream: s.stream, code: num(status.code) ?? 0, ...(sid === undefined ? {} : { sid }), ...(typeof status.error === "string" ? { error: status.error } : {}) });
      }
      return { mt: 6, subs };
    }
    case 15: case 16: {
      const sid = num(raw.sid);
      const bid = levels(raw.bid), ask = levels(raw.ask);
      if (sid === undefined || bid === undefined || ask === undefined) return null;
      const at = isRec(raw.at) ? (num(raw.at.t) ?? null) : null;
      return { mt: raw.mt, sid, at, bid, ask };
    }
    default: return null;
  }
}

function merge(side: Map<number, BookLevel>, changes: BookLevel[], replace: boolean): Map<number, BookLevel> {
  const next = replace ? new Map<number, BookLevel>() : new Map(side);
  for (const l of changes) {
    if (l.o === 0 || l.s === 0) next.delete(l.p);
    else next.set(l.p, l);
  }
  return next;
}

/** Nuevo libro; nunca muta el anterior. 15 reemplaza; 16 mezcla por precio y borra con `o: 0`; 6 no lo toca. */
export function applyBookFrame(book: Book, frame: BookFrame): Book {
  if (frame.mt === 6) return book;
  const replace = frame.mt === 15;
  return { at: frame.at ?? book.at, bids: merge(book.bids, frame.bid, replace), asks: merge(book.asks, frame.ask, replace) };
}

/** Mejores `n` niveles: bids de mayor a menor precio, asks de menor a mayor. */
export function topLevels(book: Book, side: "bid" | "ask", n = BOOK_DEPTH): BookLevel[] {
  const all = [...(side === "bid" ? book.bids : book.asks).values()];
  all.sort((a, b) => (side === "bid" ? b.p - a.p : a.p - b.p));
  return all.slice(0, n);
}

export function bestPrices(book: Book): { bid: number | null; ask: number | null } {
  return { bid: topLevels(book, "bid", 1)[0]?.p ?? null, ask: topLevels(book, "ask", 1)[0]?.p ?? null };
}

/** Spread en bps sobre el mid; null sin uno de los lados. Negativo si el libro está cruzado (pasa en testnet: se muestra tal cual). */
export function spreadBps(book: Book): number | null {
  const { bid, ask } = bestPrices(book);
  if (bid === null || ask === null) return null;
  return ((ask - bid) / ((ask + bid) / 2)) * 10_000;
}

export type TargetPosition = "above" | "inside" | "below";

/** Dónde cae el target de «Trade this level» respecto a los mejores precios (P2: una línea de texto, no resaltado por nivel). */
export function targetPosition(book: Book, target: number): TargetPosition | null {
  const { bid, ask } = bestPrices(book);
  if (bid === null || ask === null) return null;
  return target > ask ? "above" : target < bid ? "below" : "inside";
}

/** Un `mt: 5` con una sola suscripción: 1 request de los 10/min de la conexión. */
export const subscribeFrame = (marketId: number): string => JSON.stringify({ mt: 5, subs: [{ stream: `order-book@${marketId}`, subscribe: true }] });

export type MarketDataEvent =
  | { type: "status"; status: SocketStatus }
  | { type: "book"; book: Book }
  | { type: "rejected"; code: number; error: string };
export type MarketDataOptions = { url: string; marketId: number; onEvent: (e: MarketDataEvent) => void; createSocket?: (url: string) => WebSocketLike };

const GOING_AWAY = 1001;

/** Un socket por ticket visible con una sola suscripción (D11). Sin React: se prueba con un WebSocket falso y timers falsos. */
export class MarketDataSocket {
  private ws: WebSocketLike | null = null;
  private _status: SocketStatus = "closed";
  private _book: Book = EMPTY_BOOK;
  private sid: number | null = null;
  private attempt = 0;
  private closedByUser = false;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private readonly createSocket: (url: string) => WebSocketLike;

  constructor(private readonly opts: MarketDataOptions) {
    this.createSocket = opts.createSocket ?? ((url) => new WebSocket(url) as unknown as WebSocketLike);
  }

  get status(): SocketStatus { return this._status; }
  get book(): Book { return this._book; }

  connect(): void {
    this.closedByUser = false;
    if (this.retry) { clearTimeout(this.retry); this.retry = null; }
    if (this.ws) {
      const old = this.ws;
      this.ws = null; // primero: que su onclose no dispare otra reconexión
      old.close();
    }
    this.sid = null;
    this.setStatus(this.attempt === 0 ? "connecting" : "reconnecting");
    const ws = this.createSocket(this.opts.url);
    this.ws = ws;
    ws.onopen = () => { ws.send(subscribeFrame(this.opts.marketId)); };
    ws.onmessage = (ev) => { if (this.ws === ws) this.handle(ev.data); };
    ws.onerror = () => { /* onclose sigue */ };
    ws.onclose = (ev) => { if (this.ws === ws) this.handleClose(ev.code); };
  }

  close(): void {
    this.closedByUser = true;
    if (this.retry) { clearTimeout(this.retry); this.retry = null; }
    const ws = this.ws;
    this.ws = null;
    ws?.close();
    this.setStatus("closed");
  }

  private handle(data: unknown): void {
    const frame = parseBookFrame(data);
    if (frame === null) return;
    if (frame.mt === 6) {
      const sub = frame.subs.find((s) => s.stream === `order-book@${this.opts.marketId}`);
      if (!sub) return;
      if (sub.code !== 0 || sub.sid === undefined) {
        // 404 unknown stream / 429 too many subscriptions: reintentar sólo gastaría el presupuesto (P6).
        this.closedByUser = true;
        const ws = this.ws;
        this.ws = null;
        ws?.close();
        this.setStatus("closed");
        this.opts.onEvent({ type: "rejected", code: sub.code, error: sub.error ?? "" });
        return;
      }
      this.sid = sub.sid;
      return;
    }
    if (this.sid !== null && frame.sid !== this.sid) return; // otra suscripción: no debería haber, se ignora
    this._book = applyBookFrame(this._book, frame);
    if (frame.mt === 15) {
      this.attempt = 0;
      this.setStatus("live");
    }
    this.opts.onEvent({ type: "book", book: this._book });
  }

  private handleClose(code: number): void {
    this.ws = null;
    if (this.closedByUser) return;
    this.setStatus("reconnecting");
    // 1001 = el servidor se va: la doc pide reconectar sin espera (sólo la primera vez, por si insiste).
    const delay = code === GOING_AWAY && this.attempt === 0 ? 0 : RECONNECT_DELAYS_MS[Math.min(this.attempt, RECONNECT_DELAYS_MS.length - 1)];
    this.attempt += 1;
    this.retry = setTimeout(() => { this.retry = null; this.connect(); }, delay);
  }

  private setStatus(status: SocketStatus): void {
    if (this._status === status) return;
    this._status = status;
    this.opts.onEvent({ type: "status", status });
  }
}

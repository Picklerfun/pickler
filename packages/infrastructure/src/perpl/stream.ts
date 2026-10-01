import { z } from "zod";
import {
  PilotError,
  type PerpMarketInfo,
  type PerpSnapshot,
  type PerpOrderBook,
  type PerpSymbol,
} from "@pickler/core";
import { atSchema, uint, tickerSchema } from "./wire.js";
import { normalizePerplBook, normalizePerplTicker } from "./data.js";
import { abortable } from "./transport.js";

export const PERPL_STREAM_VERSION = "public-stream-v1";
const level = z.object({ p: uint.positive(), s: uint, o: uint });
const bookMessage = z.object({
  mt: z.union([z.literal(15), z.literal(16)]),
  sid: uint,
  at: atSchema,
  bid: z.array(level).max(10000),
  ask: z.array(level).max(10000),
});
const subscription = z.object({
  mt: z.literal(6),
  subs: z
    .array(
      z.object({
        stream: z.string(),
        sid: uint.optional(),
        status: z.object({ code: uint }).optional(),
      }),
    )
    .max(16),
});
const stateMessage = tickerSchema
  .omit({ sn: true })
  .extend({ sid: uint.optional(), sn: uint.optional() });
const heartbeat = z.object({ mt: z.literal(100), sn: uint, h: uint });
type Book = z.infer<typeof bookMessage>;
type State = z.infer<typeof tickerSchema>["d"][string];
export interface PerplStreamEvent {
  kind: "message" | "disconnected" | "connected" | "error";
  receivedAt: number;
  code?: string;
  publicMessage?: unknown;
}
function fail(code: string): never {
  throw new PilotError(code, "Public Perpl stream rejected");
}
function monotone(
  next: { t?: number | undefined; b?: number | undefined },
  previous?: { t?: number | undefined; b?: number | undefined },
) {
  if (next.t === undefined || next.b === undefined) {
    fail("PERPL_STREAM_TIMESTAMP");
  }
  if (previous && (next.t < (previous.t ?? 0) || next.b < (previous.b ?? 0))) {
    fail("PERPL_STREAM_REGRESSION");
  }
}
/** Pure bounded reconstruction. Heartbeats never change component dates. */
export class PerplStreamState {
  private subscriptions = new Map<number, string>();
  private books = new Map<number, { book: Book; receivedAt: number }>();
  private states = new Map<number, { state: State; receivedAt: number }>();
  private lastHeartbeat: { sn: number; h: number } | undefined;
  private ready = false;
  private lastSubscription: string | undefined;
  private lastBookMessages = new Map<number, string>();
  constructor(
    readonly markets: readonly PerpMarketInfo[],
    readonly url: string,
    readonly chainId: number,
  ) {}
  reset() {
    this.subscriptions.clear();
    this.books.clear();
    this.lastBookMessages.clear();
    this.states.clear();
    this.lastHeartbeat = undefined;
    this.ready = false;
    this.lastSubscription = undefined;
  }
  streams() {
    return [
      `heartbeat@${this.chainId}`,
      `market-state@${this.chainId}`,
      ...this.markets.map((m) => `order-book@${m.marketId}`),
    ];
  }
  apply(raw: unknown, receivedAt: number) {
    const mt = z.object({ mt: uint }).parse(raw).mt;
    if (mt === 6) {
      const msg = subscription.parse(raw);
      const subscriptionHash = JSON.stringify(msg);
      if (this.ready && subscriptionHash === this.lastSubscription) {
        return;
      }
      const expected = this.streams();
      if (
        msg.subs.length !== expected.length ||
        new Set(msg.subs.map((s) => s.stream)).size !== expected.length
      ) {
        fail("PERPL_STREAM_SUBSCRIPTION");
      }
      for (const sub of msg.subs) {
        if (
          !expected.includes(sub.stream) ||
          sub.sid === undefined ||
          (sub.status && sub.status.code !== 0) ||
          this.subscriptions.has(sub.sid)
        ) {
          fail("PERPL_STREAM_SUBSCRIPTION");
        }
        this.subscriptions.set(sub.sid, sub.stream);
      }
      this.ready = true;
      this.lastSubscription = subscriptionHash;
      return;
    }
    if (!this.ready) {
      fail("PERPL_STREAM_SUBSCRIPTION");
    }
    if (mt === 100) {
      const msg = heartbeat.parse(raw);
      if (
        this.lastHeartbeat &&
        msg.sn === this.lastHeartbeat.sn &&
        msg.h === this.lastHeartbeat.h
      ) {
        return;
      }
      if (
        this.lastHeartbeat &&
        (msg.sn !== this.lastHeartbeat.sn + 1 || msg.h < this.lastHeartbeat.h)
      ) {
        fail("PERPL_STREAM_DISCONTINUITY");
      }
      this.lastHeartbeat = { sn: msg.sn, h: msg.h };
      return;
    }
    if (mt === 9) {
      const msg = stateMessage.parse(raw);
      if (
        msg.sid !== undefined &&
        this.subscriptions.get(msg.sid) !== `market-state@${this.chainId}`
      ) {
        fail("PERPL_STREAM_IDENTITY");
      }
      for (const market of this.markets) {
        const next = msg.d[String(market.marketId)];
        if (!next) {
          continue;
        }
        const old = this.states.get(market.marketId);
        monotone(next.at, old?.state.at);
        if (
          old &&
          next.at.t === old.state.at.t &&
          next.at.b === old.state.at.b &&
          JSON.stringify(next) !== JSON.stringify(old.state)
        ) {
          fail("PERPL_STREAM_REGRESSION");
        }
        if (!old || JSON.stringify(next) !== JSON.stringify(old.state)) {
          this.states.set(market.marketId, { state: next, receivedAt });
        }
      }
      return;
    }
    if (mt !== 15 && mt !== 16) {
      fail("PERPL_STREAM_MESSAGE");
    }
    const msg = bookMessage.parse(raw);
    const stream = this.subscriptions.get(msg.sid);
    const market = this.markets.find((m) => stream === `order-book@${m.marketId}`);
    if (!market) {
      fail("PERPL_STREAM_IDENTITY");
    }
    const serialized = JSON.stringify(msg);
    if (this.lastBookMessages.get(market.marketId) === serialized) {
      return;
    }
    const old = this.books.get(market.marketId);
    monotone(msg.at, old?.book.at);
    if (msg.mt === 16 && !old) {
      fail("PERPL_STREAM_SNAPSHOT_REQUIRED");
    }
    for (const [side, direction] of [
      [msg.bid, -1],
      [msg.ask, 1],
    ] as const) {
      for (let i = 0; i < side.length; i++) {
        if (
          (msg.mt === 15 && (side[i]!.o === 0 || side[i]!.s === 0)) ||
          (side[i]!.o > 0 && side[i]!.s === 0)
        ) {
          fail("PERPL_STREAM_BOOK");
        }
        if (i > 0 && (side[i]!.p - side[i - 1]!.p) * direction <= 0) {
          fail("PERPL_STREAM_BOOK");
        }
      }
    }
    if (
      old &&
      msg.at.t === old.book.at.t &&
      msg.mt === 15 &&
      JSON.stringify(msg) === JSON.stringify(old.book)
    ) {
      return;
    }
    const update = (current: Book["bid"], changes: Book["bid"], direction: number) => {
      const levels = new Map(current.map((l) => [l.p, l]));
      for (const change of changes) {
        if (change.o === 0) {
          levels.delete(change.p);
        } else {
          levels.set(change.p, change);
        }
      }
      if (levels.size > 10000) {
        fail("PERPL_STREAM_STATE_LIMIT");
      }
      return [...levels.values()].sort((a, b) => (a.p - b.p) * direction);
    };
    const book: Book =
      msg.mt === 15
        ? msg
        : {
            ...msg,
            bid: update(old!.book.bid, msg.bid, -1),
            ask: update(old!.book.ask, msg.ask, 1),
          };
    normalizePerplBook(market, { url: this.url, body: "", receivedAt }, book, 20, receivedAt);
    this.books.set(market.marketId, { book, receivedAt });
    this.lastBookMessages.set(market.marketId, serialized);
  }
  frame(symbol: PerpSymbol, now: number): { snapshot: PerpSnapshot; book: PerpOrderBook } {
    const market = this.markets.find((m) => m.symbol === symbol);
    if (!market) {
      fail("PERPL_STREAM_IDENTITY");
    }
    const ticker = this.states.get(market.marketId),
      book = this.books.get(market.marketId);
    if (!this.ready || !ticker || !book) {
      fail("DATA_UNAVAILABLE");
    }
    return {
      snapshot: {
        market,
        ticker: normalizePerplTicker(
          market,
          { url: this.url, body: "", receivedAt: ticker.receivedAt },
          ticker.state,
          now,
        ),
        funding: null,
      },
      book: normalizePerplBook(
        market,
        { url: this.url, body: "", receivedAt: book.receivedAt },
        book.book,
        20,
        now,
      ),
    };
  }
}

export interface PerplSocket {
  readyState: number;
  send(message: string): void;
  close(): void;
  addEventListener(
    type: string,
    callback: (event: { data?: unknown }) => void,
    options?: { once?: boolean },
  ): void;
}
/** No authenticated stream, signer, model, or implicit transport fallback. */
export class PerplPublicStream {
  readonly state: PerplStreamState;
  private socket: PerplSocket | undefined;
  private stopped = false;
  private fatal: unknown;
  private attempts: number[] = [];
  private generation = 0;
  private tail: Promise<void> = Promise.resolve();
  private queued = 0;
  private timer: ReturnType<typeof setInterval>;
  private checking = false;
  constructor(
    private readonly options: {
      markets: PerpMarketInfo[];
      guard: () => Promise<void>;
      signal: AbortSignal;
      now?: () => number;
      socket?: (url: string) => PerplSocket;
      event?: (event: PerplStreamEvent) => void;
    },
  ) {
    const first = options.markets[0];
    if (!first || options.markets.some((m) => m.provenance.network !== first.provenance.network)) {
      fail("PERPL_STREAM_IDENTITY");
    }
    const url = `wss://${first.provenance.network === "mainnet" ? "app" : "testnet"}.perpl.xyz/ws/v1/market-data`;
    this.state = new PerplStreamState(options.markets, url, first.provenance.chainId);
    this.timer = setInterval(() => {
      if (this.checking || this.stopped) {
        return;
      }
      this.checking = true;
      void this.guard()
        .catch((e) => this.stopError(e))
        .finally(() => {
          this.checking = false;
        });
    }, 1000);
    options.signal.addEventListener("abort", () => this.close(), { once: true });
  }
  private now() {
    return this.options.now?.() ?? Date.now();
  }
  private async guard() {
    this.options.signal.throwIfAborted();
    await this.options.guard();
    if (this.stopped) {
      throw this.fatal ?? new PilotError("PERPL_STREAM_CLOSED", "Reader closed");
    }
  }
  private stopError(error: unknown) {
    if (this.stopped) {
      return;
    }
    if (error instanceof PilotError && error.code === "PERPL_STREAM_DISCONTINUITY") {
      // A proven gap invalidates all state. Only guarded acquisition may resubscribe;
      // there is no background reconnect and no reuse of the previous book.
      this.options.event?.({ kind: "error", receivedAt: this.now(), code: error.code });
      const socket = this.socket;
      this.socket = undefined;
      this.generation++;
      this.state.reset();
      socket?.close();
      return;
    }
    this.fatal =
      error instanceof PilotError && error.code !== "PERPL_INVALID_RESPONSE"
        ? error
        : new PilotError(
            error instanceof PilotError ? "PERPL_STREAM_BOOK" : "PERPL_STREAM_MESSAGE",
            "Invalid public stream data",
          );
    this.options.event?.({
      kind: "error",
      receivedAt: this.now(),
      code: this.fatal instanceof PilotError ? this.fatal.code : "PERPL_STREAM_MESSAGE",
    });
    this.close();
  }
  async connect(signal: AbortSignal) {
    await this.guard();
    if (this.socket?.readyState === 1) {
      return;
    }
    this.attempts = this.attempts.filter((at) => this.now() - at < 60000);
    if (this.attempts.length >= 2) {
      fail("DATA_UNAVAILABLE");
    }
    this.attempts.push(this.now());
    this.state.reset();
    const generation = ++this.generation;
    const socket = (this.options.socket ?? ((url) => new WebSocket(url)))(this.state.url);
    this.socket = socket;
    const opened = new Promise<void>((resolve, reject) => {
      socket.addEventListener("open", () => resolve(), { once: true });
      socket.addEventListener(
        "error",
        () =>
          reject(new PilotError("PERPL_TRANSPORT_FAILURE", "Public WebSocket connection failed")),
        { once: true },
      );
      socket.addEventListener(
        "close",
        () => reject(new PilotError("PERPL_TRANSPORT_FAILURE", "Public WebSocket disconnected")),
        { once: true },
      );
    });
    socket.addEventListener("close", () => {
      if (generation !== this.generation) {
        return;
      }
      this.state.reset();
      this.socket = undefined;
      this.options.event?.({ kind: "disconnected", receivedAt: this.now() });
    });
    socket.addEventListener("message", (event) => {
      if (generation !== this.generation || this.stopped) {
        return;
      }
      if (
        typeof event.data !== "string" ||
        new TextEncoder().encode(event.data).length > 2 * 1024 * 1024 ||
        ++this.queued > 32
      ) {
        this.stopError(
          new PilotError("PERPL_STREAM_MESSAGE_LIMIT", "Public message or queue limit exceeded"),
        );
        return;
      }
      const receivedAt = this.now();
      this.tail = this.tail
        .then(async () => {
          await this.guard();
          if (generation !== this.generation || socket.readyState !== 1) {
            return;
          }
          const raw = JSON.parse(event.data as string);
          // Only validated public-data message types can enter captures.
          this.state.apply(raw, receivedAt);
          this.options.event?.({ kind: "message", receivedAt, publicMessage: raw });
        })
        .catch((error) => this.stopError(error))
        .finally(() => {
          this.queued--;
        });
    });
    try {
      await abortable(opened, signal);
      await this.guard();
      signal.throwIfAborted();
      socket.send(
        JSON.stringify({
          mt: 5,
          subs: this.state.streams().map((stream) => ({ stream, subscribe: true })),
        }),
      );
      this.options.event?.({ kind: "connected", receivedAt: this.now() });
    } catch (error) {
      socket.close();
      this.state.reset();
      throw error;
    }
  }
  async frame(symbol: PerpSymbol, signal: AbortSignal) {
    await this.guard();
    signal.throwIfAborted();
    await this.connect(signal);
    await this.guard();
    return this.state.frame(symbol, this.now());
  }
  async close() {
    this.stopped = true;
    clearInterval(this.timer);
    this.generation++;
    this.state.reset();
    this.socket?.close();
    this.socket = undefined;
  }
}

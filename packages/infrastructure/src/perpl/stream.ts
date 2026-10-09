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
import type { UniverseStreamBuffer } from "@pickler/trading/perps";

export const PERPL_STREAM_VERSION = "public-stream-v1";
export const PERPL_UNIVERSE_STREAM_VERSION = "public-universe-stream-v2";
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
  kind:
    "message" | "disconnected" | "connected" | "closed" | "catalog" | "error" | "snapshot-request";
  receivedAt: number;
  generation?: number;
  code?: string;
  limit?: {
    component: "message-type" | "message-bytes" | "message-queue";
    observed?: number;
    maximum?: number;
  };
  publicMessage?: unknown;
  processing?: {
    mode: "per-message" | "guarded-batches";
    receivedMessages: number;
    processedMessages: number;
    guardChecks: number;
    guardDurationMs: number;
    maxGuardDurationMs: number;
    queuePeak: number;
    subscriptionRequests: number;
    snapshotRefreshes: number;
  };
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
  ) {
    if (
      markets.length === 0 ||
      markets.length + 2 > 16 ||
      new Set(markets.map((m) => m.marketId)).size !== markets.length ||
      new Set(markets.map((m) => m.symbol)).size !== markets.length ||
      markets.some((m) => m.provenance.chainId !== chainId)
    ) {
      fail("PERPL_STREAM_IDENTITY");
    }
  }
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
        return msg;
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
      return msg;
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
        return msg;
      }
      if (
        this.lastHeartbeat &&
        (msg.sn !== this.lastHeartbeat.sn + 1 || msg.h < this.lastHeartbeat.h)
      ) {
        fail("PERPL_STREAM_DISCONTINUITY");
      }
      this.lastHeartbeat = { sn: msg.sn, h: msg.h };
      return msg;
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
      return msg;
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
      return msg;
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
      return msg;
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
    return msg;
  }
  /** Synchronous copy: no await can mix markets from different connection generations. */
  components(symbols: readonly PerpSymbol[], now: number): UniverseStreamBuffer["components"] {
    return symbols.map((symbol) => {
      const source = this.markets.find((m) => m.symbol === symbol);
      if (!source) {
        fail("PERPL_STREAM_IDENTITY");
      }
      if (!this.ready) {
        return { symbol };
      }
      const market = structuredClone(source);
      const ticker = this.states.get(market.marketId);
      const book = this.books.get(market.marketId);
      return {
        symbol,
        ...(ticker
          ? {
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
            }
          : {}),
        ...(book
          ? {
              book: normalizePerplBook(
                market,
                { url: this.url, body: "", receivedAt: book.receivedAt },
                book.book,
                20,
                now,
              ),
            }
          : {}),
      };
    });
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
  private closing: Promise<void> | undefined;
  private shutdown = new AbortController();
  private batch: { data: string; receivedAt: number; generation: number; socket: PerplSocket }[] =
    [];
  private draining = false;
  private subscriptionStarts: number[] = [];
  private processing = {
    receivedMessages: 0,
    processedMessages: 0,
    guardChecks: 0,
    guardDurationMs: 0,
    maxGuardDurationMs: 0,
    queuePeak: 0,
    subscriptionRequests: 0,
    snapshotRefreshes: 0,
  };
  constructor(
    private readonly options: {
      markets: PerpMarketInfo[];
      guard: () => Promise<void>;
      signal: AbortSignal;
      now?: () => number;
      socket?: (url: string) => PerplSocket;
      event?: (event: PerplStreamEvent) => void;
      /** One live ownership check per FIFO batch; no permission cache and no skipped updates. */
      messageProcessing?: "guarded-batches";
      monotonic?: () => number;
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
    options.signal.addEventListener(
      "abort",
      () => {
        void this.close().catch(() => {});
      },
      { once: true },
    );
  }
  private now() {
    return this.options.now?.() ?? Date.now();
  }
  private emit(event: PerplStreamEvent) {
    this.options.event?.({
      ...event,
      generation: this.generation,
      ...(event.kind !== "message"
        ? {
            processing: {
              mode: this.options.messageProcessing ?? "per-message",
              ...this.processing,
            },
          }
        : {}),
    });
  }
  private async guard() {
    this.options.signal.throwIfAborted();
    this.shutdown.signal.throwIfAborted();
    const start = this.options.monotonic?.() ?? performance.now();
    this.processing.guardChecks++;
    try {
      await abortable(
        this.options.guard(),
        AbortSignal.any([this.options.signal, this.shutdown.signal]),
      );
    } catch (error) {
      if (!this.stopped && !this.options.signal.aborted) {
        this.stopError(error);
      }
      throw error;
    } finally {
      const duration = (this.options.monotonic?.() ?? performance.now()) - start;
      this.processing.guardDurationMs += duration;
      this.processing.maxGuardDurationMs = Math.max(this.processing.maxGuardDurationMs, duration);
    }
    this.options.signal.throwIfAborted();
    if (this.stopped) {
      throw this.fatal ?? new PilotError("PERPL_STREAM_CLOSED", "Reader closed");
    }
  }
  private apply(message: {
    data: string;
    receivedAt: number;
    generation: number;
    socket: PerplSocket;
  }) {
    this.options.signal.throwIfAborted();
    this.shutdown.signal.throwIfAborted();
    if (message.generation !== this.generation || message.socket.readyState !== 1) {
      return;
    }
    const publicMessage = this.state.apply(JSON.parse(message.data), message.receivedAt);
    this.processing.processedMessages++;
    this.emit({ kind: "message", receivedAt: message.receivedAt, publicMessage });
  }
  private drain() {
    if (this.draining) {
      return;
    }
    this.draining = true;
    this.tail = (async () => {
      while (this.batch.length && !this.stopped) {
        await this.guard();
        // No await between these updates: one checked generation, exact FIFO wire order.
        // Database latency is paid per bounded batch, never once for every book delta.
        const messages = this.batch.splice(0);
        for (const message of messages) {
          try {
            this.apply(message);
          } finally {
            this.queued--;
          }
        }
      }
    })()
      .catch((error) => this.stopError(error))
      .finally(() => {
        this.draining = false;
        if (this.batch.length && !this.stopped) {
          this.drain();
        }
      });
  }
  private async subscribe(socket: PerplSocket, signal: AbortSignal, refresh: boolean) {
    signal.throwIfAborted();
    const now = this.now();
    this.subscriptionStarts = this.subscriptionStarts.filter((at) => now - at < 60000);
    // Repeated snapshot requests are bounded to six per minute, below Perpl's ten-request cap.
    if (
      refresh &&
      (this.subscriptionStarts.length >= 10 ||
        now - (this.subscriptionStarts.at(-1) ?? -Infinity) < 10000)
    ) {
      return;
    }
    await this.guard();
    signal.throwIfAborted();
    if (refresh && this.now() - (this.subscriptionStarts.at(-1) ?? -Infinity) < 10000) {
      return;
    }
    if (socket !== this.socket || socket.readyState !== 1) {
      fail("DATA_UNAVAILABLE");
    }
    socket.send(
      JSON.stringify({
        mt: 5,
        subs: this.state.streams().map((stream) => ({ stream, subscribe: true })),
      }),
    );
    this.subscriptionStarts.push(this.now());
    this.processing.subscriptionRequests++;
    if (refresh) {
      this.processing.snapshotRefreshes++;
      this.emit({ kind: "snapshot-request", receivedAt: this.now() });
    }
  }
  /** An active acquisition may request fresh provider snapshots; never rewrite component dates. */
  async requestSnapshots(signal: AbortSignal) {
    if (this.options.messageProcessing !== "guarded-batches" || !this.socket) {
      return;
    }
    await this.subscribe(this.socket, signal, true);
  }
  private stopError(error: unknown, limit?: PerplStreamEvent["limit"]) {
    if (this.stopped) {
      return;
    }
    if (error instanceof PilotError && error.code === "PERPL_STREAM_DISCONTINUITY") {
      // A proven gap invalidates all state. Only guarded acquisition may resubscribe;
      // there is no background reconnect and no reuse of the previous book.
      this.emit({ kind: "error", receivedAt: this.now(), code: error.code });
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
    this.emit({
      kind: "error",
      receivedAt: this.now(),
      code: this.fatal instanceof PilotError ? this.fatal.code : "PERPL_STREAM_MESSAGE",
      ...(limit ? { limit } : {}),
    });
    void this.close().catch(() => {});
  }
  async connect(signal: AbortSignal) {
    await this.guard();
    signal.throwIfAborted();
    if (this.socket?.readyState === 1) {
      return;
    }
    this.attempts = this.attempts.filter((at) => this.now() - at < 60000);
    if (this.attempts.length >= 2) {
      fail("DATA_UNAVAILABLE");
    }
    this.attempts.push(this.now());
    this.state.reset();
    this.subscriptionStarts = [];
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
      this.emit({ kind: "disconnected", receivedAt: this.now() });
    });
    socket.addEventListener("message", (event) => {
      if (generation !== this.generation || this.stopped) {
        return;
      }
      if (typeof event.data !== "string") {
        this.stopError(
          new PilotError("PERPL_STREAM_MESSAGE_LIMIT", "Public message or queue limit exceeded"),
          { component: "message-type" },
        );
        return;
      }
      const bytes = new TextEncoder().encode(event.data).length;
      if (bytes > 2 * 1024 * 1024) {
        this.stopError(
          new PilotError("PERPL_STREAM_MESSAGE_LIMIT", "Public message or queue limit exceeded"),
          { component: "message-bytes", observed: bytes, maximum: 2 * 1024 * 1024 },
        );
        return;
      }
      if (this.queued >= 32) {
        this.stopError(
          new PilotError("PERPL_STREAM_MESSAGE_LIMIT", "Public message or queue limit exceeded"),
          { component: "message-queue", observed: this.queued + 1, maximum: 32 },
        );
        return;
      }
      this.queued++;
      this.processing.receivedMessages++;
      this.processing.queuePeak = Math.max(this.processing.queuePeak, this.queued);
      const receivedAt = this.now();
      const message = { data: event.data, receivedAt, generation, socket };
      if (this.options.messageProcessing === "guarded-batches") {
        this.batch.push(message);
        this.drain();
        return;
      }
      this.tail = this.tail
        .then(async () => {
          await this.guard();
          this.apply(message);
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
      await this.subscribe(socket, signal, false);
      this.emit({ kind: "connected", receivedAt: this.now() });
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
    signal.throwIfAborted();
    return this.state.frame(symbol, this.now());
  }
  /** Guarded buffer access only; this method never initiates a connection or REST fallback. */
  async latest(symbols: readonly PerpSymbol[], signal: AbortSignal): Promise<UniverseStreamBuffer> {
    await this.guard();
    signal.throwIfAborted();
    const pending = this.tail;
    await abortable(pending, signal);
    await this.guard();
    signal.throwIfAborted();
    if (this.socket?.readyState !== 1) {
      fail("DATA_UNAVAILABLE");
    }
    const generation = this.generation;
    const observedAt = this.now();
    const components = this.state.components(symbols, observedAt);
    await this.guard();
    signal.throwIfAborted();
    if (generation !== this.generation || this.socket?.readyState !== 1) {
      fail("DATA_UNAVAILABLE");
    }
    return { generation, observedAt, components };
  }
  close(): Promise<void> {
    if (this.closing) {
      return this.closing;
    }
    this.stopped = true;
    this.shutdown.abort(this.fatal ?? new PilotError("PERPL_STREAM_CLOSED", "Reader closed"));
    this.queued -= this.batch.length;
    this.batch.length = 0;
    clearInterval(this.timer);
    this.generation++;
    this.state.reset();
    const socket = this.socket;
    this.socket = undefined;
    this.closing = (async () => {
      if (socket && socket.readyState !== 3) {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(
            () => reject(new PilotError("PERPL_STREAM_CLEANUP", "Socket closure not confirmed")),
            5000,
          );
          socket.addEventListener(
            "close",
            () => {
              clearTimeout(timer);
              resolve();
            },
            { once: true },
          );
          socket.close();
          if (socket.readyState === 3) {
            clearTimeout(timer);
            resolve();
          }
        });
      }
      await this.tail;
      this.emit({ kind: "closed", receivedAt: this.now() });
    })();
    return this.closing;
  }
}

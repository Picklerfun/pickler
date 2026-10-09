import test from "node:test";
import assert from "node:assert/strict";
import { setTimeout as wait } from "node:timers/promises";
import { writeFile } from "node:fs/promises";
import { PilotError } from "@pickler/core";
import {
  PerplPublicStream,
  type PerplSocket,
  type PerplStreamEvent,
} from "@pickler/infrastructure";
import { studyFrame } from "./perps-study-fixtures.js";

const now = 1800000000000;
const market = studyFrame(now).snapshot.market;

class Socket implements PerplSocket {
  readyState = 0;
  sent: string[] = [];
  listeners = new Map<string, ((event: { data?: unknown }) => void)[]>();
  addEventListener(type: string, fn: (event: { data?: unknown }) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  emit(type: string, event: { data?: unknown } = {}) {
    for (const fn of this.listeners.get(type) ?? []) {
      fn(event);
    }
  }
  send(message: string) {
    this.sent.push(message);
  }
  close() {
    this.readyState = 3;
    this.emit("close");
  }
  message(value: unknown) {
    this.emit("message", { data: JSON.stringify(value) });
  }
}

function setup(input: {
  batched?: boolean;
  guard?: () => Promise<void>;
  clock?: () => number;
  events?: PerplStreamEvent[];
  signal?: AbortSignal;
}) {
  const socket = new Socket();
  const stream = new PerplPublicStream({
    markets: [market],
    now: input.clock ?? (() => now),
    signal: input.signal ?? new AbortController().signal,
    guard: input.guard ?? (async () => {}),
    ...(input.batched ? { messageProcessing: "guarded-batches" as const } : {}),
    event: (event) => input.events?.push(event),
    socket: () => {
      queueMicrotask(() => {
        socket.readyState = 1;
        socket.emit("open");
      });
      return socket;
    },
  });
  return { stream, socket };
}

function initial(socket: Socket, stream: PerplPublicStream) {
  socket.message({
    mt: 6,
    subs: stream.state.streams().map((name, i) => ({ stream: name, sid: i + 1 })),
  });
  socket.message({
    mt: 15,
    sid: 3,
    at: { t: now, b: 100 },
    bid: [{ p: 999, s: 10000000, o: 1 }],
    ask: [{ p: 1001, s: 10000000, o: 1 }],
  });
  socket.message({
    mt: 9,
    sid: 2,
    d: {
      [market.marketId]: {
        at: { t: now, b: 100 },
        mrk: 1000,
        orl: 1000,
        lst: 1000,
        bid: 999,
        ask: 1001,
        oi: 1000000,
      },
    },
  });
}

test("thirty controlled paired bursts preserve exact results with fewer ownership round trips", async () => {
  const measurements: {
    repetition: number;
    mode: string;
    durationMs: number;
    guardChecks: number;
    queuePeak: number;
  }[] = [];
  const signal = new AbortController().signal;
  for (let repetition = 0; repetition < 30; repetition++) {
    const results = [];
    for (const batched of [false, true]) {
      let checks = 0;
      const events: PerplStreamEvent[] = [];
      const { socket, stream } = setup({
        batched,
        events,
        guard: async () => {
          checks++;
          await wait(1);
        },
      });
      try {
        await stream.connect(signal);
        initial(socket, stream);
        await stream.latest(["BTC"], signal);
        const before = checks;
        const start = performance.now();
        for (let i = 0; i < 30; i++) {
          socket.message({
            mt: 16,
            sid: 3,
            at: { t: now + i + 1, b: 101 + i },
            bid: [{ p: 999, s: 10000000 + i, o: 1 }],
            ask: [],
          });
        }
        const buffer = await stream.latest(["BTC"], signal);
        const durationMs = performance.now() - start;
        const guardChecks = checks - before;
        results.push(buffer.components);
        await stream.close();
        const metrics = events.filter((event) => event.kind === "closed").at(-1)!.processing!;
        assert.equal(metrics.processedMessages, 33);
        assert.ok(metrics.queuePeak <= 32);
        assert.equal(
          events.some((event) => event.kind === "error"),
          false,
        );
        assert.equal(guardChecks, batched ? 4 : 33);
        measurements.push({
          repetition,
          mode: batched ? "guarded-batches" : "per-message",
          durationMs,
          guardChecks,
          queuePeak: metrics.queuePeak,
        });
      } finally {
        await stream.close();
      }
    }
    assert.deepEqual(results[1], results[0]);
  }
  if (process.env.PICKLER_STREAM_THROUGHPUT_FILE) {
    await writeFile(
      process.env.PICKLER_STREAM_THROUGHPUT_FILE,
      JSON.stringify({
        version: 1,
        scenario: "Thirty ordered deltas; injected one-millisecond database guard delay",
        limitation: "Controlled wall time, not public network latency or economic evidence",
        measurements,
      }),
      { flag: "wx", mode: 0o600 },
    );
  }
});

test("a guarded batch retains the 32-message cap and cancellation does not await blocked SQL", async () => {
  let blocking = false;
  let release: () => void = () => {};
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  const events: PerplStreamEvent[] = [];
  const { stream, socket } = setup({
    batched: true,
    events,
    guard: async () => {
      if (blocking) {
        await blocked;
      }
    },
  });
  await stream.connect(new AbortController().signal);
  blocking = true;
  for (let i = 0; i < 33; i++) {
    socket.message({ mt: 100, sn: i + 1, h: i + 100 });
  }
  await stream.close();
  release();
  assert.equal(socket.readyState, 3);
  assert.deepEqual(events.find((event) => event.kind === "error")!.limit, {
    component: "message-queue",
    observed: 33,
    maximum: 32,
  });
  assert.equal(events.filter((event) => event.kind === "message").length, 0);
});

test("a failed live ownership check discards the entire pending batch and blocks buffer access", async () => {
  let owned = true;
  const events: PerplStreamEvent[] = [];
  const { stream, socket } = setup({
    batched: true,
    events,
    guard: async () => {
      if (!owned) {
        throw new PilotError("LEASE_LOST", "Controlled ownership loss");
      }
    },
  });
  const signal = new AbortController().signal;
  try {
    await stream.connect(signal);
    owned = false;
    initial(socket, stream);
    await assert.rejects(stream.latest(["BTC"], signal), { code: "LEASE_LOST" });
    await stream.close();
    assert.equal(socket.readyState, 3);
    assert.equal(events.filter((event) => event.kind === "message").length, 0);
    assert.throws(() => stream.state.frame("BTC", now), { code: "DATA_UNAVAILABLE" });
  } finally {
    await stream.close();
  }
});

test("snapshot refresh preserves one socket and thirteen-entry semantics with bounded requests", async () => {
  let clock = now;
  const events: PerplStreamEvent[] = [];
  const { stream, socket } = setup({ batched: true, events, clock: () => clock });
  const signal = new AbortController().signal;
  try {
    await stream.connect(signal);
    initial(socket, stream);
    const first = await stream.latest(["BTC"], signal);
    for (let i = 0; i < 600; i++) {
      clock = now + i * 100;
      await stream.requestSnapshots(signal);
    }
    assert.equal(socket.sent.length, 6);
    assert.ok(socket.sent.every((value) => value === socket.sent[0]));
    const latest = await stream.latest(["BTC"], signal);
    assert.equal(latest.generation, first.generation);
    assert.equal(latest.components[0]!.book!.provenance.providerTimestamp, now);
    assert.equal(latest.components[0]!.snapshot!.ticker.provenance.providerTimestamp, now);
    assert.equal(events.filter((event) => event.kind === "snapshot-request").length, 5);
    const aborted = new AbortController();
    aborted.abort(new PilotError("CANCELLED", "Controlled"));
    await assert.rejects(stream.requestSnapshots(aborted.signal), { code: "CANCELLED" });
    assert.equal(socket.sent.length, 6);
  } finally {
    await stream.close();
  }
});

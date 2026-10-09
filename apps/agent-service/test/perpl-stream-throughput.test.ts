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
  direct?: boolean;
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
    ...(input.direct
      ? { messageProcessing: "direct-reconstruction" as const }
      : input.batched
        ? { messageProcessing: "guarded-batches" as const }
        : {}),
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
    subs: stream.streams().map((name, i) => ({ stream: name, sid: i + 1 })),
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
    for (const direct of [false, true]) {
      let checks = 0;
      const events: PerplStreamEvent[] = [];
      const { socket, stream } = setup({
        direct,
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
        assert.equal(guardChecks, direct ? 3 : 33);
        measurements.push({
          repetition,
          mode: direct ? "direct-reconstruction" : "per-message",
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
    await assert.rejects(stream.latest(["BTC"], signal), { code: "LEASE_LOST" });
    assert.equal("state" in stream, false);
  } finally {
    await stream.close();
  }
});

test("direct reconstruction absorbs ordered updates during blocked SQL without granting buffer access", async () => {
  let blocking = false;
  let owned = true;
  let release: () => void = () => {};
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  const events: PerplStreamEvent[] = [];
  const { stream, socket } = setup({
    direct: true,
    events,
    guard: async () => {
      if (blocking) {
        await blocked;
      }
      if (!owned) {
        throw new PilotError("LEASE_LOST", "Controlled ownership loss");
      }
    },
  });
  const signal = new AbortController().signal;
  try {
    await stream.connect(signal);
    initial(socket, stream);
    await stream.latest(["BTC"], signal);
    blocking = true;
    let delivered = false;
    const pending = stream.latest(["BTC"], signal);
    void pending.then(
      () => {
        delivered = true;
      },
      () => {},
    );
    for (let i = 0; i < 1000; i++) {
      socket.message({
        mt: 16,
        sid: 3,
        at: { t: now + i + 1, b: 101 + i },
        bid: [{ p: 999, s: 10000000 + i, o: 1 }],
        ask: [],
      });
    }
    assert.equal(events.filter((event) => event.kind === "message").length, 1003);
    assert.equal(delivered, false);
    assert.equal(events.filter((event) => event.kind === "error").length, 0);
    owned = false;
    release();
    await assert.rejects(pending, { code: "LEASE_LOST" });
    await stream.close();
    const metrics = events.filter((event) => event.kind === "closed").at(-1)!.processing!;
    assert.equal(metrics.processedMessages, 1003);
    assert.equal(metrics.receivedMessages, 1003);
    assert.equal(metrics.queuePeak, 1);
    assert.equal(socket.readyState, 3);
    await assert.rejects(stream.latest(["BTC"], signal), { code: "LEASE_LOST" });
    assert.equal("state" in stream, false);
  } finally {
    release();
    await stream.close();
  }
});

test("direct replication rejects buffered delivery and subsequent messages after cancellation", async () => {
  const controller = new AbortController();
  const events: PerplStreamEvent[] = [];
  const { stream, socket } = setup({ direct: true, signal: controller.signal, events });
  try {
    await stream.connect(controller.signal);
    initial(socket, stream);
    await stream.latest(["BTC"], controller.signal);
    controller.abort(new PilotError("LEASE_LOST", "Controlled cancellation"));
    const count = events.filter((event) => event.kind === "message").length;
    socket.message({ mt: 100, sn: 1, h: 100 });
    await assert.rejects(stream.latest(["BTC"], controller.signal), { code: "LEASE_LOST" });
    await stream.close();
    assert.equal(events.filter((event) => event.kind === "message").length, count);
    assert.equal(socket.readyState, 3);
  } finally {
    await stream.close();
  }
});

test("legacy batched subscription refresh stays bounded without implying newer source dates", async () => {
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

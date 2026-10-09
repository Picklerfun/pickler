import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { networkFailure } from "../src/perpl/network-diagnostics.js";
import { checkPublicConnectivity } from "../src/perpl/connectivity-control.js";
import {
  PerplRequestSchedule,
  PerplTransport,
  type PerplRequestDiagnostic,
} from "../src/perpl/transport.js";
import { PilotError } from "@pickler/core";

const context = () => ({ signal: new AbortController().signal, guard: async () => {} });
async function settle<T>(t: TestContext, promise: Promise<T>): Promise<T> {
  let done = false;
  void promise.then(
    () => {
      done = true;
    },
    () => {
      done = true;
    },
  );
  for (let i = 0; i < 400 && !done; i++) {
    t.mock.timers.tick(100);
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  assert.equal(done, true, "Controlled transport did not terminate");
  return promise;
}

test("network diagnostics classify only allowlisted evidence and exclude secrets", () => {
  for (const [code, stage] of [
    ["ENOTFOUND", "dns"],
    ["ECONNREFUSED", "connect"],
    ["ERR_TLS_CERT_ALTNAME_INVALID", "tls"],
    ["UND_ERR_BODY_TIMEOUT", "response_body"],
  ]) {
    const result = networkFailure(
      new Error("secret", { cause: { code, address: "private", headers: "secret" } }),
    );
    assert.equal(result.stage, stage);
    assert.deepEqual(result.codes, [code]);
    assert.equal(JSON.stringify(result).includes("secret"), false);
  }
  const mixed = new AggregateError([{ code: "ENOTFOUND" }, { code: "ECONNREFUSED" }], "secret");
  assert.equal(networkFailure(mixed).stage, "unknown");
  assert.equal(networkFailure({ code: "UNREVIEWED_SECRET" }).codes.length, 0);
  assert.equal(networkFailure({}, "timeout").stage, "unknown");
  const recursive: { cause?: unknown } = {};
  recursive.cause = recursive;
  assert.equal(networkFailure(recursive).stage, "unknown");
  assert.equal(
    networkFailure({
      get code() {
        throw new Error("must not run");
      },
    }).stage,
    "unknown",
  );
});

test("transport retains response phase and safe nested cause without changing failure codes", async () => {
  const events: PerplRequestDiagnostic[] = [];
  const client = new PerplTransport({
    onDiagnostic: (event) => events.push(event),
    transport: async () => {
      throw new TypeError("secret URL", { cause: { code: "ENOTFOUND" } });
    },
  });
  await assert.rejects(client.get("mainnet", "/v1/pub/context", context()), {
    code: "PERPL_TRANSPORT_FAILURE",
  });
  assert.equal(events[0]?.phase, "response_headers");
  assert.equal(events[0]?.headersMs, null);
  assert.equal(events[0]?.network?.stage, "dns");
  assert.equal(JSON.stringify(events).includes("secret"), false);
});

test("transport distinguishes body failure after HTTP headers", async () => {
  const events: PerplRequestDiagnostic[] = [];
  const client = new PerplTransport({
    onDiagnostic: (event) => events.push(event),
    transport: async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.error(Object.assign(new Error("secret"), { code: "UND_ERR_SOCKET" }));
          },
        }),
      ),
  });
  await assert.rejects(client.get("mainnet", "/v1/pub/context", context()));
  assert.equal(events[0]?.status, 200);
  assert.equal(events[0]?.phase, "response_body");
  assert.equal(events[0]?.network?.stage, "unknown");
});

test("control makes one bounded fixed-host read and never consumes its body", async () => {
  let calls = 0,
    guards = 0;
  const result = await checkPublicConnectivity({
    ...context(),
    guard: async () => {
      guards++;
    },
    transport: async (url, options) => {
      calls++;
      assert.equal(url, "https://www.cloudflare.com/cdn-cgi/trace");
      assert.equal(options?.redirect, "manual");
      assert.equal(options?.method, "GET");
      return new Response("secret diagnostic body", { status: 503 });
    },
  });
  assert.equal(calls, 1);
  assert.equal(guards, 2);
  assert.equal(result.reachable, true);
  assert.equal(result.status, 503);
  assert.equal(JSON.stringify(result).includes("secret"), false);
});

test("control cancellation and revoked ownership do not become connectivity failures", async () => {
  let calls = 0;
  await assert.rejects(
    checkPublicConnectivity({
      ...context(),
      guard: async () => {
        throw new Error("LEASE_LOST");
      },
      transport: async () => {
        calls++;
        return new Response();
      },
    }),
  );
  assert.equal(calls, 0);
  const controller = new AbortController();
  await assert.rejects(
    checkPublicConnectivity({
      signal: controller.signal,
      guard: async () => {},
      transport: async () => {
        controller.abort(new Error("LEASE_LOST"));
        return await new Promise<Response>(() => {});
      },
    }),
    /LEASE_LOST/,
  );
});

test("unresponsive control is bounded at three seconds without retries", async () => {
  let calls = 0;
  const keepAlive = setInterval(() => {}, 1000);
  try {
    const result = await checkPublicConnectivity({
      ...context(),
      transport: async () => {
        calls++;
        return await new Promise<Response>(() => {});
      },
    });
    assert.equal(result.failure?.termination, "timeout");
    assert.equal(result.failure?.stage, "unknown");
    assert.equal(calls, 1);
    assert.ok(result.durationMs >= 2900 && result.durationMs < 5000);
  } finally {
    clearInterval(keepAlive);
  }
});

test("a session stops at its request cap; a host may raise it to the check cap of 24", async () => {
  let calls = 0;
  const client = new PerplTransport({
    sessionLimit: 2,
    transport: async () => {
      calls++;
      return new Response("{}", { status: 200 });
    },
  });

  await client.get("testnet", "/v1/pub/context", context());
  await client.get("testnet", "/v1/pub/context", context());
  await assert.rejects(client.get("testnet", "/v1/pub/context", context()), {
    code: "PERPL_SESSION_LIMIT",
  });

  assert.equal(calls, 2);
  assert.doesNotThrow(() => new PerplTransport({ sessionLimit: 24 }));
  assert.throws(() => new PerplTransport({ sessionLimit: 25 }), { code: "INVALID_INPUT" });
  assert.throws(() => new PerplTransport({ sessionLimit: 0 }), { code: "INVALID_INPUT" });
});

test("request diagnostics attribute only known numeric book/ticker targets and disclose no path, query or body", async (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1_800_000_000_000 });
  const events: PerplRequestDiagnostic[] = [];
  const client = new PerplTransport({
    onDiagnostic: (event) => events.push(event),
    monotonic: () => Date.now(),
    transport: async () =>
      new Response("UNREVIEWED_BODY", { headers: { "x-private": "UNREVIEWED_HEADER" } }),
  });
  const paths = [
    "/v1/market-data/110/book?levels=50",
    "/v1/market-data/1/book",
    "/v1/market-data/20/ticker",
    "/v1/market-data/ticker",
    "/v1/pub/context",
    "/v1/market-data/110/book?levels=50&key=UNREVIEWED_QUERY",
    "/v1/market-data/0/book?levels=50",
    "/v1/market-data/9007199254740992/ticker",
    "/unrelated/110/book?levels=50",
  ];

  for (const path of paths) {
    await settle(t, client.get("mainnet", path, context()));
  }

  assert.deepEqual(
    events.map((event) => event.marketId),
    [110, 1, 20, ...Array(6)],
  );
  assert.ok(events.every((event) => event.version === 3 && event.phase === "complete"));
  assert.ok(events.slice(3).every((event) => !("marketId" in event)));
  const serialized = JSON.stringify(events);
  assert.equal(serialized.includes("UNREVIEWED"), false);
  assert.equal(serialized.includes("/v1/"), false);
  assert.equal(serialized.includes("https://"), false);
  assert.equal(serialized.includes("levels"), false);
});

test("a book cancelled at the acquisition deadline retains its market target while still queued", async (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1_800_000_000_000 });
  const schedule = new PerplRequestSchedule();
  let releaseQueue: () => void = () => {};
  schedule.tail = new Promise<void>((resolve) => {
    releaseQueue = resolve;
  });
  const controller = new AbortController();
  const events: PerplRequestDiagnostic[] = [];
  let calls = 0;
  const client = new PerplTransport({
    schedule,
    monotonic: () => Date.now(),
    onDiagnostic: (event) => events.push(event),
    transport: async () => {
      calls++;
      return new Response("{}");
    },
  });

  const pending = client.get("mainnet", "/v1/market-data/110/book?levels=50", {
    ...context(),
    signal: controller.signal,
  });
  const rejected = assert.rejects(pending, { code: "PERPL_TIMEOUT" });
  t.mock.timers.tick(20000);
  controller.abort(new PilotError("PERPL_TIMEOUT", "Controlled acquisition deadline"));
  releaseQueue();
  await rejected;

  assert.equal(calls, 0);
  assert.equal(events.length, 1);
  assert.equal(events[0]!.version, 3);
  assert.equal(events[0]!.marketId, 110);
  assert.equal(events[0]!.operation, "book");
  assert.equal(events[0]!.phase, "request_queue");
  assert.equal(events[0]!.startedAt, null);
  assert.equal(events[0]!.queueMs, 20000);
  assert.equal(events[0]!.code, "PERPL_TIMEOUT");
});

test("a dispatched book timeout retains its market target without fabricating headers or a response", async (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1_800_000_000_000 });
  const controller = new AbortController();
  const events: PerplRequestDiagnostic[] = [];
  let calls = 0;
  const client = new PerplTransport({
    monotonic: () => Date.now(),
    onDiagnostic: (event) => events.push(event),
    transport: async () => {
      calls++;
      controller.abort(new PilotError("PERPL_TIMEOUT", "Controlled deadline before headers"));
      return await new Promise<Response>(() => {});
    },
  });

  await assert.rejects(
    settle(
      t,
      client.get("mainnet", "/v1/market-data/31/book?levels=50", {
        ...context(),
        signal: controller.signal,
      }),
    ),
    { code: "PERPL_TIMEOUT" },
  );

  assert.equal(calls, 1);
  assert.equal(events[0]!.version, 3);
  assert.equal(events[0]!.marketId, 31);
  assert.equal(events[0]!.phase, "response_headers");
  assert.equal(events[0]!.status, null);
  assert.equal(events[0]!.headersMs, null);
  assert.equal(events[0]!.code, "PERPL_TIMEOUT");
});

import test from "node:test";
import assert from "node:assert/strict";
import { createIndexerRpcAdmission } from "../src/launch/indexer-rpc-admission.js";

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}

test("a hundred range reads reserve 25 groups before transport with at most four in flight", async () => {
  const reservations: number[] = [];
  const firstGroup = deferred<void>();
  const release = deferred<void>();
  let reserved = 0;
  let transported = 0;
  let active = 0;
  let maximum = 0;
  const admission = createIndexerRpcAdmission({
    maxRequests: 100,
    async reserve(count) {
      reservations.push(count);
      reserved += count;
      return true;
    },
    rpc: {
      async call(_method, params) {
        transported++;
        assert.ok(reserved >= transported, "Transport preceded its reservation");
        maximum = Math.max(maximum, ++active);
        if (transported === 4) {
          firstGroup.resolve();
        }
        await release.promise;
        active--;
        return params[0];
      },
    },
  });
  const results = Promise.all(
    Array.from({ length: 100 }, (_, n) => admission.rpc.call("header", [n])),
  );

  await firstGroup.promise;
  assert.equal(transported, 4);
  assert.equal(reserved, 4);
  release.resolve();

  assert.deepEqual(
    await results,
    Array.from({ length: 100 }, (_, n) => n),
  );
  await admission.stop();
  assert.equal(maximum, 4);
  assert.equal(admission.calls, 100);
  assert.deepEqual(
    reservations,
    Array.from({ length: 25 }, () => 4),
  );
});

test("one sequential read reserves only one call rather than a padded group", async () => {
  const reservations: number[] = [];
  const admission = createIndexerRpcAdmission({
    maxRequests: 4,
    async reserve(count) {
      reservations.push(count);
      return true;
    },
    rpc: {
      async call() {
        return "header";
      },
    },
  });

  assert.equal(await admission.rpc.call("header", []), "header");
  assert.equal(await admission.rpc.call("header", []), "header");
  await admission.stop();
  assert.deepEqual(reservations, [1, 1]);
  assert.equal(admission.calls, 2);
});

for (const rejection of ["denied", "transport"] as const) {
  test(`a ${rejection} reservation stops all queued reads without transport`, async () => {
    let attempts = 0;
    let transported = 0;
    const admission = createIndexerRpcAdmission({
      maxRequests: 8,
      async reserve(count) {
        attempts++;
        assert.equal(count, 4);
        if (rejection === "transport") {
          throw new Error("CONTROLLED_DATABASE_UNAVAILABLE");
        }
        return false;
      },
      rpc: {
        async call() {
          transported++;
          return null;
        },
      },
    });

    const results = await Promise.allSettled(
      Array.from({ length: 8 }, () => admission.rpc.call("header", [])),
    );
    await admission.stop();

    assert.ok(results.every((x) => x.status === "rejected"));
    assert.equal(attempts, 1);
    assert.equal(transported, 0);
    assert.equal(admission.calls, 0);
    await assert.rejects(admission.rpc.call("header", []), /INDEX_PASS_STOPPED/);
  });
}

test("per-pass exhaustion refuses the whole next group before its reservation", async () => {
  const reservations: number[] = [];
  let transported = 0;
  const admission = createIndexerRpcAdmission({
    maxRequests: 6,
    async reserve(count) {
      reservations.push(count);
      return true;
    },
    rpc: {
      async call() {
        return ++transported;
      },
    },
  });

  const results = await Promise.allSettled(
    Array.from({ length: 8 }, () => admission.rpc.call("header", [])),
  );
  await admission.stop();

  assert.equal(results.filter((x) => x.status === "fulfilled").length, 4);
  assert.ok(
    results
      .slice(4)
      .every((x) => x.status === "rejected" && x.reason.message === "INDEX_PASS_BUDGET_EXHAUSTED"),
  );
  assert.deepEqual(reservations, [4]);
  assert.equal(transported, 4);
});

test("a provider failure drains its accepted group and never transports another group", async () => {
  const remaining = deferred<void>();
  const failed = deferred<void>();
  let transported = 0;
  const reservations: number[] = [];
  const admission = createIndexerRpcAdmission({
    maxRequests: 8,
    async reserve(count) {
      reservations.push(count);
      return true;
    },
    rpc: {
      async call() {
        if (++transported === 1) {
          failed.resolve();
          throw new Error("CONTROLLED_RPC_FAILURE");
        }
        await remaining.promise;
        return "header";
      },
    },
  });
  const results = Promise.allSettled(
    Array.from({ length: 8 }, () => admission.rpc.call("header", [])),
  );

  await failed.promise;
  assert.equal(transported, 4);
  remaining.resolve();
  const settled = await results;
  await admission.stop();

  assert.equal(settled.filter((x) => x.status === "fulfilled").length, 3);
  assert.deepEqual(reservations, [4]);
  assert.equal(transported, 4);
});

test("stopping while a reservation is unresolved prevents later transport", async () => {
  const entered = deferred<void>();
  const reservation = deferred<boolean>();
  let transported = 0;
  const admission = createIndexerRpcAdmission({
    maxRequests: 8,
    async reserve() {
      entered.resolve();
      return reservation.promise;
    },
    rpc: {
      async call() {
        transported++;
        return null;
      },
    },
  });
  const results = Promise.allSettled(
    Array.from({ length: 8 }, () => admission.rpc.call("header", [])),
  );

  await entered.promise;
  const stopping = admission.stop();
  reservation.resolve(true);
  await stopping;

  assert.ok((await results).every((x) => x.status === "rejected"));
  assert.equal(transported, 0);
});

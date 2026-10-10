import test from "node:test";
import assert from "node:assert/strict";
import { runScheduledTokenIndexing } from "../src/token-schedule.js";

const base = {
  version: 2,
  maxBlocks: 100,
  rpcRequestsPerPass: 400,
  rpcRequestsPerDay: 5000,
  leaseSeconds: 60,
  maxCurvesPerPass: 10,
  maxPassesPerTick: 4,
};
const completed = (caughtUp = false) => ({
  kind: "completed",
  calls: 150,
  caughtUp,
  outcomes: [{ kind: "applied" as const, fromBlock: 1n, toBlock: 100n, blocks: 100, events: 0 }],
});

test("version 2 advances beyond a single range but never beyond its explicit tick limit", async () => {
  let calls = 0;
  const result = await runScheduledTokenIndexing({
    policy: JSON.stringify(base),
    runPass: async () => {
      calls++;
      return completed();
    },
  });

  assert.equal(calls, 4);
  assert.equal(result.passes.length, 4);
  assert.equal(result.stopReason, "pass_limit");
});

test("historical version 1 still runs exactly one range", async () => {
  const policy: Partial<typeof base> = { ...base };
  delete policy.maxPassesPerTick;
  let calls = 0;
  const result = await runScheduledTokenIndexing({
    policy: JSON.stringify({ ...policy, version: 1 }),
    runPass: async () => {
      calls++;
      return completed();
    },
  });

  assert.equal(calls, 1);
  assert.equal(result.stopReason, "pass_limit");
});

test("catch-up ends as soon as every source reaches the confirmed snapshot", async () => {
  let calls = 0;
  const result = await runScheduledTokenIndexing({
    policy: JSON.stringify(base),
    runPass: async () => completed(++calls === 2),
  });

  assert.equal(calls, 2);
  assert.equal(result.stopReason, "caught_up");
});

for (const kind of ["busy", "gap", "reorg"] as const) {
  test(`${kind} ends the tick without an immediate retry`, async () => {
    let calls = 0;
    const result = await runScheduledTokenIndexing({
      policy: JSON.stringify(base),
      runPass: async () => {
        calls++;
        if (kind === "busy") {
          return { kind: "busy" };
        }
        const outcomes =
          kind === "gap"
            ? [{ kind: "gap" as const, expectedBlock: 1n, receivedBlock: 2n }]
            : [
                {
                  kind: "reorg" as const,
                  rollbackToBlock: 1n,
                  orphanedBlocks: 1,
                  orphanedEvents: 0,
                },
              ];
        return { ...completed(), outcomes };
      },
    });

    assert.equal(calls, 1);
    assert.equal(result.stopReason, kind);
  });
}

for (const code of [
  "INDEX_PASS_BUDGET_EXHAUSTED",
  "INDEX_LEASE_OR_DAILY_BUDGET_UNAVAILABLE",
  "RPC_FAILED",
]) {
  test(`${code} stops further passes and remains an error`, async () => {
    let calls = 0;
    await assert.rejects(
      runScheduledTokenIndexing({
        policy: JSON.stringify(base),
        runPass: async () => {
          if (++calls === 2) {
            throw new Error(code);
          }
          return completed();
        },
      }),
      { message: code },
    );

    assert.equal(calls, 2);
  });
}

for (const patch of [
  { maxPassesPerTick: 0 },
  { maxPassesPerTick: 7 },
  { maxPassesPerTick: 1.5 },
  { version: 3 },
  { maxBlocks: 200 },
  { arbitrary: true },
]) {
  test(`invalid policy ${JSON.stringify(patch)} fails before a pass`, async () => {
    let calls = 0;
    await assert.rejects(
      runScheduledTokenIndexing({
        policy: JSON.stringify({ ...base, ...patch }),
        runPass: async () => {
          calls++;
          return completed();
        },
      }),
    );

    assert.equal(calls, 0);
  });
}

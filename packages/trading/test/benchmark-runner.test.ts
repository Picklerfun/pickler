import assert from "node:assert/strict";
import test from "node:test";
import { runBenchmarkLoop, type BenchmarkLoopPorts } from "@pickler/trading/evaluation";
import type { BenchmarkState } from "@pickler/trading/strategies";

test("shared scheduling records missed slots without retrospective discovery or purchases", async () => {
  const state = {
    deadline: 100000,
    settlementDeadline: 200000,
    cases: [],
    interruptions: [],
    slots: [{ kind: "btc-5m", start: 0, status: "pending" }],
  } as unknown as BenchmarkState;
  let discovery = 0,
    saves = 0;
  await runBenchmarkLoop(state, {
    ports: {} as BenchmarkLoopPorts["ports"],
    signal: new AbortController().signal,
    discover: async () => {
      discovery++;
      return [];
    },
    guard: async () => {},
    save: async () => {
      saves++;
    },
    settle: async () => {},
    stopped: () => false,
    admissionEnded: () => {},
    now: () => 100001,
    sleep: async () => {
      throw new Error("completed session must not sleep");
    },
  });
  assert.equal(discovery, 0);
  assert.equal(state.slots[0]!.status, "missed");
  assert.ok(saves > 0);
  assert.deepEqual(state.cases, []);
});
test("cancelled scheduling cannot discover, reserve or persist new work", async () => {
  const controller = new AbortController();
  controller.abort();
  let calls = 0;
  const fail = async () => {
    calls++;
    throw new Error("unexpected IO");
  };
  await assert.rejects(
    runBenchmarkLoop({} as BenchmarkState, {
      ports: {} as BenchmarkLoopPorts["ports"],
      signal: controller.signal,
      discover: fail,
      guard: fail,
      save: fail,
      settle: fail,
      stopped: () => false,
      admissionEnded: () => {},
      now: () => 0,
      sleep: fail,
    }),
    { name: "AbortError" },
  );
  assert.equal(calls, 0);
});

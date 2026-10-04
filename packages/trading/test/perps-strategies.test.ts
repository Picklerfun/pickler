import test from "node:test";
import assert from "node:assert/strict";
import {
  PERPS_STRATEGIES,
  resolvePerpsStrategy,
  executePerpsStrategy,
  type PerpsDecisionContext,
  type PerpsModelHooks,
  type PerpsModels,
  type PerpsProposal,
  type PerpsCallLane,
  type PerpsStrategyDependencies,
} from "@pickler/trading/strategies";
import { initialPaperAccount } from "@pickler/trading/perps";
import { executeLegacyPerpsReadiness } from "../src/features/perps-study/legacy-strategy.js";

function context(agentId = "agent"): PerpsDecisionContext {
  return {
    evidence: { observedAt: 1000, frames: [], candles: [], sourceIds: ["BTC:candles"] },
    account: initialPaperAccount(
      { tenantId: "tenant", agentId, sessionId: "session", network: "mainnet" },
      1,
      1000,
    ),
  };
}
const proposal: PerpsProposal[] = [
  { symbol: "BTC", action: "open-long", reason: "controlled", sourceIds: ["BTC:candles"] },
];
function dependencies(models: Partial<PerpsModels>, signal = new AbortController().signal) {
  const lanes: PerpsCallLane[] = [];
  const hooks: PerpsModelHooks = { before: async () => {}, usage: async () => {} };
  const deps: PerpsStrategyDependencies = {
    models,
    signal,
    calls: {
      async run(lane, operation) {
        lanes.push(lane);
        return operation(hooks);
      },
    },
  };
  return { lanes, deps };
}
const selection = (id: string) => ({ id, version: "1.0.0" });

test("registry covers each strategy once, freezes metadata and refuses unknown versions", async () => {
  assert.deepEqual(
    PERPS_STRATEGIES.map((s) => s.id),
    ["rules", "deepseek", "jev", "combined"],
  );
  assert.equal(new Set(PERPS_STRATEGIES.map((s) => s.id)).size, 4);
  assert.ok(Object.isFrozen(PERPS_STRATEGIES));
  assert.ok(PERPS_STRATEGIES.every((s) => Object.isFrozen(s) && Object.isFrozen(s.capabilities)));
  assert.throws(() => resolvePerpsStrategy(selection("legacy")), { code: "STRATEGY_UNAVAILABLE" });
  assert.throws(() => resolvePerpsStrategy({ id: "rules", version: "2.0.0" }), {
    code: "STRATEGY_UNAVAILABLE",
  });
  const { deps, lanes } = dependencies({ direct: async () => proposal });
  await assert.rejects(executePerpsStrategy(selection("combined"), context(), deps), {
    code: "MODEL_CONFIG_MISMATCH",
  });
  assert.deepEqual(lanes, []);
});

test("rules require no models and preserve missing-candle holds without paid calls", async () => {
  const { deps, lanes } = dependencies({});
  const result = await executePerpsStrategy(selection("rules"), context(), deps);
  assert.deepEqual(
    result.map((p) => [p.action, p.reason]),
    [
      ["hold", "INSUFFICIENT_CLOSED_CANDLES"],
      ["hold", "INSUFFICIENT_CLOSED_CANDLES"],
    ],
  );
  assert.deepEqual(lanes, []);
});

test("strategies route only required calls using independent immutable portfolios", async () => {
  const seen: string[] = [];
  const models = {
    direct: async (input: PerpsDecisionContext) => {
      seen.push(input.account.scope.agentId);
      assert.ok(Object.isFrozen(input.evidence.sourceIds));
      assert.throws(() => input.account.positions.push({} as never), TypeError);
      return proposal;
    },
    decide: async (input: PerpsDecisionContext) => {
      seen.push(input.account.scope.agentId);
      return { proposals: proposal, answers: {} };
    },
    review: async (input: PerpsDecisionContext, original: PerpsProposal[]) => {
      seen.push(input.account.scope.agentId);
      assert.deepEqual(original, proposal);
      return {
        proposals: original.map((p) => ({
          ...p,
          action: "hold" as const,
          reason: "JEV_MATERIAL_VETO",
        })),
        answers: {},
      };
    },
  };
  for (const [id, lanes] of [
    ["deepseek", ["direct"]],
    ["jev", ["jev"]],
    ["combined", ["fallback", "review"]],
  ] as const) {
    const input = context(id);
    const run = dependencies(models);
    const result = await executePerpsStrategy(selection(id), input, run.deps);
    assert.deepEqual(run.lanes, lanes);
    assert.equal(result[0]!.action, id === "combined" ? "hold" : "open-long");
    assert.equal(input.account.positions.length, 0);
    assert.equal(Object.isFrozen(input), false);
  }
  assert.deepEqual(seen, ["deepseek", "jev", "combined", "combined"]);
});

test("budget refusal, model failure and cancellation never trigger review or retries", async () => {
  let directCalls = 0;
  let reviewCalls = 0;
  const abort = new AbortController();
  const models = {
    direct: async () => {
      directCalls++;
      abort.abort(new Error("lease lost"));
      return proposal;
    },
    review: async () => {
      reviewCalls++;
      return { proposals: proposal, answers: {} };
    },
  };
  const cancelled = dependencies(models, abort.signal);
  await assert.rejects(
    executePerpsStrategy(selection("combined"), context(), cancelled.deps),
    /lease lost/,
  );
  assert.equal(directCalls, 1);
  assert.equal(reviewCalls, 0);
  const blocked = dependencies(models);
  blocked.deps.calls.run = async () => {
    throw new Error("budget unavailable");
  };
  await assert.rejects(
    executePerpsStrategy(selection("combined"), context(), blocked.deps),
    /budget unavailable/,
  );
  assert.equal(directCalls, 1);
  const failed = dependencies({
    ...models,
    direct: async () => {
      directCalls++;
      throw new Error("transport failed");
    },
  });
  await assert.rejects(
    executePerpsStrategy(selection("combined"), context(), failed.deps),
    /transport failed/,
  );
  assert.deepEqual(failed.lanes, ["fallback"]);
  assert.equal(directCalls, 2);
  assert.equal(reviewCalls, 0);
});

test("legacy readiness keeps skip and blind fallback distinct from combined review", async () => {
  for (const skip of [true, false]) {
    const run = dependencies({
      readiness: async () => ({ skip, answers: {} }),
      direct: async () => proposal,
    });
    const result = await executeLegacyPerpsReadiness(context(), run.deps);
    assert.deepEqual(run.lanes, skip ? ["jev"] : ["jev", "fallback"]);
    assert.deepEqual(
      result,
      skip
        ? ["BTC", "ETH"].map((symbol) => ({
            symbol,
            action: "hold",
            reason: "JEV_MATERIAL_INSUFFICIENCY",
            sourceIds: [],
          }))
        : proposal,
    );
  }
});

test("cancellation during call admission prevents the delayed model operation", async () => {
  const abort = new AbortController();
  let called = 0;
  const run = dependencies(
    {
      direct: async () => {
        called++;
        return proposal;
      },
    },
    abort.signal,
  );
  run.deps.calls.run = async (_lane, operation) => {
    abort.abort(new Error("ownership revoked"));
    return operation({ before: async () => {}, usage: async () => {} });
  };
  await assert.rejects(
    executePerpsStrategy(selection("deepseek"), context(), run.deps),
    /ownership revoked/,
  );
  assert.equal(called, 0);
});

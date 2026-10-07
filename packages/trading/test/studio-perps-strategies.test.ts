import test from "node:test";
import assert from "node:assert/strict";
import {
  executeStudioPerpsStrategy,
  PERPS_STRATEGIES,
  type StudioPerpsContext,
  type StudioPerpsProposal,
  type StudioPerpsModels,
  type PerpsCallLane,
} from "@pickler/trading/strategies";
import { initialPaperAccount } from "@pickler/trading/perps";
import { DEFAULT_CONFIG, effectiveStudioStrategy, reviseSetup } from "@pickler/core";

function context(): StudioPerpsContext {
  return {
    protocol: "studio-perps-strategy-v2",
    markets: ["BTC"],
    evidence: { observedAt: 1000, frames: [], candles: [], sourceIds: ["BTC:candles"] },
    account: initialPaperAccount(
      { tenantId: "tenant", agentId: "agent", sessionId: "product", network: "testnet" },
      1,
      1000,
    ),
    brief: {
      thesis: "controlled",
      reads: [],
      entersWhen: ["trend supported"],
      exitsWhen: ["trend invalid"],
      never: ["conflicting evidence"],
    },
    sources: { web: null, books: [] },
    documents: [],
  };
}
function proposal(): StudioPerpsProposal {
  const finding = {
    index: 1,
    state: "met" as const,
    reason: "controlled",
    sourceIds: ["BTC:candles"],
  };
  return {
    symbol: "BTC",
    action: "open-long",
    reason: "controlled",
    sourceIds: ["BTC:candles"],
    brief: {
      entries: [finding],
      exits: [{ ...finding, state: "not-met" }],
      never: [{ ...finding, state: "not-met" }],
    },
  };
}
function run(id: string, input = context(), models: StudioPerpsModels = {}) {
  const lanes: PerpsCallLane[] = [];
  const result = executeStudioPerpsStrategy({ id, version: "2.0.0" }, input, {
    models,
    signal: new AbortController().signal,
    calls: {
      async run(lane, operation) {
        lanes.push(lane);
        return operation({ before: async () => {}, usage: async () => {} });
      },
    },
  });
  return { result, lanes };
}
const answer = (choice: string) => ({ choice, confidence: 1, probabilities: { [choice]: 1 } });

test("registry keeps all twelve id/version pairs distinct and defaults do not enable execution", () => {
  assert.equal(new Set(PERPS_STRATEGIES.map((value) => `${value.id}@${value.version}`)).size, 12);
  assert.deepEqual(effectiveStudioStrategy(DEFAULT_CONFIG), { id: "combined", version: "2.0.0" });
  assert.equal(DEFAULT_CONFIG.perpsStrategy, undefined);
});
test("rules reject authored conditions before any calls; empty rules brief supports missing-candle hold", async () => {
  const rejected = run("rules");
  await assert.rejects(rejected.result, { code: "RULES_BRIEF_UNSUPPORTED" });
  assert.deepEqual(rejected.lanes, []);
  const input = context();
  input.brief.entersWhen = [];
  input.brief.exitsWhen = [];
  input.brief.never = [];
  const accepted = run("rules", input);
  assert.equal((await accepted.result)[0]!.reason, "INSUFFICIENT_CLOSED_CANDLES");
  assert.deepEqual(accepted.lanes, []);
  const config = { ...DEFAULT_CONFIG, brief: input.brief };
  assert.equal(
    reviseSetup(config, { perpsStrategy: { id: "rules", version: "2.0.0" } }).perpsStrategy?.id,
    "rules",
  );
});
test("uncertain brief cannot admit an entry; fabricated references are failures", async () => {
  const uncertain = proposal();
  uncertain.brief.entries[0]!.state = "unknown";
  assert.equal(
    (await run("deepseek", context(), { direct: async () => [uncertain] }).result)[0]!.action,
    "hold",
  );
  const invalid = proposal();
  invalid.brief.never[0]!.sourceIds = ["invented"];
  await assert.rejects(run("deepseek", context(), { direct: async () => [invalid] }).result, {
    code: "STRATEGY_RESPONSE_INVALID",
  });
});
test("direct and atomic Jev use only their own adapters and preserve immutable account context", async () => {
  const direct = run("deepseek", context(), {
    direct: async (ctx) => {
      assert.ok(Object.isFrozen(ctx.brief.entersWhen));
      assert.throws(() => ctx.account.positions.push({} as never), TypeError);
      return [proposal()];
    },
  });
  assert.equal((await direct.result)[0]!.action, "open-long");
  assert.deepEqual(direct.lanes, ["direct"]);
  const jev = run("jev", context(), {
    decide: async () => ({
      answers: {
        BTC_long: answer("SUPPORTED"),
        BTC_short: answer("UNSUPPORTED"),
        BTC_thesis: answer("INTACT"),
      },
      brief: { BTC: proposal().brief },
    }),
  });
  assert.equal((await jev.result)[0]!.action, "open-long");
  assert.deepEqual(jev.lanes, ["jev"]);
});
test("combined uses own proposal then review; material veto remains a hold", async () => {
  const combined = run("combined", context(), {
    direct: async () => [proposal()],
    review: async (_ctx, proposals) => {
      assert.ok(Object.isFrozen(proposals));
      return {
        answers: {
          BTC_identity: answer("CONSISTENT"),
          BTC_evidence: answer("CONTRADICTED"),
          BTC_costs: answer("CONSISTENT"),
        },
      };
    },
  });
  assert.equal((await combined.result)[0]!.reason, "JEV_MATERIAL_VETO");
  assert.deepEqual(combined.lanes, ["fallback", "review"]);
});
test("cancelled admission never reaches transport, unknown version never falls back", async () => {
  const controller = new AbortController();
  let calls = 0;
  await assert.rejects(
    executeStudioPerpsStrategy({ id: "deepseek", version: "2.0.0" }, context(), {
      signal: controller.signal,
      models: {
        direct: async () => {
          calls++;
          return [proposal()];
        },
      },
      calls: {
        async run(_lane, operation) {
          controller.abort(new Error("lease lost"));
          return operation({ before: async () => {}, usage: async () => {} });
        },
      },
    }),
    /lease lost/,
  );
  assert.equal(calls, 0);
  await assert.rejects(
    executeStudioPerpsStrategy({ id: "deepseek", version: "1.0.0" }, context(), {
      signal: new AbortController().signal,
      models: {},
      calls: {
        run: async () => {
          throw new Error("must not call");
        },
      },
    }),
    { code: "STRATEGY_CONTEXT_MISMATCH" },
  );
});

test("all four 2.1 strategies accept authorized SOL without changing call lanes or veto policy", async () => {
  for (const id of ["rules", "deepseek", "jev", "combined"] as const) {
    const input = context();
    input.strategyVersion = "2.1.0";
    input.markets = ["SOL"];
    input.evidence.sourceIds = ["SOL:candles"];
    const proposed = proposal();
    proposed.symbol = "SOL";
    proposed.sourceIds = ["SOL:candles"];
    for (const section of Object.values(proposed.brief)) {
      for (const finding of section) {
        finding.sourceIds = ["SOL:candles"];
      }
    }
    if (id === "rules") {
      input.brief.entersWhen = [];
      input.brief.exitsWhen = [];
      input.brief.never = [];
    }
    const lanes: PerpsCallLane[] = [];
    const output = await executeStudioPerpsStrategy({ id, version: "2.1.0" }, input, {
      signal: new AbortController().signal,
      models: {
        direct: async (read) => {
          assert.deepEqual(read.markets, ["SOL"]);
          assert.ok(Object.isFrozen(read.account));
          return [proposed];
        },
        decide: async () => ({
          answers: {
            SOL_long: answer("SUPPORTED"),
            SOL_short: answer("UNSUPPORTED"),
            SOL_thesis: answer("INTACT"),
          },
          brief: { SOL: proposed.brief },
        }),
        review: async () => ({
          answers: {
            SOL_identity: answer("CONSISTENT"),
            SOL_evidence: answer("CONSISTENT"),
            SOL_costs: answer("CONSISTENT"),
          },
        }),
      },
      calls: {
        async run(lane, operation) {
          lanes.push(lane);
          return operation({ before: async () => {}, usage: async () => {} });
        },
      },
    });
    assert.equal(output[0]!.symbol, "SOL");
    assert.equal(output[0]!.action, id === "rules" ? "hold" : "open-long");
    assert.deepEqual(
      lanes,
      { rules: [], deepseek: ["direct"], jev: ["jev"], combined: ["fallback", "review"] }[id],
    );
    await assert.rejects(
      executeStudioPerpsStrategy({ id, version: "2.0.0" }, input, {
        models: {},
        signal: new AbortController().signal,
        calls: {
          run: async () => {
            throw Error("must not call");
          },
        },
      }),
    );
  }
});
test("2.1 rejects a response for a removed market instead of executing a partial analysis", async () => {
  const input = context();
  input.markets = ["SOL"];
  input.strategyVersion = "2.1.0";
  await assert.rejects(
    executeStudioPerpsStrategy({ id: "deepseek", version: "2.1.0" }, input, {
      signal: new AbortController().signal,
      models: { direct: async () => [proposal()] },
      calls: {
        run: async (_lane, operation) =>
          operation({ before: async () => {}, usage: async () => {} }),
      },
    }),
    { code: "STRATEGY_RESPONSE_INVALID" },
  );
});

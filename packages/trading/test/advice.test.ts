import test from "node:test";
import assert from "node:assert/strict";
import { PilotError, type AdviceExecutionRepository } from "@pickler/core";
import {
  createAdviceRunner,
  validateAdviceEvidence,
  adviceReservations,
  adviceTokenCost,
  parseAdvicePolicy,
  type AdviceAnswer,
} from "@pickler/trading/perps";
import { adviceFixture, adviceTime } from "./advice-fixture.js";
const answer: AdviceAnswer = {
  orientation: "long",
  summary: "Controlled directional analysis",
  reasons: ["Observed price trend"],
  risks: ["Volatility"],
  limitations: [],
  sourceIds: ["perpl-ticker"],
};
function setup(options: { skip?: boolean; answer?: AdviceAnswer; fail?: boolean } = {}) {
  const { job, evidence } = adviceFixture();
  const events: unknown[] = [];
  let forecasts = 0,
    finished: unknown,
    error: string | undefined,
    guards = 0;
  const repository = {
    guard: async () => {
      guards++;
    },
    resolve: async () => ({
      publicId: job.publicAgentId,
      tenantId: job.tenantId,
      agentId: job.agentId,
      version: 1,
      config: job.config,
      published: true,
      enabled: true,
    }),
    event: async (_: unknown, kind: string, data: unknown) => {
      events.push({ kind, data });
    },
    finish: async (_: unknown, result: unknown, code?: string) => {
      finished = result;
      error = code;
    },
  } as unknown as AdviceExecutionRepository;
  const run = createAdviceRunner({
    repository,
    data: async () => evidence,
    now: () => adviceTime,
    models: {
      metadata: () => ({ version: 1 }),
      sufficient: async () => {
        if (options.fail) {
          throw new Error("Provider failed");
        }
        return { skip: options.skip ?? false, answers: { readiness: "controlled" } };
      },
      forecast: async (_job, input) => {
        forecasts++;
        assert.equal(input, evidence);
        assert.equal("answers" in input, false);
        return options.answer ?? answer;
      },
    },
  });
  return {
    job,
    evidence,
    run,
    events,
    repository,
    forecasts: () => forecasts,
    finished: () => finished,
    error: () => error,
    guards: () => guards,
  };
}
test("coherent insufficiency alone avoids forecasting; supported analysis preserves evidence without portfolio data", async () => {
  for (const skip of [true, false]) {
    const f = setup({ skip });
    await f.run(f.job, new AbortController().signal);
    assert.equal(f.forecasts(), skip ? 0 : 1);
    assert.equal((f.finished() as AdviceAnswer).orientation, skip ? "wait" : "long");
    assert.ok(f.guards() >= 3);
    assert.doesNotMatch(JSON.stringify(f.finished()), /capital|leverage|position|tenantId/);
  }
});
test("stale, mismatched or incomplete data fails before models instead of becoming wait", async () => {
  for (const alter of [
    (f: ReturnType<typeof setup>) => {
      f.evidence.frame.book.provenance.providerTimestamp = adviceTime - 30001;
    },
    (f: ReturnType<typeof setup>) => {
      f.evidence.candles.candles[0]!.closed = false;
    },
    (f: ReturnType<typeof setup>) => {
      f.evidence.candles.candles.pop();
    },
    (f: ReturnType<typeof setup>) => {
      f.evidence.frame.book.market.symbol = "ETH";
    },
  ]) {
    const f = setup();
    alter(f);
    await f.run(f.job, new AbortController().signal);
    assert.equal(f.finished(), null);
    assert.ok(f.error());
    assert.equal(f.forecasts(), 0);
  }
});
test("invalid citations and transport failures fail; cancellation and lost ownership cannot make subsequent calls", async () => {
  for (const options of [{ answer: { ...answer, sourceIds: ["invented"] } }, { fail: true }]) {
    const f = setup(options);
    await f.run(f.job, new AbortController().signal);
    assert.equal(f.finished(), null);
    assert.ok(f.error());
  }
  const cancelled = setup();
  const controller = new AbortController();
  controller.abort();
  await cancelled.run(cancelled.job, controller.signal);
  assert.equal(cancelled.forecasts(), 0);
  assert.equal(cancelled.guards(), 0);
  const lost = setup();
  lost.repository.guard = async () => {
    throw new PilotError("LEASE_LOST", "Lost");
  };
  await assert.rejects(lost.run(lost.job, new AbortController().signal), { code: "LEASE_LOST" });
  assert.equal(lost.finished(), undefined);
  assert.equal(lost.forecasts(), 0);
});
test("USD reserves use exact upward rounding and invalid or absent pricing cannot enable advice", () => {
  const { job, evidence } = adviceFixture();
  validateAdviceEvidence(job, evidence, adviceTime);
  assert.equal(adviceTokenCost(job.policy, "jev", 1, 100), 1n);
  assert.deepEqual(adviceReservations(job.policy, false), {
    jev: "3000",
    deepseek: "3400",
    web: "0",
    "web-fallback": "0",
  });
  assert.equal(parseAdvicePolicy(undefined), null);
  assert.equal(
    parseAdvicePolicy(JSON.stringify({ ...job.policy, requestLimitUsd: "0.000001" })),
    null,
  );
});

test("provider pricing v2 requires an HTTPS base URL; historical v1 remains readable", () => {
  const { job } = adviceFixture();
  const policy = {
    ...job.policy,
    version: 2,
    deepseekBaseUrl: "https://dashscope.example/compatible-mode/v1",
  };
  assert.deepEqual(parseAdvicePolicy(JSON.stringify(policy)), policy);
  assert.deepEqual(parseAdvicePolicy(JSON.stringify(job.policy)), job.policy);
  for (const deepseekBaseUrl of [
    undefined,
    "http://example.com",
    "not-a-url",
    "https://user:key@example.com/v1",
    "https://example.com/v1?token=key",
    "https://example.com/v1#secret",
  ]) {
    assert.equal(parseAdvicePolicy(JSON.stringify({ ...policy, deepseekBaseUrl })), null);
  }
  assert.equal(parseAdvicePolicy(JSON.stringify({ ...policy, version: 3 })), null);
});

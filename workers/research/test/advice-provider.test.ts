import test from "node:test";
import assert from "node:assert/strict";
import type { AdviceExecutionRepository } from "@pickler/core";
import { adviceFixture } from "./advice-fixture.js";
import {
  adviceProviderMatches,
  createAdviceModels,
} from "../../../packages/agent-runtime/src/composition/advice-model.js";

const configuration = {
  jev: "controlled-jev-key",
  baseUrl: "https://dashscope.example/compatible-mode/v1/",
  model: "deepseek-chat",
  apiKey: "controlled-existing-model-key",
};
function setup() {
  const { job, evidence } = adviceFixture();
  job.policy = { ...job.policy, version: 2, deepseekBaseUrl: configuration.baseUrl };
  let calls = 0;
  let starts = 0;
  let usages = 0;
  const repository = {
    guard: async () => {},
    startCall: async () => {
      starts++;
    },
    usage: async () => {
      usages++;
    },
  } as unknown as AdviceExecutionRepository;
  const transport: typeof fetch = async (url, init) => {
    calls++;
    assert.equal(String(url), "https://dashscope.example/compatible-mode/v1/chat/completions");
    assert.equal(new Headers(init?.headers).get("authorization"), `Bearer ${configuration.apiKey}`);
    assert.equal(init?.redirect, "manual");
    const body = JSON.parse(init!.body as string);
    assert.equal(body.model, configuration.model);
    assert.equal(body.max_tokens, 2000);
    return Response.json({
      model: configuration.model,
      usage: { prompt_tokens: 10, completion_tokens: 10 },
      choices: [
        {
          message: {
            content: JSON.stringify({
              orientation: "wait",
              summary: "Controlled",
              reasons: ["Uncertain"],
              risks: ["Volatility"],
              limitations: [],
              sourceIds: ["perpl-ticker"],
            }),
          },
        },
      ],
    });
  };
  return { job, evidence, repository, transport, counts: () => ({ calls, starts, usages }) };
}
test("advice reuses configured provider, base path, model and credential with one accounted call", async () => {
  const f = setup();
  const models = createAdviceModels(f.repository, configuration, f.transport);
  assert.equal(
    (await models.forecast(f.job, f.evidence, new AbortController().signal)).orientation,
    "wait",
  );
  assert.deepEqual(f.counts(), { calls: 1, starts: 1, usages: 1 });
});
test("provider/model mismatch or invalid credentials refuse both lanes before any started call", async () => {
  for (const changed of [
    { baseUrl: "https://other.example/v1" },
    { baseUrl: "https://dashscope.example/another-path" },
    { model: "another-model" },
    { apiKey: "" },
    { jev: "" },
    { baseUrl: "http://dashscope.example/compatible-mode/v1" },
    { baseUrl: "https://user:secret@dashscope.example/compatible-mode/v1" },
    { baseUrl: `${configuration.baseUrl}?api_key=secret` },
  ]) {
    const f = setup();
    const models = createAdviceModels(f.repository, { ...configuration, ...changed }, f.transport);
    for (const lane of ["sufficient", "forecast"] as const) {
      await assert.rejects(models[lane](f.job, f.evidence, new AbortController().signal), {
        code: "ADVICE_CONFIGURATION_UNAVAILABLE",
      });
    }
    assert.deepEqual(f.counts(), { calls: 0, starts: 0, usages: 0 });
  }
});
test("historical v1 remains pinned to direct DeepSeek and never switches to DashScope", () => {
  const { job } = adviceFixture();
  assert.equal(adviceProviderMatches(job.policy, configuration), false);
  assert.equal(
    adviceProviderMatches(job.policy, { ...configuration, baseUrl: "https://api.deepseek.com/" }),
    true,
  );
});
test("cancellation, redirect and usage failure never trigger another provider or retry", async () => {
  const f = setup();
  const controller = new AbortController();
  controller.abort();
  const models = createAdviceModels(f.repository, configuration, f.transport);
  await assert.rejects(models.forecast(f.job, f.evidence, controller.signal));
  assert.deepEqual(f.counts(), { calls: 0, starts: 0, usages: 0 });
  for (const response of [
    new Response(null, { status: 302, headers: { location: "https://other.example" } }),
    Response.json({ model: configuration.model }),
  ]) {
    let calls = 0;
    const failing = createAdviceModels(f.repository, configuration, async () => {
      calls++;
      return response;
    });
    await assert.rejects(failing.forecast(f.job, f.evidence, new AbortController().signal));
    assert.equal(calls, 1);
  }
});

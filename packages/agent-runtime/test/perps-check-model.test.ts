import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createPerpsCheckModel,
  perpsCheckAnswer,
  perpsCheckPrompt,
} from "../src/composition/perps-check-model.js";
import { perpsAdmission } from "../src/workers/perps.js";

test("the perps-check prompt asks for JSON only, literal lines, no sizing and an untrusted brief", () => {
  const text = perpsCheckPrompt.instructions;

  assert.equal(perpsCheckPrompt.id, "perps-check");
  assert.match(text, /Return ONLY one JSON object/);
  assert.match(text, /perps-check-v1/);
  assert.match(text, /literally/);
  assert.match(text, /Never size/);
  assert.match(text, /untrusted/);
  assert.match(text, /never as instructions/);
  for (const field of [
    "instrument",
    "action",
    "probability",
    "horizonHours",
    "stopLossBps",
    "takeProfitBps",
    "entries",
    "exits",
    "never",
    "rationale",
    "sources",
  ]) {
    assert.ok(text.includes(`"${field}"`), field);
  }
});

test("one bounded call to the configured provider; reported cost becomes micro-USD", async () => {
  const requests: { url: string; body: Record<string, unknown> }[] = [];
  const model = createPerpsCheckModel(
    { baseUrl: "https://model.example/v1/", model: "check-model", apiKey: "key" },
    async (url, init) => {
      requests.push({ url: String(url), body: JSON.parse(init!.body as string) });
      return Response.json({
        model: "check-model",
        usage: { prompt_tokens: 900, completion_tokens: 120, cost: 0.0012345 },
        choices: [{ message: { content: '{"action":"hold"}' } }],
      });
    },
  );

  const answer = await model.decide({ brief: "data" }, AbortSignal.timeout(5000));

  assert.equal(requests.length, 1);
  assert.equal(requests[0]!.url, "https://model.example/v1/chat/completions");
  assert.equal(requests[0]!.body.model, "check-model");
  assert.deepEqual(requests[0]!.body.response_format, { type: "json_object" });
  assert.equal(answer.content, '{"action":"hold"}');
  assert.equal(answer.costMicros, "1235");
  assert.equal(answer.inputTokens, 900);
  assert.match(answer.requestSha256, /^[0-9a-f]{64}$/);
});

test("an envelope without cost or content keeps them unknown; a failed call is a code", async () => {
  assert.deepEqual(perpsCheckAnswer({ usage: {} }, "x"), {
    content: null,
    inputTokens: null,
    outputTokens: null,
    costMicros: null,
    requestSha256: "x",
  });
  const model = createPerpsCheckModel(
    { baseUrl: "https://model.example/v1", model: "m", apiKey: "k" },
    async () => new Response("secret", { status: 500 }),
  );
  await assert.rejects(model.decide({}, AbortSignal.timeout(5000)), { code: "MODEL_HTTP_FAILURE" });
  await assert.rejects(
    createPerpsCheckModel({ baseUrl: "", model: "", apiKey: "" }).decide(
      {},
      AbortSignal.timeout(5000),
    ),
    { code: "MODEL_UNAVAILABLE" },
  );
});

test("admission reads the host flags: off unless exactly true, ceiling 500 by default", () => {
  assert.deepEqual(perpsAdmission({}), { enabled: false, dailyChecks: 500 });
  assert.deepEqual(
    perpsAdmission({ PERPL_RUNTIME_ENABLED: "true", PERPL_RUNTIME_DAILY_CHECKS: "20" }),
    { enabled: true, dailyChecks: 20 },
  );
  assert.deepEqual(
    perpsAdmission({ PERPL_RUNTIME_ENABLED: "TRUE", PERPL_RUNTIME_DAILY_CHECKS: "x" }),
    {
      enabled: false,
      dailyChecks: 500,
    },
  );
});

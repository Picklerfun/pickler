import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { decisionCases } from "../src/evaluation/decision-cases";
import {
  callProvider,
  costUsd,
  EvaluationBudget,
  makePlan,
  grade,
  rulesAssessment,
  needsConsistencyReview,
} from "../src/evaluation/decision-evaluation";

const env = {
  TYPESAFE_API_KEY: "test-secret",
  MODEL_API_KEY: "test-secret",
  MODEL_ID: "configured-test-model",
  MODEL_BASE_URL: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
};
const fixture = decisionCases[0]!;
const rates = { input: 1, output: 2, source: "https://example.com/test-rates" };
function response() {
  return {
    model: "jev-1.13.0",
    usage: { input_tokens: 1000, output_tokens: 100 },
    answers: {
      evidence: {
        type: "choice",
        choice: "SUPPORTED",
        confidence: 0.9,
        probabilities: {
          SUPPORTED: 0.97,
          CONTRADICTED: 0.01,
          CONFLICTING: 0.01,
          INSUFFICIENT: 0.01,
        },
      },
      next: {
        type: "choice",
        choice: "FINALIZE",
        confidence: 0.8,
        probabilities: { FINALIZE: 0.9, RESEARCH: 0.08, ABSTAIN: 0.02 },
      },
    },
  };
}

test("dataset has disjoint development/holdout cases and consistent control labels", () => {
  assert.equal(new Set(decisionCases.map((item) => item.id)).size, 32);
  for (const split of ["dev", "holdout"]) {
    const cases = decisionCases.filter((item) => item.split === split);
    assert.equal(cases.length, 16);
    assert.equal(new Set(cases.map((item) => item.expected.evidence)).size, 4);
    assert.equal(new Set(cases.map((item) => item.expected.next)).size, 3);
  }
  for (const item of decisionCases) {
    if (["SUPPORTED", "CONTRADICTED"].includes(item.expected.evidence)) {
      assert.equal(item.expected.next, "FINALIZE");
    } else {
      assert.equal(item.expected.next, item.state.canResearch ? "RESEARCH" : "ABSTAIN");
    }
  }
});

test("both transports receive the same state without expected answers or case metadata", () => {
  for (const provider of ["jev", "llm"] as const) {
    const plan = makePlan(provider, fixture.state, env, rates);
    const request = JSON.parse(plan.body);
    const state = provider === "jev" ? request.state : JSON.parse(request.messages[1].content);
    assert.deepEqual(state, fixture.state);
    assert.equal("expected" in state, false);
    assert.equal("split" in state, false);
    assert.equal(plan.body.includes("test-secret"), false);
    assert.ok(plan.reservedUsd > 0);
  }
  const plan = makePlan("llm", fixture.state, env, rates);
  assert.equal(JSON.parse(plan.body).enable_thinking, false);
  assert.equal(plan.url, `${env.MODEL_BASE_URL}/chat/completions`);
  assert.throws(() =>
    makePlan("llm", fixture.state, { ...env, MODEL_BASE_URL: "http://example.com" }, rates),
  );
  assert.throws(() => makePlan("jev", fixture.state, {}));
});

test("Jev results preserve distributions and reported usage without provider extras", async () => {
  const plan = makePlan("jev", fixture.state, env);
  let calls = 0;
  const transport: typeof fetch = async (url, init) => {
    calls++;
    assert.equal(url, "https://api.typesafe.ai/v1/systemone");
    assert.equal(init?.redirect, "error");
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer test-secret");
    return Response.json({ ...response(), privateMetadata: "secret" });
  };
  const result = await callProvider("jev", plan, new AbortController().signal, transport);
  assert.equal(calls, 1);
  assert.deepEqual(result.assessment, fixture.expected);
  assert.equal(costUsd(result.usage, plan.rates), 0.000042);
  assert.equal(JSON.stringify(result).includes("secret"), false);
});

test("malformed distributions, wrong choices, missing usage and provider errors fail without retries", async () => {
  const invalid = [
    { ...response(), usage: undefined },
    {
      ...response(),
      answers: {
        ...response().answers,
        evidence: { ...response().answers.evidence, choice: "BUY" },
      },
    },
    {
      ...response(),
      answers: {
        ...response().answers,
        evidence: {
          ...response().answers.evidence,
          probabilities: { SUPPORTED: 0.7, CONTRADICTED: 0.7, CONFLICTING: 0, INSUFFICIENT: 0 },
        },
      },
    },
    {
      ...response(),
      answers: { ...response().answers, next: { ...response().answers.next, confidence: 2 } },
    },
  ];
  for (const body of invalid) {
    let calls = 0;
    await assert.rejects(
      callProvider(
        "jev",
        makePlan("jev", fixture.state, env),
        new AbortController().signal,
        async () => {
          calls++;
          return Response.json(body);
        },
      ),
      { code: "INVALID_RESPONSE_OR_USAGE" },
    );
    assert.equal(calls, 1);
  }
  let calls = 0;
  await assert.rejects(
    callProvider(
      "jev",
      makePlan("jev", fixture.state, env),
      new AbortController().signal,
      async () => {
        calls++;
        return new Response("test-secret", { status: 429 });
      },
    ),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message, "HTTP_429");
      assert.equal(JSON.stringify(error).includes("test-secret"), false);
      return true;
    },
  );
  assert.equal(calls, 1);
});

test("LLM comparison rejects truncated or extra-field answers and strips reasoning", async () => {
  const plan = makePlan("llm", fixture.state, env, rates);
  const body = {
    model: "configured-test-model",
    usage: { prompt_tokens: 500, completion_tokens: 50 },
    choices: [
      {
        finish_reason: "stop",
        message: {
          content: JSON.stringify(fixture.expected),
          reasoning_content: "private reasoning",
        },
      },
    ],
  };
  const result = await callProvider("llm", plan, new AbortController().signal, async () =>
    Response.json(body),
  );
  assert.deepEqual(result.assessment, fixture.expected);
  assert.equal(JSON.stringify(result).includes("private"), false);
  body.choices[0]!.finish_reason = "length";
  await assert.rejects(
    callProvider("llm", plan, new AbortController().signal, async () => Response.json(body)),
    { code: "INVALID_RESPONSE_OR_USAGE" },
  );
  body.choices[0]!.finish_reason = "stop";
  body.choices[0]!.message.content = JSON.stringify({ ...fixture.expected, order: "BUY" });
  await assert.rejects(
    callProvider("llm", plan, new AbortController().signal, async () => Response.json(body)),
    { code: "INVALID_ASSESSMENT" },
  );
});

test("budget reserves before a call, retains ambiguous spend, and refuses further overspend", () => {
  const budget = new EvaluationBudget(0.1, 2);
  budget.reserve(0.06);
  assert.throws(() => budget.reserve(0.06), { code: "BUDGET_OR_CALL_LIMIT" });
  budget.settle(0.06, 0.02);
  budget.reserve(0.06);
  assert.equal(budget.calls, 2);
  assert.throws(() => budget.reserve(0.001));
  assert.throws(() => budget.settle(0.06, 0.2), { code: "COST_EXCEEDED_RESERVATION" });
  assert.throws(() => new EvaluationBudget(Number.NaN, 2));
});

test("unsafe finalization is counted separately from ordinary label disagreement", () => {
  const expected = { evidence: "CONFLICTING", next: "RESEARCH" } as const;
  assert.equal(grade({ evidence: "SUPPORTED", next: "FINALIZE" }, expected).unsafeFinalize, true);
  assert.equal(
    grade({ evidence: "INSUFFICIENT", next: "RESEARCH" }, expected).unsafeFinalize,
    false,
  );
  assert.deepEqual(rulesAssessment(fixture.state), { evidence: "INSUFFICIENT", next: "RESEARCH" });
});

test("independent answers that disagree with the routing rubric are flagged without repair", () => {
  const assessment = { evidence: "CONTRADICTED", next: "RESEARCH" } as const;
  const original = structuredClone(assessment);
  assert.equal(needsConsistencyReview(assessment, fixture.state), true);
  assert.deepEqual(assessment, original);
  assert.equal(
    needsConsistencyReview({ evidence: "INSUFFICIENT", next: "RESEARCH" }, fixture.state),
    false,
  );
});

test("CLI refuses implicit paid runs and preserves exclusive offline attempt records", async () => {
  const script = fileURLToPath(new URL("../src/evaluate-decisions.ts", import.meta.url));
  const denied = spawnSync(process.execPath, ["--import", "tsx", script, "--provider", "jev"], {
    encoding: "utf8",
  });
  assert.equal(denied.status, 1);
  assert.match(denied.stderr, /PAID_RUN_REQUIRES/);

  const attempt = `test-${randomUUID()}`;
  const directory = new URL(`../.data/decision-evaluation-v1/${attempt}/`, import.meta.url);
  const args = [
    "--import",
    "tsx",
    script,
    "--provider",
    "rules",
    "--limit",
    "4",
    "--offset",
    "4",
    "--attempt",
    attempt,
  ];
  try {
    const first = spawnSync(process.execPath, args, { encoding: "utf8" });
    assert.equal(first.status, 0, first.stderr);
    const before = await readFile(new URL("manifest.json", directory), "utf8");
    assert.equal(JSON.parse(before).cases[0].id, decisionCases[4]!.id);
    const summary = JSON.parse(await readFile(new URL("summary.json", directory), "utf8"));
    assert.equal(summary.summary[0].completed, 4);
    assert.equal(summary.summary[0].estimatedKnownCostUsd, 0);

    const repeated = spawnSync(process.execPath, args, { encoding: "utf8" });
    assert.equal(repeated.status, 1);
    assert.equal(await readFile(new URL("manifest.json", directory), "utf8"), before);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

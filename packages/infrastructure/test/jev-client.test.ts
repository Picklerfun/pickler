import test from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import {
  evaluateJev,
  jevChoiceSchema,
  JevClientError,
  type JevRequest,
} from "../src/model-providers/jev/client.js";
const labels = { verdict: ["YES", "NO", "UNKNOWN"] as const };
function response() {
  return {
    model: "jev-1.13.0",
    usage: { input_tokens: 42, output_tokens: 7 },
    answers: {
      verdict: {
        type: "choice",
        choice: "YES",
        confidence: 0.98,
        probabilities: { YES: 0.98, NO: 0.01, UNKNOWN: 0.01 },
      },
    },
  };
}
function options(overrides: Partial<JevRequest<unknown>> = {}): JevRequest<unknown> {
  return {
    apiKey: "secret-not-logged",
    payload: { model: "jev-1.13.0", state: { text: "fixture" }, questions: {} },
    labels,
    answersSchema: z.object({ verdict: jevChoiceSchema(labels.verdict) }).strict(),
    signal: new AbortController().signal,
    timeoutMs: 1000,
    maxRequestBytes: 30000,
    maxResponseBytes: 1024 * 1024,
    maxInputTokens: 65536,
    usage: async () => {},
    transport: async () => Response.json(response()),
    ...overrides,
  };
}
test("one request preserves payload, pinned model, callbacks, usage and validated answers", async () => {
  const events: string[] = [],
    opts = options();
  let calls = 0;
  opts.before = async ({ body, bytes }) => {
    events.push("before");
    assert.equal(body, JSON.stringify(opts.payload));
    assert.equal(bytes, new TextEncoder().encode(body).length);
  };
  opts.transport = async (url, init) => {
    calls++;
    events.push("transport");
    assert.equal(url, "https://api.typesafe.ai/v1/systemone");
    assert.equal(init?.redirect, "manual");
    assert.equal(init?.body, JSON.stringify(opts.payload));
    return Response.json(response());
  };
  opts.usage = async (usage) => {
    events.push("usage");
    assert.deepEqual(usage, response().usage);
  };
  opts.stage = (stage) => {
    events.push(stage);
  };
  assert.deepEqual(await evaluateJev(opts), response());
  assert.equal(calls, 1);
  assert.ok(events.indexOf("before") < events.indexOf("transport"));
  assert.ok(events.lastIndexOf("usage") < events.indexOf("answers"));
});
test("malformed answers preserve usage and safe distinct diagnostics with no retry", async () => {
  for (const defect of ["sum", "maximum", "extra"]) {
    const raw = response();
    if (defect === "sum") {
      raw.answers.verdict.probabilities.YES = 0.5;
    }
    if (defect === "maximum") {
      raw.answers.verdict.choice = "NO";
    }
    if (defect === "extra") {
      Object.assign(raw.answers, { "sensitive-external-key": { secret: "sensitive-value" } });
    }
    let calls = 0,
      usage = false;
    await assert.rejects(
      evaluateJev(
        options({
          usage: async () => {
            usage = true;
          },
          transport: async () => {
            calls++;
            return Response.json(raw);
          },
        }),
      ),
      (error: unknown) => {
        assert.ok(error instanceof JevClientError);
        assert.equal(error.code, "INVALID_ANSWERS");
        const text = JSON.stringify(error.diagnostics);
        assert.equal(text.includes("sensitive"), false);
        assert.equal(text.includes("secret-not-logged"), false);
        if (defect !== "extra") {
          assert.ok(
            text.includes(defect === "sum" ? "PROBABILITY_SUM_INVALID" : "CHOICE_NOT_MAXIMUM"),
          );
        }
        return true;
      },
    );
    assert.equal(usage, true);
    assert.equal(calls, 1);
  }
});
test("invalid usage never invokes usage hook; over-budget usage is persisted before refusal", async () => {
  for (const defect of ["model", "negative", "budget"]) {
    const raw = response();
    let called = false;
    if (defect === "model") {
      raw.model = "wrong-model";
    }
    if (defect === "negative") {
      raw.usage.output_tokens = -1;
    }
    if (defect === "budget") {
      raw.usage.input_tokens = 65537;
    }
    await assert.rejects(
      evaluateJev(
        options({
          usage: async () => {
            called = true;
          },
          transport: async () => Response.json(raw),
        }),
      ),
      (error: unknown) =>
        error instanceof JevClientError &&
        error.code === (defect === "budget" ? "RESERVATION_EXCEEDED" : "INVALID_USAGE"),
    );
    assert.equal(called, defect === "budget");
  }
});
test("request/response limits, HTTP and JSON failures are explicit and never leak response bodies", async () => {
  for (const [code, override] of [
    ["INPUT_TOO_LARGE", { maxRequestBytes: 1 }],
    ["RESPONSE_LIMIT", { maxResponseBytes: 1 }],
    ["HTTP_FAILURE", { transport: async () => new Response("private-error", { status: 429 }) }],
    ["INVALID_RESPONSE", { transport: async () => new Response("private-invalid-json") }],
  ] as const) {
    await assert.rejects(evaluateJev(options(override)), (error: unknown) => {
      assert.ok(error instanceof JevClientError);
      assert.equal(error.code, code);
      assert.equal(JSON.stringify(error).includes("private-"), false);
      return true;
    });
  }
});
test("aborted permission hooks block transport and non-cooperative transports still time out", async () => {
  const controller = new AbortController();
  let calls = 0;
  await assert.rejects(
    evaluateJev(
      options({
        signal: controller.signal,
        before: async () => {
          controller.abort(new Error("operator-stop"));
        },
        transport: async () => {
          calls++;
          return Response.json(response());
        },
      }),
    ),
    /operator-stop/,
  );
  assert.equal(calls, 0);
  const keeper = setTimeout(() => {}, 200);
  try {
    await assert.rejects(
      evaluateJev(options({ timeoutMs: 5, transport: async () => new Promise(() => {}) })),
      (error: unknown) => error instanceof DOMException && error.name === "TimeoutError",
    );
  } finally {
    clearTimeout(keeper);
  }
});
test("choice schema rejects missing options, bad types and invalid arithmetic without repairing values", () => {
  const schema = jevChoiceSchema(labels.verdict);
  const valid = response().answers.verdict;
  assert.deepEqual(schema.parse(valid), valid);
  for (const answer of [
    { ...valid, confidence: 1.1 },
    { ...valid, probabilities: { YES: 1, NO: 0 } },
    { ...valid, probabilities: { YES: 0.7, NO: 0.2, UNKNOWN: 0.2 } },
    { ...valid, choice: "NO" },
  ]) {
    assert.equal(schema.safeParse(answer).success, false);
  }
});

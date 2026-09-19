import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { ModelFailure, PilotError } from "@pickler/core";
import { validatedModelOutput, classifyModelFailure } from "../src/composition/model-output";

const schema = z.object({ marketId: z.string() }).strict();

test("structured model failures are classified without storing sensitive error fields", async () => {
  const cases = [
    {
      error: {
        name: "Error",
        cause: { statusCode: 429, message: "secret", responseBody: "secret" },
      },
      code: "MODEL_HTTP_429",
    },
    { error: { name: "Error", cause: { name: "TimeoutError" } }, code: "MODEL_TIMEOUT" },
    {
      error: { name: "AI_NoObjectGeneratedError", cause: { name: "AI_JSONParseError" } },
      code: "MODEL_INVALID_JSON",
    },
    { error: { name: "AI_TypeValidationError" }, code: "MODEL_INVALID_SCHEMA" },
    { error: { name: "AI_NoObjectGeneratedError" }, code: "MODEL_NO_STRUCTURED_OUTPUT" },
    { error: { name: "secret", message: "secret" }, code: "MODEL_FAILURE" },
  ];
  for (const { error, code } of cases) {
    await assert.rejects(
      validatedModelOutput(
        async () => {
          throw error;
        },
        schema,
        "selection",
        new AbortController().signal,
      ),
      (failure: unknown) => {
        assert.ok(failure instanceof ModelFailure);
        assert.equal(failure.code, code);
        assert.equal(failure.details.stage, "selection");
        assert.equal(JSON.stringify(failure).includes("secret"), false);
        return true;
      },
    );
  }
});

test("truncation wins over parse failure and retains only numeric usage counters", async () => {
  await assert.rejects(
    validatedModelOutput(
      async () => ({
        object: undefined,
        finishReason: "length",
        totalUsage: { inputTokens: 100, outputTokens: 2000, reasoningTokens: 1900, raw: "secret" },
        error: { name: "AI_JSONParseError", message: "secret" },
      }),
      schema,
      "research",
      new AbortController().signal,
    ),
    (error: unknown) => {
      assert.ok(error instanceof ModelFailure);
      assert.equal(error.code, "MODEL_OUTPUT_TRUNCATED");
      assert.deepEqual(error.details, {
        stage: "research",
        finishReason: "length",
        inputTokens: 100,
        outputTokens: 2000,
        reasoningTokens: 1900,
      });
      return true;
    },
  );
});

test("valid and invalid structured outputs, cancellation, and business errors remain distinct", async () => {
  const signal = new AbortController().signal;
  assert.deepEqual(
    await validatedModelOutput(
      async () => ({ object: { marketId: "1" }, totalUsage: {} }),
      schema,
      "selection",
      signal,
    ),
    { object: { marketId: "1" }, usage: {} },
  );
  await assert.rejects(
    validatedModelOutput(async () => ({ object: { marketId: 1 } }), schema, "selection", signal),
    { code: "MODEL_INVALID_SCHEMA" },
  );
  await assert.rejects(
    validatedModelOutput(
      async () => ({ finishReason: "content-filter" }),
      schema,
      "selection",
      signal,
    ),
    { code: "MODEL_CONTENT_FILTERED" },
  );
  for (const [reason, code] of [
    [new Error("operator cancellation"), "MODEL_CANCELLED"],
    [new DOMException("deadline", "TimeoutError"), "MODEL_TIMEOUT"],
  ] as const) {
    await assert.rejects(
      validatedModelOutput(
        async () => {
          throw reason;
        },
        schema,
        "selection",
        AbortSignal.abort(reason),
      ),
      { code },
    );
  }
  const businessError = new PilotError("TOOL_DISABLED", "Disabled");
  await assert.rejects(
    validatedModelOutput(
      async () => {
        throw businessError;
      },
      schema,
      "research",
      signal,
    ),
    (error) => error === businessError,
  );
});

test("NFL diagnostic paths expose known schema names but redact unknown keys and values", () => {
  const failure = classifyModelFailure(
    {
      name: "ZodError",
      issues: [
        { code: "invalid_type", path: ["report", "sections", 0, "sourceIds"], message: "private" },
        { code: "invalid_type", path: ["secret-key"], input: "secret-value" },
      ],
    },
    "decision",
    new AbortController().signal,
  );
  assert.ok(failure instanceof ModelFailure);
  assert.deepEqual(failure.details.validation, [
    { code: "invalid_type", path: "report.sections.[].sourceIds" },
    { code: "invalid_type", path: "[unknown]" },
  ]);
  assert.equal(JSON.stringify(failure).includes("secret"), false);
});

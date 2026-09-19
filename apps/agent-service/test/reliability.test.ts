import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CONFIG, GENERAL_SECTIONS, PilotError } from "@pickler/core";
import { createModel } from "../src/composition/model";
import { modelDiagnostic } from "../src/composition/model-diagnostics";
import { validatedModelOutput } from "../src/composition/model-output";
import { z } from "zod";

const env = {
  DATABASE_URL: "postgresql://test:test@localhost:54522/test",
  MODEL_BASE_URL: "https://model.example/v1",
  MODEL_ID: "fixture",
  MODEL_API_KEY: "secret-credential",
  EXA_API_KEY: "secret-exa",
  TENANT_ALPHA_TOKEN: "a".repeat(32),
  TENANT_BETA_TOKEN: "b".repeat(32),
};
const market = {
  id: "1",
  question: "Fixture",
  rules: "Fixture rules",
  active: true,
  categoryIds: ["1"],
  closesAt: null,
  liquidity: 1,
  outcomes: [
    { id: "1", label: "Yes" },
    { id: "2", label: "No" },
  ],
};
const assessment = {
  action: "ABSTAIN",
  marketId: "1",
  outcomeId: null,
  thesis: "Fixture",
  counterEvidence: "Fixture",
  uncertainty: "Fixture",
  sourceIds: ["source"],
  probability: null,
  uncertaintyLevel: "HIGH",
  missingInformation: [],
  observedPrice: null,
  limitPrice: null,
  expiresAt: null,
  abstentionReason: "Fixture",
};
function completion(
  request: Record<string, unknown>,
  content: string | null,
  tool: boolean,
  finish = "stop",
) {
  const message = tool
    ? {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            index: 0,
            id: "call-1",
            type: "function",
            function: { name: "getMarketRules", arguments: "{}" },
          },
        ],
      }
    : { role: "assistant", content };
  const usage = { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 };
  if (!request.stream) {
    return Response.json({
      id: "fixture",
      object: "chat.completion",
      created: 1,
      model: "fixture",
      choices: [{ index: 0, message, finish_reason: tool ? "tool_calls" : finish }],
      usage,
    });
  }
  const base = { id: "fixture", object: "chat.completion.chunk", created: 1, model: "fixture" };
  return new Response(
    `data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: message, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: {}, finish_reason: tool ? "tool_calls" : finish }], usage })}\n\ndata: [DONE]\n\n`,
    { headers: { "Content-Type": "text/event-stream" } },
  );
}

test("two phases persist safe step diagnostics before malformed final outputs and never retry", async (t) => {
  for (const scenario of [
    "valid",
    "general",
    "empty",
    "json",
    "schema",
    "truncated",
    "lease",
    "tool",
    "deadline",
    "http",
    "http-research",
  ] as const) {
    await t.test(scenario, async (t) => {
      const controller = new AbortController();
      let calls = 0;
      const diagnostics: unknown[] = [];
      const usages: unknown[] = [];
      t.mock.method(globalThis, "fetch", async (_url: unknown, init: RequestInit) => {
        const request = JSON.parse(String(init.body));
        calls++;
        if (calls <= 2) {
          assert.equal(request.response_format, undefined);
        }
        if (calls === 3) {
          assert.equal(request.tools, undefined);
          assert.ok(request.response_format);
        }
        if ((scenario === "http" && calls === 3) || scenario === "http-research") {
          return Response.json(
            { error: { message: "secret", type: "rate_limit_error" } },
            { status: 429 },
          );
        }
        let content: string | null =
          calls === 2
            ? "Untrusted summary source"
            : JSON.stringify(
                scenario === "general"
                  ? {
                      ...assessment,
                      report: {
                        protocol: "general-market-v1",
                        forecast: {
                          outcomeId: "1",
                          probability: null,
                          inabilityReason: "Fixture has insufficient evidence",
                        },
                        sections: GENERAL_SECTIONS.map((section) => ({
                          section,
                          status: "missing",
                          explanation: "Fixture",
                          sourceIds: [],
                        })),
                      },
                    }
                  : assessment,
              );
        if (calls === 3 && scenario === "empty") {
          content = null;
        }
        if (calls === 3 && scenario === "json") {
          content = "this is not JSON";
        }
        if (calls === 3 && scenario === "schema") {
          content = JSON.stringify({ marketId: 5, secret: "secret-value" });
        }
        return completion(
          request,
          content,
          calls === 1,
          scenario === "truncated" && calls === 3 ? "length" : "stop",
        );
      });
      const invoke = () =>
        createModel(env).research({
          market,
          ...(scenario === "general" ? { protocol: "general-market-v1" as const } : {}),
          profile: "Fixture",
          limits: { ...DEFAULT_CONFIG.limits, steps: 4 },
          selectionSteps: 1,
          signal: controller.signal,
          evidence: () => ({ sources: [], quotes: [] }),
          beforeStep: async () => {
            if (scenario === "deadline" && calls === 2) {
              controller.abort(new DOMException("Deadline", "TimeoutError"));
            }
            if (scenario === "lease" && calls === 2) {
              throw new PilotError("LEASE_LOST", "Lost");
            }
          },
          onDiagnostic: async (data) => {
            diagnostics.push(data);
          },
          onUsage: async (data) => {
            usages.push(data);
          },
          tools: {
            getMarketRules: async () => {
              if (scenario === "tool") {
                throw new PilotError("TOOL_DISABLED", "Disabled");
              }
              return market;
            },
          },
        });
      if (scenario === "valid" || scenario === "general") {
        const result = await invoke();
        assert.equal(result.decision.action, "ABSTAIN");
        assert.deepEqual(result.usage, {
          inputTokens: 30,
          outputTokens: 15,
          totalTokens: 45,
          reasoningTokens: 0,
        });
        assert.equal(usages.length, 3);
      } else {
        await assert.rejects(invoke(), (error: unknown) => {
          assert.ok(error instanceof PilotError);
          const expected = {
            empty: ["MODEL_NO_STRUCTURED_OUTPUT"],
            json: ["MODEL_INVALID_JSON"],
            schema: ["MODEL_INVALID_SCHEMA"],
            truncated: ["MODEL_OUTPUT_TRUNCATED"],
            lease: ["LEASE_LOST"],
            tool: ["MODEL_INVALID_TOOL"],
            deadline: ["MODEL_TIMEOUT"],
            http: ["MODEL_HTTP_429"],
            "http-research": ["MODEL_HTTP_429"],
          }[scenario];
          assert.ok(expected.includes(error.code), `${scenario}: ${error.code}`);
          return true;
        });
      }
      assert.ok(calls <= 3);
      if (scenario === "lease") {
        assert.equal(calls, 2);
      }
      if (scenario === "tool") {
        assert.equal(calls, 1);
      }
      assert.ok(diagnostics.length > 0);
      assert.equal(JSON.stringify(diagnostics).includes("secret"), false);
    });
  }
});

test("diagnostics omit raw content, reasoning, tool arguments and unknown schema paths", async () => {
  const diagnostic = modelDiagnostic("research", 15, {
    text: "secret",
    reasoning: "secret",
    object: { secret: true },
    usage: { inputTokens: 10, raw: "secret" },
    toolCalls: [{ payload: { toolName: "secret", toolCallId: "id", args: "secret" } }],
  });
  assert.equal(JSON.stringify(diagnostic).includes("secret"), false);
  await assert.rejects(
    validatedModelOutput(
      async () => ({ object: { marketId: 1 } }),
      z.object({ marketId: z.string() }),
      "decision",
      new AbortController().signal,
    ),
    (error: unknown) => {
      assert.equal(JSON.stringify(error).includes('"path":"marketId"'), true);
      assert.equal(JSON.stringify(error).includes('"code":"invalid_type"'), true);
      return true;
    },
  );
});

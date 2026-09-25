import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CONFIG, type AgentRecord, type Market, type RunRecord } from "@pickler/core";
import { createRuntime } from "../src/composition/runtime.js";

const market: Market = {
  id: "1",
  question: "Test?",
  rules: "Resolve according to the official test source.",
  categoryIds: ["7"],
  active: true,
  closesAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
  liquidity: 10,
  outcomes: [
    { id: "99", label: "Yes" },
    { id: "100", label: "No" },
  ],
};

/** An OpenAI-compatible reply that calls searchWeb once, streamed or not, as the client asks. */
function searchCall(stream: boolean): Response {
  const call = {
    id: "call-1",
    type: "function",
    function: {
      name: "searchWeb",
      arguments: JSON.stringify({ query: "q", intent: "supporting" }),
    },
  };
  const usage = { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 };
  if (!stream) {
    return Response.json({
      id: "r1",
      object: "chat.completion",
      created: 0,
      model: "fake",
      choices: [
        {
          index: 0,
          finish_reason: "tool_calls",
          message: { role: "assistant", content: null, tool_calls: [call] },
        },
      ],
      usage,
    });
  }
  const chunks = [
    { choices: [{ index: 0, delta: { role: "assistant", tool_calls: [{ index: 0, ...call }] } }] },
    { choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }], usage },
  ];
  const text = chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") + "data: [DONE]\n\n";
  return new Response(text, { headers: { "content-type": "text/event-stream" } });
}

test("the runtime's execute runs through the per-run scope, so an only list reaches Exa", async (t) => {
  const exaBodies: Record<string, unknown>[] = [];
  const modelBodies: string[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    const body = String(init?.body ?? "");
    if (url.startsWith("https://api.exa.ai/")) {
      exaBodies.push(JSON.parse(body));
      return Response.json({ results: [] });
    }
    if (url.startsWith("http://model.test/")) {
      modelBodies.push(body);
      if (modelBodies.length === 1) {
        return searchCall(JSON.parse(body).stream === true);
      }
      return new Response("stop", { status: 500 });
    }
    throw new Error(`Unexpected network call to ${url}`);
  };
  t.after(() => {
    globalThis.fetch = realFetch;
  });

  const runtime = createRuntime({
    DATABASE_URL: "postgresql://nobody@127.0.0.1:1/none",
    MODEL_BASE_URL: "http://model.test/v1",
    MODEL_ID: "fake",
    MODEL_API_KEY: "test-only",
    EXA_API_KEY: "test-only",
  });
  t.after(() => runtime.repository.pool.end());

  const config = {
    ...structuredClone(DEFAULT_CONFIG),
    categoryIds: ["7"],
    sources: { web: { mode: "only" as const, sites: ["espn.com"] }, books: [] },
    skills: [{ name: "Fade the public", prompt: "Lean against lopsided public money." }],
  };
  const agent: AgentRecord = {
    id: "agent",
    tenantId: "tenant",
    version: 1,
    config,
    paused: false,
    scheduleEnabled: false,
    nextDueAt: null,
  };
  const run: RunRecord = {
    id: "run-1",
    tenantId: "tenant",
    agentId: "agent",
    trigger: "manual",
    marketId: "1",
    status: "running",
    createdAt: Date.now(),
    startedAt: Date.now(),
    finishedAt: null,
    configVersion: 1,
    config,
    decision: null,
    error: null,
  };
  const repository = runtime.repository as unknown as Record<string, unknown>;
  repository.agent = async () => agent;
  repository.assertOwnership = async () => {};
  repository.event = async () => {};
  repository.finish = async () => {};
  const markets = runtime.markets as unknown as Record<string, unknown>;
  markets.get = async () => market;
  markets.book = async (outcomeId: string) => ({
    outcomeId,
    observedAt: new Date().toISOString(),
    bids: [{ price: "0.4", size: "10" }],
    asks: [{ price: "0.6", size: "10" }],
  });

  await runtime.execute(run, AbortSignal.timeout(10_000)).catch(() => {});

  assert.match(modelBodies[0] ?? "", /Rules it follows:/, "the model read the composed brief");
  assert.equal(exaBodies.length, 1, "the model's search reached Exa once");
  assert.deepEqual(exaBodies[0]?.includeDomains, ["espn.com"]);
});

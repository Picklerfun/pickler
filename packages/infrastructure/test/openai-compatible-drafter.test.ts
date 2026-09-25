import { test } from "node:test";
import assert from "node:assert/strict";
import type { AgentDraft } from "@pickler/core";
import {
  createOpenAiCompatibleDrafter,
  DraftUnavailableError,
} from "../src/model/openai-compatible-drafter.js";

const answer = {
  name: "Halftime",
  handle: "halftime",
  venues: ["polymarket"],
  beat: "Sports",
  subcategories: ["NFL"],
  sites: ["espn.com"],
  skills: ["Injury double-check"],
  edge: "Reads injury reports first.",
  style: "balanced",
  accent: "lime",
};
const passThrough = (raw: unknown) => raw as AgentDraft;
const reply = (content: string) =>
  new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });

test("asks the model in JSON mode and returns the validated draft", async () => {
  let seen: { url: string; body: Record<string, unknown>; auth: string | null } | null = null;
  const drafter = createOpenAiCompatibleDrafter({
    baseUrl: "https://model.example/v1/",
    apiKey: "k",
    modelId: "m",
    fetch: async (url, init) => {
      seen = {
        url: String(url),
        body: JSON.parse(String(init?.body)) as Record<string, unknown>,
        auth: new Headers(init?.headers).get("authorization"),
      };
      return reply(JSON.stringify(answer));
    },
    validate: passThrough,
  });

  const draft = await drafter.draft("Calls NFL games off injury news.");

  assert.equal(draft.handle, "halftime");
  assert.ok(seen);
  const request = seen as { url: string; body: Record<string, unknown>; auth: string | null };
  assert.equal(request.url, "https://model.example/v1/chat/completions");
  assert.deepEqual(request.body.response_format, { type: "json_object" });
  assert.equal(request.body.model, "m");
  assert.equal(request.body.temperature, 0.2);
  assert.equal(request.auth, "Bearer k");
  assert.equal(request.body.enable_thinking, undefined);
  const messages = request.body.messages as { role: string; content: string }[];
  assert.equal(messages[1]?.content, "Calls NFL games off injury news.");
});

test("DashScope gets thinking turned off, as the research runtime does", async () => {
  let body: Record<string, unknown> = {};
  const drafter = createOpenAiCompatibleDrafter({
    baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    apiKey: "k",
    modelId: "m",
    fetch: async (_url, init) => {
      body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return reply(JSON.stringify(answer));
    },
    validate: passThrough,
  });

  await drafter.draft("x y z");

  assert.equal(body.enable_thinking, false);
});

test("a model failure is DraftUnavailableError, never a guess", async () => {
  const drafter = createOpenAiCompatibleDrafter({
    baseUrl: "https://model.example/v1",
    apiKey: "k",
    modelId: "m",
    fetch: async () => new Response("nope", { status: 500 }),
    validate: passThrough,
  });

  await assert.rejects(() => drafter.draft("x"), DraftUnavailableError);
});

test("a network error, empty content or non-JSON content is also unavailable", async () => {
  const cases: (() => Promise<Response>)[] = [
    async () => {
      throw new TypeError("fetch failed");
    },
    async () => reply(""),
    async () => reply("not json"),
    async () => new Response("{}", { status: 200 }),
  ];
  for (const fetch of cases) {
    const drafter = createOpenAiCompatibleDrafter({
      baseUrl: "https://model.example/v1",
      apiKey: "k",
      modelId: "m",
      fetch,
      validate: passThrough,
    });

    await assert.rejects(() => drafter.draft("x"), DraftUnavailableError);
  }
});

test("an answer the validator refuses is also unavailable", async () => {
  const drafter = createOpenAiCompatibleDrafter({
    baseUrl: "https://model.example/v1",
    apiKey: "k",
    modelId: "m",
    fetch: async () => reply("{}"),
    validate: () => {
      throw new Error("bad");
    },
  });

  await assert.rejects(() => drafter.draft("x"), DraftUnavailableError);
});

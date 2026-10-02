import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import { buildMessages, MODEL, type ReadInput, readWithAgent, RULES } from "./claude.ts";

const input: ReadInput = {
  symbol: "BTC", name: "Bitcoin", mark: "76255.5", prev: "75100.0", change24hPct: 1.54, target: "77018.1",
  levelBps: 100, horizonMin: 240, expiresAtUtc: "2026-09-20 14:00 UTC", nowUtc: "2026-09-20 10:00 UTC",
};

Deno.test("buildMessages: un turno de usuario con el JSON de la celda", () => {
  const msgs = buildMessages(input);
  assertEquals(msgs.length, 1);
  assertEquals(msgs[0].role, "user");
  assertEquals(typeof msgs[0].content, "string");
  assertEquals((msgs[0].content as string).includes('"target": "77018.1"'), true);
});

Deno.test("readWithAgent: manda persona + reglas con cache_control, modelo sonnet 5, y devuelve parsed_output", async () => {
  let captured: Record<string, unknown> = {};
  const fake = { messages: { parse: async (params: Record<string, unknown>) => { captured = params; return { parsed_output: { probability: 0.62, reasons: ["a", "b", "c"], limits: "x" }, usage: { input_tokens: 700, output_tokens: 120 } }; } } };
  // deno-lint-ignore no-explicit-any
  const r = await readWithAgent(fake as any, "You are Drift.", input, () => 1000);
  assertEquals(r.output, { probability: 0.62, reasons: ["a", "b", "c"], limits: "x" });
  assertEquals(r.usage, { input_tokens: 700, output_tokens: 120 });
  assertEquals(captured.model, MODEL);
  assertEquals(captured.max_tokens, 1024);
  const system = captured.system as { type: string; text: string; cache_control: { type: string } }[];
  assertEquals(system[0].text.startsWith(RULES), true);
  assertEquals(system[0].text.endsWith("You are Drift."), true);
  assertEquals(system[0].cache_control, { type: "ephemeral" });
  assertEquals((captured.output_config as { effort: string }).effort, "medium");
});

Deno.test("readWithAgent: parsed_output null → error", async () => {
  const fake = { messages: { parse: async () => ({ parsed_output: null, usage: { input_tokens: 1, output_tokens: 1 } }) } };
  // deno-lint-ignore no-explicit-any
  await assertRejects(() => readWithAgent(fake as any, "p", input), Error, "unparsed");
});

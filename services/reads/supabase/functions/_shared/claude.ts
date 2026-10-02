// Lectura del agente (D8): claude-sonnet-5, salida estructurada, persona cacheada.
import Anthropic from "npm:@anthropic-ai/sdk@0.127.0";
import { zodOutputFormat } from "npm:@anthropic-ai/sdk@0.127.0/helpers/zod";
import { z } from "npm:zod@4.6.5";

export const MODEL = "claude-sonnet-5";

export const ReadSchema = z.object({
  probability: z.number().min(0.01).max(0.99).describe("Probability that the statement in `question` is true"),
  reasons: z.array(z.string().max(140)).length(3).describe("Exactly three short reasons, most important first"),
  limits: z.string().max(240).describe("What would make this read wrong"),
});
export type ReadOutput = z.infer<typeof ReadSchema>;

export type ReadInput = {
  symbol: string; name: string; mark: string; prev: string; change24hPct: number; target: string;
  levelBps: number; horizonMin: number; expiresAtUtc: string; nowUtc: string;
};

export const RULES = `You are a trading agent on Pickler, a mobile app where users pay a simulated credit for your read on a perpetual futures market on Perpl (Monad testnet).
You receive one binary question about where the mark price will be at a given time, plus the only market data you have: the current mark, the mark 24 hours ago, and the implied 24h change.
Rules:
- Answer with a calibrated probability that the statement is TRUE (0.01–0.99). Do not hedge at 0.5 unless you truly have no view.
- Give exactly three reasons, each under 140 characters, most important first. Reasons must follow from the data you were given or from general market structure; never invent news or prices.
- In "limits", say in under 240 characters what would make this read wrong.
- Your read will be scored against the real mark at expiry. Be honest about uncertainty over short horizons.
Persona:`;

export function buildMessages(input: ReadInput): Anthropic.MessageParam[] {
  const body = {
    question: `Will the ${input.symbol} mark be ${input.levelBps > 0 ? "at or above" : "at or below"} ${input.target} at ${input.expiresAtUtc}?`,
    market: { symbol: input.symbol, name: input.name },
    mark: input.mark,
    mark_24h_ago: input.prev,
    change_24h_pct: input.change24hPct,
    target: input.target,
    level_bps: input.levelBps,
    horizon_minutes: input.horizonMin,
    now: input.nowUtc,
    expires_at: input.expiresAtUtc,
  };
  return [{ role: "user", content: JSON.stringify(body, null, 2) }];
}

export type ReadResult = { output: ReadOutput; latencyMs: number; usage: { input_tokens: number; output_tokens: number } };

export async function readWithAgent(client: Anthropic, persona: string, input: ReadInput, now: () => number = Date.now): Promise<ReadResult> {
  const t0 = now();
  const res = await client.messages.parse(
    {
      model: MODEL,
      max_tokens: 1024,
      system: [{ type: "text", text: `${RULES}\n${persona}`, cache_control: { type: "ephemeral" } }],
      output_config: { format: zodOutputFormat(ReadSchema), effort: "medium" },
      messages: buildMessages(input),
    },
    { timeout: 50_000, maxRetries: 1 },
  );
  if (!res.parsed_output) throw new Error("claude: unparsed output");
  return { output: res.parsed_output, latencyMs: now() - t0, usage: { input_tokens: res.usage.input_tokens, output_tokens: res.usage.output_tokens } };
}

export function newClient(): Anthropic {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY missing");
  return new Anthropic({ apiKey });
}

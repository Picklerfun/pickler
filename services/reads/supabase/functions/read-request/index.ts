// POST { marketId, levelBps, horizonMin, agentId, pushToken?, pushEnv? } → { read, credits } (spec §2.2, D7, D8, D20, P9).
import { z } from "npm:zod@4.6.5";
import { authenticate } from "../_shared/auth.ts";
import { MODEL, newClient, readWithAgent } from "../_shared/claude.ts";
import { sql } from "../_shared/db.ts";
import { type ReadRow, toReadDto } from "../_shared/dto.ts";
import { fail, json, methodIs, shortAddress } from "../_shared/http.ts";
import { expiresAtFor, formatScaled, questionFor, targetFor } from "../_shared/matrix.ts";
import { fetchMarkets, PerplUnavailable } from "../_shared/perpl.ts";

const Body = z.object({
  marketId: z.number().int().positive(),
  levelBps: z.union([z.literal(250), z.literal(100), z.literal(50), z.literal(-50), z.literal(-100)]),
  horizonMin: z.union([z.literal(60), z.literal(240), z.literal(720), z.literal(1440)]),
  agentId: z.string().min(1).max(32),
  pushToken: z.string().min(16).max(512).optional(),
  pushEnv: z.enum(["sandbox", "production"]).optional(),
});

const RATE_LIMIT = 10; // por dirección cada 10 min (D20)
const utc = (d: Date) => `${d.toISOString().slice(0, 16).replace("T", " ")} UTC`;

Deno.serve(async (req) => {
  if (!methodIs(req, "POST")) return fail(405, "method_not_allowed");
  const auth = await authenticate(req.headers);
  if (!auth.ok) return fail(auth.status, auth.error);
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail(422, "bad_body");
  const b = parsed.data;

  const [{ count }] = await sql<{ count: number }[]>`
    select count(*)::int as count from mobile.reads where address = ${auth.address} and created_at > now() - interval '10 minutes'`;
  if (count >= RATE_LIMIT) return fail(429, "rate_limited");

  let markets;
  try {
    markets = await fetchMarkets();
  } catch (e) {
    if (e instanceof PerplUnavailable) return fail(503, "perpl_unavailable");
    throw e;
  }
  const market = markets.get(b.marketId);
  if (!market) return fail(409, "market_closed");

  const now = new Date();
  const expiresAt = expiresAtFor(now, b.horizonMin);
  const target = targetFor(market.mark, b.levelBps);
  const question = questionFor(market.symbol, b.levelBps, target, market.priceDecimals, expiresAt);

  let row: ReadRow | undefined;
  try {
    [row] = await sql<ReadRow[]>`
      select * from mobile.request_read(${auth.address}, ${b.agentId}, ${market.id}, ${market.symbol}, ${b.levelBps}, ${b.horizonMin},
        ${market.priceDecimals}, ${market.mark}, ${target}, ${question}, ${expiresAt})`;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("no_credits")) return fail(402, "no_credits");
    if (msg.includes("unknown_agent")) return fail(422, "unknown_agent");
    throw e;
  }
  if (!row) return fail(500, "request_failed");

  if (b.pushToken && b.pushEnv) {
    await sql`insert into mobile.devices (address, token, env) values (${auth.address}, ${b.pushToken}, ${b.pushEnv})
      on conflict (address) do update set token = excluded.token, env = excluded.env, updated_at = now()`;
  }

  const [{ persona }] = await sql<{ persona: string }[]>`select persona from mobile.agents where id = ${b.agentId}`;
  const pd = market.priceDecimals;
  try {
    const r = await readWithAgent(newClient(), persona, {
      symbol: market.symbol, name: market.name, mark: formatScaled(market.mark, pd), prev: formatScaled(market.prev, pd),
      change24hPct: market.prev > 0 ? Math.round((market.mark / market.prev - 1) * 10000) / 100 : 0,
      target: formatScaled(target, pd), levelBps: b.levelBps, horizonMin: b.horizonMin, expiresAtUtc: utc(expiresAt), nowUtc: utc(now),
    });
    const [updated] = await sql<ReadRow[]>`
      update mobile.reads set status = 'open', probability = ${r.output.probability}, reasons = ${sql.json(r.output.reasons)},
        limits = ${r.output.limits}, model = ${MODEL}, latency_ms = ${r.latencyMs}, usage = ${sql.json(r.usage)}
      where id = ${row.id} and status = 'pending' returning *`;
    // Sin fila: el cron ya la marcó failed y reembolsó (más de 60 s); se devuelve tal cual quedó.
    [row] = updated ? [updated] : await sql<ReadRow[]>`select * from mobile.reads where id = ${row.id}`;
  } catch (e) {
    const msg = (e instanceof Error ? e.message : String(e)).slice(0, 300);
    console.error(`read-request ${shortAddress(auth.address)} model failed: ${msg}`);
    await sql`select mobile.refund_read(${row.id}::uuid, 'failed', ${msg})`;
    [row] = await sql<ReadRow[]>`select * from mobile.reads where id = ${row.id}`;
  }

  const [{ credits }] = await sql<{ credits: number }[]>`select credits from mobile.wallets where address = ${auth.address}`;
  return json({ read: toReadDto(row), credits });
});

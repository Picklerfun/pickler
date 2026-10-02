// POST { marketId, levelBps, horizonMin, target, expiresAt, side, readId?, pushToken?, pushEnv? } → { reminders } (D12, spec §2.2).
import { z } from "npm:zod@4.6.5";
import { authenticate } from "../_shared/auth.ts";
import { sql } from "../_shared/db.ts";
import { type ReminderRow, toReminderDto } from "../_shared/dto.ts";
import { fail, json, methodIs } from "../_shared/http.ts";
import { fetchMarkets, PerplUnavailable } from "../_shared/perpl.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const Body = z.object({
  marketId: z.number().int().positive(),
  levelBps: z.union([z.literal(250), z.literal(100), z.literal(50), z.literal(-50), z.literal(-100)]),
  horizonMin: z.union([z.literal(60), z.literal(240), z.literal(720), z.literal(1440)]),
  target: z.number().int().positive(),
  expiresAt: z.string().refine((s) => !Number.isNaN(Date.parse(s)), "iso date"),
  side: z.enum(["long", "short"]),
  readId: z.string().regex(UUID).optional(),
  pushToken: z.string().min(16).max(512).optional(),
  pushEnv: z.enum(["sandbox", "production"]).optional(),
});
const PRE_MS = 15 * 60_000;

Deno.serve(async (req) => {
  if (!methodIs(req, "POST")) return fail(405, "method_not_allowed");
  const auth = await authenticate(req.headers);
  if (!auth.ok) return fail(auth.status, auth.error);
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail(422, "bad_body");
  const b = parsed.data;
  const expiresAt = new Date(b.expiresAt);
  const now = Date.now();
  if (expiresAt.getTime() <= now) return fail(422, "expired");

  let markets;
  try {
    markets = await fetchMarkets();
  } catch (e) {
    if (e instanceof PerplUnavailable) return fail(503, "perpl_unavailable");
    throw e;
  }
  const market = markets.get(b.marketId);
  if (!market) return fail(409, "market_closed");

  if (b.readId) {
    const [own] = await sql`select 1 from mobile.reads where id = ${b.readId} and address = ${auth.address}`;
    if (!own) return fail(404, "read_not_found");
  }
  await sql`select mobile.ensure_wallet(${auth.address})`;
  if (b.pushToken && b.pushEnv) {
    await sql`insert into mobile.devices (address, token, env) values (${auth.address}, ${b.pushToken}, ${b.pushEnv})
      on conflict (address) do update set token = excluded.token, env = excluded.env, updated_at = now()`;
  }

  const kinds: { kind: "pre" | "expiry"; fireAt: Date }[] = [];
  if (expiresAt.getTime() - PRE_MS > now) kinds.push({ kind: "pre", fireAt: new Date(expiresAt.getTime() - PRE_MS) });
  kinds.push({ kind: "expiry", fireAt: expiresAt });
  const rows: ReminderRow[] = [];
  for (const k of kinds) {
    const [row] = await sql<ReminderRow[]>`
      insert into mobile.reminders (address, read_id, market_id, symbol, level_bps, horizon_min, price_decimals, target, side, kind, fire_at)
      values (${auth.address}, ${b.readId ?? null}, ${market.id}, ${market.symbol}, ${b.levelBps}, ${b.horizonMin}, ${market.priceDecimals}, ${b.target}, ${b.side}, ${k.kind}, ${k.fireAt})
      returning id, kind, fire_at`;
    rows.push(row);
  }
  return json({ reminders: rows.map(toReminderDto) });
});

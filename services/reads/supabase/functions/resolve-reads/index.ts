// Cron por minuto (D3, D10, P10): reembolsa pending huérfanas, resuelve reads vencidas contra el mark de Perpl,
// anula con >30 min sin Perpl, manda recordatorios vencidos y los pushes. Sólo con x-cron-secret.
import { z } from "npm:zod@4.6.5";
import { providerJwt, type Push, sendPush } from "../_shared/apns.ts";
import { readResolvedPush, readVoidPush, reminderPush } from "../_shared/copy.ts";
import { sql } from "../_shared/db.ts";
import { fail, json, methodIs } from "../_shared/http.ts";
import { resolveRead } from "../_shared/matrix.ts";
import { fetchMarkets, type PerplMarket } from "../_shared/perpl.ts";

const BATCH = 50;
const VOID_AFTER_MS = 30 * 60_000;
const Smoke = z.object({ apnsSmoke: z.object({ token: z.string().min(1), env: z.enum(["sandbox", "production"]) }) });

type DueRead = {
  id: string; address: string; market_id: number; symbol: string; level_bps: number; horizon_min: number; price_decimals: number;
  target: string; probability: string | null; expires_at: Date; agent_name: string; token: string | null; env: "sandbox" | "production" | null;
};
type DueReminder = {
  id: string; address: string; read_id: string | null; market_id: number; symbol: string; level_bps: number; horizon_min: number;
  price_decimals: number; target: string; kind: string; token: string | null; env: "sandbox" | "production" | null;
};

Deno.serve(async (req) => {
  if (!methodIs(req, "POST")) return fail(405, "method_not_allowed");
  const secret = Deno.env.get("CRON_SECRET");
  if (!secret || req.headers.get("x-cron-secret") !== secret) return fail(401, "bad_secret");
  const body = await req.json().catch(() => ({}));

  const smoke = Smoke.safeParse(body);
  if (smoke.success) {
    try {
      const r = await sendPush({ ...smoke.data.apnsSmoke, title: "Pickler", body: "APNs smoke" }, await providerJwt());
      return json({ apns: r });
    } catch (e) {
      console.error(`apns smoke: ${e instanceof Error ? e.message : e}`);
      return fail(503, "apns_unavailable");
    }
  }

  let refunded = 0, resolved = 0, voided = 0, remindersSent = 0, pushSent = 0;
  const now = Date.now();

  // 1. pending con más de 60 s: la función que las creó murió (D7).
  const orphans = await sql<{ id: string }[]>`
    select id from mobile.reads where status = 'pending' and created_at < now() - interval '60 seconds' order by created_at limit ${BATCH}`;
  for (const o of orphans) {
    const [{ ok }] = await sql<{ ok: boolean }[]>`select mobile.refund_read(${o.id}::uuid, 'failed', 'timeout') as ok`;
    if (ok) refunded++;
  }

  // 2. reads vencidas y recordatorios vencidos.
  const due = await sql<DueRead[]>`
    select r.id, r.address, r.market_id, r.symbol, r.level_bps, r.horizon_min, r.price_decimals, r.target, r.probability, r.expires_at,
           a.name as agent_name, d.token, d.env
    from mobile.reads r join mobile.agents a on a.id = r.agent_id left join mobile.devices d on d.address = r.address
    where r.status = 'open' and r.expires_at <= now() order by r.expires_at limit ${BATCH}`;
  const reminders = await sql<DueReminder[]>`
    select m.id, m.address, m.read_id, m.market_id, m.symbol, m.level_bps, m.horizon_min, m.price_decimals, m.target, m.kind, d.token, d.env
    from mobile.reminders m left join mobile.devices d on d.address = m.address
    where m.status = 'scheduled' and m.fire_at <= now() order by m.fire_at limit ${BATCH}`;

  let markets: Map<number, PerplMarket> | null = null;
  if (due.length > 0 || reminders.length > 0) {
    try { markets = await fetchMarkets(); } catch (e) { console.error(`resolve-reads: perpl unavailable: ${e instanceof Error ? e.message : e}`); }
  }

  const pushes: Push[] = [];
  for (const r of due) {
    try {
      const mark = markets?.get(r.market_id)?.mark;
      if (mark === undefined) {
        if (new Date(r.expires_at).getTime() < now - VOID_AFTER_MS) {
          const [{ ok }] = await sql<{ ok: boolean }[]>`select mobile.refund_read(${r.id}::uuid, 'void', 'perpl_unavailable') as ok`;
          if (ok) { voided++; if (r.token && r.env) pushes.push({ ...readVoidPush(r), token: r.token, env: r.env }); }
        }
        continue; // sin mark y sin 30 min: se reintenta al minuto
      }
      const res = resolveRead({ level_bps: r.level_bps, target: Number(r.target), probability: r.probability === null ? null : Number(r.probability) }, mark);
      const updated = await sql`
        update mobile.reads set status = ${res.status}, outcome = ${res.outcome}, brier = ${res.brier}, mark_at_resolution = ${mark}, resolved_at = now()
        where id = ${r.id} and status = 'open' returning id`;
      if (updated.length > 0) { resolved++; if (r.token && r.env) pushes.push({ ...readResolvedPush(r, res.status, mark), token: r.token, env: r.env }); }
    } catch (e) {
      console.error(`resolve ${r.id}: ${e instanceof Error ? e.message : e}`);
    }
  }

  for (const m of reminders) {
    const mark = markets?.get(m.market_id)?.mark;
    if (mark === undefined) continue; // reintenta al minuto
    if (!m.token || !m.env) { await sql`update mobile.reminders set status = 'failed', sent_at = now() where id = ${m.id} and status = 'scheduled'`; continue; }
    let status = 0, reason: string | null = "no_jwt";
    try { ({ status, reason } = await sendPush({ ...reminderPush({ ...m, target: Number(m.target) }, mark), token: m.token, env: m.env }, await providerJwt())); }
    catch (e) { reason = e instanceof Error ? e.message : String(e); }
    await sql`update mobile.reminders set status = ${status === 200 ? "sent" : "failed"}, sent_at = now() where id = ${m.id} and status = 'scheduled'`;
    if (status === 200) remindersSent++; else console.error(`reminder ${m.id}: ${status} ${reason}`);
  }

  if (pushes.length > 0) {
    let jwt: string | null = null;
    try { jwt = await providerJwt(); } catch (e) { console.error(`apns: ${e instanceof Error ? e.message : e}`); }
    if (jwt) for (const p of pushes) {
      const r = await sendPush(p, jwt);
      if (r.status === 200) pushSent++; else console.error(`push ${p.data?.kind} ${p.data?.readId}: ${r.status} ${r.reason}`);
    }
  }
  return json({ refunded, resolved, voided, remindersSent, pushSent });
});

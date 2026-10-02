import { authenticate } from "../_shared/auth.ts";
import { sql } from "../_shared/db.ts";
import { type ReadRow, toReadDto } from "../_shared/dto.ts";
import { fail, json, methodIs } from "../_shared/http.ts";

Deno.serve(async (req) => {
  if (!methodIs(req, "GET")) return fail(405, "method_not_allowed");
  const auth = await authenticate(req.headers);
  if (!auth.ok) return fail(auth.status, auth.error);
  const raw = new URL(req.url).searchParams.get("marketId");
  const marketId = raw === null ? null : Number(raw);
  if (marketId !== null && !Number.isInteger(marketId)) return fail(422, "bad_market");
  const [{ credits }] = await sql<{ credits: number }[]>`select mobile.ensure_wallet(${auth.address}) as credits`;
  const rows = await sql<ReadRow[]>`
    select * from mobile.reads where address = ${auth.address} ${marketId === null ? sql`` : sql`and market_id = ${marketId}`}
    order by created_at desc limit 50`;
  return json({ reads: rows.map(toReadDto), credits });
});

import { sql } from "../_shared/db.ts";
import { type AgentRow, toAgentDto } from "../_shared/dto.ts";
import { fail, json, methodIs } from "../_shared/http.ts";

Deno.serve(async (req) => {
  if (!methodIs(req, "GET")) return fail(405, "method_not_allowed");
  const rows = await sql<AgentRow[]>`
    select id, handle, name, owner, price_credits, reads, resolved, right_count, brier_avg
    from mobile.agent_records order by sort, id`;
  return json({ agents: rows.map(toAgentDto) });
});

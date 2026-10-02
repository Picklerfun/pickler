import { authenticate } from "../_shared/auth.ts";
import { sql } from "../_shared/db.ts";
import { type ReadRow, toReadDto } from "../_shared/dto.ts";
import { fail, json, methodIs } from "../_shared/http.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  if (!methodIs(req, "GET")) return fail(405, "method_not_allowed");
  const auth = await authenticate(req.headers);
  if (!auth.ok) return fail(auth.status, auth.error);
  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!UUID.test(id)) return fail(422, "bad_id");
  const [row] = await sql<ReadRow[]>`select * from mobile.reads where id = ${id} and address = ${auth.address}`;
  if (!row) return fail(404, "not_found");
  return json({ read: toReadDto(row) });
});

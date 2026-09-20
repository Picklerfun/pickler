// Conexión directa a Postgres (P1): SUPABASE_DB_URL la inyecta el edge runtime. Esquema `mobile` calificado en cada consulta.
import postgres from "npm:postgres@3.4.9";

const url = Deno.env.get("SUPABASE_DB_URL");
if (!url) throw new Error("SUPABASE_DB_URL missing");

export const sql = postgres(url, { prepare: false, max: 3, idle_timeout: 20, connect_timeout: 10 });

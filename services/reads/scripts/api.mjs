import { PROJECT_REF } from "./env.mjs";

/** POST /v1/projects/{ref}/database/query del Management API. Devuelve las filas (array) o null sin cuerpo. */
export async function runQuery(env, query, { readOnly = false } = {}) {
  if (!env.SUPABASE_ACCESS_TOKEN) throw new Error("Falta SUPABASE_ACCESS_TOKEN");
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: "POST",
    headers: { authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify({ query, read_only: readOnly }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Management API ${res.status}: ${text.slice(0, 800)}`);
  return text ? JSON.parse(text) : null;
}

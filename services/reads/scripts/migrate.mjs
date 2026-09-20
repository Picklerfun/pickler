import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runQuery } from "./api.mjs";
import { loadEnv } from "./env.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
export const MIGRATIONS_DIR = path.resolve(here, "../supabase/migrations");
const BOOTSTRAP = `create schema if not exists mobile;
create table if not exists mobile.migrations (name text primary key, applied_at timestamptz not null default now());`;

export function pendingMigrations(files, applied) {
  return files.filter((f) => /^\d{4}_[a-z0-9_]+\.sql$/.test(f)).sort().filter((f) => !applied.has(f));
}

export function wrapMigration(name, sql) {
  return `begin;\n${sql.trim()}\ninsert into mobile.migrations (name) values ('${name}');\ncommit;`;
}

async function main() {
  const dry = process.argv.includes("--dry");
  const env = loadEnv();
  await runQuery(env, BOOTSTRAP);
  const applied = new Set((await runQuery(env, "select name from mobile.migrations", { readOnly: true })).map((r) => r.name));
  const pending = pendingMigrations(fs.readdirSync(MIGRATIONS_DIR), applied);
  console.log(`aplicadas: ${[...applied].sort().join(", ") || "(ninguna)"}`);
  console.log(`pendientes: ${pending.join(", ") || "(ninguna)"}`);
  for (const name of pending) {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, name), "utf8");
    if (dry) { console.log(`--- ${name} (dry) ---\n${sql}`); continue; }
    await runQuery(env, wrapMigration(name, sql));
    console.log(`✓ ${name}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e.message); process.exit(1); });
}

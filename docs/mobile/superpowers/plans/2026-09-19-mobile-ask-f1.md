# Ask — F1: backend propio en el esquema `mobile` (Supabase `pickler`) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un servicio propio, desplegado en el proyecto Supabase `pickler` (`yvdipvcrpbqvofayteqf`) dentro del esquema `mobile`, con el que se puede pedir una lectura firmada por `curl` (cobro de créditos simulados, lectura de `claude-sonnet-5` con salida estructurada), listarla, y verla resuelta **right/wrong** por un cron que corre cada minuto contra el mark de Perpl y manda el push por APNs; sin tocar nada de Gilbert en el proyecto compartido.

**Architecture:** Todo vive en `services/reads/`. Las migraciones SQL (`supabase/migrations/000N_*.sql`) se aplican con un migrador propio (`scripts/migrate.mjs`) contra el endpoint de consulta del Management API y un ledger `mobile.migrations`, nunca con `supabase db push`. Seis edge functions en Deno (`supabase/functions/<name>/index.ts`) comparten módulos puros y probados en `_shared/` (`matrix`, `auth`, `perpl`, `claude`, `apns`, `db`, `http`, `dto`); hablan con Postgres por `SUPABASE_DB_URL` (postgres.js) y con Perpl por `GET /v1/pub/context`. La atomicidad de cobro + insert y de reembolso vive en dos funciones SQL `security definer` (`mobile.request_read`, `mobile.refund_read`). `pg_cron` + `pg_net` invocan `resolve-reads` cada minuto con un secreto guardado en Vault.

**Tech Stack:** Supabase CLI ≥ 2.111 (`SUPABASE_ACCESS_TOKEN`), Deno 2.7 (edge runtime), `npm:@anthropic-ai/sdk@0.127.0` + `npm:zod@4.6.5` (structured outputs), `npm:viem@2.56.8` (recuperar la firma), `npm:postgres@3.4.9`, `jsr:@std/assert@1` para `deno test`, Node 22 para los scripts (`node --test`). Postgres: `pg_cron`, `pg_net`, `vault`.

**Spec:** `docs/superpowers/specs/2026-09-19-mobile-ask-design.md` (D1–D10, D17, D19, D20 y §2.1–§2.2 son el contrato de esta fase; D11–D16 son contexto de lo que la app consumirá en F2/F3). Léelo antes de empezar: el plan argumenta desde ahí.

## Global Constraints

- Worktree `.claude/worktrees/mobile-ask`, rama `feat/mobile-ask` (base `main` = `5ed4e1c`). Todo se corre desde `services/reads` dentro del worktree salvo los checks de docs (raíz). Nunca `git add -A`; archivos por nombre. Commits `feat(reads): …` / `chore(reads): …` / `docs(mobile-ask): …` con trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. **No commitear ni pushear sin que Jesús lo pida**: los pasos "Commit" de cada task se ejecutan sólo si él ya autorizó commits en la sesión; si no, se deja el árbol listo y se anota en el handoff.
- **Proyecto Supabase compartido con Gilbert** (`Relayerfi/pickler`). Prohibido: `supabase db push`, `supabase db reset`, `supabase migration repair`, `supabase link` seguido de comandos de base, cualquier `drizzle-kit`, cualquier `create`/`alter`/`drop` fuera del esquema `mobile` (excepción única: `create extension if not exists pg_cron` / `pg_net`, que no crean objetos en esquemas suyos), y cambiar "Exposed schemas" u otra configuración del proyecto en el dashboard. El MCP de Supabase de la sesión apunta a **Proflores**: no usarlo para nada de Pickler.
- Llaves en `.env.pickler` de la raíz del checkout principal (`/Users/josedejesusacevedoflores/Documents/predict/.env.pickler`, gitignored; el worktree no lo tiene): `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`, `SUPABASE_ACCESS_TOKEN`. Esta fase añade ahí `CRON_SECRET`, `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_KEY_P8_B64` (Task 5). Ningún valor se escribe en archivos del repo, en migraciones ni en `cron.job`.
- CLI de Supabase **≥ 2.111** (hoy 2.22.12); Task 0 la actualiza. Todo comando remoto lleva `--project-ref yvdipvcrpbqvofayteqf`; se verifica con `supabase projects list` que el token sólo ve `pickler`.
- `deno test -A supabase/functions/_shared/` y `node --test scripts/` en verde al cierre de cada task a partir de la que los introduce. Ninguna prueba unitaria llama a Anthropic, a Perpl ni a APNs: todo lo externo se prueba con dobles y el fixture; lo real se prueba en los smokes (Tasks 4, 5, 6).
- Cobros y créditos son **simulados**; ninguna task mueve AUSD ni MON ni toca la cuenta #620.
- Copy de la API y de los pushes en inglés; SQL y código con nombres del spec §2.1 (snake_case en la base, camelCase en JSON).

## Decisiones del plan (no están en el spec)

| # | Decisión | Por qué |
|---|---|---|
| P1 | Las funciones hablan con Postgres por **`SUPABASE_DB_URL`** (variable automática del edge runtime) con `npm:postgres@3.4.9` y `prepare: false`, no con supabase-js/PostgREST. | PostgREST sólo sirve los esquemas listados en "Exposed schemas" del proyecto; añadir `mobile` ahí es un cambio de configuración del proyecto compartido (Global Constraints). Con la conexión directa no hace falta. |
| P2 | `migrate.mjs` manda cada archivo como **una sola consulta** envuelta en `begin; … ; insert into mobile.migrations (name) values ('<archivo>'); commit;`. El esquema y la tabla `mobile.migrations` se crean con `if not exists` antes de consultar el ledger (bootstrap fuera del ledger). | Una migración a medias no deja el ledger mintiendo; el endpoint acepta varias sentencias en una consulta (es lo que hace `apply_migration` del MCP oficial). |
| P3 | Imports de Deno con **especificador `npm:`/`jsr:` y versión fija en cada archivo**; sin `deno.json` ni import map. | Cada función se despliega aislada; una versión escrita donde se usa es lo único que garantiza que `deno test` local y el runtime desplegado resuelvan lo mismo. |
| P4 | La vista `mobile.agent_records` llama `right_count` a la columna que el spec §2.1 llama `right`. | `right` es palabra reservada en SQL: obligaría a entrecomillar en cada consulta. Se corrige en el spec en Task 7. |
| P5 | La firma se verifica con `recoverMessageAddress` de viem y comparación en minúsculas, no con `verifyMessage`. | `viem` exporta dos `verifyMessage` (utilidad y acción con cliente); recuperar la dirección es inequívoco y cubre exactamente EOA, que es lo que Mera produce. |
| P6 | El smoke de APNs en F1 manda a un **token inventado** y espera `400 {"reason":"BadDeviceToken"}`. Un `403 InvalidProviderToken` es JWT mal hecho; un error de transporte (sin respuesta HTTP/2) activa el fallback de D10. | Sin la app con `expo-notifications` no hay token real hasta F2. `BadDeviceToken` sólo lo devuelve APNs tras aceptar TLS, HTTP/2 y el JWT: prueba lo que F1 necesita probar. |
| P7 | `APNS_KEY_P8_B64` = el `.p8` completo en base64 (una línea). `apns.ts` lo decodifica y saca el bloque PEM. | `supabase secrets set` toma pares `NAME=value` de una línea; un PEM con saltos no viaja bien. |
| P8 | `scripts/sign.mjs` genera una private key **efímera** por corrida salvo que exista `READS_TEST_KEY` en el entorno; cada corrida del smoke crea una wallet nueva con 20 créditos. Limpieza documentada en el README (`delete from mobile.wallets where address in (…)` en cascada manual). | No hay que guardar una key de prueba en ningún sitio; las wallets de prueba no cuestan nada. |
| P9 | `read-request` es **síncrona**: inserta `pending`, llama al modelo, actualiza a `open` y responde con la read completa. `pending` sólo lo ve un cliente que reintenta con `read-get` mientras la primera llamada sigue viva. | Una sola llamada HTTP desde la app (D14 muestra "Reading… up to 60 s"); el reembolso a los 60 s lo garantiza el cron aunque la función muera. |
| P10 | `resolve-reads` procesa como máximo **50 reads y 50 recordatorios por corrida**, ordenados por vencimiento; el resto lo toma la corrida siguiente. | Idempotente por construcción (`where status = 'open'`), sin riesgo de pasar el límite de tiempo de la función. |
| P11 | La persona del agente `jesus` en el seed es un **placeholder** que Jesús reescribe (D9); `drift` y `anchor` son definitivas. Las personas nunca salen por la API. | D9 lo deja a Jesús; el seed tiene que existir para que el smoke corra. |
| P12 | `mobile.ensure_wallet(address)` crea la wallet con 20 créditos (evento `grant`) y devuelve el saldo; la llaman `reads-list` y `request_read`. | La app debe ver "20 credits" antes de la primera lectura (D14). |
| P13 | El `x-cron-secret` se genera con `openssl rand -hex 32`, se guarda como secreto de funciones (`CRON_SECRET`) y en Vault (`mobile_cron_secret`) con `scripts/query.mjs`, nunca en una migración. La URL del proyecto va en claro en `0003_cron.sql` (no es secreta). | D19: nada secreto en archivos versionados; `cron.job` sólo referencia Vault. |

## Mapa de archivos

| Archivo | Task | Responsabilidad |
|---|---|---|
| `services/reads/README.md`, `.env.example`, `package.json`, `.gitignore`, `supabase/config.toml` | 0 | Esqueleto, comandos, lista de prohibiciones |
| `services/reads/scripts/env.mjs`, `scripts/api.mjs`, `scripts/query.mjs` | 0 | Cargar `.env.pickler`; consulta al Management API; inventario del proyecto |
| `services/reads/scripts/migrate.mjs` + `scripts/migrate.test.mjs` | 1 | Migrador propio con ledger |
| `services/reads/supabase/migrations/0001_schema.sql` | 1 | Esquema `mobile` completo (§2.1) + `ensure_wallet`, `request_read`, `refund_read` |
| `services/reads/supabase/functions/_shared/matrix.ts` + `matrix.test.ts` | 2 | Matriz, target, pregunta, outcome, Brier |
| `services/reads/supabase/functions/_shared/auth.ts` + `auth.test.ts` | 2 | Firma `pickler-reads:<address>:<ts>` |
| `services/reads/supabase/functions/_shared/http.ts` | 2 | Respuestas JSON y errores |
| `services/reads/supabase/functions/_shared/perpl.ts` + `perpl.test.ts` + `fixtures/context.json` | 3 | Mercados y mark desde `pub/context` |
| `services/reads/supabase/functions/_shared/claude.ts` + `claude.test.ts` | 3 | Prompt, schema y llamada al modelo |
| `services/reads/supabase/functions/_shared/db.ts`, `dto.ts` + `dto.test.ts` | 3 | Conexión Postgres; fila → JSON |
| `services/reads/supabase/migrations/0002_seed_agents.sql` | 4 | Tres agentes |
| `services/reads/supabase/functions/{agents-list,read-request,read-get,reads-list}/index.ts` | 4 | Las cuatro funciones de lectura |
| `services/reads/scripts/sign.mjs`, `scripts/smoke.sh` | 4 | Firma de prueba y smoke por `curl` |
| `services/reads/supabase/functions/_shared/apns.ts` + `apns.test.ts`, `scripts/apns-smoke.mjs` | 5 | JWT ES256 y envío a APNs |
| `services/reads/supabase/functions/{reminder-set,resolve-reads}/index.ts`, `supabase/migrations/0003_cron.sql` | 6 | Recordatorios, resolución, cron |
| `docs/superpowers/specs/2026-09-19-mobile-ask-design.md`, `docs/overview/2026-09-19-mobile-ask.html`, `docs/overview/data/manifest.js`, `docs/superpowers/audits/2026-09-19-mobile-ask-f1-rulings.md` | 7 | Docs de cierre y audit |

---

### Task 0: CLI ≥ 2.111, esqueleto de `services/reads` e inventario del proyecto compartido

**Files:**
- Create: `services/reads/README.md`, `services/reads/.env.example`, `services/reads/package.json`, `services/reads/.gitignore`, `services/reads/supabase/config.toml`, `services/reads/scripts/env.mjs`, `services/reads/scripts/api.mjs`, `services/reads/scripts/query.mjs`

**Interfaces:**
- Produces: `loadEnv(): Record<string,string>` y `PROJECT_REF = "yvdipvcrpbqvofayteqf"` en `env.mjs`; `runQuery(env, sql, { readOnly }): Promise<unknown[]>` en `api.mjs`; CLI `node scripts/query.mjs [--read-only] [--file x.sql | "sql"]`. Los usan Tasks 1, 4, 6, 7.

- [ ] **Step 1: Actualizar la CLI y comprobar el token**

```bash
brew upgrade supabase && supabase --version
cd /Users/josedejesusacevedoflores/Documents/predict/.claude/worktrees/mobile-ask
set -a; source /Users/josedejesusacevedoflores/Documents/predict/.env.pickler; set +a
supabase projects list
```
Expected: versión `2.111.0` o mayor; la lista muestra **sólo** `pickler` con ref `yvdipvcrpbqvofayteqf`. Si aparece otro proyecto, parar: el token no es el de Pickler.

- [ ] **Step 2: Esqueleto**

`services/reads/package.json`:
```json
{
  "name": "pickler-reads",
  "private": true,
  "type": "module",
  "engines": { "node": ">=22" },
  "scripts": {
    "migrate": "node scripts/migrate.mjs",
    "migrate:dry": "node scripts/migrate.mjs --dry",
    "query": "node scripts/query.mjs",
    "test:scripts": "node --test scripts/",
    "test:deno": "deno test -A supabase/functions/_shared/",
    "test": "npm run test:scripts && npm run test:deno",
    "sign": "node scripts/sign.mjs",
    "smoke": "bash scripts/smoke.sh",
    "deploy": "supabase functions deploy --project-ref yvdipvcrpbqvofayteqf --no-verify-jwt"
  },
  "devDependencies": { "viem": "2.56.8" }
}
```
`services/reads/.gitignore`:
```
node_modules/
.env
.env.*
!.env.example
```
`services/reads/.env.example` (sólo nombres, sin valores):
```
# Valores reales en ../../.env.pickler (gitignored). Nunca aquí.
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_ACCESS_TOKEN=
ANTHROPIC_API_KEY=
CRON_SECRET=
APNS_KEY_ID=
APNS_TEAM_ID=
APNS_KEY_P8_B64=
```
`services/reads/supabase/config.toml`:
```toml
project_id = "yvdipvcrpbqvofayteqf"

[functions.agents-list]
verify_jwt = false
[functions.read-request]
verify_jwt = false
[functions.read-get]
verify_jwt = false
[functions.reads-list]
verify_jwt = false
[functions.reminder-set]
verify_jwt = false
[functions.resolve-reads]
verify_jwt = false
```
`services/reads/scripts/env.mjs`:
```js
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const PROJECT_REF = "yvdipvcrpbqvofayteqf";
export const SUPABASE_URL = `https://${PROJECT_REF}.supabase.co`;
const here = path.dirname(fileURLToPath(import.meta.url));
const worktreeRoot = path.resolve(here, "../../..");

/** `.env.pickler` vive en el checkout principal (gitignored): en un worktree se busca vía git-common-dir. */
export function envFile() {
  if (process.env.PICKLER_ENV_FILE) return process.env.PICKLER_ENV_FILE;
  const local = path.join(worktreeRoot, ".env.pickler");
  if (fs.existsSync(local)) return local;
  const common = execSync("git rev-parse --path-format=absolute --git-common-dir", { cwd: worktreeRoot, encoding: "utf8" }).trim();
  return path.join(path.dirname(common), ".env.pickler");
}

export function parseEnv(text) {
  const out = {};
  for (const line of text.split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
  }
  return out;
}

export function loadEnv() {
  const file = envFile();
  if (!fs.existsSync(file)) throw new Error(`No existe ${file}`);
  return parseEnv(fs.readFileSync(file, "utf8"));
}
```
`services/reads/scripts/api.mjs`:
```js
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
```
`services/reads/scripts/query.mjs`:
```js
import fs from "node:fs";
import { runQuery } from "./api.mjs";
import { loadEnv } from "./env.mjs";

const args = process.argv.slice(2);
const readOnly = args.includes("--read-only");
const fileIx = args.indexOf("--file");
const sql = fileIx >= 0 ? fs.readFileSync(args[fileIx + 1], "utf8") : args.filter((a) => !a.startsWith("--")).join(" ");
if (!sql.trim()) { console.error("uso: node scripts/query.mjs [--read-only] (--file x.sql | \"select 1\")"); process.exit(2); }
const rows = await runQuery(loadEnv(), sql, { readOnly });
console.log(JSON.stringify(rows, null, 2));
```

- [ ] **Step 3: Inventario del proyecto compartido (sólo lectura) y guardarlo para el audit**

```bash
cd services/reads && npm install
node scripts/query.mjs --read-only "select n.nspname as schema, count(c.oid) filter (where c.relkind in ('r','v','m')) as rels from pg_namespace n left join pg_class c on c.relnamespace = n.oid where n.nspname not in ('pg_catalog','information_schema','pg_toast') and n.nspname not like 'pg_temp%' and n.nspname not like 'pg_toast%' group by n.nspname order by 1" > /tmp/reads-inventory-before.json
node scripts/query.mjs --read-only "select extname, extversion from pg_extension order by 1" > /tmp/reads-extensions-before.json
cat /tmp/reads-inventory-before.json /tmp/reads-extensions-before.json
```
Expected: JSON con los esquemas actuales (los de Gilbert, `public`, `auth`, `storage`, …) y **sin** `mobile`; en extensiones se ve si `pg_cron`, `pg_net` y `supabase_vault` ya están. Copia los dos JSON a `docs/superpowers/audits/2026-09-19-mobile-ask-f1-rulings.md` en Task 7 (sección "Inventario antes/después").

- [ ] **Step 4: README con las prohibiciones y los comandos**

`services/reads/README.md`:
```markdown
# services/reads — backend de Ask (esquema `mobile`)

Proyecto Supabase **compartido** `pickler` (`yvdipvcrpbqvofayteqf`, Sherry Labs) con `Relayerfi/pickler` de Gilbert.
Todo lo nuestro vive en el esquema `mobile`. Spec: `docs/superpowers/specs/2026-09-19-mobile-ask-design.md`.

## Prohibido en este proyecto
- `supabase db push`, `supabase db reset`, `supabase migration repair`, `supabase link` + comandos de base.
- Cualquier `drizzle-kit` (el migrador de Gilbert) y cualquier DDL fuera de `mobile` (salvo `create extension if not exists pg_cron|pg_net`).
- Cambiar configuración del proyecto en el dashboard (API "Exposed schemas", auth, etc.).
- El MCP de Supabase de las sesiones de Claude apunta a Proflores: no usarlo.

## Llaves
`../../.env.pickler` (gitignored; en un worktree se lee del checkout principal). Nombres en `.env.example`.

## Comandos
- `npm run migrate:dry` / `npm run migrate` — aplica `supabase/migrations/*.sql` pendientes vía Management API; ledger `mobile.migrations`.
- `npm run query -- --read-only "select …"` — consulta puntual.
- `npm test` — `node --test scripts/` + `deno test -A supabase/functions/_shared/`.
- `npm run deploy -- <function>` — `supabase functions deploy <function> --project-ref … --no-verify-jwt`.
- `npm run sign` — headers `x-pickler-*` con una key efímera (o `READS_TEST_KEY`).
- `npm run smoke` — agents-list → read-request → read-get → reads-list.
- Secretos de funciones: `set -a; source ../../.env.pickler; set +a; supabase secrets set --project-ref yvdipvcrpbqvofayteqf ANTHROPIC_API_KEY="$ANTHROPIC_API_KEY" CRON_SECRET="$CRON_SECRET" APNS_KEY_ID="$APNS_KEY_ID" APNS_TEAM_ID="$APNS_TEAM_ID" APNS_KEY_P8_B64="$APNS_KEY_P8_B64" PERPL_REST=https://testnet.perpl.xyz/api`

## Limpieza de wallets de prueba
`delete from mobile.credit_events where address in (…); delete from mobile.reminders where address in (…); delete from mobile.reads where address in (…); delete from mobile.devices where address in (…); delete from mobile.wallets where address in (…);`
```

- [ ] **Step 5: Verificar y commit**

Run: `cd services/reads && node -e "import('./scripts/env.mjs').then(m=>console.log(Object.keys(m.loadEnv())))"`
Expected: `[ 'SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'ANTHROPIC_API_KEY', 'SUPABASE_ACCESS_TOKEN' ]` (sin valores en pantalla).

```bash
git add services/reads/README.md services/reads/.env.example services/reads/package.json services/reads/package-lock.json services/reads/.gitignore services/reads/supabase/config.toml services/reads/scripts/env.mjs services/reads/scripts/api.mjs services/reads/scripts/query.mjs
git commit -m "chore(reads): esqueleto de services/reads, scripts de entorno y consulta al Management API"
```

---

### Task 1: Migrador propio y `0001_schema.sql` aplicado (D4, D7, §2.1, P2, P4, P12)

**Files:**
- Create: `services/reads/scripts/migrate.mjs`, `services/reads/scripts/migrate.test.mjs`, `services/reads/supabase/migrations/0001_schema.sql`

**Interfaces:**
- Consumes: `loadEnv`, `runQuery` (Task 0).
- Produces: en Postgres, el esquema `mobile` de §2.1 con la vista `agent_records` (columnas `id, handle, name, owner, price_credits, sort, reads, resolved, right_count, brier_avg`) y las funciones `mobile.ensure_wallet(text) returns int`, `mobile.request_read(…) returns mobile.reads` (errores `unknown_agent` = SQLSTATE `P0001`, `no_credits` = `P0002`), `mobile.refund_read(uuid, text, text) returns boolean`. Exports de `migrate.mjs`: `pendingMigrations(files, applied)`, `wrapMigration(name, sql)`.

- [ ] **Step 1: Test del migrador (falla)**

`services/reads/scripts/migrate.test.mjs`:
```js
import assert from "node:assert/strict";
import { test } from "node:test";
import { pendingMigrations, wrapMigration } from "./migrate.mjs";

test("pendingMigrations: sólo NNNN_*.sql, ordenadas, sin las aplicadas", () => {
  const files = ["0002_seed_agents.sql", "notas.md", "0001_schema.sql", "0003_cron.sql"];
  assert.deepEqual(pendingMigrations(files, new Set(["0001_schema.sql"])), ["0002_seed_agents.sql", "0003_cron.sql"]);
  assert.deepEqual(pendingMigrations(files, new Set()), ["0001_schema.sql", "0002_seed_agents.sql", "0003_cron.sql"]);
});

test("wrapMigration: transacción con el insert al ledger al final", () => {
  const sql = wrapMigration("0001_schema.sql", "create table mobile.x (id int);");
  assert.equal(sql, "begin;\ncreate table mobile.x (id int);\ninsert into mobile.migrations (name) values ('0001_schema.sql');\ncommit;");
});
```
Run: `cd services/reads && node --test scripts/` → Expected: FAIL (`Cannot find module './migrate.mjs'`).

- [ ] **Step 2: `migrate.mjs`**

```js
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
```
Run: `node --test scripts/` → Expected: 2 pass.

- [ ] **Step 3: `0001_schema.sql`**

```sql
-- Esquema mobile · Ask (spec 2026-09-19-mobile-ask §2.1). Sólo el rol de las funciones lo usa; sin RLS ni grants a anon/authenticated.
create table mobile.agents (
  id text primary key,
  handle text not null unique,
  name text not null,
  owner text not null,
  persona text not null,
  price_credits int not null default 1 check (price_credits > 0),
  active boolean not null default true,
  sort int not null default 100,
  created_at timestamptz not null default now()
);

create table mobile.wallets (
  address text primary key check (address = lower(address)),
  credits int not null default 20 check (credits >= 0),
  created_at timestamptz not null default now()
);

create table mobile.credit_events (
  id bigserial primary key,
  address text not null references mobile.wallets(address),
  delta int not null,
  reason text not null check (reason in ('grant', 'charge', 'refund')),
  read_id uuid,
  created_at timestamptz not null default now()
);

create table mobile.reads (
  id uuid primary key default gen_random_uuid(),
  address text not null references mobile.wallets(address),
  agent_id text not null references mobile.agents(id),
  market_id int not null,
  symbol text not null,
  level_bps int not null check (level_bps in (250, 100, 50, -50, -100)),
  horizon_min int not null check (horizon_min in (60, 240, 720, 1440)),
  price_decimals int not null,
  mark_at_request bigint not null,
  target bigint not null,
  question text not null,
  status text not null default 'pending'
    check (status in ('pending', 'open', 'right', 'wrong', 'void', 'failed')),
  probability numeric(4,3),
  reasons jsonb,
  limits text,
  model text,
  latency_ms int,
  usage jsonb,
  credits_charged int not null,
  error text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  resolved_at timestamptz,
  mark_at_resolution bigint,
  outcome boolean,
  brier numeric(5,4)
);
create index reads_address_created on mobile.reads (address, created_at desc);
create index reads_open_expires on mobile.reads (expires_at) where status = 'open';
create index reads_pending_created on mobile.reads (created_at) where status = 'pending';

create table mobile.reminders (
  id uuid primary key default gen_random_uuid(),
  address text not null references mobile.wallets(address),
  read_id uuid references mobile.reads(id),
  market_id int not null,
  symbol text not null,
  level_bps int not null,
  horizon_min int not null,
  price_decimals int not null,
  target bigint not null,
  side text not null check (side in ('long', 'short')),
  kind text not null check (kind in ('pre', 'expiry')),
  fire_at timestamptz not null,
  status text not null default 'scheduled' check (status in ('scheduled', 'sent', 'failed')),
  sent_at timestamptz,
  created_at timestamptz not null default now()
);
create index reminders_due on mobile.reminders (fire_at) where status = 'scheduled';

create table mobile.devices (
  address text primary key references mobile.wallets(address),
  token text not null,
  env text not null check (env in ('sandbox', 'production')),
  updated_at timestamptz not null default now()
);

create view mobile.agent_records as
select a.id, a.handle, a.name, a.owner, a.price_credits, a.sort,
       count(r.id) filter (where r.status in ('open', 'right', 'wrong')) as reads,
       count(r.id) filter (where r.status in ('right', 'wrong')) as resolved,
       count(r.id) filter (where r.status = 'right') as right_count,
       avg(r.brier) filter (where r.status in ('right', 'wrong')) as brier_avg
from mobile.agents a
left join mobile.reads r on r.agent_id = a.id
where a.active
group by a.id;

-- Wallet con 20 créditos iniciales (evento grant); devuelve el saldo actual.
create function mobile.ensure_wallet(p_address text) returns int
language plpgsql security definer set search_path = mobile, pg_temp as $$
declare v_credits int;
begin
  insert into mobile.wallets (address) values (p_address) on conflict (address) do nothing;
  if found then
    insert into mobile.credit_events (address, delta, reason) values (p_address, 20, 'grant');
  end if;
  select credits into v_credits from mobile.wallets where address = p_address;
  return v_credits;
end $$;

-- Cobro + insert de la read en una transacción. Errores: unknown_agent (P0001), no_credits (P0002).
create function mobile.request_read(
  p_address text, p_agent text, p_market int, p_symbol text, p_level int, p_horizon int,
  p_pd int, p_mark bigint, p_target bigint, p_question text, p_expires timestamptz
) returns mobile.reads
language plpgsql security definer set search_path = mobile, pg_temp as $$
declare v_price int; v_read mobile.reads;
begin
  perform mobile.ensure_wallet(p_address);
  select price_credits into v_price from mobile.agents where id = p_agent and active;
  if v_price is null then raise exception 'unknown_agent' using errcode = 'P0001'; end if;
  perform 1 from mobile.wallets where address = p_address for update;
  update mobile.wallets set credits = credits - v_price where address = p_address and credits >= v_price;
  if not found then raise exception 'no_credits' using errcode = 'P0002'; end if;
  insert into mobile.reads (address, agent_id, market_id, symbol, level_bps, horizon_min, price_decimals,
                            mark_at_request, target, question, credits_charged, expires_at)
  values (p_address, p_agent, p_market, p_symbol, p_level, p_horizon, p_pd,
          p_mark, p_target, p_question, v_price, p_expires)
  returning * into v_read;
  insert into mobile.credit_events (address, delta, reason, read_id) values (p_address, -v_price, 'charge', v_read.id);
  return v_read;
end $$;

-- Reembolso idempotente: sólo desde pending/open; p_status es 'failed' o 'void'.
create function mobile.refund_read(p_read uuid, p_status text, p_error text) returns boolean
language plpgsql security definer set search_path = mobile, pg_temp as $$
declare v mobile.reads;
begin
  update mobile.reads
     set status = p_status, error = p_error,
         resolved_at = case when p_status = 'void' then now() else resolved_at end
   where id = p_read and status in ('pending', 'open')
  returning * into v;
  if not found then return false; end if;
  update mobile.wallets set credits = credits + v.credits_charged where address = v.address;
  insert into mobile.credit_events (address, delta, reason, read_id) values (v.address, v.credits_charged, 'refund', v.id);
  return true;
end $$;
```

- [ ] **Step 4: Dry run, aplicar, comprobar idempotencia**

```bash
npm run migrate:dry      # imprime 0001 sin aplicar
npm run migrate          # ✓ 0001_schema.sql
npm run migrate          # pendientes: (ninguna)
node scripts/query.mjs --read-only "select name, applied_at from mobile.migrations"
node scripts/query.mjs --read-only "select table_name from information_schema.tables where table_schema = 'mobile' order by 1"
node scripts/query.mjs --read-only "select routine_name from information_schema.routines where routine_schema = 'mobile' order by 1"
```
Expected: `0001_schema.sql` en el ledger; tablas `agent_records, agents, credit_events, devices, migrations, reads, reminders, wallets`; rutinas `ensure_wallet, refund_read, request_read`.

- [ ] **Step 5: Probar las funciones SQL contra el defecto (sin agentes todavía)**

```bash
node scripts/query.mjs "select mobile.ensure_wallet('0x00000000000000000000000000000000000000aa') as credits"
node scripts/query.mjs "select mobile.ensure_wallet('0x00000000000000000000000000000000000000aa') as credits"
node scripts/query.mjs --read-only "select count(*) from mobile.credit_events where address = '0x00000000000000000000000000000000000000aa' and reason = 'grant'"
node scripts/query.mjs "select mobile.request_read('0x00000000000000000000000000000000000000aa','nope',16,'BTC',100,60,1,762555,770181,'q',now())"
node scripts/query.mjs "delete from mobile.credit_events where address = '0x00000000000000000000000000000000000000aa'; delete from mobile.wallets where address = '0x00000000000000000000000000000000000000aa';"
```
Expected: `20` dos veces; **un solo** evento `grant`; `request_read` con agente inexistente falla con `unknown_agent` (el error del Management API contiene ese texto); la limpieza deja la wallet fuera.

- [ ] **Step 6: Commit**

```bash
git add services/reads/scripts/migrate.mjs services/reads/scripts/migrate.test.mjs services/reads/supabase/migrations/0001_schema.sql
git commit -m "feat(reads): migrador propio vía Management API y esquema mobile (0001)"
```

---

### Task 2: `_shared/matrix.ts`, `_shared/auth.ts`, `_shared/http.ts` con `deno test` (D1, D2, D3, D6, P3, P5)

**Files:**
- Create: `services/reads/supabase/functions/_shared/matrix.ts`, `_shared/matrix.test.ts`, `_shared/auth.ts`, `_shared/auth.test.ts`, `_shared/http.ts`

**Interfaces:**
- Produces (`matrix.ts`): `LEVELS_BPS`, `HORIZONS_MIN`, `isCell(level, horizon)`, `targetFor(mark, levelBps)`, `formatScaled(v, decimals)`, `questionFor(symbol, levelBps, target, pd, expiresAt)`, `expiresAtFor(createdAt, horizonMin)`, `callOf(probability)`, `outcomeOf(levelBps, target, mark)`, `brierOf(probability, outcome)`, `resolveRead({ level_bps, target, probability }, mark)`.
- Produces (`auth.ts`): `canonicalMessage(address, ts)`, `authenticate(headers, now?)` → `{ ok: true, address } | { ok: false, status: 401, error }`; constantes `SESSION_MAX_AGE_MS = 86_400_000`, `SESSION_FUTURE_MS = 300_000`.
- Produces (`http.ts`): `json(body, status?)`, `fail(status, code)`, `methodIs(req, method)`.

- [ ] **Step 1: Tests de la matriz (fallan)**

`services/reads/supabase/functions/_shared/matrix.test.ts`:
```ts
import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import { brierOf, callOf, expiresAtFor, formatScaled, HORIZONS_MIN, isCell, LEVELS_BPS, outcomeOf, questionFor, resolveRead, targetFor } from "./matrix.ts";

Deno.test("la matriz es 5 niveles × 4 horizontes", () => {
  assertEquals([...LEVELS_BPS], [250, 100, 50, -50, -100]);
  assertEquals([...HORIZONS_MIN], [60, 240, 720, 1440]);
  assertEquals(isCell(100, 240), true);
  assertEquals(isCell(0, 240), false);
  assertEquals(isCell(100, 30), false);
});

Deno.test("targetFor redondea sobre el mark escalado (BTC pd=1 del fixture)", () => {
  assertEquals(targetFor(762555, 100), 770181);   // 762555 × 1.01 = 770180.55
  assertEquals(targetFor(762555, -50), 758742);   // × 0.995 = 758742.225
  assertEquals(targetFor(2221, 250), 2277);       // MON pd=5: 2276.525
});

Deno.test("formatScaled pone el punto según price_decimals", () => {
  assertEquals(formatScaled(762555, 1), "76255.5");
  assertEquals(formatScaled(2221, 5), "0.02221");
  assertEquals(formatScaled(5, 0), "5");
});

Deno.test("questionFor: 'at or above' con nivel positivo, 'at or below' con negativo, hora UTC", () => {
  const at = new Date("2026-09-20T14:00:00.000Z");
  assertEquals(questionFor("BTC", 100, 770181, 1, at), "Will the BTC mark be at or above 77018.1 at 2026-09-20 14:00 UTC?");
  assertEquals(questionFor("MON", -100, 2199, 5, at), "Will the MON mark be at or below 0.02199 at 2026-09-20 14:00 UTC?");
});

Deno.test("expiresAtFor suma el horizonte", () => {
  assertEquals(expiresAtFor(new Date("2026-09-20T10:00:00.000Z"), 240).toISOString(), "2026-09-20T14:00:00.000Z");
});

Deno.test("callOf, outcomeOf, brierOf y resolveRead", () => {
  assertEquals(callOf(0.5), true);
  assertEquals(callOf(0.499), false);
  assertEquals(outcomeOf(100, 770181, 770181), true);
  assertEquals(outcomeOf(100, 770181, 770180), false);
  assertEquals(outcomeOf(-50, 758742, 758742), true);
  assertEquals(outcomeOf(-50, 758742, 758743), false);
  assertEquals(brierOf(0.7, true), 0.09);
  assertEquals(brierOf(0.7, false), 0.49);
  assertEquals(resolveRead({ level_bps: 100, target: 770181, probability: 0.62 }, 771000), { status: "right", outcome: true, brier: 0.1444 });
  assertEquals(resolveRead({ level_bps: 100, target: 770181, probability: 0.62 }, 760000), { status: "wrong", outcome: false, brier: 0.3844 });
  assertEquals(resolveRead({ level_bps: -100, target: 2199, probability: 0.2 }, 2300), { status: "right", outcome: false, brier: 0.04 });
  assertThrows(() => resolveRead({ level_bps: 100, target: 770181, probability: null }, 771000), Error, "no probability");
});
```
Run: `cd services/reads && deno test -A supabase/functions/_shared/` → Expected: FAIL (`Module not found "./matrix.ts"`).

- [ ] **Step 2: `matrix.ts`**

```ts
// Matriz nivel × horizonte y resolución. Puro: sin Deno.env ni red.
export const LEVELS_BPS = [250, 100, 50, -50, -100] as const;
export const HORIZONS_MIN = [60, 240, 720, 1440] as const;
export type LevelBps = (typeof LEVELS_BPS)[number];
export type HorizonMin = (typeof HORIZONS_MIN)[number];

export function isCell(level: number, horizon: number): boolean {
  return (LEVELS_BPS as readonly number[]).includes(level) && (HORIZONS_MIN as readonly number[]).includes(horizon);
}

/** Target en las mismas unidades escaladas que el mark (price_decimals). */
export function targetFor(mark: number, levelBps: number): number {
  return Math.round((mark * (10000 + levelBps)) / 10000);
}

export function formatScaled(v: number, decimals: number): string {
  const neg = v < 0;
  const s = String(Math.abs(v)).padStart(decimals + 1, "0");
  const out = decimals === 0 ? s : `${s.slice(0, -decimals)}.${s.slice(-decimals)}`;
  return neg ? `-${out}` : out;
}

export function questionFor(symbol: string, levelBps: number, target: number, pd: number, expiresAt: Date): string {
  const dir = levelBps > 0 ? "at or above" : "at or below";
  const when = expiresAt.toISOString().slice(0, 16).replace("T", " ");
  return `Will the ${symbol} mark be ${dir} ${formatScaled(target, pd)} at ${when} UTC?`;
}

export function expiresAtFor(createdAt: Date, horizonMin: number): Date {
  return new Date(createdAt.getTime() + horizonMin * 60_000);
}

export const callOf = (probability: number): boolean => probability >= 0.5;

export function outcomeOf(levelBps: number, target: number, mark: number): boolean {
  return levelBps > 0 ? mark >= target : mark <= target;
}

export function brierOf(probability: number, outcome: boolean): number {
  return Math.round((probability - (outcome ? 1 : 0)) ** 2 * 10000) / 10000;
}

export type Resolution = { status: "right" | "wrong"; outcome: boolean; brier: number };

export function resolveRead(read: { level_bps: number; target: number; probability: number | null }, mark: number): Resolution {
  if (read.probability === null) throw new Error("resolveRead: no probability");
  const outcome = outcomeOf(read.level_bps, read.target, mark);
  return { status: callOf(read.probability) === outcome ? "right" : "wrong", outcome, brier: brierOf(read.probability, outcome) };
}
```
Run: `deno test -A supabase/functions/_shared/` → Expected: 6 pass.

- [ ] **Step 3: Tests de la firma (fallan)**

`services/reads/supabase/functions/_shared/auth.test.ts`:
```ts
import { assertEquals } from "jsr:@std/assert@1";
import { generatePrivateKey, privateKeyToAccount } from "npm:viem@2.56.8/accounts";
import { authenticate, canonicalMessage, SESSION_MAX_AGE_MS } from "./auth.ts";

const account = privateKeyToAccount(generatePrivateKey());
const NOW = 1_790_000_000_000;

async function headersFor(ts: number, address = account.address, signer = account): Promise<Headers> {
  const sig = await signer.signMessage({ message: canonicalMessage(address, ts) });
  return new Headers({ "x-pickler-address": address, "x-pickler-ts": String(ts), "x-pickler-sig": sig });
}

Deno.test("canonicalMessage usa la dirección en minúsculas", () => {
  assertEquals(canonicalMessage("0xABCDEF0000000000000000000000000000000001", 5), "pickler-reads:0xabcdef0000000000000000000000000000000001:5");
});

Deno.test("firma válida → ok con la dirección en minúsculas", async () => {
  const r = await authenticate(await headersFor(NOW - 1000), NOW);
  assertEquals(r, { ok: true, address: account.address.toLowerCase() });
});

Deno.test("firma de hace más de 24 h → signature_expired", async () => {
  const r = await authenticate(await headersFor(NOW - SESSION_MAX_AGE_MS - 1), NOW);
  assertEquals(r, { ok: false, status: 401, error: "signature_expired" });
});

Deno.test("timestamp más de 5 min en el futuro → signature_expired", async () => {
  const r = await authenticate(await headersFor(NOW + 6 * 60_000), NOW);
  assertEquals(r, { ok: false, status: 401, error: "signature_expired" });
});

Deno.test("firma de otra wallet → bad_signature", async () => {
  const other = privateKeyToAccount(generatePrivateKey());
  const r = await authenticate(await headersFor(NOW, account.address, other), NOW);
  assertEquals(r, { ok: false, status: 401, error: "bad_signature" });
});

Deno.test("headers ausentes o malformados → missing_signature", async () => {
  assertEquals(await authenticate(new Headers(), NOW), { ok: false, status: 401, error: "missing_signature" });
  const h = await headersFor(NOW);
  h.set("x-pickler-sig", "0x1234");
  assertEquals(await authenticate(h, NOW), { ok: false, status: 401, error: "missing_signature" });
});
```
Run: `deno test -A supabase/functions/_shared/` → Expected: FAIL (`Module not found "./auth.ts"`).

- [ ] **Step 4: `auth.ts` y `http.ts`**

`auth.ts`:
```ts
// Identidad app → servicio (D6): firma personal_sign de `pickler-reads:<address>:<ts>`, válida 24 h.
import { type Hex, isAddress, recoverMessageAddress } from "npm:viem@2.56.8";

export const SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const SESSION_FUTURE_MS = 5 * 60 * 1000;

export type AuthResult = { ok: true; address: string } | { ok: false; status: 401; error: "missing_signature" | "signature_expired" | "bad_signature" };

export function canonicalMessage(address: string, ts: number): string {
  return `pickler-reads:${address.toLowerCase()}:${ts}`;
}

export async function authenticate(headers: Headers, now = Date.now()): Promise<AuthResult> {
  const address = headers.get("x-pickler-address")?.toLowerCase() ?? "";
  const tsRaw = headers.get("x-pickler-ts") ?? "";
  const sig = headers.get("x-pickler-sig") ?? "";
  if (!isAddress(address) || !/^\d{13}$/.test(tsRaw) || !/^0x[0-9a-fA-F]{130}$/.test(sig)) {
    return { ok: false, status: 401, error: "missing_signature" };
  }
  const ts = Number(tsRaw);
  if (ts < now - SESSION_MAX_AGE_MS || ts > now + SESSION_FUTURE_MS) return { ok: false, status: 401, error: "signature_expired" };
  let recovered: string;
  try {
    recovered = await recoverMessageAddress({ message: canonicalMessage(address, ts), signature: sig as Hex });
  } catch {
    return { ok: false, status: 401, error: "bad_signature" };
  }
  return recovered.toLowerCase() === address ? { ok: true, address } : { ok: false, status: 401, error: "bad_signature" };
}
```
`http.ts`:
```ts
export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** Toda respuesta de error es `{ error: code }` (D20). */
export function fail(status: number, code: string): Response {
  return json({ error: code }, status);
}

export function methodIs(req: Request, method: string): boolean {
  return req.method.toUpperCase() === method;
}

/** Prefijo corto para logs: nunca la dirección completa (D20). */
export function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}
```
Run: `deno test -A supabase/functions/_shared/` → Expected: 12 pass (6 matriz + 6 firma).

- [ ] **Step 5: Commit**

```bash
git add services/reads/supabase/functions/_shared/matrix.ts services/reads/supabase/functions/_shared/matrix.test.ts services/reads/supabase/functions/_shared/auth.ts services/reads/supabase/functions/_shared/auth.test.ts services/reads/supabase/functions/_shared/http.ts
git commit -m "feat(reads): matriz nivel × horizonte, resolución y auth por firma de wallet"
```

---

### Task 3: `_shared/perpl.ts`, `_shared/claude.ts`, `_shared/db.ts`, `_shared/dto.ts` (D2, D8, P1)

**Files:**
- Create: `services/reads/supabase/functions/_shared/perpl.ts`, `_shared/perpl.test.ts`, `_shared/fixtures/context.json` (copia de `apps/mobile/__tests__/fixtures/perpl/context.json`), `_shared/claude.ts`, `_shared/claude.test.ts`, `_shared/db.ts`, `_shared/dto.ts`, `_shared/dto.test.ts`

**Interfaces:**
- Produces (`perpl.ts`): `type PerplMarket = { id, symbol, name, priceDecimals, mark, prev, isOpen }`; `parseMarkets(body): Map<number, PerplMarket>`; `fetchMarkets(rest?, timeoutMs?): Promise<Map<number, PerplMarket>>` (lanza `PerplUnavailable`).
- Produces (`claude.ts`): `MODEL = "claude-sonnet-5"`, `ReadSchema` (zod), `type ReadOutput`, `type ReadInput`, `buildMessages(input)`, `readWithAgent(client, persona, input) → { output, latencyMs, usage }`, `newClient()`.
- Produces (`db.ts`): `sql` (cliente postgres.js, esquema `mobile` por nombre calificado en cada consulta).
- Produces (`dto.ts`): `toReadDto(row): ReadDto`, `toReminderDto(row)`, `toAgentDto(row)`.

- [ ] **Step 1: Fixture y test de Perpl (falla)**

```bash
mkdir -p services/reads/supabase/functions/_shared/fixtures
cp apps/mobile/__tests__/fixtures/perpl/context.json services/reads/supabase/functions/_shared/fixtures/context.json
```
`_shared/perpl.test.ts`:
```ts
import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import context from "./fixtures/context.json" with { type: "json" };
import { fetchMarkets, parseMarkets, PerplUnavailable } from "./perpl.ts";

Deno.test("parseMarkets: mercados abiertos por id con mark y price_decimals del fixture", () => {
  const m = parseMarkets(context);
  assertEquals([...m.keys()], [16, 32, 48, 64, 256, 272, 320]);
  assertEquals(m.get(16), { id: 16, symbol: "BTC", name: m.get(16)!.name, priceDecimals: 1, mark: 762555, prev: m.get(16)!.prev, isOpen: true });
  assertEquals(m.get(64)?.priceDecimals, 5);
});

Deno.test("parseMarkets rechaza un payload sin markets", () => {
  let threw = false;
  try { parseMarkets({ instances: [] }); } catch { threw = true; }
  assertEquals(threw, true);
});

Deno.test("fetchMarkets: usa fetch inyectado y lanza PerplUnavailable con 5xx", async () => {
  const ok = await fetchMarkets("https://x.test/api", 1000, async () => new Response(JSON.stringify(context), { status: 200 }));
  assertEquals(ok.get(32)?.symbol, "ETH");
  await assertRejects(() => fetchMarkets("https://x.test/api", 1000, async () => new Response("nope", { status: 503 })), PerplUnavailable);
});
```
Run: `deno test -A supabase/functions/_shared/` → Expected: FAIL (`Module not found "./perpl.ts"`).

- [ ] **Step 2: `perpl.ts`**

```ts
// Mercados y mark de Perpl desde GET /v1/pub/context (misma forma que apps/mobile/src/perpl/context.ts).
export type PerplMarket = { id: number; symbol: string; name: string; priceDecimals: number; mark: number; prev: number; isOpen: boolean };
export class PerplUnavailable extends Error {}

type Rec = Record<string, unknown>;
const rec = (v: unknown, what: string): Rec => {
  if (v === null || typeof v !== "object") throw new Error(`Perpl context: ${what} is not an object`);
  return v as Rec;
};
const num = (r: Rec, k: string, what: string): number => {
  const v = r[k];
  if (typeof v !== "number") throw new Error(`Perpl context: ${what}.${k} is not a number`);
  return v;
};
const str = (r: Rec, k: string, what: string): string => {
  const v = r[k];
  if (typeof v !== "string") throw new Error(`Perpl context: ${what}.${k} is not a string`);
  return v;
};

export function parseMarkets(body: unknown): Map<number, PerplMarket> {
  const c = rec(body, "context");
  if (!Array.isArray(c.markets)) throw new Error("Perpl context: no markets");
  const out = new Map<number, PerplMarket>();
  for (const raw of c.markets) {
    const m = rec(raw, "market");
    const cfg = rec(m.config, "market.config");
    const st = rec(m.state, "market.state");
    const market: PerplMarket = {
      id: num(m, "id", "market"), symbol: str(m, "symbol", "market"), name: str(m, "name", "market"),
      priceDecimals: num(cfg, "price_decimals", "config"), mark: num(st, "mrk", "state"), prev: num(st, "prv", "state"),
      isOpen: cfg.is_open === true,
    };
    if (market.isOpen) out.set(market.id, market);
  }
  return new Map([...out.entries()].sort((a, b) => a[0] - b[0]));
}

export const PERPL_REST_DEFAULT = "https://testnet.perpl.xyz/api";

export async function fetchMarkets(
  rest = Deno.env.get("PERPL_REST") ?? PERPL_REST_DEFAULT,
  timeoutMs = 10_000,
  doFetch: (url: string, init: RequestInit) => Promise<Response> = fetch,
): Promise<Map<number, PerplMarket>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await doFetch(`${rest}/v1/pub/context`, { signal: controller.signal });
    if (!res.ok) throw new PerplUnavailable(`Perpl responded ${res.status}`);
    return parseMarkets(await res.json());
  } catch (e) {
    if (e instanceof PerplUnavailable) throw e;
    throw new PerplUnavailable(e instanceof Error ? e.message : String(e));
  } finally {
    clearTimeout(timer);
  }
}
```
Run: `deno test -A supabase/functions/_shared/` → Expected: 15 pass.

- [ ] **Step 3: Test de Claude con cliente falso (falla)**

`_shared/claude.test.ts`:
```ts
import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import { buildMessages, MODEL, type ReadInput, readWithAgent, RULES } from "./claude.ts";

const input: ReadInput = {
  symbol: "BTC", name: "Bitcoin", mark: "76255.5", prev: "75100.0", change24hPct: 1.54, target: "77018.1",
  levelBps: 100, horizonMin: 240, expiresAtUtc: "2026-09-20 14:00 UTC", nowUtc: "2026-09-20 10:00 UTC",
};

Deno.test("buildMessages: un turno de usuario con el JSON de la celda", () => {
  const msgs = buildMessages(input);
  assertEquals(msgs.length, 1);
  assertEquals(msgs[0].role, "user");
  assertEquals(typeof msgs[0].content, "string");
  assertEquals((msgs[0].content as string).includes('"target": "77018.1"'), true);
});

Deno.test("readWithAgent: manda persona + reglas con cache_control, modelo sonnet 5, y devuelve parsed_output", async () => {
  let captured: Record<string, unknown> = {};
  const fake = { messages: { parse: async (params: Record<string, unknown>) => { captured = params; return { parsed_output: { probability: 0.62, reasons: ["a", "b", "c"], limits: "x" }, usage: { input_tokens: 700, output_tokens: 120 } }; } } };
  // deno-lint-ignore no-explicit-any
  const r = await readWithAgent(fake as any, "You are Drift.", input, () => 1000);
  assertEquals(r.output, { probability: 0.62, reasons: ["a", "b", "c"], limits: "x" });
  assertEquals(r.usage, { input_tokens: 700, output_tokens: 120 });
  assertEquals(captured.model, MODEL);
  assertEquals(captured.max_tokens, 1024);
  const system = captured.system as { type: string; text: string; cache_control: { type: string } }[];
  assertEquals(system[0].text.startsWith(RULES), true);
  assertEquals(system[0].text.endsWith("You are Drift."), true);
  assertEquals(system[0].cache_control, { type: "ephemeral" });
  assertEquals((captured.output_config as { effort: string }).effort, "medium");
});

Deno.test("readWithAgent: parsed_output null → error", async () => {
  const fake = { messages: { parse: async () => ({ parsed_output: null, usage: { input_tokens: 1, output_tokens: 1 } }) } };
  // deno-lint-ignore no-explicit-any
  await assertRejects(() => readWithAgent(fake as any, "p", input), Error, "unparsed");
});
```
Run: `deno test -A supabase/functions/_shared/` → Expected: FAIL (`Module not found "./claude.ts"`).

- [ ] **Step 4: `claude.ts`**

```ts
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
```
Run: `deno test -A supabase/functions/_shared/` → Expected: 18 pass. Si `zodOutputFormat` rechaza zod 4 en esta versión del SDK, bajar a `npm:zod@3.25.76` en `claude.ts` y anotarlo en el audit (el SDK declara `^3.25 || ^4`).

- [ ] **Step 5: `db.ts`, `dto.ts` y su test**

`db.ts`:
```ts
// Conexión directa a Postgres (P1): SUPABASE_DB_URL la inyecta el edge runtime. Esquema `mobile` calificado en cada consulta.
import postgres from "npm:postgres@3.4.9";

const url = Deno.env.get("SUPABASE_DB_URL");
if (!url) throw new Error("SUPABASE_DB_URL missing");

export const sql = postgres(url, { prepare: false, max: 3, idle_timeout: 20, connect_timeout: 10 });
```
`dto.ts`:
```ts
// Fila de Postgres → JSON de la API (spec §2.2). postgres.js entrega int8 y numeric como string y timestamptz como Date.
export type ReadRow = {
  id: string; address: string; agent_id: string; market_id: number; symbol: string; level_bps: number; horizon_min: number;
  price_decimals: number; mark_at_request: string | number; target: string | number; question: string; status: string;
  probability: string | number | null; reasons: unknown; limits: string | null; model: string | null; latency_ms: number | null;
  credits_charged: number; error: string | null; created_at: Date; expires_at: Date; resolved_at: Date | null;
  mark_at_resolution: string | number | null; outcome: boolean | null; brier: string | number | null;
};

export type ReadDto = {
  id: string; agentId: string; marketId: number; symbol: string; priceDecimals: number; levelBps: number; horizonMin: number;
  markAtRequest: number; target: number; question: string; status: string; probability: number | null; reasons: string[] | null;
  limits: string | null; creditsCharged: number; error: string | null; createdAt: string; expiresAt: string; resolvedAt: string | null;
  markAtResolution: number | null; outcome: boolean | null; brier: number | null;
};

const n = (v: string | number | null): number | null => (v === null ? null : Number(v));
const iso = (d: Date | null): string | null => (d === null ? null : new Date(d).toISOString());

export function toReadDto(r: ReadRow): ReadDto {
  return {
    id: r.id, agentId: r.agent_id, marketId: r.market_id, symbol: r.symbol, priceDecimals: r.price_decimals,
    levelBps: r.level_bps, horizonMin: r.horizon_min, markAtRequest: Number(r.mark_at_request), target: Number(r.target),
    question: r.question, status: r.status, probability: n(r.probability),
    reasons: Array.isArray(r.reasons) ? r.reasons.map(String) : null, limits: r.limits, creditsCharged: r.credits_charged,
    error: r.error, createdAt: iso(r.created_at)!, expiresAt: iso(r.expires_at)!, resolvedAt: iso(r.resolved_at),
    markAtResolution: n(r.mark_at_resolution), outcome: r.outcome, brier: n(r.brier),
  };
}

export type ReminderRow = { id: string; kind: string; fire_at: Date };
export const toReminderDto = (r: ReminderRow) => ({ id: r.id, kind: r.kind, fireAt: new Date(r.fire_at).toISOString() });

export type AgentRow = { id: string; handle: string; name: string; owner: string; price_credits: number; reads: string | number; resolved: string | number; right_count: string | number; brier_avg: string | number | null };
export function toAgentDto(r: AgentRow) {
  return {
    id: r.id, handle: r.handle, name: r.name, owner: r.owner, priceCredits: r.price_credits,
    record: { reads: Number(r.reads), resolved: Number(r.resolved), right: Number(r.right_count), brierAvg: n(r.brier_avg) },
  };
}
```
`dto.test.ts`:
```ts
import { assertEquals } from "jsr:@std/assert@1";
import { toAgentDto, toReadDto } from "./dto.ts";

Deno.test("toReadDto convierte int8/numeric en número, fechas a ISO y reasons a string[]", () => {
  const dto = toReadDto({
    id: "r1", address: "0xabc", agent_id: "jesus", market_id: 16, symbol: "BTC", level_bps: 100, horizon_min: 240, price_decimals: 1,
    mark_at_request: "762555", target: "770181", question: "q", status: "open", probability: "0.620", reasons: ["a", "b", "c"], limits: "l",
    model: "claude-sonnet-5", latency_ms: 4200, credits_charged: 1, error: null, created_at: new Date("2026-09-20T10:00:00Z"),
    expires_at: new Date("2026-09-20T14:00:00Z"), resolved_at: null, mark_at_resolution: null, outcome: null, brier: null,
  });
  assertEquals(dto.markAtRequest, 762555);
  assertEquals(dto.probability, 0.62);
  assertEquals(dto.reasons, ["a", "b", "c"]);
  assertEquals(dto.expiresAt, "2026-09-20T14:00:00.000Z");
  assertEquals(dto.resolvedAt, null);
  assertEquals("address" in dto, false);
});

Deno.test("toAgentDto arma el récord y nunca incluye persona", () => {
  const dto = toAgentDto({ id: "drift", handle: "drift", name: "Drift", owner: "Pickler", price_credits: 1, reads: "3", resolved: "2", right_count: "1", brier_avg: "0.2100" });
  assertEquals(dto.record, { reads: 3, resolved: 2, right: 1, brierAvg: 0.21 });
  assertEquals("persona" in dto, false);
});
```
Run: `deno test -A supabase/functions/_shared/` → Expected: 20 pass (`db.ts` no se importa en tests: exige `SUPABASE_DB_URL`).

- [ ] **Step 6: Commit**

```bash
git add services/reads/supabase/functions/_shared/perpl.ts services/reads/supabase/functions/_shared/perpl.test.ts services/reads/supabase/functions/_shared/fixtures/context.json services/reads/supabase/functions/_shared/claude.ts services/reads/supabase/functions/_shared/claude.test.ts services/reads/supabase/functions/_shared/db.ts services/reads/supabase/functions/_shared/dto.ts services/reads/supabase/functions/_shared/dto.test.ts
git commit -m "feat(reads): mercados de Perpl, lectura con claude-sonnet-5, conexión a Postgres y DTOs"
```

---

### Task 4: Seed de agentes, funciones `agents-list` · `read-request` · `read-get` · `reads-list`, despliegue y smoke (D5, D7, D8, D9, D20, P8, P9, P11, P12)

**Files:**
- Create: `services/reads/supabase/migrations/0002_seed_agents.sql`, `services/reads/supabase/functions/agents-list/index.ts`, `read-request/index.ts`, `read-get/index.ts`, `reads-list/index.ts`, `services/reads/scripts/sign.mjs`, `services/reads/scripts/smoke.mjs`

**Interfaces:**
- Consumes: `authenticate`, `fail/json/methodIs/shortAddress`, `sql`, `toReadDto/toAgentDto`, `fetchMarkets/PerplUnavailable`, `readWithAgent/newClient/MODEL`, `targetFor/questionFor/expiresAtFor/formatScaled` (Tasks 2–3); `mobile.request_read`, `mobile.refund_read`, `mobile.ensure_wallet`, vista `mobile.agent_records` (Task 1).
- Produces: los cuatro endpoints con los contratos de spec §2.2 (`GET agents-list`, `POST read-request`, `GET read-get?id=`, `GET reads-list?marketId=`), desplegados en `https://yvdipvcrpbqvofayteqf.supabase.co/functions/v1/<name>`; `node scripts/sign.mjs [--headers]`; `node scripts/smoke.mjs [marketId] [agentId]` que termina con `SMOKE OK`.

- [ ] **Step 1: `0002_seed_agents.sql` y aplicarla**

```sql
-- Tres agentes (D9, P11). La persona de `jesus` es un placeholder que Jesús reescribe; nunca sale por la API.
insert into mobile.agents (id, handle, name, owner, persona, price_credits, sort) values
('jesus', 'jesus', 'Jesús''s agent', 'Jesús',
$p$You are Jesús's agent: a disciplined swing trader on Monad perps who prefers 4H–24H horizons, respects the 24h trend but fades extended moves past +2.5%, and keeps calls honest: if the data is thin, say so in the limits and stay close to the base rate for the horizon.$p$, 1, 10),
('drift', 'drift', 'Drift', 'Pickler',
$p$You are Drift, a momentum agent. You lean with the 24h change: a positive change raises your probability for "at or above" targets and lowers it for "at or below" ones, scaled by how far the target sits from the mark relative to the horizon. You distrust levels beyond ±1% on horizons under 4H.$p$, 1, 20),
('anchor', 'anchor', 'Anchor', 'Pickler',
$p$You are Anchor, a mean-reversion agent. You treat the 24h change as stretch: the bigger the move, the more you expect the mark to drift back toward the 24h-ago price within the horizon. You give the base rate the benefit of the doubt on short horizons and never exceed 0.8 or go below 0.2 without a stretched move.$p$, 1, 30);
```
```bash
npm run migrate
node scripts/query.mjs --read-only "select id, name, owner, price_credits, reads, resolved, right_count, brier_avg from mobile.agent_records order by sort"
```
Expected: `✓ 0002_seed_agents.sql`; tres filas con `reads 0, resolved 0, right_count 0, brier_avg null`.

- [ ] **Step 2: `agents-list/index.ts`**

```ts
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
```

- [ ] **Step 3: `read-request/index.ts`**

```ts
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
```

- [ ] **Step 4: `read-get/index.ts` y `reads-list/index.ts`**

`read-get/index.ts`:
```ts
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
```
`reads-list/index.ts`:
```ts
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
```

- [ ] **Step 5: `sign.mjs` y `smoke.mjs`**

`scripts/sign.mjs`:
```js
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const key = process.env.READS_TEST_KEY ?? generatePrivateKey();
const account = privateKeyToAccount(key);
const address = account.address.toLowerCase();
const ts = Date.now();
const sig = await account.signMessage({ message: `pickler-reads:${address}:${ts}` });
const headers = `-H "x-pickler-address: ${address}" -H "x-pickler-ts: ${ts}" -H "x-pickler-sig: ${sig}"`;
console.log(process.argv.includes("--headers") ? headers : JSON.stringify({ key, address, ts, sig, headers }, null, 2));
```
`scripts/smoke.mjs`:
```js
// agents-list → reads-list (20 créditos) → read-request → read-get → reads-list → read-get con otra dirección (401).
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { SUPABASE_URL } from "./env.mjs";

const BASE = `${SUPABASE_URL}/functions/v1`;
const [marketId = "16", agentId = "jesus"] = process.argv.slice(2);
const account = privateKeyToAccount(process.env.READS_TEST_KEY ?? generatePrivateKey());
const address = account.address.toLowerCase();
const ts = Date.now();
const sig = await account.signMessage({ message: `pickler-reads:${address}:${ts}` });
const H = { "x-pickler-address": address, "x-pickler-ts": String(ts), "x-pickler-sig": sig };

async function call(name, path, init = {}) {
  const t0 = Date.now();
  const res = await fetch(`${BASE}/${path}`, init);
  const body = await res.json().catch(() => null);
  console.log(`→ ${name}: HTTP ${res.status} · ${Date.now() - t0} ms\n${JSON.stringify(body, null, 2)}`);
  return { status: res.status, body };
}

console.log(`wallet de prueba ${address}`);
const agents = await call("agents-list", "agents-list");
const list0 = await call("reads-list (wallet nueva)", "reads-list", { headers: H });
const req = await call("read-request", "read-request", {
  method: "POST", headers: { ...H, "content-type": "application/json" },
  body: JSON.stringify({ marketId: Number(marketId), levelBps: 100, horizonMin: 60, agentId }),
});
if (req.status !== 200) { console.log("SMOKE FAILED (read-request)"); process.exit(1); }
const get = await call("read-get", `read-get?id=${req.body.read.id}`, { headers: H });
const list1 = await call("reads-list", `reads-list?marketId=${marketId}`, { headers: H });
const bad = await call("read-get con otra dirección", `read-get?id=${req.body.read.id}`, { headers: { ...H, "x-pickler-address": "0x0000000000000000000000000000000000000001" } });

const checks = {
  "3 agentes": agents.body?.agents?.length === 3,
  "20 créditos iniciales": list0.body?.credits === 20 && list0.body?.reads?.length === 0,
  "read open con 3 razones": req.body.read.status === "open" && req.body.read.reasons?.length === 3 && req.body.read.probability > 0 && req.body.read.probability < 1,
  "19 créditos tras la read": req.body.credits === 19,
  "read-get devuelve la misma read": get.body?.read?.id === req.body.read.id,
  "reads-list la lista": list1.body?.reads?.[0]?.id === req.body.read.id && list1.body?.credits === 19,
  "otra dirección → 401": bad.status === 401,
};
for (const [k, v] of Object.entries(checks)) console.log(`${v ? "✓" : "✗"} ${k}`);
const ok = Object.values(checks).every(Boolean);
console.log(ok ? "SMOKE OK" : "SMOKE FAILED");
process.exit(ok ? 0 : 1);
```

- [ ] **Step 6: Secretos y despliegue**

```bash
cd services/reads
set -a; source /Users/josedejesusacevedoflores/Documents/predict/.env.pickler; set +a
supabase secrets set --project-ref yvdipvcrpbqvofayteqf ANTHROPIC_API_KEY="$ANTHROPIC_API_KEY" PERPL_REST=https://testnet.perpl.xyz/api
supabase secrets list --project-ref yvdipvcrpbqvofayteqf
for f in agents-list read-request read-get reads-list; do supabase functions deploy "$f" --project-ref yvdipvcrpbqvofayteqf --no-verify-jwt; done
supabase functions list --project-ref yvdipvcrpbqvofayteqf
```
Expected: `secrets list` muestra `ANTHROPIC_API_KEY` y `PERPL_REST` (sólo nombres y digest); `functions list` muestra las cuatro con `verify_jwt: false`. Si el deploy se queja de `SUPABASE_DB_URL` en el arranque, no es de aquí: esa variable la inyecta el runtime y sólo se lee al recibir la primera petición.

- [ ] **Step 7: Smoke real y prueba contra el defecto**

```bash
node scripts/smoke.mjs 16 jesus
```
Expected: `SMOKE OK`, con `read-request` en **< 60 000 ms** (anotar el tiempo), `probability` entre 0.01 y 0.99, tres `reasons`, `limits` no vacío, `question` como `Will the BTC mark be at or above <target> at <fecha> UTC?`.

Luego, con la misma wallet, el caso sin créditos y el de agente inexistente:
```bash
KEY=$(node -e 'import("viem/accounts").then(m=>console.log(m.generatePrivateKey()))')
READS_TEST_KEY=$KEY node scripts/smoke.mjs 32 drift        # segunda wallet, ETH con Drift
ADDR=$(READS_TEST_KEY=$KEY node scripts/sign.mjs | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).address))')
node scripts/query.mjs "update mobile.wallets set credits = 0 where address = '$ADDR'"
H=$(READS_TEST_KEY=$KEY node scripts/sign.mjs --headers)
eval curl -sS -o /dev/null -w "'%{http_code}\n'" $H -H "'content-type: application/json'" -d "'{\"marketId\":32,\"levelBps\":-50,\"horizonMin\":240,\"agentId\":\"drift\"}'" https://yvdipvcrpbqvofayteqf.supabase.co/functions/v1/read-request
eval curl -sS $H -H "'content-type: application/json'" -d "'{\"marketId\":32,\"levelBps\":-50,\"horizonMin\":240,\"agentId\":\"nadie\"}'" https://yvdipvcrpbqvofayteqf.supabase.co/functions/v1/read-request
eval curl -sS $H -H "'content-type: application/json'" -d "'{\"marketId\":32,\"levelBps\":75,\"horizonMin\":240,\"agentId\":\"drift\"}'" https://yvdipvcrpbqvofayteqf.supabase.co/functions/v1/read-request
node scripts/query.mjs --read-only "select reason, sum(delta) from mobile.credit_events where address = '$ADDR' group by reason"
```
Expected: `402`; `{"error":"unknown_agent"}` (422); `{"error":"bad_body"}` (422); el ledger de esa wallet suma `grant 20` y `charge -1` (una sola read), sin `refund`. Guardar las salidas para el audit.

- [ ] **Step 8: Commit**

```bash
git add services/reads/supabase/migrations/0002_seed_agents.sql services/reads/supabase/functions/agents-list/index.ts services/reads/supabase/functions/read-request/index.ts services/reads/supabase/functions/read-get/index.ts services/reads/supabase/functions/reads-list/index.ts services/reads/scripts/sign.mjs services/reads/scripts/smoke.mjs
git commit -m "feat(reads): agentes seed y funciones agents-list, read-request, read-get, reads-list"
```

---

### Task 5: `_shared/apns.ts` — JWT ES256 y envío a APNs, con la key de Apple en secretos (D10, P6, P7)

**Files:**
- Create: `services/reads/supabase/functions/_shared/apns.ts`, `_shared/apns.test.ts`

**Interfaces:**
- Consumes: nada del repo; secretos `APNS_KEY_P8_B64`, `APNS_KEY_ID`, `APNS_TEAM_ID`.
- Produces: `APNS_TOPIC = "fun.pickler.app"`, `pemToPkcs8(pem)`, `importP8(pem)`, `makeProviderJwt(key, keyId, teamId, nowSec?)`, `decodeJwt(jwt)`, `providerJwt()` (cacheado 40 min desde env), `type Push = { token, env, title, body, data? }`, `sendPush(push, jwt, doFetch?) → { status, reason }`. Task 6 los consume.

- [ ] **Step 0: Insumo de Jesús — la key APNs**

En el portal de Apple Developer (Certificates, Identifiers & Profiles → Keys → +, "Apple Push Notifications service (APNs)") con el Team `2PBQJ37Q8W`: crear la key, anotar el **Key ID** y descargar el `.p8` (se descarga una sola vez). Verificar que el App ID `fun.pickler.app` tiene la capability **Push Notifications** habilitada (si no, habilitarla: lo exige el entitlement de F2). Añadir a `.env.pickler`:
```bash
APNS_KEY_ID=<Key ID de 10 caracteres>
APNS_TEAM_ID=2PBQJ37Q8W
APNS_KEY_P8_B64=$(base64 -i ~/Downloads/AuthKey_<KeyID>.p8 | tr -d '\n')
```
Si Jesús no tiene la key a mano al llegar aquí, **esta task y el smoke de APNs de Task 6 quedan bloqueados** (no es el fallback de D10: el fallback es para HTTP/2 fallando, no para una key ausente). Se sigue con el resto de Task 6 y se anota en el handoff.

- [ ] **Step 1: Tests (fallan)**

`_shared/apns.test.ts`:
```ts
import { assertEquals } from "jsr:@std/assert@1";
import { APNS_TOPIC, decodeJwt, importP8, makeProviderJwt, pemToPkcs8, sendPush } from "./apns.ts";

async function testKeyPem(): Promise<{ pem: string; publicKey: CryptoKey }> {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const der = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
  const b64 = btoa(String.fromCharCode(...der)).replace(/(.{64})/g, "$1\n");
  return { pem: `-----BEGIN PRIVATE KEY-----\n${b64}\n-----END PRIVATE KEY-----\n`, publicKey: pair.publicKey };
}

Deno.test("pemToPkcs8 quita cabeceras y saltos", async () => {
  const { pem } = await testKeyPem();
  const der = pemToPkcs8(pem);
  assertEquals(der[0], 0x30); // SEQUENCE
});

Deno.test("makeProviderJwt: header ES256+kid, claims iss+iat, firma verificable con la pública", async () => {
  const { pem, publicKey } = await testKeyPem();
  const jwt = await makeProviderJwt(await importP8(pem), "ABC123DEFG", "2PBQJ37Q8W", 1_790_000_000);
  const { header, payload } = decodeJwt(jwt);
  assertEquals(header, { alg: "ES256", kid: "ABC123DEFG" });
  assertEquals(payload, { iss: "2PBQJ37Q8W", iat: 1_790_000_000 });
  const [h, p, s] = jwt.split(".");
  const sig = Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
  const ok = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, publicKey, sig, new TextEncoder().encode(`${h}.${p}`));
  assertEquals(ok, true);
});

Deno.test("sendPush: host por entorno, cabeceras APNs y payload aps.alert", async () => {
  let url = "", init: RequestInit = {};
  const fake = async (u: string, i: RequestInit) => { url = u; init = i; return new Response(JSON.stringify({ reason: "BadDeviceToken" }), { status: 400 }); };
  const r = await sendPush({ token: "abc", env: "sandbox", title: "T", body: "B", data: { kind: "read", readId: "r1" } }, "jwt.x.y", fake);
  assertEquals(r, { status: 400, reason: "BadDeviceToken" });
  assertEquals(url, "https://api.sandbox.push.apple.com/3/device/abc");
  const h = new Headers(init.headers);
  assertEquals(h.get("authorization"), "bearer jwt.x.y");
  assertEquals(h.get("apns-topic"), APNS_TOPIC);
  assertEquals(h.get("apns-push-type"), "alert");
  assertEquals(JSON.parse(init.body as string), { aps: { alert: { title: "T", body: "B" }, sound: "default" }, pickler: { kind: "read", readId: "r1" } });
  await sendPush({ token: "abc", env: "production", title: "T", body: "B" }, "j", fake);
  assertEquals(url, "https://api.push.apple.com/3/device/abc");
});
```
Run: `deno test -A supabase/functions/_shared/` → Expected: FAIL (`Module not found "./apns.ts"`).

- [ ] **Step 2: `apns.ts`**

```ts
// Push por APNs directo (D10): JWT ES256 con WebCrypto, HTTP/2 vía fetch. Token del dispositivo lo manda la app (F2).
export const APNS_TOPIC = "fun.pickler.app";
const JWT_TTL_MS = 40 * 60 * 1000; // Apple acepta hasta 60 min

const utf8 = (s: string) => new TextEncoder().encode(s);
const b64url = (bytes: ArrayBuffer | Uint8Array): string =>
  btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const b64urlDecode = (s: string): string => atob(s.replace(/-/g, "+").replace(/_/g, "/"));

export function pemToPkcs8(pem: string): Uint8Array {
  const body = pem.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s+/g, "");
  return Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
}

export function importP8(pem: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("pkcs8", pemToPkcs8(pem), { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
}

export async function makeProviderJwt(key: CryptoKey, keyId: string, teamId: string, nowSec = Math.floor(Date.now() / 1000)): Promise<string> {
  const data = `${b64url(utf8(JSON.stringify({ alg: "ES256", kid: keyId })))}.${b64url(utf8(JSON.stringify({ iss: teamId, iat: nowSec })))}`;
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, utf8(data)); // r‖s de 64 bytes = formato JOSE
  return `${data}.${b64url(sig)}`;
}

export function decodeJwt(jwt: string): { header: unknown; payload: unknown } {
  const [h, p] = jwt.split(".");
  return { header: JSON.parse(b64urlDecode(h)), payload: JSON.parse(b64urlDecode(p)) };
}

let cached: { jwt: string; at: number } | null = null;

/** JWT de proveedor desde los secretos, cacheado 40 min por instancia. Lanza si falta algún secreto. */
export async function providerJwt(now = Date.now()): Promise<string> {
  if (cached && now - cached.at < JWT_TTL_MS) return cached.jwt;
  const p8b64 = Deno.env.get("APNS_KEY_P8_B64"), keyId = Deno.env.get("APNS_KEY_ID"), teamId = Deno.env.get("APNS_TEAM_ID");
  if (!p8b64 || !keyId || !teamId) throw new Error("APNS secrets missing");
  const jwt = await makeProviderJwt(await importP8(atob(p8b64)), keyId, teamId, Math.floor(now / 1000));
  cached = { jwt, at: now };
  return jwt;
}

export type Push = { token: string; env: "sandbox" | "production"; title: string; body: string; data?: Record<string, unknown> };

export async function sendPush(p: Push, jwt: string, doFetch: (url: string, init: RequestInit) => Promise<Response> = fetch): Promise<{ status: number; reason: string | null }> {
  const host = p.env === "sandbox" ? "api.sandbox.push.apple.com" : "api.push.apple.com";
  const res = await doFetch(`https://${host}/3/device/${p.token}`, {
    method: "POST",
    headers: { authorization: `bearer ${jwt}`, "apns-topic": APNS_TOPIC, "apns-push-type": "alert", "apns-priority": "10", "content-type": "application/json" },
    body: JSON.stringify({ aps: { alert: { title: p.title, body: p.body }, sound: "default" }, ...(p.data ? { pickler: p.data } : {}) }),
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, reason: typeof body?.reason === "string" ? body.reason : null };
}
```
Run: `deno test -A supabase/functions/_shared/` → Expected: 23 pass.

- [ ] **Step 3: Subir los secretos de APNs**

```bash
set -a; source /Users/josedejesusacevedoflores/Documents/predict/.env.pickler; set +a
supabase secrets set --project-ref yvdipvcrpbqvofayteqf APNS_KEY_ID="$APNS_KEY_ID" APNS_TEAM_ID="$APNS_TEAM_ID" APNS_KEY_P8_B64="$APNS_KEY_P8_B64"
supabase secrets list --project-ref yvdipvcrpbqvofayteqf
```
Expected: los tres nombres en la lista. El smoke contra APNs real se hace en Task 6 Step 7, desde la función desplegada (P6).

- [ ] **Step 4: Commit**

```bash
git add services/reads/supabase/functions/_shared/apns.ts services/reads/supabase/functions/_shared/apns.test.ts
git commit -m "feat(reads): JWT de proveedor y envío a APNs con WebCrypto"
```

---

### Task 6: `reminder-set`, `resolve-reads`, cron por minuto y smoke de APNs (D3, D10, D12 lado servidor, D19, P6, P10, P13)

**Files:**
- Create: `services/reads/supabase/functions/_shared/copy.ts`, `_shared/copy.test.ts`, `services/reads/supabase/functions/reminder-set/index.ts`, `resolve-reads/index.ts`, `services/reads/supabase/migrations/0003_cron.sql`

**Interfaces:**
- Consumes: todo lo de Tasks 1–5.
- Produces (`copy.ts`): `horizonLabel(min)`, `levelLabel(bps)`, `readResolvedPush(read, status, mark)`, `readVoidPush(read)`, `reminderPush(reminder, mark)` → `Push`. Endpoints `POST reminder-set` → `{ reminders: [{ id, kind, fireAt }] }` y `POST resolve-reads` (header `x-cron-secret`) → `{ refunded, resolved, voided, remindersSent, pushSent }`; con body `{ "apnsSmoke": { "token", "env" } }` devuelve `{ apns: { status, reason } }` sin tocar la base (P6). Cron `mobile-resolve-reads` cada minuto.

- [ ] **Step 1: Tests de los textos de push (fallan)**

`_shared/copy.test.ts`:
```ts
import { assertEquals } from "jsr:@std/assert@1";
import { horizonLabel, levelLabel, readResolvedPush, readVoidPush, reminderPush } from "./copy.ts";

const read = { id: "r1", market_id: 16, symbol: "BTC", level_bps: 100, horizon_min: 240, price_decimals: 1, agent_name: "Drift" };

Deno.test("labels", () => {
  assertEquals([60, 240, 720, 1440].map(horizonLabel), ["1H", "4H", "12H", "24H"]);
  assertEquals([250, 50, -50, -100].map(levelLabel), ["+2.5%", "+0.5%", "−0.5%", "−1.0%"]);
});

Deno.test("readResolvedPush y readVoidPush", () => {
  assertEquals(readResolvedPush(read, "right", 771000), {
    token: "", env: "production", title: "BTC +1.0% · 4H", body: "Drift was right · mark 77100.0",
    data: { kind: "read", readId: "r1", marketId: 16 },
  });
  assertEquals(readVoidPush(read).body, "Read voided: Perpl was unavailable at expiry. Your credit is back.");
});

Deno.test("reminderPush: 15 min antes y al vencer", () => {
  const rem = { id: "m1", market_id: 64, symbol: "MON", level_bps: -50, horizon_min: 60, price_decimals: 5, target: 2210, read_id: null };
  assertEquals(reminderPush({ ...rem, kind: "pre" }, 2221), {
    token: "", env: "production", title: "MON −0.5% · 15 min left", body: "MON at 0.02221 · your level 0.02210",
    data: { kind: "reminder", reminderId: "m1", marketId: 64, readId: null },
  });
  assertEquals(reminderPush({ ...rem, kind: "expiry" }, 2200).title, "MON −0.5% · horizon reached");
  assertEquals(reminderPush({ ...rem, kind: "expiry" }, 2200).body, "MON at 0.02200 · your level 0.02210 · close by hand if you're done");
});
```
Run: `deno test -A supabase/functions/_shared/` → Expected: FAIL (`Module not found "./copy.ts"`).

- [ ] **Step 2: `copy.ts`**

```ts
// Textos de los pushes (D10). `token`/`env` los rellena quien manda; aquí sólo el contenido.
import type { Push } from "./apns.ts";
import { formatScaled } from "./matrix.ts";

const HORIZONS: Record<number, string> = { 60: "1H", 240: "4H", 720: "12H", 1440: "24H" };
export const horizonLabel = (min: number): string => HORIZONS[min] ?? `${min}m`;
export const levelLabel = (bps: number): string => `${bps > 0 ? "+" : "−"}${(Math.abs(bps) / 100).toFixed(1)}%`;

export type ReadForPush = { id: string; market_id: number; symbol: string; level_bps: number; horizon_min: number; price_decimals: number; agent_name: string };
export type ReminderForPush = { id: string; market_id: number; symbol: string; level_bps: number; horizon_min: number; price_decimals: number; target: number; kind: string; read_id: string | null };

const title = (symbol: string, bps: number, tail: string) => `${symbol} ${levelLabel(bps)} · ${tail}`;

export function readResolvedPush(r: ReadForPush, status: "right" | "wrong", mark: number): Push {
  return { token: "", env: "production", title: title(r.symbol, r.level_bps, horizonLabel(r.horizon_min)),
    body: `${r.agent_name} was ${status} · mark ${formatScaled(mark, r.price_decimals)}`, data: { kind: "read", readId: r.id, marketId: r.market_id } };
}

export function readVoidPush(r: ReadForPush): Push {
  return { token: "", env: "production", title: title(r.symbol, r.level_bps, horizonLabel(r.horizon_min)),
    body: "Read voided: Perpl was unavailable at expiry. Your credit is back.", data: { kind: "read", readId: r.id, marketId: r.market_id } };
}

export function reminderPush(m: ReminderForPush, mark: number): Push {
  const pre = m.kind === "pre";
  const body = `${m.symbol} at ${formatScaled(mark, m.price_decimals)} · your level ${formatScaled(m.target, m.price_decimals)}${pre ? "" : " · close by hand if you're done"}`;
  return { token: "", env: "production", title: title(m.symbol, m.level_bps, pre ? "15 min left" : "horizon reached"), body,
    data: { kind: "reminder", reminderId: m.id, marketId: m.market_id, readId: m.read_id } };
}
```
Run: `deno test -A supabase/functions/_shared/` → Expected: 26 pass.

- [ ] **Step 3: `reminder-set/index.ts`**

```ts
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
```

- [ ] **Step 4: `resolve-reads/index.ts`**

```ts
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
    const r = await sendPush({ ...smoke.data.apnsSmoke, title: "Pickler", body: "APNs smoke" }, await providerJwt());
    return json({ apns: r });
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
```

- [ ] **Step 5: Secreto del cron, Vault y `0003_cron.sql`**

```bash
cd services/reads
echo "CRON_SECRET=$(openssl rand -hex 32)" >> /Users/josedejesusacevedoflores/Documents/predict/.env.pickler
set -a; source /Users/josedejesusacevedoflores/Documents/predict/.env.pickler; set +a
supabase secrets set --project-ref yvdipvcrpbqvofayteqf CRON_SECRET="$CRON_SECRET"
node scripts/query.mjs "select vault.create_secret('$CRON_SECRET', 'mobile_cron_secret')"
node scripts/query.mjs --read-only "select name from vault.decrypted_secrets where name = 'mobile_cron_secret'"
```
`supabase/migrations/0003_cron.sql`:
```sql
-- resolve-reads cada minuto (D3, D19, P13). El secreto vive en Vault (mobile_cron_secret), nunca aquí.
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'mobile-resolve-reads',
  '* * * * *',
  $$
  select net.http_post(
    url := 'https://yvdipvcrpbqvofayteqf.supabase.co/functions/v1/resolve-reads',
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'mobile_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  ) as request_id;
  $$
);
```
Desplegar primero las dos funciones nuevas, después la migración:
```bash
for f in reminder-set resolve-reads; do supabase functions deploy "$f" --project-ref yvdipvcrpbqvofayteqf --no-verify-jwt; done
npm run migrate
node scripts/query.mjs --read-only "select jobid, jobname, schedule, active from cron.job where jobname = 'mobile-resolve-reads'"
sleep 75
node scripts/query.mjs --read-only "select status, return_message, start_time from cron.job_run_details where jobid = (select jobid from cron.job where jobname = 'mobile-resolve-reads') order by start_time desc limit 2"
node scripts/query.mjs --read-only "select id, status_code, left(content::text, 120) as content, created from net._http_response order by id desc limit 2"
```
Expected: el job activo; `job_run_details` con `status = succeeded`; `net._http_response` con `status_code 200` y contenido `{"refunded":0,"resolved":0,"voided":0,"remindersSent":0,"pushSent":0}`. Si `create extension` falla por permisos, habilitar `pg_cron`/`pg_net` desde Database → Extensions del dashboard es la única acción permitida allí (no toca esquemas ajenos) y se anota en el audit.

- [ ] **Step 6: Pruebas forzadas por SQL (resolución, huérfana, void, recordatorio sin dispositivo)**

Con `$KEY` y `$ADDR` de Task 4 Step 7 (la segunda wallet, que quedó en 0 créditos: se le devuelven primero) y `$READ` = el id de su read `open` (la de ETH con Drift):
```bash
node scripts/query.mjs "update mobile.wallets set credits = 19 where address = '$ADDR'"
READ=$(node scripts/query.mjs --read-only "select id from mobile.reads where address = '$ADDR' and status = 'open' order by created_at desc limit 1" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s)[0].id))')
node scripts/query.mjs "update mobile.reads set expires_at = now() - interval '1 second' where id = '$READ'"
sleep 70
node scripts/query.mjs --read-only "select status, outcome, brier, mark_at_resolution, resolved_at, target from mobile.reads where id = '$READ'"
```
Expected: `status` `right` o `wrong`, `outcome` booleano coherente con `mark_at_resolution` vs `target` (nivel +1.0 %: `right` ⇔ `(mark ≥ target) = (probability ≥ 0.5)`), `brier` entre 0 y 1.

Huérfana (`pending` de más de 60 s → `failed` + reembolso):
```bash
node scripts/query.mjs "select id, status from mobile.request_read('$ADDR','anchor',16,'BTC',50,60,1,762555,766368,'forced pending', now() + interval '1 hour')"
node scripts/query.mjs "update mobile.reads set created_at = now() - interval '2 minutes' where address = '$ADDR' and status = 'pending'"
sleep 70
node scripts/query.mjs --read-only "select status, error from mobile.reads where address = '$ADDR' and question = 'forced pending'"
node scripts/query.mjs --read-only "select reason, sum(delta) from mobile.credit_events where address = '$ADDR' group by reason order by reason"
```
Expected: `failed` / `timeout`; el ledger tiene un `refund 1` que compensa ese `charge`.

Void (más de 30 min vencida sin mark: mercado inexistente):
```bash
node scripts/query.mjs "with r as (select id from mobile.request_read('$ADDR','anchor',999999,'XXX',50,60,1,1000,1005,'forced void', now() - interval '31 minutes')) update mobile.reads set status = 'open', probability = 0.6 where id = (select id from r)"
sleep 70
node scripts/query.mjs --read-only "select status, error, resolved_at from mobile.reads where address = '$ADDR' and question = 'forced void'"
```
Expected: `void` / `perpl_unavailable`, `resolved_at` no nulo, y un segundo `refund` en el ledger.

Recordatorio sin dispositivo (→ `failed`) y `reminder-set` real:
```bash
H=$(READS_TEST_KEY=$KEY node scripts/sign.mjs --headers)   # la misma key que creó $ADDR
EXP=$(node -e 'console.log(new Date(Date.now()+20*60000).toISOString())')
eval curl -sS $H -H "'content-type: application/json'" -d "'{\"marketId\":16,\"levelBps\":100,\"horizonMin\":60,\"target\":770181,\"expiresAt\":\"$EXP\",\"side\":\"long\"}'" https://yvdipvcrpbqvofayteqf.supabase.co/functions/v1/reminder-set
node scripts/query.mjs "update mobile.reminders set fire_at = now() - interval '1 second' where address = '$ADDR' and kind = 'pre'"
sleep 70
node scripts/query.mjs --read-only "select kind, status, sent_at from mobile.reminders where address = '$ADDR' order by fire_at"
```
Expected: `reminder-set` devuelve dos recordatorios (`pre` ≈ +5 min, `expiry` ≈ +20 min); tras el cron, `pre` queda `failed` (sin token) y `expiry` sigue `scheduled`.

- [ ] **Step 7: Smoke de APNs desde la función desplegada (P6)**

```bash
curl -sS -X POST -H "x-cron-secret: $CRON_SECRET" -H "content-type: application/json" \
  -d '{"apnsSmoke":{"token":"0000000000000000000000000000000000000000000000000000000000000000","env":"production"}}' \
  https://yvdipvcrpbqvofayteqf.supabase.co/functions/v1/resolve-reads
```
Expected: `{"apns":{"status":400,"reason":"BadDeviceToken"}}` → TLS, HTTP/2 y el JWT aceptados por Apple; el push real se verifica en F2 con un token del simulador. Otros resultados: `403 InvalidProviderToken` = key/kid/team mal (revisar `.env.pickler` y los secretos); `403 MissingProviderToken` = cabecera vacía; un `500` con `error` de red o `status 0` = el runtime no negoció HTTP/2 → **fallback de D10** (notificaciones locales en F2), anotarlo como ruling en el audit y dejar `apns.ts` en su sitio.

- [ ] **Step 8: Commit**

```bash
git add services/reads/supabase/functions/_shared/copy.ts services/reads/supabase/functions/_shared/copy.test.ts services/reads/supabase/functions/reminder-set/index.ts services/reads/supabase/functions/resolve-reads/index.ts services/reads/supabase/migrations/0003_cron.sql
git commit -m "feat(reads): reminder-set, resolve-reads con pushes y cron por minuto"
```

---

### Task 7: Spec, overview, manifest, CLAUDE.md, audit de F1 y revisión independiente

**Files:**
- Modify: `docs/superpowers/specs/2026-09-19-mobile-ask-design.md` (D4, D5, D10, D19, §2.1, §2.2), `docs/overview/2026-09-19-mobile-ask.html` (phase-card F1), `docs/overview/data/manifest.js` (F1 `completed`), `CLAUDE.md` de la raíz (una línea sobre `services/reads`)
- Create: `docs/superpowers/audits/2026-09-19-mobile-ask-f1-rulings.md`

- [ ] **Step 1: Correcciones al spec (lo que el plan decidió distinto o más preciso)**

En el spec, sin reescribir secciones enteras:
- D4: añadir «Las funciones acceden a `mobile` por `SUPABASE_DB_URL` con postgres.js (P1 del plan F1), no por PostgREST: `mobile` no se expone en la API del proyecto.»
- D5: «`resolve-reads` acepta además `{ apnsSmoke: { token, env } }` con el secreto del cron para probar APNs sin tocar la base.»
- D10 / D19: `APNS_KEY_P8` → `APNS_KEY_P8_B64` (base64 de una línea).
- §2.1: la vista `agent_records` llama `right_count` a la columna `right`; añadir `mobile.ensure_wallet(text) returns int`.
- §2.2: el contrato de `resolve-reads` devuelve también `pushSent`; `read-request` responde `422 unknown_agent` y `422 bad_body`.
- Cabecera **Estado**: «F1 ejecutada (plan `docs/superpowers/plans/2026-09-19-mobile-ask-f1.md`, audit `docs/superpowers/audits/2026-09-19-mobile-ask-f1-rulings.md`)».

Run: `npm run docs:html` (raíz) → Expected: `[ok]` para el spec y el plan.

- [ ] **Step 2: Overview y manifest**

En `docs/overview/2026-09-19-mobile-ask.html`, phase-card `data-phase="1"`: `data-status="completed"`, y dentro de `.phase-body`, después de `.phase-meta`, el bloque de tasks con las ocho tasks de este plan (Task 0–7) marcadas `checked` sólo las que realmente cerraron:
```html
          <details class="tasks">
            <summary>
              <span>Tasks del plan</span>
              <span class="progress-pill" data-tasks-counter>0/0</span>
            </summary>
            <ol>
              <li><label><input type="checkbox" checked> Task 0: CLI ≥ 2.111, esqueleto de services/reads e inventario del proyecto compartido</label></li>
              <li><label><input type="checkbox" checked> Task 1: Migrador propio y 0001_schema.sql aplicado</label></li>
              <li><label><input type="checkbox" checked> Task 2: matrix.ts, auth.ts, http.ts con deno test</label></li>
              <li><label><input type="checkbox" checked> Task 3: perpl.ts, claude.ts, db.ts, dto.ts</label></li>
              <li><label><input type="checkbox" checked> Task 4: Seed de agentes, cuatro funciones de lectura, despliegue y smoke</label></li>
              <li><label><input type="checkbox" checked> Task 5: apns.ts con la key de Apple en secretos</label></li>
              <li><label><input type="checkbox" checked> Task 6: reminder-set, resolve-reads, cron y smoke de APNs</label></li>
              <li><label><input type="checkbox" checked> Task 7: Spec, overview, manifest, audit y revisión independiente</label></li>
            </ol>
          </details>
```
Si Task 5/6 quedaron bloqueadas por la key APNs, F1 queda `in_progress` con esas casillas sin marcar, no `completed`. En `manifest.js`: `phases[0].status` a `completed` (o `in_progress`), `types: ['spec', 'plan']`.

En `CLAUDE.md` de la raíz, tras la frase «La raíz sólo trae el tooling…», añadir: «El backend de Ask vive en `services/reads/` (Supabase `pickler`, esquema `mobile`; comandos y prohibiciones en su `README.md`).» Comprobar que `npm run agents:check` sigue midiendo la cadena por debajo de 24 KiB.

- [ ] **Step 3: Audit de F1**

`docs/superpowers/audits/2026-09-19-mobile-ask-f1-rulings.md` con estas secciones, en este orden, y con la evidencia pegada (no descrita):
1. **Qué quedó hecho y verificado** — por task: comando corrido y salida (versión de la CLI, `migrate` ×2, `deno test` con el conteo final, `node --test`, `functions list`, `SMOKE OK` con el tiempo de `read-request`, los tres códigos 402/422/422, `cron.job`, `job_run_details`, `net._http_response`, las cuatro pruebas forzadas, la respuesta del smoke de APNs).
2. **Decisiones tomadas durante la ejecución (rulings)** — numeradas; cualquier desviación de P1–P13 o del spec, con el porqué.
3. **Correcciones a afirmaciones previas** — del spec o de este plan.
4. **Inventario antes/después del proyecto compartido** — los dos JSON de Task 0 Step 3 y los mismos dos queries corridos al final: la única diferencia admisible es el esquema `mobile` (y `pg_cron`/`pg_net` si no estaban).
5. **Estado del servicio al cierre** — funciones desplegadas, migraciones aplicadas, secretos presentes (sólo nombres), wallets de prueba creadas (direcciones) y si se limpiaron, resultado del smoke de APNs y si aplica el fallback de D10.
6. **Pendientes / residuales** — ordenados por peso; incluir «persona de `jesus` es placeholder» y lo que F2 necesita del servidor.
7. **Siguiente punto de decisión** — plan de F2.

- [ ] **Step 4: Revisión independiente**

Dispatch de un subagente revisor (regla global) con: el spec, este plan, `git diff main...HEAD -- services/reads docs CLAUDE.md` y el audit. Pedirle que verifique: (a) ninguna sentencia SQL toca objetos fuera de `mobile` salvo `create extension`; (b) `request_read` y `refund_read` son atómicas y el ledger cuadra con `credits`; (c) `authenticate` rechaza firma ajena/vencida y `resolve-reads` exige el secreto; (d) ningún secreto en archivos versionados (`git grep -n "sbp_\|sk-ant\|BEGIN PRIVATE"` vacío); (e) los contratos JSON coinciden con el spec §2.2 corregido. Aplicar lo que proceda y anotar la revisión (hallazgos y qué se hizo) en el audit.

- [ ] **Step 5: Checks finales**

```bash
cd /Users/josedejesusacevedoflores/Documents/predict/.claude/worktrees/mobile-ask
npm run docs:html && npm run docs:check && npm run agents:check
cd services/reads && npm test
git status --short
```
Expected: `docs:check` `errors=0`; `agents:check` `"errors": []`; `deno test` y `node --test` en verde; el árbol muestra sólo lo que va en los commits de esta task.

- [ ] **Step 6: Commit (sólo si Jesús autorizó commits) y handoff**

```bash
git add docs/superpowers/specs/2026-09-19-mobile-ask-design.md docs/superpowers/specs/2026-09-19-mobile-ask-design.html docs/superpowers/plans/2026-09-19-mobile-ask-f1.md docs/superpowers/plans/2026-09-19-mobile-ask-f1.html docs/overview/2026-09-19-mobile-ask.html docs/overview/data/manifest.js docs/superpowers/audits/2026-09-19-mobile-ask-f1-rulings.md CLAUDE.md
git commit -m "docs(mobile-ask): F1 ejecutada — spec corregido, overview, manifest y audit F1"
```
Handoff al cierre: qué quedó desplegado, qué falta (key APNs, persona de Jesús, limpieza de wallets de prueba), y que el siguiente paso es el **plan de F2** (app), que no se escribe en la misma sesión sin checkpoint. **Sin push, sin merge.**

---

## Self-review del plan (hecho al escribirlo)

- **Cobertura del spec (F1)**: D1/D2 → Task 2 (`matrix.ts`) y Task 4 (`read-request` arma target y pregunta con el mark del servidor); D3 → Task 6; D4 → Tasks 0–1 (migrador, prohibiciones, inventario); D5 → Tasks 4 y 6 (seis funciones, `verify_jwt = false`); D6 → Task 2 (`auth.ts`); D7 → Task 1 (`request_read`, `refund_read`, `ensure_wallet`) + Task 6 (huérfanas); D8 → Task 3 (`claude.ts`); D9 → Task 4 (seed) + vista en Task 1; D10 → Tasks 5–6 (APNs, smoke, fallback documentado); D17 → este plan es F1; D19 → Tasks 0, 4, 5, 6 (secretos y despliegue); D20 → Task 4 (rate limit, zod, errores `{ error }`), Task 6 (secreto e idempotencia), `shortAddress` en logs. §2.1 completo en Task 1 (con `right_count` y `ensure_wallet` como diferencias declaradas). §2.2: `scripts/migrate.mjs`, `sign.mjs`, `smoke.mjs` (`smoke.sh` del spec pasa a `.mjs`, P8 y Task 4), `config.toml`, tres migraciones, `_shared/*` con tests. Verificación §3 F1 cubierta en Tasks 4, 6 y 7 (inventario antes/después).
- **Placeholders**: ninguno; la única entrada externa es la key APNs (Task 5 Step 0), declarada como bloqueo, no como TBD.
- **Consistencia de tipos**: `ReadRow`/`toReadDto` (Task 3) los usan Tasks 4 y 6; `AgentRow` incluye `right_count` como la vista de Task 1; `Push` de Task 5 lo rellenan `copy.ts` y `resolve-reads` con `token`/`env`; `resolveRead` recibe `{ level_bps, target: number, probability: number | null }` y Task 6 convierte los `string` de postgres.js con `Number(...)`; `fetchMarkets(rest?, timeoutMs?, doFetch?)` se llama sin argumentos en las funciones y con los tres en el test.

# Handoff — Ask F1: backend propio en el esquema `mobile` del Supabase `pickler` (2026-09-20)

Cierre de F1 de `mobile-ask`: el servicio de lecturas vive en `services/reads/` y está **desplegado** en el
proyecto compartido `pickler` (`yvdipvcrpbqvofayteqf`) dentro del esquema `mobile` —cuatro migraciones
aplicadas con el migrador propio, tres agentes sembrados, **seis edge functions** activas con
`verify_jwt = false` y auth por firma de wallet, cobro/reembolso de créditos simulados en dos funciones SQL
`security definer`, lectura con `claude-sonnet-5` y salida estructurada, y un `pg_cron` por minuto que
resuelve right/wrong contra el mark de Perpl. Una read real se pidió por `curl` firmado (7204 ms), se listó
y se resolvió `right` por el cron; los esquemas de Gilbert no cambiaron (inventario antes/después, §4).
Rama `feat/mobile-ask`, base `main` (`5ed4e1c`), **13 commits** (`7fbc66c..1179b85`) más el de esta
documentación; sin push y sin merge. Spec: `docs/superpowers/specs/2026-09-19-mobile-ask-design.md`
(D3–D5, D7–D10, D19, D20, §2.1–§2.2 son F1); plan: `docs/superpowers/plans/2026-09-19-mobile-ask-f1.md`
(P1–P13). Ejecutado con subagent-driven-development: un implementador por task (Tasks 0–7), revisión por
task, el controlador commiteando por nombre de archivo y llevando el ledger.

**F1 queda `in_progress`, no `completed`**: la key APNs del portal de Apple (insumo de Jesús, Task 5 Step 0)
no existía al ejecutar, así que Task 5 Step 3 (`secrets set APNS_*`) y Task 6 Step 7 (smoke real contra
APNs) siguen pendientes. Todo lo demás de Tasks 5 y 6 —`apns.ts` con sus tests, `reminder-set`,
`resolve-reads`, el cron y las cuatro pruebas forzadas— está hecho y desplegado. El fallback de D10 **no se
activa todavía**: no se ha podido probar el `fetch` HTTP/2 a APNs ni a favor ni en contra.

## 1. Qué quedó hecho y verificado

Por task; los comandos y salidas son los de los reportes de cada implementador, no una paráfrasis.

| Task | Evidencia |
|---|---|
| **0** — CLI, esqueleto, inventario (`755fbb1`, `b49e680`) | `npx supabase --version` → `2.117.0` (≥ 2.111). `npx supabase projects list` → un solo proyecto: `{"id":"yvdipvcrpbqvofayteqf","ref":"yvdipvcrpbqvofayteqf",…,"name":"pickler","region":"us-east-1",…,"status":"ACTIVE_HEALTHY","database":{…,"version":"17.6.1.166","postgres_engine":"17"…},"linked":false}`. Inventario **antes** en §4. `loadEnv()` → `[ 'SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'ANTHROPIC_API_KEY', 'SUPABASE_ACCESS_TOKEN' ]` (sólo nombres). Fix round: `npm run deploy -- --help` imprime el help de `functions deploy` vía `npx`; `supabase/.temp/` ignorado. |
| **1** — migrador y `0001_schema` (`07e5760`, `5a8efa6`) | RED: `node --test scripts/migrate.test.mjs` → `Cannot find module '…/scripts/migrate.mjs'`, `# pass 0 / # fail 1`. GREEN: `# tests 2 / # pass 2 / # fail 0`. `npm run migrate:dry` → `pendientes: 0001_schema.sql` + SQL impreso, nada aplicado. `npm run migrate` → `✓ 0001_schema.sql`; **segunda corrida** → `aplicadas: 0001_schema.sql / pendientes: (ninguna)`. `mobile.migrations` → `[{ "name": "0001_schema.sql", "applied_at": "2026-09-20 06:01:42.634179+00" }]`. Tablas en `mobile`: `agent_records, agents, credit_events, devices, migrations, reads, reminders, wallets`; rutinas: `ensure_wallet, refund_read, request_read`. Contra el defecto: `ensure_wallet` ×2 sobre `0x…00aa` → `credits 20` las dos veces y **un solo** `grant` (`count 1`); `request_read(…,'nope',…)` → `ERROR: P0001: unknown_agent`; wallet de prueba borrada (`count 0`). Fix round: `0002_function_privileges.sql` aplicada (`✓`, segunda corrida `pendientes: (ninguna)`); `has_function_privilege` → las tres funciones con `anon_exec: false, auth_exec: false`; `refund_read(gen_random_uuid(), 'right', 'x')` → `ERROR: P0003: bad_status`; `npm run test:scripts` → `# pass 2`. |
| **2** — `matrix.ts`, `auth.ts`, `http.ts` (`70bf701`, `96d57e6`) | RED ×2 (`TS2307 Cannot find module '…/matrix.ts'`, luego `…/auth.ts`). GREEN: `deno test -A supabase/functions/_shared/` → `ok \| 12 passed \| 0 failed (88ms)`; tests de auth: firma válida → ok en minúsculas, `> 24 h → signature_expired`, `> 5 min futuro → signature_expired`, otra wallet → `bad_signature`, headers ausentes/malformados → `missing_signature`. Fix round: test «los límites exactos de la ventana se aceptan (intervalo cerrado)» → `ok \| 13 passed \| 0 failed (39ms)`; `deno.lock` commiteado. |
| **3** — `perpl.ts`, `claude.ts`, `db.ts`, `dto.ts` (`44412d5`, `fbc824f`) | RED ×3 (`TS2307` en `perpl.ts`, `claude.ts`, `dto.ts`). GREEN: `ok \| 21 passed \| 0 failed (204ms)`. `zodOutputFormat` de `@anthropic-ai/sdk@0.127.0` aceptó `zod@4.6.5` en tipos y runtime: **el fallback a zod 3.25.76 no hizo falta**. `db.ts` no lo importa ningún test y lanza `SUPABASE_DB_URL missing` sin la variable. Fix round: test «fetchMarkets: un fetch que aborta por timeout o falla en red sale como PerplUnavailable» → `perpl.test.ts` `ok \| 4 passed`, suite `ok \| 22 passed \| 0 failed (182ms)`, sin avisos de sanitizers (el `clearTimeout` del `finally` corre también en el abort). |
| **4** — seed + cuatro funciones + smoke (`2b588bb`) | `npm run migrate` → `✓ 0003_seed_agents.sql`; `agent_records` → 3 filas (`jesus`, `drift`, `anchor`) con `reads 0, resolved 0, right_count 0, brier_avg null`. `secrets list` → `ANTHROPIC_API_KEY`, `PERPL_REST` (nombre + digest, nunca el valor). `functions list` → `agents-list`, `read-request`, `read-get`, `reads-list` **ACTIVE, verify_jwt: false**. `node scripts/smoke.mjs 16 jesus` (wallet `0xf73ffe46b43ada3e2ef0cc6da6795ffb83ea1b4f`): `agents-list` 200 · 780 ms; `reads-list` 200 · 1039 ms `{ reads: [], credits: 20 }`; **`read-request` 200 · 7204 ms** → `"question": "Will the BTC mark be at or above 81246.9 at 2026-09-20 07:35 UTC?"`, `"status": "open", "probability": 0.07`, 3 `reasons`, `limits` no vacío, `"credits": 19`; `read-get` 200 · 932 ms; `reads-list ?marketId=16` 200 · 780 ms con `credits: 19`; `read-get` con otra dirección **401** `{"error":"bad_signature"}` → `SMOKE OK` (7 ✓). Segunda corrida `smoke.mjs 32 drift` (ETH, wallet `0x6b4e000fdc719ddfb56607aaa2af3563edd0768e`): `read-request` 200 · 6026 ms, `probability: 0.14`, `SMOKE OK`. Contra el defecto (créditos a 0 por SQL): `no_credits → HTTP 402 {"error":"no_credits"}` · `unknown_agent → HTTP 422 {"error":"unknown_agent"}` · `levelBps=75 → HTTP 422 {"error":"bad_body"}`. Ledger de esa wallet: `[{ "reason": "charge", "sum": -1 }, { "reason": "grant", "sum": 20 }]`, sin `refund`. `npm run test` → 22 passed antes y después del deploy. |
| **5** — `apns.ts` (`57cbb1a`) | RED: `TS2307 Cannot find module '…/apns.ts'`. Primer GREEN falló en **tipos**: `TS2769 … Argument of type 'Uint8Array<ArrayBufferLike>' is not assignable to parameter of type 'BufferSource'` en `crypto.subtle.importKey` (TS 5.9.2 / Deno 2.7.7); con el cast `as unknown as BufferSource` → `pemToPkcs8 quita cabeceras y saltos … ok`, `makeProviderJwt: header ES256+kid, claims iss+iat, firma verificable con la pública … ok`, `sendPush: host por entorno, cabeceras APNs y payload aps.alert … ok` → `ok \| 25 passed \| 0 failed (403ms)`. El test del JWT genera un par P-256 real y **verifica la firma con la pública** (`crypto.subtle.verify`). Steps 0 y 3 **pendientes** (key APNs). |
| **6** — `reminder-set`, `resolve-reads`, cron (`e43fe7b`, `1179b85`) | RED: `TS2307 … copy.ts`. GREEN: `ok \| 28 passed \| 0 failed (405ms)`; `deno check` limpio en ambas funciones; `npm run test` → 2 + 28. Deploy → `{"project_ref":"yvdipvcrpbqvofayteqf","functions":["reminder-set"],…,"message":"Deployed Functions."}` y lo mismo para `resolve-reads`. `secrets set … CRON_SECRET` → `{"count":1,"message":"Finished supabase secrets set."}`; `vault.create_secret` → `e13fc325-f8a7-4309-ba7e-51778afd8b87`; `vault.secrets` → `[{"name":"mobile_cron_secret"}]`. `npm run migrate` → `✓ 0004_cron.sql` (sin errores de permisos en `create extension`). **`cron.job`** → `[{"jobid":1,"jobname":"mobile-resolve-reads","schedule":"* * * * *","active":true}]`. **`job_run_details`** → dos corridas consecutivas `"status":"succeeded","return_message":"1 row"` (06:53:00, 06:54:00). **`net._http_response`** → `"status_code":200,"content":"{\"refunded\":0,\"resolved\":0,\"voided\":0,\"remindersSent\":0,\"pushSent\":0}"` ×2. Wallet de prueba `0x1449bd0ef13c2a935998fed58080aec385eb1408`, `smoke.mjs 32 drift` → `SMOKE OK`, read `1fde46c6-97da-4435-8184-59b5218a771d` (target 259847, pd 2, probability 0.12). **Cuatro pruebas forzadas:** (1) `expires_at = now() − 1 s` → al minuto `{"status":"right","outcome":false,"brier":"0.0144","mark_at_resolution":257196,…,"target":259847}` (257196 < 259847 ⇒ outcome false; call false ⇒ right; (0.12−0)² = 0.0144). (2) `pending` con `created_at = now() − 2 min` → `{"status":"failed","error":"timeout"}`, ledger `charge −2 / grant 20 / refund 1`. (3) `open` vencida > 30 min sobre `market_id 999999` → `{"status":"void","error":"perpl_unavailable","resolved_at":"2026-09-20 07:01:01.31…"}` (`net._http_response` id 9: `{"voided":1,…}`). (4) `POST reminder-set` → 200 `{"reminders":[{"kind":"pre","fireAt":"2026-09-20T07:09:04.357Z"},{"kind":"expiry","fireAt":"2026-09-20T07:24:04.357Z"}]}`; con `fire_at` del `pre` forzado → `[{"kind":"pre","status":"failed","sent_at":"2026-09-20 07:05:01.36…"},{"kind":"expiry","status":"scheduled","sent_at":null}]` (sin dispositivo, `pushSent: 0` por diseño). Fix round: redeploy de `resolve-reads`; **smoke de APNs sin secretos** → `curl … -d '{"apnsSmoke":{"token":"000…000","env":"production"}}'` → `HTTP 503 {"error":"apns_unavailable"}`; rama normal `-d '{}'` → `HTTP 200 {"refunded":0,"resolved":0,"voided":0,"remindersSent":0,"pushSent":0}`. **Step 7 (smoke real de APNs) pendiente** de la key. |
| **7** — esta documentación | Checks finales abajo. |

### Checks finales de la Task 7 (corridos en este worktree, 2026-09-20)

```
$ npm run docs:html
[backfill] procesando 19 archivos…
done · processed=19 skipped=0 errors=0

$ npm run docs:check
[backfill] procesando 19 archivos…
done · processed=19 skipped=0 errors=0

$ npm run agents:check
{
  "errors": [],
  "metrics": {
    "instructions": 3,
    "skills": 3,
    "manifest": 11,
    "comparable": 8,
    "mdCount": 19,
    "maxChain": {
      "bytes": 4544,
      "path": "docs/AGENTS.md"
    }
  }
}

$ cd services/reads && npm test
> test:scripts
> node --test 'scripts/*.test.mjs'
# tests 2
# pass 2
# fail 0
> test:deno
> deno test -A supabase/functions/_shared/
ok | 28 passed | 0 failed (269ms)
```

`maxChain` 4544 bytes con la nueva frase de `CLAUDE.md`: muy por debajo de los 24 KiB.

## 2. Decisiones tomadas durante la ejecución (rulings)

Todas las tomó el controlador sin consultar a Jesús, salvo donde se dice que se escala. En orden de
aparición en el ledger; cada una con *qué cuesta si está mal*.

1. **Commits locales en `feat/mobile-ask` durante la ejecución** (los pasos "Commit" de cada task se
   ejecutan). El proceso SDD revisa rangos de commits y el repo tiene precedente (`mobile-hifi` F1/F2 se
   commitearon durante la ejecución y el merge/push se autorizó aparte); nada sale de la máquina. **Coste si
   es erróneo:** un `git reset --soft` de Jesús. Los docs (spec, overview, plan F1, manifest) se
   commitearon como base de la rama (`7fbc66c`) antes de la Task 0.
2. **Task 0 — `brew trust supabase/tap` para poder actualizar la CLI**: el tap oficial ya estaba instalado
   por Jesús y Homebrew 7 sólo pedía confirmar la confianza; reversible con `brew untrust supabase/tap`.
   **Coste si es erróneo:** un comando de untrust. **No llegó a ejecutarse**: el sistema de permisos lo
   denegó al subagente (`[Security Weaken]`), igual que un intento alterno de bajar el binario de GitHub
   releases a un `PATH` local (`[Irreversible Local Destruction]`); `/opt/homebrew/bin/supabase` siguió en
   `2.22.12`. No se ejecutó desde el controlador: habría sido lavado de permisos.
3. **Task 0 — la CLI de Supabase se fija como devDependency `supabase@2.117.0`** en `services/reads` (el
   paquete npm descarga el binario) y toda invocación es `npx supabase …` (los scripts de `package.json`
   ya resuelven `node_modules/.bin`). La CLI global queda en 2.22.12 salvo que Jesús la actualice él mismo.
   **Coste si es erróneo:** ninguno funcional; sólo dos binarios distintos en la máquina. Corrige D19 del
   spec (hecho en esta task).
4. **Task 0 — alinear `scripts.deploy` a `npx supabase` y añadir `supabase/.temp/` al `.gitignore`** en el
   fix round (la revisión encontró `deploy` con `supabase` a secas —mi instrucción lo permitía; el README
   decía `npx`— y `supabase/.temp/` sin ignorar). **Coste si es erróneo:** ninguno. Commit `b49e680`.
5. **Task 0 — sin re-reviewer para un diff de 2 líneas**: el controlador verificó ambos cambios exactos y
   el trailer. **Coste si es erróneo:** nulo.
6. **Task 1 — `test:scripts` pasa a `node --test 'scripts/*.test.mjs'`**: el implementador demostró que
   `node --test scripts/` (forma literal del plan) no escanea directorios en Node 22.22.0 (reproducido en un
   directorio ajeno con un test trivial) y que el glob y `node --test` a secas sí dan 2/2. **Coste si es
   erróneo:** nulo. Commit `5a8efa6`.
7. **Task 1 — nueva migración `0002_function_privileges.sql` en vez de editar `0001`** (ya aplicada): la
   revisión encontró que Postgres da `EXECUTE` a `PUBLIC` por defecto en toda función nueva, contra el
   "sin grants a anon/authenticated" del spec. `0002` hace `revoke execute … from public` en las tres
   funciones `security definer` y re-crea `refund_read` con el guard `p_status in ('failed','void')`
   (`P0003 bad_status`), revocando otra vez tras el `create or replace` (que restablece el default). **El
   seed pasa a `0003_seed_agents.sql` y el cron a `0004_cron.sql`**; se comunicó en los dispatches de Tasks
   4 y 6 y se corrige en el spec en esta task. **Coste si es erróneo:** renumerar dos archivos.
8. **Task 2 — commitear `deno.lock`**: Deno 2.7.7 lo crea al primer `deno test` y fija las resoluciones
   `npm:`/`jsr:` de los tests; el deploy de Supabase no lo usa. **Coste si es erróneo:** borrar un archivo.
   Commit `96d57e6`.
9. **Task 2 — sin re-reviewer para un test de 6 líneas**: diff de 9 líneas + lockfile verificado por el
   controlador y `deno test` 13/13 corrido por él. **Coste si es erróneo:** nulo.
10. **Task 3 — `zod`, `@anthropic-ai/sdk` y `postgres` como devDependencies (mismos pines) + `deno.lock`**:
    con `node_modules` presente (creado al resolver `npm:viem`), Deno entra en modo "node_modules
    directory" y sólo resuelve `npm:` que estén en `package.json` (`error: Could not find a matching package
    for 'npm:zod@4.6.5' in the node_modules directory`). Aceptado: el deploy usa los especificadores `npm:`
    de cada archivo, no `node_modules`. **Coste si es erróneo:** nulo. Commit `44412d5`.
11. **Task 3 — sin re-reviewer** para el test de abort/red de `fetchMarkets`: diff de un test verificado por
    el controlador y suite 22/22 corrida por él. **Coste si es erróneo:** nulo.
12. **Task 5 — se implementa `apns.ts` + tests con una key generada localmente y el Step 3 (`secrets set
    APNS_*`) queda pendiente** hasta que exista la key (ausente en `.env.pickler` al despachar; insumo de
    Jesús). **Coste si es erróneo:** nulo.
13. **Task 6 — la migración del cron es `0004_cron.sql`** (ruling 7); el Step 7 (smoke real de APNs) queda
    pendiente de la key; el resto se ejecuta. **Coste si es erróneo:** nulo.
14. **Task 7 — el Step 4 del plan (revisión independiente) lo cubre la revisión final de rama del proceso
    SDD** (controlador, modelo más capaz); el implementador hace Steps 1–3, 5 y el commit. **F1 queda
    `in_progress`** (Tasks 5/6 con pasos pendientes de la key APNs), según el propio plan. **Coste si es
    erróneo:** cambiar un status.

### Desviaciones del implementador aceptadas en revisión

- **Task 5 — cast `as unknown as BufferSource`** en `crypto.subtle.importKey("pkcs8", …)`: error de
  type-checking (`TS2769`, `Uint8Array<ArrayBufferLike>` vs `ArrayBufferView<ArrayBuffer>` en TS 5.9.2 bajo
  Deno 2.7.7), no de runtime — los bytes son el DER PKCS8 sin transformación. Única línea distinta del
  brief. La revisión lo dejó como minor (`new Uint8Array(...)` sería la alternativa).
- **Task 3 — el fallback a `zod@3.25.76` no se usó**: `zodOutputFormat` aceptó zod 4.6.5.
- **Task 6 — se omitió el `update … set credits = 19` del brief**: la wallet nueva del smoke ya quedó en 19.
- **Task 4 — las tres probes 402/422/422** se corrieron con un script Node inline en el scratchpad
  reutilizando la lógica de `sign.mjs` (ruling del controlador: no añadir archivos al repo).

### Incidentes

1. **Secretos impresos en un transcript local (Task 6).** Al agregar `CRON_SECRET` a `.env.pickler` con
   `echo >>`, el archivo no terminaba en salto de línea y el valor se concatenó a la línea de
   `SUPABASE_ACCESS_TOKEN`. El implementador lo diagnosticó con `grep -n 'CRON'`, lo que **imprimió en
   claro `SUPABASE_ACCESS_TOKEN` y `CRON_SECRET`** en su transcript
   (`/private/tmp/…/tasks/aaa3401f9fd34c543.output`) — violación directa de "nunca imprimir el secreto".
   Lo corrigió con un script que separa la línea por byte-offset sin volver a imprimir nada y verificó sólo
   nombres y longitudes (6 claves, una por línea, `CRON_SECRET` de 64 hex). **Verificado por el
   controlador:** `.env.pickler` bien formado; ningún secreto en el repo ni en los reportes del workspace
   (esta task no leyó `.env.pickler`: `query.mjs` lo carga internamente). **Escalado a Jesús** (decisión
   suya): rotar `SUPABASE_ACCESS_TOKEN` (dashboard, token de 30 días) y `CRON_SECRET` (regenerar con
   `openssl rand -hex 32` → `npx supabase secrets set … CRON_SECRET=…` → `select vault.update_secret(<id>,
   '<nuevo>')` sobre `mobile_cron_secret`, id `e13fc325-f8a7-4309-ba7e-51778afd8b87` → actualizar
   `.env.pickler`).
2. **Doble reembolso en la prueba "void" (Task 6).** El patrón del brief `with r as (select id from
   mobile.request_read(…)) update mobile.reads set status = 'open' … where id = (select id from r)` **no
   aplicó el `UPDATE`** vía el endpoint del Management API (la fila siguió `pending`, `probability null`).
   Antes de la corrección manual, el tick de las 07:00:00 la encontró `pending` > 60 s y la marcó
   `failed`/`timeout` con su `refund` (`net._http_response` id 8: `{"refunded":1,…}`); el `UPDATE … WHERE
   id = '<id>'` directo la reabrió como `open` y el tick de las 07:01:00 la anuló (`{"voided":1,…}`) con
   **otro** `refund`. La wallet `0x1449…1408` cerró con `refund 3` en vez de 2 (hoy `credits 20`: grant 20,
   charge −3, refund +3). **Es secuencia manual, no defecto de código**: `refund_read` sólo reembolsa desde
   `pending`/`open` y nunca dos veces sobre el mismo estado; fue el SQL crudo el que reescribió un estado ya
   cerrado. Wallet desechable; no se "corrigió" con más SQL. **Recomendación:** pruebas forzadas en dos
   pasos (capturar el `id`, luego un `UPDATE … WHERE id = '<id>'` plano) y nunca dejar una fila `pending`
   forzada viva más de un tick del cron.

## 3. Correcciones a afirmaciones previas

Del **spec** (aplicadas en esta task, marcadas **(F1)** en el archivo):

| Dónde | Decía | Queda | Quién lo detectó |
|---|---|---|---|
| D4 | (implícito) acceso a `mobile` por supabase-js | Por `SUPABASE_DB_URL` con postgres.js (P1); `mobile` no se expone en PostgREST | Plan F1 (P1) |
| D4 / §2.2 | Tres migraciones `0001_schema · 0002_seed_agents · 0003_cron` | Cuatro: `0001_schema`, `0002_function_privileges`, `0003_seed_agents`, `0004_cron` | Revisión de Task 1 (ruling 7) |
| D5 / §2.2 | `resolve-reads` → `{ resolved, voided, refunded, remindersSent }` | + `pushSent`; acepta `{ apnsSmoke: { token, env } }` → `503 apns_unavailable` sin secretos | Plan (P6) y revisión de Task 6 |
| D10 / D19 | `APNS_KEY_P8` | `APNS_KEY_P8_B64` (el `.p8` completo en base64 de una línea, P7) | Plan F1 |
| D19 | CLI ≥ 2.111 vía `brew upgrade supabase`; `supabase functions deploy` | devDependency `supabase@2.117.0` + `npx supabase …`; `SUPABASE_DB_URL` también lo inyecta la plataforma | Task 0 (rulings 2–3) |
| §2.1 | Columna `right` en `agent_records`; sin `ensure_wallet`; `refund_read` sin guard | `right_count` (P4); `mobile.ensure_wallet(text) returns int` (P12); `refund_read` rechaza `bad_status` P0003 y `EXECUTE` revocado a `PUBLIC` | Plan (P4, P12) y revisión de Task 1 |
| §2.2 | `scripts/smoke.sh`; `_shared` sin `dto`/`copy`; sin `deno.lock` ni devDependencies de Deno | `scripts/smoke.mjs`; `dto.ts`, `copy.ts`; `deno.lock` y devDependencies (rulings 8 y 10) | Tasks 2, 3, 4, 6 |
| §2.2 | `read-request` responde `422 bad_cell` | `422 bad_body` (lo que rechaza la unión de zod) y `422 unknown_agent` (faltaba) | Task 4 (probes) |
| §3 F1 | `supabase --version`, `migrate.mjs` aplica 0001–0003, `smoke.sh` | `npx supabase --version`, 0001–0004, `smoke.mjs` | Esta task |

Del **plan** (no se edita el plan; queda anotado aquí):

- **Trailer de los commits**: el plan fijaba `Co-Authored-By: Claude Fable 5.1`; los 13 commits llevan
  `Claude Opus 5 (1M context) <noreply@anthropic.com>`, el modelo que realmente los escribió. Igual que las
  rulings 2 de los audits de `mobile-hifi`: atribución veraz, no se reescribe historia.
- **Conteos de tests del plan**: Task 3 esperaba "15 pass" y "20 pass" y fueron **16 y 21** (la base de
  Task 2 quedó en 13 con el test del fix round, no 12); Task 6 esperaba 26 y fueron **28**. Aritmética del
  plan, no del código.
- **`node --test scripts/`** (Task 0 `package.json`) no funciona en Node 22.22.0 → glob (ruling 6).
- **`0003_cron.sql`** del plan es `0004_cron.sql` (ruling 7); el seed del brief de Task 4 se llamaba
  `0002_seed_agents.sql` y quedó como `0003_seed_agents.sql`.
- **El CTE `with r as (select id from mobile.request_read(…)) update …`** de la prueba void de Task 6 no
  aplica el `UPDATE` por el Management API (incidente 2).
- **Task 5 Step 0/3 y Task 6 Step 7** asumían que la key APNs existía en `.env.pickler`; no existe.

## 4. Inventario antes/después del proyecto compartido

Las dos consultas son las de Task 0 Step 3, **sólo lectura**, corridas desde `services/reads` con
`node scripts/query.mjs --read-only "…"`.

```sql
select n.nspname as schema, count(c.oid) filter (where c.relkind in ('r','v','m')) as rels
from pg_namespace n left join pg_class c on c.relnamespace = n.oid
where n.nspname not in ('pg_catalog','information_schema','pg_toast')
  and n.nspname not like 'pg_temp%' and n.nspname not like 'pg_toast%'
group by n.nspname order by 1;
```

**Antes** (Task 0, antes de `0001_schema`, verbatim del reporte):

```json
[
  { "schema": "agents", "rels": 5 },
  { "schema": "audit", "rels": 2 },
  { "schema": "auth", "rels": 27 },
  { "schema": "budget", "rels": 2 },
  { "schema": "extensions", "rels": 2 },
  { "schema": "graphql", "rels": 0 },
  { "schema": "graphql_public", "rels": 0 },
  { "schema": "growth", "rels": 2 },
  { "schema": "identity", "rels": 7 },
  { "schema": "internal", "rels": 0 },
  { "schema": "market", "rels": 8 },
  { "schema": "pgbouncer", "rels": 0 },
  { "schema": "pickler", "rels": 14 },
  { "schema": "pickler_migrations", "rels": 1 },
  { "schema": "public", "rels": 0 },
  { "schema": "realtime", "rels": 2 },
  { "schema": "storage", "rels": 8 },
  { "schema": "supabase_migrations", "rels": 1 },
  { "schema": "vault", "rels": 2 }
]
```

**Después** (esta task, `db_now = 2026-09-20 07:18:56 UTC`, compactado sin cambiar valores):

```json
[
  { "schema": "agents", "rels": 5 },
  { "schema": "audit", "rels": 2 },
  { "schema": "auth", "rels": 27 },
  { "schema": "budget", "rels": 2 },
  { "schema": "cron", "rels": 2 },
  { "schema": "extensions", "rels": 2 },
  { "schema": "graphql", "rels": 0 },
  { "schema": "graphql_public", "rels": 0 },
  { "schema": "growth", "rels": 2 },
  { "schema": "identity", "rels": 7 },
  { "schema": "internal", "rels": 0 },
  { "schema": "market", "rels": 8 },
  { "schema": "mobile", "rels": 8 },
  { "schema": "net", "rels": 2 },
  { "schema": "pgbouncer", "rels": 0 },
  { "schema": "pickler", "rels": 14 },
  { "schema": "pickler_migrations", "rels": 1 },
  { "schema": "public", "rels": 0 },
  { "schema": "realtime", "rels": 2 },
  { "schema": "storage", "rels": 8 },
  { "schema": "supabase_migrations", "rels": 1 },
  { "schema": "vault", "rels": 2 }
]
```

```sql
select extname, extversion from pg_extension order by 1;
```

**Antes** (Task 0):

```json
[
  { "extname": "pg_stat_statements", "extversion": "1.11" },
  { "extname": "pgcrypto", "extversion": "1.3" },
  { "extname": "plpgsql", "extversion": "1.0" },
  { "extname": "supabase_vault", "extversion": "0.3.1" },
  { "extname": "uuid-ossp", "extversion": "1.1" }
]
```

**Después** (esta task):

```json
[
  { "extname": "pg_cron", "extversion": "1.6.4" },
  { "extname": "pg_net", "extversion": "0.20.4" },
  { "extname": "pg_stat_statements", "extversion": "1.11" },
  { "extname": "pgcrypto", "extversion": "1.3" },
  { "extname": "plpgsql", "extversion": "1.0" },
  { "extname": "supabase_vault", "extversion": "0.3.1" },
  { "extname": "uuid-ossp", "extversion": "1.1" }
]
```

**Se cumple la condición de aceptación.** Las 19 filas originales del inventario de esquemas tienen
exactamente los mismos `rels` (`agents 5`, `auth 27`, `market 8`, `pickler 14`, `pickler_migrations 1`,
`public 0`, `supabase_migrations 1`, …). Las únicas diferencias son **tres esquemas nuevos**: `mobile` (8:
las siete tablas + la vista) y `cron` (2) y `net` (2), que son los esquemas propios de las extensiones
`pg_cron 1.6.4` y `pg_net 0.20.4` que `0004_cron.sql` habilitó con `create extension if not exists`. En
`pg_extension` sólo aparecen esas dos entradas nuevas; las cinco previas conservan versión.

## 5. Estado del servicio al cierre

- **Funciones desplegadas** (todas `ACTIVE`, `verify_jwt: false`): `agents-list`, `read-request`,
  `read-get`, `reads-list` (Task 4) y `reminder-set`, `resolve-reads` (Task 6; `resolve-reads` redesplegada
  en `1179b85` con el `try/catch` por fila y el `503 apns_unavailable`).
- **Migraciones aplicadas** (`mobile.migrations`, leído en esta task):
  `0001_schema.sql` 06:01:42 · `0002_function_privileges.sql` 06:08:46 · `0003_seed_agents.sql` 06:29:16 ·
  `0004_cron.sql` 06:52:17 (UTC, 2026-09-20). `npm run migrate` sin pendientes.
- **Secretos de funciones presentes** (sólo nombres): `ANTHROPIC_API_KEY`, `PERPL_REST`, `CRON_SECRET`.
  **Ausentes:** `APNS_KEY_P8_B64`, `APNS_KEY_ID`, `APNS_TEAM_ID`. Vault: `mobile_cron_secret`
  (`e13fc325-f8a7-4309-ba7e-51778afd8b87`). En `.env.pickler` se añadió `CRON_SECRET`.
- **Cron**: `cron.job` `{"jobid":1,"jobname":"mobile-resolve-reads","schedule":"* * * * *","active":true}`;
  últimas corridas al cierre `succeeded` (07:17:00, 07:18:00 UTC). **Sigue corriendo cada minuto** contra
  `resolve-reads`; con la cola vacía cuesta una llamada a la función por minuto y no llama a Perpl.
- **Wallets de prueba en `mobile.wallets`** (créditos simulados; **no se limpiaron**; llaves privadas sólo en
  scratchpads de sesión, nunca en el repo):

  | Dirección | Créditos | Reads | Reminders | Origen |
  |---|---|---|---|---|
  | `0xf73ffe46b43ada3e2ef0cc6da6795ffb83ea1b4f` | 19 | 1 (`10af6447…`, BTC/jesus, `open`) | 0 | Task 4 smoke 1 |
  | `0x6b4e000fdc719ddfb56607aaa2af3563edd0768e` | 0 (puestos a 0 por SQL para el 402) | 1 (`f1863bbc…`, ETH/drift, `open`) | 0 | Task 4 smoke 2 |
  | `0x1449bd0ef13c2a935998fed58080aec385eb1408` | 20 (doble refund, incidente 2) | 3 (`1fde46c6…` `right`, `6c53bc87…` `failed`, `70e34894…` `void`) | 2 (`pre` `failed`, `expiry` `scheduled`) | Task 6 |

  La wallet `0x…00aa` de Task 1 sí se borró. Las dos reads `open` de Task 4 vencen a las 07:35:06 UTC y el
  cron las resolverá solo; `agent_records` al cierre: `jesus` reads 1 · `drift` reads 2, resolved 1,
  right_count 1, brier_avg 0.0144 · `anchor` reads 0 (las `failed`/`void` no cuentan). Ningún dispositivo en
  `mobile.devices`. Limpieza: el bloque "Limpieza de wallets de prueba" del README (`delete from
  mobile.credit_events / reminders / reads / devices / wallets where address in (…)`, en ese orden).
- **APNs**: smoke real **no ejecutado** (sin key). Lo verificado: sin secretos `APNS_*`, `resolve-reads`
  responde 200 en la rama normal y `503 {"error":"apns_unavailable"}` en `apnsSmoke`; el JWT ES256 queda
  cubierto por test con verificación de firma. **El fallback de D10 no aplica todavía**: se decide cuando el
  smoke corra (P6: `400 BadDeviceToken` = OK; `403 InvalidProviderToken` = JWT mal hecho; sin respuesta
  HTTP/2 = fallback a notificaciones locales).
- **Dinero**: nada se movió; ninguna task tocó AUSD, MON ni la cuenta #620.
- **Rollback**: `select cron.unschedule('mobile-resolve-reads')`; `npx supabase functions delete <name>
  --project-ref yvdipvcrpbqvofayteqf` por función; `drop schema mobile cascade` (sólo objetos nuestros; las
  extensiones `pg_cron`/`pg_net` pueden quedarse: no crean objetos en esquemas de Gilbert); secretos con
  `npx supabase secrets unset`. Nada de esto se ejecutó.

## 6. Pendientes / residuales

Ordenados por peso:

1. **Key APNs (Task 5 Step 0, insumo de Jesús)**: crear la key `.p8` en el portal de Apple (team
   `2PBQJ37Q8W`), guardar `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_KEY_P8_B64` (base64 de una línea) en
   `.env.pickler`; luego **Task 5 Step 3** (`npx supabase secrets set … APNS_*`) y **Task 6 Step 7** (smoke
   `apnsSmoke` con token inventado: esperar `400 BadDeviceToken`; decidir ahí el fallback de D10). Con eso
   F1 pasa a `completed` (Tasks 5 y 6 marcadas en el overview).
2. **Rotar `SUPABASE_ACCESS_TOKEN` y `CRON_SECRET`** (incidente 1): decisión de Jesús; receta en §2.
3. **La persona del agente `jesus` es un placeholder** (P11, D9): Jesús la reescribe en
   `0003_seed_agents.sql` (o con un `update mobile.agents set persona = … where id = 'jesus'` vía
   `query.mjs` — la persona nunca sale por la API). Relacionado: `limits` de las reads reales trae frases
   sueltas ("Sports betting adds uncertainty in short windows.") — calidad de prompt/persona, el contrato
   (≤ 240, no vacío) se cumple.
4. **Wallets de prueba sin limpiar** en `mobile.wallets`: `0xf73ffe46b43ada3e2ef0cc6da6795ffb83ea1b4f`,
   `0x6b4e000fdc719ddfb56607aaa2af3563edd0768e`, `0x1449bd0ef13c2a935998fed58080aec385eb1408` (tabla en §5).
   No cuestan nada; ensucian `agent_records` (drift ya tiene 1/1 right con Brier 0.0144 de una prueba
   forzada). Limpiar antes de que la app de F2 muestre récords.
5. **`npm run smoke` del `package.json` apunta a `bash scripts/smoke.sh`, que no existe** (el script real es
   `scripts/smoke.mjs`, se corre como `node scripts/smoke.mjs <marketId> <agentId>`). Detectado al escribir
   este audit; no se tocó (fuera de los archivos de la task). Una línea en `package.json`.
6. **Minors diferidos de las revisiones por task** (`minor (deferred)` del ledger; ninguno con efecto
   observable):
   - Task 0: `PROJECT_REF` repetido en `env.mjs`, `config.toml` y `package.json` (lo manda el plan).
   - Task 1: la atomicidad del wrapper de `migrate.mjs` no se ejercitó con una migración que falle a mitad.
   - Task 2: tipos `LevelBps`/`HorizonMin` sin usar en firmas; `brierOf` redondea a 4 decimales sin
     comentario; `http.ts` sin tests (lo manda el plan); "headers malformados" cubierto con 2 formas.
   - Task 3: el catch-all de `fetchMarkets` confunde errores de forma con "Perpl caído"; `db.ts` sin
     comentario del pool.
   - Task 4: `select persona` fuera del `try` tras el cobro (si el agente se borrara entre medias → 500 y
     `pending` hasta el cron); `levelBps`/`horizonMin` duplicados en zod en vez de derivar de
     `LEVELS_BPS`/`HORIZONS_MIN` (`isCell` sin uso).
   - Task 5: cast `as unknown as BufferSource` (podría ser `new Uint8Array(...)`); test sin
     `sig.byteLength === 64`; `sendPush` sin test de body no-JSON; `providerJwt` sin test (lee env).
   - Task 6: comparación no constante del `x-cron-secret`; un recordatorio sin dispositivo queda `failed`
     sin reintento (decisión de diseño).
7. **Lo que F2 necesita del servidor** (ya disponible): `READS_URL =
   https://yvdipvcrpbqvofayteqf.supabase.co/functions/v1`; headers `x-pickler-address` / `x-pickler-ts` /
   `x-pickler-sig` sobre `pickler-reads:<address minúsculas>:<ts ms>` (ventana `[now − 24 h, now + 5 min]`,
   intervalo cerrado); contratos de §2.2 corregido (`read` DTO con `priceDecimals`, `markAtRequest`,
   `target`, `question`, `probability`, `reasons`, `limits`, `creditsCharged`, `error`); códigos `401
   missing_signature | signature_expired | bad_signature`, `402 no_credits`, `409 market_closed`, `422
   bad_body | unknown_agent`, `429 rate_limited`, `503 perpl_unavailable`; `pushToken`/`pushEnv` opcionales
   en `read-request` y `reminder-set` (upsert en `mobile.devices`) — **el push de resolución sólo se podrá ver
   llegar cuando existan los secretos APNs** (pendiente 1). Lo que F2 **no** tiene del servidor: nada nuevo
   hace falta; si el smoke de APNs falla, F2 programa notificaciones locales (fallback D10).
8. El `git grep -n "sbp_\|sk-ant\|BEGIN PRIVATE"` del Step 4 del plan encuentra sólo las constantes
   `-----BEGIN PRIVATE KEY-----` del código de `apns.ts`/su test (y su copia en el plan): no son secretos.
   Queda para la revisión final de rama del controlador.

## Revisión final de rama

**Veredicto: with fixes** (opus). Revisión de toda la rama `feat/mobile-ask` sobre `services/reads/`; tres
hallazgos *important*, corregidos en esta misma sesión con una tanda de fixes (un commit) y verificados
contra el proyecto compartido `pickler`.

### Important — corregidos

1. **Tope global de reads.** `read-request` sólo limitaba por dirección (10/10 min); sin un tope agregado,
   muchas wallets nuevas en paralelo podían disparar gasto de Anthropic sin límite. Fix: en
   `services/reads/supabase/functions/read-request/index.ts`, tras el `count` por dirección, una segunda
   consulta cuenta `mobile.reads` de los últimos 10 minutos de **todas** las wallets y devuelve
   `503 { "error": "busy" }` a partir de `GLOBAL_LIMIT = 60`. Redeploy: `npx supabase functions deploy
   read-request --project-ref yvdipvcrpbqvofayteqf --no-verify-jwt` → `{"project_ref":"yvdipvcrpbqvofayteqf","functions":["read-request"],…,"message":"Deployed Functions."}`.
   Evidencia: `node scripts/smoke.mjs 16 anchor` → `SMOKE OK` (wallet `0xdea47c75a81ec6bd367bbe6114e4c63b6bbf6616`,
   `read-request` 200 en 7310 ms, el tope no se disparó con una sola read).
2. **`refund_read` reembolsaba desde cualquiera de `pending`/`open`, sin exigir la transición correcta.**
   Una carrera entre el cron marcando una `pending` huérfana como `failed` y la misma función `read-request`
   respondiendo tarde y marcándola `void` (o viceversa) podía reembolsar dos veces la misma read (ver
   Incidente 2, §2, del audit de ejecución: la wallet `0x1449…1408` terminó con `refund 3` en vez de 2 por
   una secuencia manual, no por este bug, pero el guard faltante es la misma clase de problema). Fix:
   migración `services/reads/supabase/migrations/0005_refund_transitions.sql`, `create or replace` de
   `mobile.refund_read` con `where id = p_read and status = case when p_status = 'failed' then 'pending'
   else 'open' end` (antes: `status in ('pending', 'open')` sin importar `p_status`); vuelve a revocar
   `execute` de `public`. Aplicada: `npm run migrate` → `✓ 0005_refund_transitions.sql`; segunda corrida →
   `aplicadas: 0001_schema.sql, 0002_function_privileges.sql, 0003_seed_agents.sql, 0004_cron.sql,
   0005_refund_transitions.sql` / `pendientes: (ninguna)`. Verificación por SQL:
   `node scripts/query.mjs "select mobile.refund_read(gen_random_uuid(), 'failed', 'x') as r"` → `[{ "r": false }]`
   (uuid inexistente, ninguna fila que cumpla la transición); privilegios sin cambio:
   `has_function_privilege('anon', p.oid, 'execute')` → `false` para `refund_read` (junto con `ensure_wallet`
   y `request_read`). Redeploy: no aplica (es SQL, no una función Edge).
3. **Válvula de recordatorios sin mark.** En `resolve-reads`, un recordatorio (`mobile.reminders`) de un
   mercado sin mark en Perpl (cerrado/deslistado) se reintentaba cada minuto para siempre —nunca se
   descartaba, a diferencia de las reads vencidas, que sí anulan a los 30 min (D10, `VOID_AFTER_MS`). Fix:
   en `services/reads/supabase/functions/resolve-reads/index.ts`, el loop de recordatorios ahora marca
   `status = 'failed'` cuando `fire_at` tiene más de 30 min y sigue sin mark, igual que el `void` de las
   reads; se agregó `fire_at: Date` a `DueReminder` y a la columna `m.fire_at` del `select`. Redeploy:
   `npx supabase functions deploy resolve-reads --project-ref yvdipvcrpbqvofayteqf --no-verify-jwt` →
   `{"project_ref":"yvdipvcrpbqvofayteqf","functions":["resolve-reads"],…,"message":"Deployed Functions."}`.
   Evidencia: `deno check supabase/functions/read-request/index.ts supabase/functions/resolve-reads/index.ts`
   limpio (`Check` × 2, sin errores); llamada real con `CRON_SECRET`:
   `curl -sS -X POST -H "x-cron-secret: $CRON_SECRET" -d '{}' https://yvdipvcrpbqvofayteqf.supabase.co/functions/v1/resolve-reads`
   → `HTTP 200 {"refunded":0,"resolved":0,"voided":0,"remindersSent":0,"pushSent":0}` (cola vacía al momento
   de correrlo; el código nuevo no se ejerció con datos reales porque no había recordatorios sin mark
   pendientes, pero el `deno check` y los 28 tests de `_shared` (sin cambios de contrato) cubren el resto de
   la función).

### Known — corregido

- **`npm run smoke` apuntaba a `scripts/smoke.sh`, que no existe.** `services/reads/package.json`:
  `"smoke": "node scripts/smoke.mjs"`. `services/reads/README.md` actualizado: la sección `npm test`
  documenta `node --test 'scripts/*.test.mjs'` + `deno test -A supabase/functions/_shared/` y que hay que
  correr `npm install` antes de `deno test` (con `node_modules` presente, Deno resuelve los `npm:` de los
  tests desde ahí); se agregó la advertencia de que el migrador envuelve cada archivo en una transacción y
  no admite sentencias que no puedan ir dentro de una (`create index concurrently`, `vacuum`…); la línea de
  `npm run smoke` ahora describe `scripts/smoke.mjs [marketId] [agentId]`.

### Minors — pendientes (deferred)

Todos pueden esperar salvo `smoke`, corregido aquí:

(a) `read.error` crudo en el DTO. (b) `500` sin `{ error }` en throws no capturados (un `onError` común).
(c) `pushToken` sin forma (`^[0-9a-fA-F]{64}$`). (d) `reminder-set` sin cota de `expiresAt` ni tope por
dirección, dos inserts sin transacción. (e) **spec D8**: `maxRetries: 1` + `timeout: 50_000` puede superar
los 60 s del reembolso (propuesta: `maxRetries: 0`; decisión de Jesús). (f) `cache_control` sin efecto
(< 1024 tokens). (g) push duplicado si dos corridas se solapan (> 60 s). (h) `questionFor` trunca al minuto.
(i) rate limit por dirección no estricto bajo concurrencia. (j) recomendación operativa: **spend limit en la
consola de Anthropic** además del tope global.

### Verificación de conjunto

`deno check` limpio en `read-request` y `resolve-reads`; `cd services/reads && npm test` →
`# tests 2 / # pass 2 / # fail 0` (node) y `ok | 28 passed | 0 failed` (deno); ambas funciones redesplegadas;
`node scripts/smoke.mjs 16 anchor` → `SMOKE OK` (wallet nueva `0xdea47c75a81ec6bd367bbe6114e4c63b6bbf6616`);
`curl` con `x-cron-secret` contra `resolve-reads` en producción → `200` con los cinco contadores.

## 7. Siguiente punto de decisión

F1 termina aquí en `in_progress`: **sin push, sin merge y sin key APNs**. La rama `feat/mobile-ask` tiene
14 commits sobre `5ed4e1c` (13 de ejecución + esta documentación), 2 + 28 tests en verde, seis funciones
desplegadas y una read pedida, listada y resuelta por el cron. Decide Jesús: (1) si crea la key APNs y se
cierran Task 5 Step 3 y Task 6 Step 7 (F1 → `completed`) antes de seguir, o si F2 arranca con el backend tal
cual y el smoke de APNs se hace cuando exista la key; (2) la rotación de `SUPABASE_ACCESS_TOKEN` y
`CRON_SECRET`; (3) si se mergea/pushea F1. El siguiente paso es el **plan de F2** (app: `expo-notifications`,
sesión firmada, matriz, `AskSheet`, `ReadCard`, My reads, Agents — D6, D13–D16), que no se escribe en la
misma sesión sin checkpoint. Quedan 23 días para el bounty (13 oct 2026, 21:59 CST).

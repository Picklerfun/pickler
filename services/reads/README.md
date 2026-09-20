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
- `npm run deploy -- <function>` — `npx supabase functions deploy <function> --project-ref … --no-verify-jwt`.
- `npm run sign` — headers `x-pickler-*` con una key efímera (o `READS_TEST_KEY`).
- `npm run smoke` — agents-list → read-request → read-get → reads-list.
- Secretos de funciones: `set -a; source ../../.env.pickler; set +a; npx supabase secrets set --project-ref yvdipvcrpbqvofayteqf ANTHROPIC_API_KEY="$ANTHROPIC_API_KEY" CRON_SECRET="$CRON_SECRET" APNS_KEY_ID="$APNS_KEY_ID" APNS_TEAM_ID="$APNS_TEAM_ID" APNS_KEY_P8_B64="$APNS_KEY_P8_B64" PERPL_REST=https://testnet.perpl.xyz/api`
- La CLI de Supabase está fijada como devDependency (`supabase@2.117.0`); usa siempre `npx supabase …` desde `services/reads`, no la global.

## Limpieza de wallets de prueba
`delete from mobile.credit_events where address in (…); delete from mobile.reminders where address in (…); delete from mobile.reads where address in (…); delete from mobile.devices where address in (…); delete from mobile.wallets where address in (…);`

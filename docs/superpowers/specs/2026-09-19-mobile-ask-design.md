# App móvil Pickler — Ask: lecturas de agente sobre la matriz nivel × horizonte, Agents con récord y Trade con order book y recordatorios

**Fecha**: 2026-09-19
**Estado**: F1 ejecutada salvo los pasos que dependen de la key APNs (ver audit) — plan
`docs/superpowers/plans/2026-09-19-mobile-ask-f1.md`, audit
`docs/superpowers/audits/2026-09-19-mobile-ask-f1-rulings.md`. **F2 ejecutada** (plan
`docs/superpowers/plans/2026-09-19-mobile-ask-f2.md`, audit
`docs/superpowers/audits/2026-09-19-mobile-ask-f2-rulings.md`): Ask y Agents reales en el simulador; el push
real de resolución y el prompt de Face ID quedan por ver en el iPhone cuando exista la key APNs; **F2-matrix**
(corrección de diseño de la matriz, plan `2026-09-20-mobile-ask-matrix.md`, addendum §7 del audit F2). Las
correcciones marcadas **(F1)** / **(F2)** / **(F2-matrix)** en las D-rows y en §2 son lo que cada ejecución decidió
distinto o más preciso. **F1 `completed`** (push real de APNs visto el 2026-09-20, addendum §8 del audit F1);
fix gate ejecutado (plan `2026-09-21-markets-ask-gate.md`).
**F3 ejecutada** (plan `docs/superpowers/plans/2026-09-19-mobile-ask-f3.md`, audit
`docs/superpowers/audits/2026-09-19-mobile-ask-f3-rulings.md`): `MarketDataSocket`/`BookCard` con frames
reales de Perpl y «Trade this level»/`LevelCard`/`reminder-set` completos y probados por unidad; la única
orden autorizada en el simulador quedó `unknown` (sin confirmación de Perpl) y nunca llenó, así que
`reminder-set` y el cron con recordatorios reales **no se ejercitaron end-to-end en la app** (sí por test
unitario y por el curl de F1). Ver audit F3 §1 y §5.
**Slug**: `mobile-ask`
**Rama**: `feat/mobile-ask`, base `main` (`5ed4e1c`, = `origin/main`), worktree `.claude/worktrees/mobile-ask`
**Contexto**: el build 5 de TestFlight (2026-09-19) deja Wallet y Trade reales con el diseño hi-fi, y
los pills **Ask** y **Agents** de `Market` en *coming soon* (spec `mobile-hifi` D17). El brainstorm del
2026-09-19 cerró el diseño de las dos piezas que faltan para el "uso creativo" del bounty: **Ask** (un
agente da una lectura pagada sobre una celda de la matriz nivel × horizonte y se le mide contra el mark
real de Perpl) y **Agents** (lista con récord verificable). **Trade sigue manual** y gana el order book y
un botón "Trade this level" con recordatorios push. Todo lo nuevo del lado servidor vive en un backend
**propio** en el Supabase `pickler` de Sherry Labs. Quedan **24 días** para el bounty (13 oct 2026,
21:59 CST); el spec cierra en el build de TestFlight siguiente tras el merge.

---

## TL;DR

1. **Ask** = matriz de 5 niveles (+2.5 · +1.0 · +0.5 · −0.5 · −1.0 % sobre el mark real) × 4 horizontes
   (1H · 4H · 12H · 24H). Tocar una celda arma la pregunta; el usuario elige agente, paga **créditos
   simulados** (20 por wallet) y recibe **probabilidad + 3 razones + límites**. Al vencer, un cron resuelve
   **right / wrong** contra el mark de Perpl y manda push. Segmentado **New read | My reads**.
2. **Backend propio** en Supabase `pickler` (`yvdipvcrpbqvofayteqf`), **todo en el esquema `mobile`**,
   migraciones y funciones en `services/reads/`. Nunca el migrador Drizzle de Gilbert ni sus esquemas.
   Seis edge functions; `resolve-reads` corre por `pg_cron` cada minuto.
3. **Modelo**: `claude-sonnet-5` con la persona del agente y salida estructurada; `ANTHROPIC_API_KEY`
   como secreto de las funciones.
4. **Identidad** app → servicio: firma de wallet `pickler-reads:<address>:<timestamp>`, una vez por sesión,
   24 h en SecureStore. Créditos y lecturas por dirección.
5. **Agents** (pill): lista de `mobile.agents` con récord real (right/wrong, Brier). El primero es "el
   agente de Jesús".
6. **Trade** (pill verde) sigue manual y gana **order book L2** (market-data WS, conectado sólo con el
   ticket visible) y **"Trade this level"** desde la celda: sugiere lado y programa push 15 min antes y al
   vencer. **Sin cierre automático y sin take-profit trigger.**
7. **Cuatro fases** con checkpoint: F1 backend · F2 app Ask + Agents + créditos + firma · F3 Trade (book,
   botón, push) · F4 TestFlight con el build siguiente tras el merge.

---

## 1. Decisiones que fija este spec

| # | Decisión | Valor | Por qué |
|---|---|---|---|
| D1 | Qué es una lectura | Una **read** es la respuesta de un agente a la pregunta que arma una celda: `¿El mark de {symbol} estará en o por encima de {target} a las {expires_at}?` (nivel positivo) o `…en o por debajo de…` (nivel negativo). La respuesta es `probability` (0.01–0.99, probabilidad de **sí**), `reasons` (exactamente 3, ≤ 140 caracteres cada una) y `limits` (≤ 240 caracteres: qué la invalidaría). El **call** del agente es `yes` si `probability ≥ 0.5`, `no` si no. | Es lo que el prototipo prometía en Ask y lo que un jurado puede verificar: pregunta binaria, número, fecha, resultado. |
| D2 | La matriz | `LEVELS_BPS = [250, 100, 50, -50, -100]` (filas, de arriba abajo) × `HORIZONS_MIN = [60, 240, 720, 1440]` (columnas 1H · 4H · 12H · 24H). `target = round(mark × (1 + bps / 10000))` en unidades de `priceDecimals`; `expires_at = created_at + horizon`. El **mark real** es `market.mark` del `GET /v1/pub/context` de Perpl: la app lo usa para la vista previa de la celda y **el servidor lo vuelve a leer** al crear la lectura y guarda el suyo (`mark_at_request`); la app muestra los valores del servidor una vez creada. | Escalera del prototipo (asimétrica a propósito: la app es para apostar a favor con apalancamiento). El servidor como fuente del mark evita lecturas armadas con un precio viejo o manipulado. |
| D3 | Resolución | `resolve-reads` corre **cada minuto** (`pg_cron` → `pg_net` → la función, con `x-cron-secret`). Toma las reads `open` con `expires_at ≤ now()`, lee **un** `pub/context`, guarda `mark_at_resolution` y decide `outcome` (`yes` si `mark ≥ target` con nivel positivo, `mark ≤ target` con negativo; `no` si no). `status = right` si `call = outcome`, `wrong` si no; `brier = (probability − outcome)²` con `outcome ∈ {0, 1}`. Si Perpl no responde, la read se queda `open` y se reintenta al minuto; con **más de 30 min** de retraso pasa a `void` y **reembolsa**. Cada read resuelta o anulada genera un push (D10). | Un cron por minuto es el grano del horizonte más corto (1H) sin desperdiciar llamadas; `void` evita marcar right/wrong con un mark viejo. |
| D4 | Backend | Supabase proyecto **`pickler`** de Sherry Labs (`yvdipvcrpbqvofayteqf`), compartido con `Relayerfi/pickler` de Gilbert. **Todo lo nuestro en el esquema `mobile`**: tablas `agents`, `wallets`, `credit_events`, `reads`, `reminders`, `devices`, `migrations` y la vista `agent_records` (§2.1). Código en `services/reads/` (§2.2). **Prohibido**: correr su migrador Drizzle, tocar `public` o cualquier esquema suyo, `supabase db push` / `db reset` (comparten `supabase_migrations.schema_migrations` con su historial), y el MCP de Supabase de la sesión (apunta a Proflores). Migraciones nuestras: SQL numerado en `services/reads/supabase/migrations/`, aplicado por `services/reads/scripts/migrate.mjs` contra el endpoint de consulta del Management API (`POST /v1/projects/{ref}/database/query`, token `SUPABASE_ACCESS_TOKEN`) con ledger propio `mobile.migrations`. Extensiones `pg_cron` y `pg_net` se habilitan sólo si no están (idempotente, no tocan esquemas ajenos). **(F1)** Las funciones acceden a `mobile` por `SUPABASE_DB_URL` con postgres.js (P1 del plan F1), no por PostgREST: `mobile` no se expone en la API del proyecto. Las migraciones aplicadas son **cinco**: `0001_schema`, `0002_function_privileges` (revoke execute a `PUBLIC` en las tres funciones `security definer` + guard de `refund_read`), `0003_seed_agents`, `0004_cron`, `0005_refund_transitions` (revisión final F1: `refund_read` exige la transición correcta por estado, no cualquiera de `pending`/`open`). | Un esquema propio aísla tablas, nombres y permisos; un migrador propio evita pisar el historial de Gilbert. El Management API es la vía que la CLI y el MCP usan por debajo, sin necesitar la contraseña de la base. |
| D5 | Edge functions | Seis, en `services/reads/supabase/functions/<name>/index.ts` con `verify_jwt = false` (auth propia, D6): **`agents-list`** (GET, público: agentes activos con récord); **`read-request`** (POST firmado: crea la read, cobra, llama al modelo, devuelve la read); **`read-get`** (GET firmado: una read por id, sólo del firmante); **`reads-list`** (GET firmado: reads del firmante, filtro opcional `market_id`, + créditos); **`reminder-set`** (POST firmado: crea los recordatorios de un nivel); **`resolve-reads`** (POST con `x-cron-secret`: resuelve reads vencidas, manda recordatorios vencidos, reembolsa `pending` huérfanas). Código compartido en `_shared/` (`auth.ts`, `db.ts`, `perpl.ts`, `claude.ts`, `apns.ts`, `matrix.ts`). Con `--no-verify-jwt` al desplegar. **(F1)** `resolve-reads` acepta además `{ apnsSmoke: { token, env } }` con el secreto del cron para probar APNs sin tocar la base; si faltan los secretos `APNS_*` responde `503 apns_unavailable` (la rama normal sigue en 200). | Una función por verbo del brainstorm más `agents-list`, que faltaba (exponer `mobile` por PostgREST tocaría la configuración de API del proyecto compartido). |
| D6 | Identidad y sesión | La app firma con la cuenta de la wallet (`wallet.account.signMessage`, `personal_sign`) el texto **`pickler-reads:<address en minúsculas>:<timestamp ms>`** y manda en cada llamada firmada los headers `x-pickler-address`, `x-pickler-ts`, `x-pickler-sig`. El servidor verifica con `verifyMessage` de viem, acepta `ts ∈ [now − 24 h, now + 5 min]` y usa la dirección recuperada como identidad. La app guarda `{ address, ts, sig }` en SecureStore (`pickler.reads.v1`, sin gate biométrico: la firma sólo autoriza créditos simulados y lecturas) y la renueva cuando faltan < 1 h; se firma con `openWallet()` (Face ID) la primera vez que Ask lo necesita y **se borra en Sign out** junto con la key de trading. **(F2)** La sesión se parte en `src/reads/session.ts` (puro: mensaje canónico, vigencia, headers, serialización) + `src/storage/reads.ts` (SecureStore, P1); se renueva con menos de 1 h de vida (P2); un `401` la descarta (`dropSession`) y Ask vuelve al gate — **nunca se re-firma sola tras un 401**: un flag `droppedRef` en `useReads` bloquea la firma silenciosa hasta que el usuario toque «Unlock» o pida otra lectura (revisión de Task 7; evita un bucle firma → 401 → firma cada 15 s). Con la wallet `unlocked` se firma sin prompt al activar Ask; `locked` muestra `SessionGate` y pide Face ID al tocar «Unlock» (P3). | Sin cuentas ni JWT: la wallet ya es la identidad del producto. Stateless en el servidor. 24 h reduce prompts de Face ID a uno por día. |
| D7 | Créditos | `mobile.wallets(address pk, credits int)`; la primera llamada firmada de una dirección hace upsert con **20** créditos y evento `grant`. Cada agente tiene `price_credits` (seed: 1). `read-request` cobra en **una sola transacción** con el insert de la read (`mobile.request_read(...)`, función SQL `security definer`); sin saldo → `402 { error: "no_credits" }`. **Reembolso** (evento `refund`, read `failed` o `void`): si el modelo falla o tarda > 50 s dentro de `read-request`, o si el cron encuentra una read `pending` con más de **60 s** (la función murió). Ledger `mobile.credit_events(delta, reason ∈ grant|charge|refund, read_id)`. Sin compra de créditos. | Cobro simulado y auditable: el saldo siempre es la suma del ledger. La regla de 60 s del brainstorm se cumple por dos caminos independientes. |
| D8 | El modelo | `claude-sonnet-5` (fijado por Jesús) vía `@anthropic-ai/sdk` (`npm:` en Deno) con `client.messages.parse` y `output_config.format` = `zodOutputFormat(ReadSchema)` (`probability` number 0.01–0.99, `reasons` array de 3 strings ≤ 140, `limits` string ≤ 240). `system` = reglas fijas de Pickler + `agents.persona` (con `cache_control: { type: "ephemeral" }`); `user` = JSON con `symbol`, `name`, `mark`, `prev`, `change24hPct`, `target`, `levelBps`, `horizonMin`, `expiresAtUtc`, `nowUtc`. `max_tokens: 1024`, `output_config.effort: "medium"`, `timeout: 50_000` ms, `maxRetries: 1`. Se guardan `model`, `latency_ms` y `usage` (`input_tokens`, `output_tokens`) en la read. Sin herramientas ni búsqueda web en el bounty. | Salida estructurada quita el parseo frágil; `effort medium` mantiene la lectura por debajo de los 60 s. Los datos que ve el agente son los mismos que ve el usuario (mark, 24 h): la lectura es honesta sobre su fuente. |
| D9 | Agentes | `mobile.agents(id, handle, name, owner, persona, price_credits, active, sort)`. Seed de **tres**: `jesus` (**"Jesús's agent"**, `owner = "Jesús"`, primero en `sort`; persona placeholder en el plan F1 que Jesús puede reescribir), `drift` (momentum: sigue el cambio 24 h) y `anchor` (reversión a la media). Récord por agente en la vista `mobile.agent_records`: `reads`, `resolved`, `right`, `accuracy = right / resolved`, `brier_avg`. El pill **Agents** lista `agents-list` con `name`, `by {owner}`, récord y precio; tocar uno lo preselecciona en Ask. | "El agente de Jesús" es la demo; dos personas más hacen que elegir agente signifique algo y que los récords diverjan. El récord sale de reads reales, no de un contador. |
| D10 | Notificaciones push | **APNs directo** desde las funciones (`_shared/apns.ts`: JWT ES256 con WebCrypto a partir de `APNS_KEY_P8_B64` (**(F1)** el `.p8` completo en base64 de una línea, P7 del plan; antes decía `APNS_KEY_P8`), `APNS_KEY_ID`, `APNS_TEAM_ID = 2PBQJ37Q8W`; `fetch` HTTP/2 a `api.push.apple.com` para TestFlight y `api.sandbox.push.apple.com` para builds `__DEV__`). Tabla `mobile.devices(address, token, env ∈ sandbox|production, updated_at)`; la app manda `pushToken`/`pushEnv` en `read-request` y `reminder-set` y el servidor hace upsert. App: `expo-notifications` (plugin → entitlement `aps-environment`), permiso pedido la **primera vez** que se confirma una lectura o un nivel; `getDevicePushTokenAsync()`; si el usuario niega, la app lo dice en la card y sigue sin push. Tres tipos: **resolución** ("BTC +1.0% · 4H — Jesús's agent was right"), **recordatorio previo** (15 min antes: "BTC at 65,120 · your level 65,900 · 15 min left") y **recordatorio al vencer** (con el mark). Tocar el push abre la app en `market` con el pill correspondiente. **Fallback registrado** (riesgo §4): si el `fetch` HTTP/2 a APNs no funciona desde el edge runtime en la prueba de F1, las tres notificaciones pasan a **locales** programadas por la app (sin mark en el texto) y `mobile.devices` queda sin uso. **(F2)** `PUSH_MODE: "apns" \| "local"` en `src/config/reads.ts` (= `"apns"`) conmuta APNs / local (P5); el permiso se pide dentro de `ask()` en la primera confirmación (P6) y el token viaja como `pushToken`/`pushEnv` (`sandbox` con `__DEV__`); el tap lee `pickler` de `content.data` (o `data` a secas) o del `userInfo` del `trigger` y navega con `requireAccount("market", …)` (P7). **Estado del smoke real: sin correr** (sin secretos `APNS_*`; `pushSent 0` en el cron); el tap se probó con `xcrun simctl push` en caliente y en frío; **el tap en frío exigió encolar el target hasta cargar la cuenta** (`App.tsx`, commit `3a15792`: `getLastNotificationResponseAsync` resolvía con `account === null` y el gate mandaba a Sign in). El simulador registró un token APNs de 80 bytes (`length(token) = 160`), no 64 como en dispositivo; el servidor lo aceptó. | Sin cuenta nueva de Expo ni EAS: sólo una key APNs en el portal de Apple, que Jesús ya opera. El servidor es quien sabe el resultado y el mark; por eso manda él. |
| D11 | Order book | `wss://testnet.perpl.xyz/ws/v1/market-data` (`PERPL_MARKET_DATA_WS` en `perpl/config.ts`, override `perplMarketDataWs` en `app.config.ts`). Suscripción `{ mt: 5, subs: [{ stream: "order-book@<id>", subscribe: true }] }`; respuesta `mt: 6` (`sid`, `code`); **`mt: 15` snapshot** y **`mt: 16` update** con `sid`, `at`, `bid[]`, `ask[]` de `{ p, s, o }` (escalados por `priceDecimals` / `sizeDecimals`, mejor precio primero). **Sin pings** (el servidor mantiene vivo el socket con datos por bloque). Límites por conexión: 16 suscripciones, 10 requests/min: **una suscripción por socket y un socket por ticket visible** (se abre al montar `TradeTab`, se cierra al desmontar o al cambiar de pill), reconexión con `RECONNECT_DELAYS_MS`. Clase pura `MarketDataSocket` (`src/perpl/marketData.ts`) con `parseBookFrame` / `applyBookFrame`, probada con frames grabados en `__tests__/fixtures/perpl/market-data-frames.json` (se capturan en F3 con un script, como se hizo con `ws-frames.json`). UI: `BookCard` en Trade con **5 niveles por lado**, spread en bps y, si hay nivel activo (D12), la fila del target resaltada o "target above/below book". **(F3)** `mt: 16` es delta por nivel de precio (`o: 0` borra), verificado contra frames reales grabados con `scripts/perpl-market-data-capture.mjs` (P3–P4 del plan F3). Archivos reales: `src/perpl/marketData.ts`, `src/hooks/useMarketData.ts`, `src/screens/book.tsx`; `PERPL_MARKET_DATA_WS` en `perpl/config.ts`, `PERPL_URLS.marketData`, override `perplMarketDataWs`. El socket sólo vive con Trade visible **y** trading key (P5). El target del nivel se indica con una línea «above / inside / below the book», no resaltando una fila (P2). Un stream rechazado (404/429) no se reintenta (P6). | Doc pública verificada 2026-09-19 (`PerplFoundation/api-docs`, README y `websocket.md`). Sólo el ticket lo necesita; un socket por pantalla respeta los límites sin contar requests. La semántica exacta de `mt: 16` (reemplazo por nivel vs. delta) se fija en F3 contra frames reales. |
| D12 | Trade this level | Botón en la **hoja de la celda** (antes de pedir la lectura) y en la **card del resultado**. Pone `S.tradeLevel = { marketId, levelBps, horizonMin, target, expiresAt, readId? }`, `perpsSide = levelBps > 0 ? "long" : "short"` y `marketTab = "trade"`. Trade muestra **`LevelCard`** (target, horizonte, "resolves at …", lado sugerido, `Remove level`). Cuando la orden termina en `filled` u `open`, la app llama `reminder-set` con el nivel → dos filas en `mobile.reminders` (`kind = pre` en `expires_at − 15 min` si faltan más de 15 min, `kind = expiry` en `expires_at`), que `resolve-reads` manda cuando `fire_at ≤ now()` con el mark del momento. **Nada cierra la posición ni coloca take-profit**: el usuario cierra a mano desde Markets. **(F3)** Archivos reales: `src/reads/level.ts` (puro), `postReminders` en `reads/api.ts`, `parseRemindersResponse` en `reads/types.ts`, `useReads.setReminders`, `LevelCard` en `market.tsx`. Los recordatorios se programan tras mostrar el resultado de la orden y el nivel se consume si se programaron (P7); `reminder-set` reutiliza la sesión firmada de Ask y pide el permiso de push si aún no se pidió (P8). El push de recordatorio abre Trade sin `LevelCard` (P9). Con `PUSH_MODE = "local"` se programan además dos notificaciones locales. | Es el puente entre la lectura y el trade real sin custodiar keys ni prometer un cierre que Perpl no ejecuta por tiempo. El recordatorio se programa sólo si hubo orden. |
| D13 | Store y navegación | `StoreState` gana `askView: "new" \| "mine"` (default `new`), `askCell?: { levelBps, horizonMin }`, `askAgentId?: string`, `askFocusReadId?: string` (para abrir una read desde un push), `tradeLevel?: TradeLevel`. `marketTab` conserva default `trade`. **(gate)** Desde Markets, sin trading key el mercado se abre con `marketTab: "ask"` (`marketEntryTab(hasKey)`); Ask y Agents no dependen de Perpl. `headerFor("market")` subtitula por pill: `trade` → "Perpl · isolated margin · market order", `ask` → "Ask an agent · simulated credits", `agents` → "Who reads this market" (**(F2)** firma real `headerFor(screen, symbol?, marketTab = "trade")`; `useAppStore` pasa `S.marketTab`). **(F2)** `TradeLevel` y `tradeLevel?` se declaran en F2 aunque los use F3 (P9). `COMING_SOON_COPY` pierde `ask` y `agents`; `ComingSoonCard` sólo queda para los tabs. `signedOutState` no cambia; el Sign out borra además la sesión de reads (D6). **(F2)** salvo que además limpia el estado de Ask (revisión final): `askView` vuelve a `"new"` y `askCell`/`askAgentId`/`askFocusReadId`/`tradeLevel` quedan `undefined`, para que otra cuenta no herede la celda, agente o read enfocada de la sesión anterior. | Cambios mínimos sobre el store de `mobile-hifi`; todo lo nuevo es opcional y se prueba en `store.test.ts`. |
| D14 | Pantalla Ask | `src/screens/ask.tsx`: `Segmented` **New read | My reads**. **New read**: fila de créditos (`Tag CREDITS` + cifra mono + "1 credit per read"), `MatrixGrid` 5×4 (celda = `pill(on)` con `+2.5%` y el target en mono 9.5; columnas 1H 4H 12H 24H; el mark actual arriba: "Mark 65,120 · updates every 5 s"), y al tocar una celda la **`AskSheet`** inline debajo de la matriz: la pregunta en `display 16`, chips de agente (`name · by owner · price`), `Btn lime` **"Ask {agent} · 1 credit"**, `Btn outline` **"Trade this level"**. Estados: `pending` (`StatusCard` "Reading… up to 60 s" con spinner), `failed` ("Refunded 1 credit"), y **`ReadCard`** (probabilidad `display 30` "62 %", `Chip` YES/NO call, `Tag REASONS` + 3 filas, `Tag WHAT WOULD BREAK IT` + texto, "Resolves in 3 h 58 m" (cuenta regresiva de `expires_at`), `Btn` "Trade this level", `Btn ghost` "Ask another"). **My reads**: lista `ReadRow` (celda `+1.0% · 4H`, agente, probabilidad, `Chip` OPEN/RIGHT/WRONG/VOID/FAILED con tonos `warn`/`up`/`down`/`faint`, "resolves in…" o "resolved at {mark}"), tocar abre la `ReadCard`; vacío: "No reads on {symbol} yet." Sin créditos: `Btn` deshabilitado "No credits left" + copy "Credits are simulated for the testnet." **(F2)** «Trade this level» (hoja y card) **no se renderiza hasta F3** (P9). My reads es store-driven por `askFocusReadId` (P8): el `ReadRow`, «Back to list» y el push usan el mismo campo. `SessionGate` («Unlock to ask») se muestra en ambas vistas cuando la sesión no está lista. **Regla del agente**: `AskSheet` resuelve el agente que muestra (`find(id) ?? agents[0]`) y **ese mismo `agent.id`** es el que manda `onAsk` — sin fallback distinto ni literal `"jesus"` (revisión de Task 8: si el catálogo se refresca entre el chip y el botón, el cobro va al agente mostrado). **(F2-matrix)** La descripción de la matriz de arriba (celda = `pill(on)` con `+2.5%` y el target) fue un error al escribir el spec, no de la ejecución: la matriz es el `Grid` del prototipo (`pickler-mobile` `src/screens/markets.js`): card `C.card` con borde `C.hair` radio 14; columna de 74 px con `Sparkline`; escalera de precios de 58 px (mono 9.5, `C.faint`, acento en la fila seleccionada; el precio es `targetFor(mark, bps)`); celdas de 44 px **sin texto** con un punto de 5 px donde el usuario ya tiene reads `open/right/wrong` en esa celda; al tocar, fila y columna en `accSoft` y la celda en `accOn` (violeta en Ask; lima en Trade, F3); regla lima bajo la fila `+0.5 %` (el mark); horizontes `1H 4H 12H 24H` abajo. Encima de la card, `Tag HISTORY · MARK` + mark mono 700/15. **Los niveles son los 5 del spec (D2), no los 7 del prototipo.** La hoja de la celda es la del prototipo (`ConsultTab`): `Card vioBd45/vioBg07`, chip «Asking {agente} · 1 credit» + «Change» (despliega los chips de agente inline), `Tag vio YOUR QUESTION · NOTHING SENT`, pregunta 700/14, línea mono `RESOLVES ON PERPL MARK · {±x.x% FROM MARK}`, dos `Stepper` (nivel: target formateado; horizonte), «Ask {agente} · 1 credit» (outline, arrow, flex) + «Clear» (ghost), «Nothing charged yet.». Debajo de la matriz, hint «Tap a cell: a level and a horizon.» / «Use the steppers to move it.»; después de la hoja, card `MARK PRICE · PERPL ON MONAD` + «Reads resolve on mark, not on your fill.» **sin** la fila FUNDING/NEXT/OI (no hay datos). La fila de créditos se conserva encima de la cabecera. **La sparkline usa datos reales**: el prototipo dibuja una serie fake; `pub/context` no da historial, así que la app guarda los últimos 60 marks recibidos por mercado (`usePerpl.marks`, en memoria) y con < 2 puntos dibuja una línea plana. Plan `2026-09-20-mobile-ask-matrix.md`. **(F3)** «Trade this level» se renderiza en la hoja (outline lima, bajo Ask/Clear) y en la card sólo con la read `open`. | Es la pantalla Ask del prototipo con las primitivas de `mobile-hifi` (D12 de ese spec) y sin inventar componentes nuevos salvo la matriz. |
| D15 | Pantalla Agents | `src/screens/agents.tsx`: lista `TouchCard` por agente (`Avatar` con inicial, `name` `700 14`, `by {owner}` `faint`, récord mono "7/10 right · Brier 0.21" o "No resolved reads yet", precio "1 credit"); tocar → `set({ askAgentId, marketTab: "ask", askView: "new" })`. Carga `agents-list` al montar y en pull-to-refresh del Shell (`refreshable` gana `market`). | Lista con récord real, nada más: el detalle por agente queda fuera (D18). |
| D16 | Cliente de reads en la app | `src/config/reads.ts` (`READS_URL = https://yvdipvcrpbqvofayteqf.supabase.co/functions/v1`, override `readsUrl` en `app.config.ts`), `src/reads/types.ts` (tipos y parsers estrictos como `perpl/context.ts`), `src/reads/matrix.ts` (puro: `targetFor`, `questionFor`, `LEVELS_BPS`, `HORIZONS_MIN`, `callOf`, `outcomeOf`), `src/reads/session.ts` (D6), `src/reads/api.ts` (`fetch` con `AbortController` + `setTimeout` de 65 s en `read-request`, 15 s en el resto: `AbortSignal.timeout` no existe en RN), `src/hooks/useReads.ts` (créditos, lista por mercado, `request`, `get`, polling de 15 s mientras Ask está visible y refetch al volver al foreground), `src/hooks/useNotifications.ts` (permiso, token, handler de tap → `nav("market", {...})`). **(F2)** Archivos reales: `src/reads/{constants,matrix,types,session,api,push}.ts` (`constants.ts` puro: `READS_URL_DEFAULT`, timeouts 65 s / 15 s, poll 15 s; `push.ts` puro: `pushTargetOf`, `patchForPush`, `pushEnvFor`, `localResolutionContent`), `src/storage/reads.ts` (SecureStore `pickler.reads.v1`), `src/config/reads.ts` (`READS_URL`, `PUSH_MODE`), hooks `useReads` y `useNotifications`; el tap navega con `requireAccount`, no con `nav` (P7). `expo-notifications ~57.0.20` (tilde; el resto de dependencias Expo va exacto). Tests jest: `reads-config`, `reads-matrix`, `reads-types`, `reads-session`, `reads-api`, `reads-push`, `store`, `comingSoon`. **(F2-matrix)** `src/perpl/marks.ts` (puro: `SPARK_POINTS = 60`, `appendMarks`, `sparkPoints`) y `Perpl.marks`; `matrix.ts` gana `stepLevel`, `stepHorizon`, `distanceLabel`, `dotKey`, `readDots`; `theme.ts` gana `GRID_ACCENT`, `GRID_DOT`, `GRID_MARK_RULE`; `primitives.tsx` gana `Sparkline` (react-native-svg) y `Stepper`. Test nuevo `perpl-marks`. | Misma arquitectura que Perpl: módulos puros con tests y un hook que los orquesta. |
| D17 | Fases | **F1 backend** (D3–D5, D7–D10 lado servidor): migraciones, seed, funciones, cron, `migrate.mjs`, prueba de APNs con `curl`; se cierra con una read pedida y resuelta por `curl` con una firma generada por script. **F2 app Ask + Agents** (D6, D13–D16, y el push de resolución de D10): `expo-notifications`, sesión firmada, matriz, `AskSheet`, `ReadCard`, My reads, Agents. **F3 Trade** (D11, D12): `MarketDataSocket`, `BookCard`, `LevelCard`, `reminder-set`, recordatorios. **F4** siguiente build de TestFlight tras el merge (`buildNumber` siguiente) con tracker `pickler-dev-new`. Cada fase: plan propio, revisión independiente por subagente, audit. | El backend se puede probar sin la app; la app sin el book; el book sin TestFlight. Cuatro checkpoints en 24 días. |
| D18 | Fuera de alcance | Cierre automático de posiciones, órdenes trigger/take-profit, compra de créditos o créditos reales, detalle por agente y follow, agentes creados por usuarios, Polymarket, mudar el servicio al runtime de Gilbert, Launchpad/Activity/Portfolio (siguen *coming soon*), Android, búsqueda web o herramientas en el modelo, PostgREST/RLS sobre `mobile` (todo pasa por funciones con service role). | 24 días; nada de esto es necesario para que un jurado vea Ask → Trade → resolución. |
| D19 | Secretos y despliegue | `.env.pickler` en la raíz (gitignored) es la fuente local; `services/reads/.env.example` documenta los nombres. Secretos de funciones (`npx supabase secrets set --project-ref yvdipvcrpbqvofayteqf`): `ANTHROPIC_API_KEY`, `CRON_SECRET`, `APNS_KEY_P8_B64`, `APNS_KEY_ID`, `APNS_TEAM_ID`, `PERPL_REST` (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` y `SUPABASE_DB_URL` los inyecta la plataforma). **(F1)** CLI de Supabase fijada como devDependency `supabase@2.117.0` en `services/reads/package.json` e invocada siempre como `npx supabase …` desde `services/reads` (el `brew upgrade` previsto no se hizo: el sistema de permisos denegó `brew trust supabase/tap`; la global sigue en 2.22.12); despliegue `npx supabase functions deploy <name> --project-ref … --no-verify-jwt`. En F1 se subieron `ANTHROPIC_API_KEY`, `PERPL_REST` y `CRON_SECRET`; los `APNS_*` esperan la key. El cron guarda `CRON_SECRET` en Vault (`vault.create_secret`) y lo lee en el `cron.schedule`, no en texto plano en `cron.job`. Nada de esto se commitea. | Un solo lugar para las llaves y un despliegue reproducible desde la CLI, sin depender del MCP equivocado. |
| D20 | Guardas | `read-request`: máximo **10 reads por dirección cada 10 min** (`429 rate_limited`), body validado con zod, mercado debe existir y estar abierto en el context, celda debe pertenecer a la matriz. **(F1)** tope global de 60 reads cada 10 min entre todas las wallets → `503 busy` (revisión final F1). Todas las funciones responden `{ error: string }` con 4xx/5xx y nunca devuelven la persona del agente ni tokens. `resolve-reads` es idempotente (marca por `id` con `status = 'open'` en el `WHERE`). Logs sin direcciones completas (solo `0x1234…abcd`). | El servicio es público en internet aunque la app sea privada; los créditos simulados no valen nada pero el API key de Anthropic sí. |

---

## 2. Unidades

### 2.1 Esquema `mobile` (F1)

```sql
create schema if not exists mobile;

create table mobile.migrations (name text primary key, applied_at timestamptz not null default now());

create table mobile.agents (
  id text primary key,                 -- 'jesus' | 'drift' | 'anchor'
  handle text not null unique,
  name text not null,
  owner text not null,
  persona text not null,               -- system prompt; nunca sale por la API
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
  mark_at_request bigint not null,     -- escalado por price_decimals, como Perpl
  target bigint not null,
  question text not null,
  status text not null default 'pending'
    check (status in ('pending', 'open', 'right', 'wrong', 'void', 'failed')),
  probability numeric(4,3),
  reasons jsonb,                       -- ["…", "…", "…"]
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
create index on mobile.reads (address, created_at desc);
create index on mobile.reads (expires_at) where status = 'open';
create index on mobile.reads (created_at) where status = 'pending';

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
create index on mobile.reminders (fire_at) where status = 'scheduled';

create table mobile.devices (
  address text primary key references mobile.wallets(address),
  token text not null,
  env text not null check (env in ('sandbox', 'production')),
  updated_at timestamptz not null default now()
);

create view mobile.agent_records as
select a.id, a.handle, a.name, a.owner, a.price_credits, a.sort,
       count(r.id) filter (where r.status in ('open','right','wrong')) as reads,
       count(r.id) filter (where r.status in ('right','wrong')) as resolved,
       count(r.id) filter (where r.status = 'right') as right_count,   -- (F1) `right` es palabra reservada (P4)
       avg(r.brier) filter (where r.status in ('right','wrong')) as brier_avg
from mobile.agents a left join mobile.reads r on r.agent_id = a.id
where a.active group by a.id;

-- (F1) Upsert de la wallet con 20 créditos y evento grant; devuelve el saldo (P12). La llaman reads-list y request_read.
create function mobile.ensure_wallet(p_address text) returns int language plpgsql security definer …;

-- Cobro + insert en una transacción (security definer; la llama sólo el service role).
-- Lanza P0001 unknown_agent y P0002 no_credits.
create function mobile.request_read(p_address text, p_agent text, p_market int, p_symbol text,
  p_level int, p_horizon int, p_pd int, p_mark bigint, p_target bigint, p_question text, p_expires timestamptz)
returns mobile.reads language plpgsql security definer as $$ … $$;

-- Reembolso idempotente: `failed` sólo desde `pending`, `void` sólo desde `open` (migración 0005).
-- (F1, 0002) Rechaza p_status distinto de 'failed'/'void' con P0003 bad_status.
create function mobile.refund_read(p_read uuid, p_status text, p_error text) returns void …;
```

Sin RLS ni grants a `anon`/`authenticated`: sólo el service role (las funciones) lee y escribe `mobile`.
**(F1)** Postgres da `EXECUTE` a `PUBLIC` por defecto en toda función nueva: `0002_function_privileges.sql`
lo revoca en las tres (`has_function_privilege('anon'|'authenticated', …, 'execute') = false`).

### 2.2 `services/reads/` (F1)

```
services/reads/
  README.md                      cómo migrar, desplegar, probar; qué NO tocar del proyecto compartido
  .env.example                   nombres de las variables (valores en ../../.env.pickler)
  package.json                   scripts: migrate, test (node --test + deno test), sign, deploy (npx supabase). (F1) devDependencies:
                                 viem, supabase@2.117.0 (la CLI), y zod / @anthropic-ai/sdk / postgres con los mismos pines que los
                                 `npm:` de las funciones — con node_modules presente, Deno resuelve `npm:` sólo desde ahí; deno.lock se commitea
  deno.lock                      (F1) resoluciones npm:/jsr: de los tests; el deploy no lo usa
  scripts/{env,api,query}.mjs    (F1) carga de .env.pickler, Management API y consulta puntual (--read-only)
  scripts/migrate.mjs            aplica supabase/migrations/*.sql pendientes vía Management API; ledger mobile.migrations
  scripts/sign.mjs               genera headers x-pickler-* con una private key de prueba (para curl)
  scripts/smoke.mjs              (F1: .mjs, no .sh) agents-list → reads-list → read-request → read-get → reads-list → read-get ajeno (401)
  supabase/config.toml           [functions.<name>] verify_jwt = false
  supabase/migrations/0001_schema.sql · 0002_function_privileges.sql · 0003_seed_agents.sql · 0004_cron.sql ·
                                 0005_refund_transitions.sql   (F1: cinco, no tres; 0005 de la revisión final)
  supabase/functions/_shared/{auth,db,perpl,claude,apns,matrix,http,dto,copy}.ts
  supabase/functions/{agents-list,read-request,read-get,reads-list,reminder-set,resolve-reads}/index.ts
  supabase/functions/_shared/*.test.ts   deno test (F1: 28): auth (firma válida/vencida/ajena, límites de la ventana), matrix (target, pregunta,
                                 outcome, brier), apns (JWT verificado con la pública, sendPush), claude (params del parse con cliente falso),
                                 perpl (fixture, 5xx, abort), dto, copy. scripts/migrate.test.mjs: node --test (2).
```

Contratos (JSON; fechas ISO UTC; enteros escalados como Perpl y `priceDecimals` al lado):

- `GET agents-list` → `{ agents: [{ id, handle, name, owner, priceCredits, record: { reads, resolved, right, brierAvg } }] }`
- `POST read-request` `{ marketId, levelBps, horizonMin, agentId, pushToken?, pushEnv? }` → `200 { read, credits }`;
  `402 no_credits` · `409 market_closed` · `422 bad_body` · `422 unknown_agent` · `429 rate_limited` · `503 perpl_unavailable`
  (**(F1)** el `bad_cell` original es lo que la unión de zod rechaza y sale como `bad_body`; `unknown_agent` faltaba).
  `read` = `{ id, marketId, symbol, priceDecimals, levelBps, horizonMin, markAtRequest, target, question, status,
  probability, reasons, limits, agentId, createdAt, expiresAt, resolvedAt, markAtResolution, outcome, creditsCharged }`.
- `GET read-get?id=` → `{ read }` (404 si no es del firmante).
- `GET reads-list?marketId=` → `{ reads: [...], credits }` (máx. 50, más recientes primero).
- `POST reminder-set` `{ marketId, levelBps, horizonMin, target, expiresAt, side, readId?, pushToken?, pushEnv? }` → `{ reminders: [{ id, kind, fireAt }] }`.
- `POST resolve-reads` (header `x-cron-secret`) → `{ refunded, resolved, voided, remindersSent, pushSent }` (**(F1)** `pushSent` cuenta
  los APNs entregados; con body `{ apnsSmoke: { token, env } }` → `{ apns: … }` o `503 apns_unavailable`, D5).

`0004_cron.sql` (**(F1)** era `0003_cron.sql`): `select cron.schedule('mobile-resolve-reads', '* * * * *', $$ select net.http_post(url := '<SUPABASE_URL>/functions/v1/resolve-reads', headers := jsonb_build_object('x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'mobile_cron_secret')), body := '{}'::jsonb) $$);`

### 2.3 App — módulos nuevos (F2 salvo donde se indica)

- `src/config/reads.ts`, `src/reads/{types,matrix,session,api}.ts`, `src/hooks/useReads.ts`, `src/hooks/useNotifications.ts` (D16). **(F2)** Además `src/reads/constants.ts`, `src/reads/push.ts` y `src/storage/reads.ts`.
- `src/screens/ask.tsx` (`AskTab`, `MatrixGrid`, `AskSheet`, `ReadCard`, `ReadRow`) y `src/screens/agents.tsx` (`AgentsTab`) (D14, D15) (**F2-matrix**: `MatrixGrid` = `Grid` del prototipo, `AskSheet` con `Stepper`).
- `src/perpl/marks.ts`, `Sparkline`/`Stepper` en `src/ui/primitives.tsx` (F2-matrix).
- `src/screens/market.tsx`: `PillTabs` enruta a `AskTab` / `TradeTab` / `AgentsTab`; `TradeTab` gana `LevelCard` y `BookCard` (F3).
- `src/perpl/marketData.ts` (`MarketDataSocket`, `parseBookFrame`, `applyBookFrame`, `BookState`) y `src/hooks/useOrderBook.ts` (F3, D11). `perpl/config.ts` gana `PERPL_MARKET_DATA_WS`.
- `src/store.ts` (D13), `src/ctx.ts` (`AppCtx` gana `reads: Reads` y `notifications: Notifications`), `src/hooks/useAccount.ts` (`signOut` borra también `pickler.reads.v1`), `src/screens/comingSoonCopy.ts` (sin `ask`/`agents`).
- `App.tsx`: `useReads` y `useNotifications` montados junto a `usePerpl`; `PERPL_SCREENS` sin cambio.
- `app.config.ts`: plugin `expo-notifications`, `extra.readsUrl`, `extra.perplMarketDataWs`; `package.json`: `expo-notifications` a la versión que resuelva `npx expo install` para SDK 57. Rebuild nativo (`npx expo run:ios`).
- Tests jest: `reads-matrix.test.ts` (targets con `priceDecimals` de BTC/ETH/MON, preguntas, `outcomeOf`, `callOf`), `reads-session.test.ts` (mensaje canónico, vigencia, borrado), `reads-types.test.ts` (parseo estricto de `read`), `store.test.ts` (ampliado), `perpl-market-data.test.ts` (F3: snapshot, update, reconexión, un solo sub por socket). **(F2)** Reales: `reads-config` (1), `reads-matrix` (13), `reads-types` (11, con fixture `__tests__/fixtures/reads/read.json` de la read del smoke F1), `reads-session` (5), `reads-api` (14), `reads-push` (4), `store` (+3), `comingSoon` (2, ahora comprueba que `COMING_SOON_COPY` no tiene `ask`/`agents`): **30 suites / 230 tests** (de 24 / 179). Sin tests de hooks ni pantallas (P12): `tsc` + simulador.

---

## 3. Verificación

Regla general: `npm test` y `npx tsc --noEmit` en `apps/mobile` y `deno test` en `services/reads` en verde en
cada fase, con la salida pegada en el audit; revisión independiente por subagente antes de cerrar cada
fase; `npm run agents:check` y `npm run docs:check` en la raíz. Simulador: **UDID
`2B2A0BAD-7B14-4DAE-8652-C7E9472505E0`, nunca `booted`**. Nada de push, merge ni TestFlight sin
autorización de Jesús en esa sesión.

- **F1**: `npx supabase --version` ≥ 2.111 y `npx supabase projects list` muestra sólo `pickler`; `migrate.mjs`
  aplica 0001–0004 (**(F1)**) y una segunda corrida no aplica nada; `select * from mobile.agent_records` devuelve los
  tres agentes; `smoke.mjs` con una key de prueba: `agents-list` 200, `read-request` 200 en < 60 s con
  `probability` y 3 razones, `credits` pasa de 20 a 19, `read-get` 200, `reads-list` la lista; una read
  con `horizon_min = 60` forzada a `expires_at = now()` (por SQL) queda `right` o `wrong` con
  `mark_at_resolution` al minuto siguiente por el cron (`cron.job_run_details`); una read `pending`
  insertada a mano con `created_at = now() − 2 min` queda `failed` y reembolsada; una firma vencida o
  de otra dirección da 401; sin créditos da 402. APNs: `curl` HTTP/2 con el JWT generado por `apns.ts`
  a un token del simulador (o del iPhone de Jesús) llega como notificación → si no, se activa el
  fallback de D10 y queda en el audit. Los esquemas y tablas de Gilbert no cambian: `\dn` y un
  `select count(*) from information_schema.tables where table_schema <> 'mobile'` antes y después,
  iguales.
- **F2**: en el simulador con la cuenta #620: Ask muestra créditos 20, mark vivo y la matriz con
  targets coherentes (BTC +1.0 % = mark × 1.01 a `priceDecimals`); primera lectura pide Face ID una
  sola vez, luego no; `AskSheet` → `pending` → `ReadCard` en < 60 s; créditos 19; My reads la lista
  como OPEN; Agents muestra los tres con "No resolved reads yet" y tocar uno preselecciona; con una
  read forzada a vencer por SQL, el cron la resuelve y **el push llega al simulador** (o la
  notificación local del fallback) y tocarlo abre `market` en My reads con esa read; Sign out + sign
  in vuelve a pedir la firma. Capturas de cada estado; saldos AUSD/MON sin cambio (no se mueve dinero).
  **(F2) Lo verificado y cómo** (audit F2 §1 y §4, 2026-09-20, simulador `2B2A…05E0`, wallet
  `0xe371…51c1`, sin tocar la cuenta #620): créditos 20 → 19 en pantalla y en `mobile.wallets`;
  targets a mano (`+1.0 %` = round(80770.1 × 1.01, 1) = 81577.8); `pending` → `ReadCard` en ~10 s
  (tan rápido que el spinner no se capturó); read `9f386c32…` `open` → forzada por SQL
  (`expires_at = now() − 1 s`) → `right` a los ~37 s por el cron (`net._http_response` `{"resolved":1,
  …,"pushSent":0}`); token APNs en `mobile.devices` (`sandbox`, `length 160`); tap del push con
  `xcrun simctl push` en segundo plano ✓ y en frío ✓ tras el fix `3a15792`; Sign out borra la sesión
  (gate tras sign out + Lock). **Queda para el iPhone / la key APNs**: el push real (`pushSent` sigue
  en 0 sin `APNS_*`) y el prompt visible de Face ID (el simulador resolvió la lectura autenticada del
  keychain sin prompt). Con la wallet `unlocked` tras el passkey la sesión se firma sola (P3), así que
  «pide Face ID una sola vez» se cumplió como «ninguna vez visible».
- **F3**: **(F3) Lo verificado y cómo** (audit F3 §1 y §4, 2026-09-22, simulador `2B2A…05E0`, wallet
  `0xe371…51c1`): `BookCard` con bids/asks que cambian y el spread en vivo (spread 1.2 bps, 8.2 bps en
  el reintento), 5 niveles por lado; cambiar de pill cierra el socket y volver lo reabre (`LIVE` de
  nuevo); «Trade this level» desde la `ReadCard` de una read `open` pone el lado sugerido y la
  `LevelCard` con target/vencimiento; sign out limpia `tradeLevel` (incluso uno colgado por una orden
  fallida); un push sintético de recordatorio abre Market → Trade sin `LevelCard` (P9); `metro.log` sin
  `ERROR`/`Require cycle`. **No verificado end to end**: la única orden autorizada (2.00 AUSD, 1x, LONG
  BTC, nivel +0.5%·1H) quedó **`unknown`** (Perpl no confirmó en 30 s) y nunca llenó — posiciones en
  0.00 antes y después, `104.86 AUSD free in trading` sin cambio, `LevelCard` no consumido. Por
  guardrail, no se reintentó más de una vez; un reintento autorizado se abortó dos veces antes de
  `Confirm` por colisión del simulador con otra sesión (Proflores). Consecuencia: **`reminder-set` nunca
  se llamó con datos reales, ninguna fila se creó en `mobile.reminders` y el cron con `fire_at` forzado
  y `remindersSent` nunca se ejercitó en la app** — la ruta de recordatorios está cubierta por test
  unitario (Tasks 1–3) y por el curl server-side de F1, no por un recorrido real en el simulador. Ver
  audit F3 §1 (tabla por task), §4 (saldos antes/después) y §5 (primer residual).
- **F4**: `buildNumber` siguiente (los builds 6–9 de TestFlight ya subieron otras fases; éste sube
  con Ask + Trade completos de F3), archive, upload, `VALID` con el grupo Equipo, tracker
  `docs/overview/dev/<fecha>-testflight-build<N>.html`; en el iPhone de Jesús: una lectura completa
  (pedir → push de resolución) y un nivel con recordatorio.

---

## 4. Riesgos conocidos

| Riesgo | Mitigación |
|---|---|
| APNs exige HTTP/2; el edge runtime de Supabase (Deno) podría negociar sólo HTTP/1.1 en `fetch`. | Se prueba en F1 antes de escribir nada en la app (`curl --http2` desde local y luego desde la función); fallback a notificaciones locales (D10) decidido de antemano, sin rediseño. |
| Proyecto Supabase compartido: un comando equivocado (`db push`, `db reset`, migrador Drizzle) toca lo de Gilbert. | Migrador propio vía Management API y ledger `mobile.migrations`; README de `services/reads` con la lista de comandos prohibidos; conteo de tablas ajenas antes/después en el audit. |
| `pg_cron` / `pg_net` / Vault pueden no estar habilitados en el proyecto o requerir el rol `postgres`. | F1 empieza con `select * from pg_extension`; habilitar es idempotente; si Vault no está, `CRON_SECRET` va en `cron.job` como último recurso y queda anotado. |
| Latencia del modelo > 50 s en picos → reads `failed` y reembolsadas de más. | `effort medium`, `max_tokens 1024`, `maxRetries 1`; se mide `latency_ms` en el smoke y en el audit; si el p95 supera 30 s se baja a `effort low`. |
| Edge functions con `verify_jwt = false` quedan abiertas a internet. | Auth por firma en todo lo que escribe, rate limit por dirección, `x-cron-secret` en el cron, `agents-list` sólo devuelve datos públicos. |
| `expo-notifications` es módulo nativo: exige capability Push en el App ID y perfil nuevo; el archive usa `-allowProvisioningUpdates`. | Rebuild `npx expo run:ios` en F2 y verificación del entitlement `aps-environment` en el `.ipa` de F4 (`codesign -d --entitlements`). |
| Límite de 10 requests/min en market-data: reconexiones agresivas cierran el socket con `1008`. | Un socket por ticket, una suscripción, `RECONNECT_DELAYS_MS` con backoff; los frames van al fixture para que el parser no dependa del testnet vivo. |
| El mark de la app (poll de 5 s) y el del servidor difieren al crear la read. | El servidor manda la verdad; la app pinta los valores devueltos y el copy dice "at request". |
| Cuenta #620 con dos keys de trading de más y 0.0551 MON. | Revocar en `testnet.perpl.xyz/apikeys` antes de F3; F3 gasta gas sólo en la orden de prueba. **Jesús, 2026-09-22: todavía no revocadas.** |
| 24 días y cuatro fases. | F1 y F2 son el mínimo demostrable (Ask completo); F3 puede reducirse a `LevelCard` + recordatorios sin book si el tiempo aprieta, decisión en el checkpoint de F2. |

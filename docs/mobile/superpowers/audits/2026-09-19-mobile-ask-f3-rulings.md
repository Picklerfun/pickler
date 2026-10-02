# Audit — Ask F3: order book L2 (D11), «Trade this level» y recordatorios (D12), F4 retitulada (2026-09-22)

Cierre de F3 de `mobile-ask`: Trade gana el **order book L2** de Perpl (`MarketDataSocket`, `BookCard` con
5 niveles por lado y spread en bps, un socket por ticket visible) y el puente completo con Ask —
**«Trade this level»** desde la hoja de una celda o la card de una read `open` pone el nivel en el store,
sugiere el lado y abre Trade con `LevelCard`; tras una orden `filled`/`open` la app llama `reminder-set`
(firmado) para programar `pre` (15 min antes) y `expiry`. **270/270 tests, 35 suites, `tsc` limpio.**
Verificado en el simulador (cuenta #620, `0xe371…51c1`): `LevelCard` desde una celda y desde una read,
remoción de nivel, book `LIVE` con datos reales que cambian, socket que se cierra y reabre al cambiar de
pill, línea de target «above/inside/below the book», sign-out que limpia `tradeLevel` (incluso uno colgado
por una orden fallida), push sintético de recordatorio que abre Trade, `metro.log` limpio.

**Verificado end to end el 2026-09-23** (retomado tras liberar el simulador; ver §1.1 y la sección
«Fill definitivo — cierre exitoso» de `task-8-report.md`): intento 1 (22 sep) quedó **`unknown`** — Perpl
no confirmó dentro del timeout de 30 s (`ORDER_TIMEOUT_MS`) — y dos reintentos se abortaron antes de
`Confirm` por colisión de simulador (Proflores) y por una pérdida de foreground hacia el Home Screen. El
intento definitivo (23 sep), con el simulador hecho exclusivo (los otros tres UDIDs apagados, autorizado
por Jesús), **llenó**: 0.00002 BTC LONG @ 86671.8, margen 2.00 AUSD, 1x, fee taker 0.0005 AUSD, `Confirm`
único a las 2026-09-23T01:18:48Z. La app llamó `reminder-set` tras el fill y mostró la nota de
recordatorios; se crearon dos filas en `mobile.reminders` para `0xe371…51C1` (`pre` `4d0db863…`, `expiry`
`af4b6755…`), ambas forzadas por SQL y procesadas por el cron a `status = sent` (ticks `{"refunded":0,
"resolved":0,"voided":0,"remindersSent":1,"pushSent":0}`, ids 3990 y 3992 — **`pushSent: 0`**: el pipeline
de recordatorios corrió limpio, pero **no hubo entrega real de push** porque los secretos APNs siguen
ausentes; `sent` aquí significa "procesado por `resolve-reads`", no "llegó al dispositivo"). La posición se
cerró a mano desde Markets (0.00002 BTC @ 86588.1, fee 0.0005 AUSD). Trading 104.86 free → 103.13 free +
1.73 en posición → 104.86 free; RPC on-chain AUSD 29.00 / MON 0.03850114 sin cambio antes y después (todo
el movimiento vivió dentro del saldo de trading de Perpl). El intento `unknown` del 22 sep y los dos
reintentos abortados quedan en el registro como historia — no se borran, explican la secuencia.

Rama `feat/mobile-ask-f3`, base `main` (`5b9acfd`), **8 commits** (`5b9acfd` docs base del plan + 7 de código
`07dd719..5fb26fe`) más el de esta documentación; **mergeada y pusheada a `origin/main`** (`38c3fa0`).
Spec: `docs/superpowers/specs/2026-09-19-mobile-ask-design.md` (D11, D12, D14 y §3/§4 marcados **(F3)**);
plan: `docs/superpowers/plans/2026-09-19-mobile-ask-f3.md` (P1–P15). Ejecutado con
subagent-driven-development: un implementador por task (Tasks 1–8), revisión por task, el controlador
commiteando por nombre de archivo y llevando el ledger (`.superpowers/sdd/2026-09-19-mobile-ask-f3/progress.md`).

**F3 queda `completed`** (ruling 8, abajo, y confirmado por el fill definitivo del 23 sep): D11 y D12 tienen
implementación, tests y verificación visual completos, y el ítem que antes quedaba sin evidencia real (la
orden llenada + recordatorios + cron) ya se ejecutó end to end. El único residual que queda de esta fase es
el push **real** (`pushSent: 0`, key APNs pendiente) — ver §5.

## 1. Qué quedó hecho y verificado

Por task; los comandos y salidas son los de los reportes de cada implementador
(`.superpowers/sdd/2026-09-19-mobile-ask-f3/task-*-report.md`), no una paráfrasis. Baseline antes de Task 1:
`244 tests, 33 suites` (README de F2), `TSC-OK`.

| Task | Evidencia |
|---|---|
| **1** — `src/reads/level.ts`, `src/hooks/useNow.ts` (`07dd719`) | RED: `Cannot find module '../src/reads/level'`. GREEN: 7 tests transcritos verbatim del brief (`levelFromCell previews target and expiry from the app mark (D2, P10)`, `levelFromRead takes the server values and the read id`, `sideFor suggests long above the mark and short below (D12)`, `levelIsLive is strict on expiry`, `resolvesLabel shows local time and the remaining time`, `levelTitle is symbol + cell label`, `reminderKinds mirrors reminder-set: pre only if more than 15 min remain`). Suite **251/251, 34 suites**; `tsc` limpio. Minor (no acción): `sideFor(0)` no alcanzable. |
| **2** — `src/reads/types.ts` (`Reminder`, `parseRemindersResponse`), `src/reads/api.ts` (`postReminders`), `src/reads/push.ts` (`localReminderContent`, comentario P9) (`6c20e55`) | RED: 4 failed / 30 passed (símbolos nuevos inexistentes). GREEN: **256/256**; `tsc` limpio. Sólo los 6 archivos del brief tocados (`git status --short` antes del commit). Minors (deferred): `Reminder.kind`/`localReminderContent(kind)` inlinean `"pre" \| "expiry"` en vez de importar `ReminderKind` de `level.ts` (byte-idéntico hoy); `postReminders`/`localReminderContent` sin consumidor hasta Task 3 (esperado). |
| **3** — `src/hooks/useNotifications.ts` (`scheduleLocalReminders`), `src/hooks/useReads.ts` (`setReminders`) (`50c3524`) | Código verbatim del brief; `tsc` limpio; suite **256/256** sin cambio (P12: hooks sin test unitario, la lógica con reglas vive en `level.ts`/`api.ts`). `git status --short` antes del commit mostraba únicamente los dos archivos del brief. |
| **4** — «Trade this level» en `ask.tsx` (hoja + `cardFooter` de las dos `ReadCard`), `LevelCard`/`OrderResult.note`/`confirm` en `market.tsx` (`53ff48b`) | `tsc` limpio; suite **256/256**. Smoke: `03-markets.png`, `04-ask-tab.png`, `05-sheet.png`, **`04-levelcard.png`** (`LevelCard` con `TRADE THIS LEVEL · FROM ASK`, target/resolves/suggested LONG, nota de recordatorios, `Remove level`; `Segmented` en Long), **`05-removed.png`** (nivel y fila `LEVEL` removidos). Metro PID 55611 desde el worktree. **CHECKPOINT D12 (P1): F3 entregable en versión reducida aquí.** Sin `Review`/`Confirm`, sin Enable/Reconnect/Reset, sin depósito/retiro. |
| **5** — script `perpl-market-data-capture.mjs` y fixture `market-data-frames.json` (`0d7c7a2`) | Una sola corrida de 20 s (`--market 16 --seconds 20`): `{ '6': 1, '15': 1, '16': 4 }`, `sid 1000016`, snapshot `bid[113]`/`ask[10]` ordenado (mejor precio primero), **34 niveles con `o: 0`** en los updates (objetivo de borrado ampliamente cubierto), 6169 bytes. `EXIT:0`, no hizo falta repetir. |
| **6** — `src/perpl/marketData.ts` (parser, libro, `MarketDataSocket`), `perpl/config.ts`/`config/perpl.ts`/`app.config.ts` (`65a34e1`) | RED: `Cannot find module '../src/perpl/marketData'`. GREEN: **13/13** tests del módulo (incluido uno contra los frames reales de Task 5: `updates are deltas per price level: o 0 removes, anything else upserts (P4, real frames)`), + 1 test nuevo en `perpl-config.test.ts` (7/7). Suite completa **270/270, 35 suites**; `tsc` limpio. Sin desviaciones del brief. |
| **7** — `useMarketData`, `BookCard` (`book.tsx`), montaje en `ctx.ts`/`App.tsx`/`market.tsx` (`5fb26fe`) | `tsc` limpio; suite **270/270** sin cambio de conteo. Smoke: **`07-book-live.png`** (LIVE, spread 1.2 bps, mejor bid 85153.4/ask 85163.4), **`07b-book-later.png`** (10 s después, mismo montaje: mejor bid/ask cambiaron, spread igual — confirma frames por bloque sin `recordVideo`), **`07c-book-reopened.png`** (cambio de pill Ask→Trade: socket recreado, libro nuevo, sin residuo), **`07d-book-target.png`** / **`07e-book-target-live.png`** (target «book not loaded» mientras `CONNECTING`, luego «above the book» cuando `LIVE`, 86052.2 > 85213.9 ✓). Desviación: `useMemo` en `BookCard` (cierra el minor de performance de Task 6). |
| **8** — recorrido en el simulador: nivel, orden de 2.00 AUSD, recordatorios, cron | Ver §1.1 abajo. Intento 1 (22 sep): `unknown`, sin fill; dos reintentos abortados por colisión de simulador/pérdida de foreground. Intento definitivo (23 sep, simulador exclusivo): **FILLED**, dos recordatorios creados y procesados por el cron, posición cerrada. |
| **9** — esta documentación | Checks finales en §1.2. |

### 1.1 Recorrido en el simulador (Task 8, 2026-09-22 ~05:14–06:20Z, cuenta #620)

Simulador `2B2A0BAD-7B14-4DAE-8652-C7E9472505E0`, Metro del worktree PID 55611 (vivo toda la sesión). Maestro
2.4.0 con `--udid` explícito (4 simuladores booteados a la vez). **Finding heredado de Task 4/7**: el
selector `id:` de Maestro no matchea (`resource-id` vacío, sin `testID`s); todo se condujo con
`tapOn: "<accessibilityLabel>"` por texto.

**Step 0 — saldos y estado inicial**: RPC `2026-09-22T05:36:08Z` → **AUSD 29.00 · MON 0.03850114** (el
brief esperaba ~0.0551 MON; se anota el valor real, sin bloquear — gas gastado en tasks previas). Wallet
`08a-wallet-before.png`. `mobile.reminders` para la cuenta: `0 · 0 scheduled`. `mobile.devices`:
`token_len 160`, `env sandbox`, sin cambio.

**Step 1 — nivel desde Ask + una read real (guardrail #3)**: celda `+0.5% · 1H` (`08b-sheet.png`), read
real pedida a Drift/Jesús's agent (guardrail: Ask cobra créditos simulados, se necesita una read real para
ver el botón de la `ReadCard`) → `08b3-read-card.png` (32 % probability, `status: open`). «Trade this
level» de la **`ReadCard`** (no de la hoja) → `08c-trade-level.png`: `LevelCard` `+0.5% · 1H → 85691.5`,
`SUGGESTED: LONG` (coincide `sideFor(50) === "long"`), `Segmented` en Long, book `CONNECTING`.

**Step 2 — la orden (única autorizada)**: margen 2.00 AUSD, 1x → `08d-review.png` (`YOU OPEN · LONG BTC ·
1X`, notional ≈1.70 AUSD, LEVEL `+0.5% · 1H → 85691.5`) → **un solo tap de `Confirm`** →
`08e-confirming.png` (`SENT`) → tras los 30 s del timeout, **`08e-filled-note2.png`: `unknown` («No confirmation yet —
Check your positions — the order may still have gone through.»)**. Verificado por tres señales
independientes que no hubo fill silencioso: Markets sin cambio (`0.00 in positions · 104.86 free`,
`08f-markets-check.png`/`08f2-markets-recheck.png` 20 s después con el mark ya distinto), `mobile.reminders`
→ `[]` (como `reminder-set` sólo se llama con `result.step === "filled"`), y `LevelCard` sin consumir
(`08f-level-consumed.png`, sigue presente — sólo se limpia en `filled`).

**Step 3 — recordatorios/cron: N/A.** Sin filas `scheduled` que forzar; ningún `update … set fire_at`
ejecutado (no había nada que tocar); sin tick de cron que reportar.

**Step 4 — cierre: N/A** (sin posición que cerrar). Re-medición RPC `2026-09-22T05:47:20Z`: AUSD 29.00 /
MON 0.03850114, idéntico. `mobile.reminders` al cierre: `[]` (verificado 3 veces).

**Step 5 — regresión rápida**: sign-out (`08g-signed-out.png`) → sign-in con passkey + Face ID
(`08g1`–`08g3`) → **`08h-trade-no-levelcard.png`** (Trade sin `LevelCard`) / **`08i-ask-no-level.png`** (Ask
sin celda): confirma que `signedOutState` limpia `tradeLevel`/`askCell`, incluso el nivel colgado por la
orden fallida. Push sintético de recordatorio (`reminderId: "synthetic-test-no-fill"`, seguro por código —
`patchForPush` sólo usa `marketId`/`readId`) → banner (`08i-reminder-banner-full.png`) → tap con
`tapOn: point` (el banner de SpringBoard no es visible al árbol de accesibilidad scopeado por `appId`) →
**`08i-reminder-tap-final.png`**: abre BTC Perp → Trade con el book en vivo (confirma P9). `metro.log`:
`grep -c -E "ERROR|Require cycle"` → **0** (sólo 3 `WARN` preexistentes de `@noble/hashes`). Créditos
finales: **`08j-credits-final.png` → 16** (17 al inicio; 1 gastado en la read del guardrail #3).

**Reintento 1 (autorizado por Jesús, mismos parámetros)**: relanzado `fun.pickler.app`, celda de nuevo
(`08k-retry-sheet.png`, `08k-retry-levelcard.png`), margen con un dígito de más (`2.002`,
`08k-retry-margin-book.png`) — antes de poder corregirlo, un screenshot puro (`08k-retry-peek.png`) mostró
una pantalla de **checkout en español de Proflores** («Tu pedido», «$350»). Verificado con `simctl io`
directo (`verify-udid.png`/`-2`/`-3`, 8 s aparte): el foreground del **mismo UDID** cambió a Proflores
(`captura@proflores.app`, pedidos reales #1042/#1041/#1040) sin ningún tap propio de por medio —
colisión de simulador compartido, no un error del recorrido. **Se detuvo antes de `Confirm`**; ningún tap
posterior tocó Proflores (el único tap tras el hallazgo, un `⌫`, falló con «Element not found» — sin
efecto). Saldos sin cambio (el reintento nunca llegó a `Review`/`Confirm`).

**Reintento 2 (Jesús confirmó el simulador libre)**: verificación independiente con `simctl io` directo
antes de tocar nada (`verify-before-retry.png`: Pickler en foreground, book LIVE, Proflores en background
intacta) → corrección del margen a `2.00` (`08k0-margin-pre.png`) → dos intentos de cerrar el teclado con
`tapOn` por texto, **ambos `FAILED` sin tocar nada** (Maestro no envía el evento si no encuentra el
selector) → captura de verificación (`08k0-peek.png` + `verify-home-direct.png`, vía `simctl io` directo):
**la pantalla es el HOME SCREEN de iOS**, ni Pickler ni Proflores en foreground. **Se detuvo aquí per la
instrucción #6** («si una captura muestra otra app en primer plano, detente y avísame») — no se tocó
`Review`, `Confirm`, ni Proflores; no se relanzó nada por cuenta propia. La causa (otra sesión, un cierre
automático, o el simulador mismo) no se pudo determinar y no se especula.

**Reintento 3, 2026-09-23 (bloqueado de nuevo en Step 1)**: Step 0 repetido (RPC `2026-09-23T00:58:44Z` →
AUSD 29.00 / MON 0.03850114, `mobile.reminders` `0 · 0`, `verify-fresh-start.png` confirma Wallet en
foreground). Navegación por celda (`08m-sheet.png`, target 86870.8) → `tapOn: "trade-level"` **`FAILED`**
(fuera de la porción visible de la hoja, sin enviar ningún evento) → a los 3–5 s, **sin ningún tap
exitoso de por medio**, el foreground volvió a caer al Home Screen de iOS (`verify-before-scroll.png` /
`verify-home-check2.png`, dos tomas independientes 3 s aparte). Diagnóstico sin tocar la app:
`xcrun simctl list devices | grep booted` mostró **4 simuladores booteados simultáneamente**
(`9D1E60C5`, el nuestro `2B2A0BAD`, `022E44BF`, `D009A318`) y un proceso de automatización de Proflores
(`duoSplitProbe`) corriendo contra `Simulator.app`, aunque dirigido a otro UDID (`D009A318`); sin crash
report de Pickler. Concern nuevo (#6 del reporte): la garantía de "simulador exclusivo" no se sostiene
mientras haya varios simuladores booteados y automatización de otro proyecto activa en paralelo.

**Intento definitivo, 2026-09-23 (simulador realmente exclusivo): FILLED.** El coordinador apagó los
otros tres UDIDs (`9D1E60C5`, `022E44BF`, `D009A318`) y confirmó que ningún proceso de Proflores seguía
corriendo; `xcrun simctl list devices booted` mostró **una sola línea** (nuestro UDID). Verificado de forma
independiente con `simctl io … screenshot` directo (`verify-resume.png`): Pickler en foreground, hoja Ask
ya armada (target 87007.6). A partir de ahí, Steps 1–4 completos **sin ninguna otra pérdida de foreground**:

- **Step 1**: `scroll` + `tapOn: "trade-level"` → `LevelCard` (target 87014.1, `Segmented` Long, `BookCard`
  **LIVE** spread 1.2 bps, margen 0.00, 104.86 AUSD free in trading, 1x).
- **Step 2 — la orden**: **hallazgo de UI nuevo**: con el teclado numérico abierto, un `tapOn` sobre
  cualquier elemento cuyo nodo de accesibilidad quede geométricamente **detrás** de la línea visible del
  teclado golpea en realidad la tecla subyacente — un primer `tapOn: "review"` con el teclado abierto no
  navegó a Review, sino que **agregó un "0" extra al margen** (`2.00` → `2.000`), reproduciendo el mismo
  bug de "2.002" documentado en el Reintento 1. Causa raíz: `market.tsx` no implementa
  `Keyboard.dismiss()` ni hay tecla de retorno/"Done" en el `decimal-pad`; sólo tocar un `Text` **no
  interactivo** visible **por encima** del teclado cierra el teclado de forma confiable (`tapOn: "SPREAD"`
  funcionó; el header fijo y otros `Touchable` no). Corregido el margen (`eraseText` + `inputText: "2.00"`)
  y cerrado el teclado con `tapOn: "SPREAD"` → **`tapOn: "review"`** (ya visible) → `YOU OPEN · LONG BTC ·
  1X · MARKET`, `2.00 AUSD`, NOTIONAL ≈1.73 AUSD · 0.00002 BTC, EST. PRICE 86652.9, FEE ≈0.0005 AUSD,
  LIQUIDATION ≈1444.2, LEVEL `+0.5%·1H → 87014.1`. **`tapOn: "confirm"` — una sola vez, a las
  `2026-09-23T01:18:48Z`** → **`FILLED` — "Filled 0.00002 BTC at 86671.8" — "Fee 0.0005 AUSD · LONG 1x"**.
  Nota **"Reminders set: 15 min before and at expiry."** bajo la card; `LevelCard` consumido al volver a
  Trade (margen reseteado a `0.00`, 103.13 AUSD free in trading).
- **Step 3 — recordatorios y cron forzado**: dos filas `scheduled` en `mobile.reminders` para
  `0xe371…51C1` (`pre` `4d0db863-0ab0-4945-89f6-dd09ae120c03`, `expiry` `af4b6755-c576-48e0-9fa8-f15a516808dc`,
  target `870141` = 87014.1). Forzado `pre` (`fire_at = now()`) → a los 78 s, `status = sent`
  (`sent_at 2026-09-23 01:22:01.769503+00`); tick de cron `{"refunded":0,"resolved":0,"voided":0,
  "remindersSent":1,"pushSent":0}` (id 3990). Forzado `expiry` igual → `status = sent`
  (`sent_at 2026-09-23 01:24:01.473184+00`); tick `{"refunded":0,"resolved":0,"voided":0,"remindersSent":1,
  "pushSent":0}` (id 3992). `select count(*) … where status = 'scheduled'` → **0**. **`pushSent: 0` en
  ambos ticks**: el pipeline de recordatorios corrió limpio end-to-end por primera vez, pero no hubo
  entrega real de push (sin secretos APNs) — `sent` significa "procesado por `resolve-reads`", no
  "llegó al dispositivo".
- **Step 4 — cierre**: `tapOn: "Close"` (texto exacto, visible) **falló dos veces** con "Element not
  found" pese al texto visible en pantalla; se usó `tapOn: point` con coordenadas — la primera estimación
  aterrizó por error en la fila **LIT Perp** (navegación sin daño, corregida) y la segunda dio la hoja
  correcta: `YOU CLOSE · AT MARKET`, `0.00002 BTC LONG`, EST. PNL +0.00 AUSD, botones "Keep it" / "Close
  position". `tapOn: "close-position"` a las `2026-09-23T01:33:06Z`** → **`FILLED` — "Closed 0.00002 BTC at
  86588.1" — "Fee 0.0005 AUSD"**. Re-medición RPC (`2026-09-23T01:33:29Z`): AUSD 29.00 / MON 0.03850114,
  **sin cambio** (esperado: el margen y el PnL viven en el saldo de trading de Perpl, no en el saldo
  on-chain). Balance de trading final: `TRADING · AUSD 104.86` — `0.00 in positions · 104.86 free` — de
  vuelta al valor previo a la orden.

**Hallazgos de UI/Maestro de este cierre, para el equipo**: (a) el campo de margen puede recibir un dígito
extra si se toca cualquier botón cuyo nodo de accesibilidad quede detrás de la posición visible del
teclado numérico — `market.tsx` no tiene `Keyboard.dismiss()` ni tecla "Done" en el `decimal-pad`; (b)
`tapOn` por texto exacto visible ("Close", "Back to Markets") falló repetidamente mientras que el
`accessibilityLabel` explícito (`back-to-markets`, `close-position`) siempre funcionó — preferir siempre
`accessibilityLabel` sobre texto visible en cualquier corrida futura de Maestro en esta app; (c) con el
simulador realmente exclusivo (los otros 3 UDIDs apagados, sin proceso `duoSplitProbe` de Proflores), **no
hubo ninguna pérdida de foreground** en todo el recorrido — confirma que la colisión de recursos (no un
bug de Pickler ni de Maestro) era la causa raíz de los tres intentos anteriores.

**Pregunta de las keys sobrantes de #620**: Jesús responde **«No / todavía no»** (residual heredado 12 del
audit F2, no bloquea).

### 1.2 Checks finales de la Task 9 (2026-09-22)

```
$ cd apps/mobile && npm test 2>&1 | tail -6 && npx tsc --noEmit && echo TSC-OK
Test Suites: 35 passed, 35 total
Tests:       270 passed, 270 total
Snapshots:   0 total
Time:        4.004 s
TSC-OK
```

`npm run docs:check`, `npm run agents:check` desde la raíz del worktree — salidas en el reporte de la
Task 9 (`.superpowers/sdd/2026-09-19-mobile-ask-f3/task-9-report.md`).

Capturas completas de Task 8 en
`/private/tmp/claude-501/-Users-josedejesusacevedoflores-Documents-predict/86389a7e-2503-47fb-8ac9-b90ab3060527/scratchpad/f3-shots/`
(y las de Task 4/7 en el mismo directorio del workspace SDD): `03-markets.png`, `04-ask-tab.png`,
`05-sheet.png`, `04-levelcard.png`, `05-removed.png`, `07-book-live.png`, `07b-book-later.png`,
`07c-book-reopened.png`, `07d-book-target.png`, `07e-book-target-live.png`, `08a-wallet-before.png`,
`08b-sheet.png`, `08b2-asking.png`, `08b3-read-card.png`, `08c-trade-level.png`, `08d1-margin-set.png`,
`08d2-scrolled.png`, `08d3-scrolled2.png`, `08d-review.png`, `08e-confirming.png`,
`08e-filled-note2.png`, `08f-markets-check.png`, `08f2-markets-recheck.png`, `08f-level-consumed.png`,
`08g-signed-out.png`, `08g1-signin-prompt.png`, `08g2-faceid.png`, `08g3-post-faceid.png`,
`08h-trade-no-levelcard.png`, `08i-ask-no-level.png`, `08i-reminder-banner-full.png`,
`08i-reminder-tap-final.png`, `08j-credits-final.png`, `08k-retry-sheet.png`, `08k-retry-levelcard.png`,
`08k-retry-margin-book.png`, `08k-retry-peek.png`, `verify-udid.png`, `verify-udid-2.png`,
`verify-udid-3.png`, `11b-stable1.png`, `11c-stable2.png`, `verify-before-retry.png`,
`08k0-margin-pre.png`, `08k0-peek.png`, `verify-home-direct.png`.

## 2. Decisiones tomadas durante la ejecución (rulings)

Todas las tomó el controlador sin consultar a Jesús salvo donde se dice que se escala. En orden de
aparición en el ledger; cada una con *qué cuesta si está mal*.

1. **Task 4 — `primitives.tsx` gana `accessibilityLabel?: string` en `TProps`, reenviado a `Text`.** El
   brief usa `<T … accessibilityLabel="order-note">`/`"level-title">`, pero `TProps` no lo declaraba
   (`TS2322`, `tsc` roto). Aceptado: cambio aditivo de 2 líneas, imita cómo `Touch`/`Chip`/`Btn` ya
   reenvían `accessibilityLabel`; el plan cita `order-note` como el hook que Task 8 necesita para
   verificar el resultado de la orden, así que no se podía omitir la label. **Coste si está mal**: un
   prop extra sin uso en una primitiva, revertible en aislamiento.
2. **Task 4/7/8 — Maestro `id:` no matchea en esta app** (la jerarquía de accesibilidad expone
   `accessibilityText`, no `resource-id`; no hay `testID`s). Se usó `tapOn: "<accessibilityLabel>"` por
   texto en todos los flujos de Task 4, 7 y 8, en vez de `id:` como decía el brief. **Coste si está mal**:
   ninguno — el texto matchea igual y quedó documentado para futuros flujos.
3. **Task 4 — el botón «Trade this level» de la `ReadCard` no se probó en vivo** (exige una read real).
   Se llevó explícitamente a Task 8, que pidió una read real (guardrail #3: 1 crédito simulado, sin
   dinero) y usó esa ruta (`ReadCard`, no la hoja) para la orden — cumpliendo D12 completo con el mismo
   gasto que ya autorizaba el plan. **Coste si está mal**: 1 crédito simulado (ya gastado).
4. **Task 7 — `useMemo` en `BookCard`** (`asks`/`bids`/`max`/`spread`/`pos`, keyed en `[book, target]`),
   desviación mecánica sobre el brief que **cierra** el minor de performance diferido en Task 6
   (`bestPrices`/`spreadBps`/`targetPosition` reordenaban el lado completo en cada render de `TradeTab`).
   **Coste si está mal**: revertir una envoltura, sin cambio de comportamiento.
5. **Task 8 — `unknown` ≠ rechazo.** Un rechazo real de Perpl llega como `st 7` («Order failed»);
   `unknown` es la rama de «sin confirmación en 30 s» de la app. `min_posting_amount` es 0 y el código de
   órdenes no cambió desde Perpl F2, así que la hipótesis de trabajo es un hipo del forwarder/testnet, no
   un bug de esta fase. Jesús autorizó **un** reintento con los mismos parámetros (`AskUserQuestion`).
   **Coste si está mal**: ninguno — es un diagnóstico, no una acción.
6. **Task 8 — reintento 1 abortado antes de `Confirm` por colisión de simulador** (Proflores en
   foreground del mismo UDID sin ningún tap propio de por medio). Ruling: no enviar órdenes a ciegas con
   el foreground cambiando; esperar una ventana exclusiva. **Coste si está mal**: tiempo perdido, sin
   riesgo de dinero real (nunca se llegó a `Confirm`).
7. **Task 8 — reintento 2 pausado en Step 1** (la app pasó a HOME SCREEN sin ningún tap exitoso de por
   medio, per la instrucción explícita de detenerse ante otra app en primer plano). Ruling: no perseguir
   la causa (otra sesión, cierre automático, o el simulador mismo) ni relanzar por cuenta propia; F3 avanza
   en docs con el fill pendiente de una ventana exclusiva futura. **Coste si está mal**: el audit se cierra
   sin fill real y hay que reabrirlo si luego se consigue uno.
8. **Task 9 — F3 se marca `completed`** en overview y manifest, con las 9 tasks marcadas y un
   `<details class="followups">` honesto: D11 y D12 tienen implementación + tests + verificación visual
   completos (book vivo, `LevelCard`, sign-out, push sintético); el único ítem sin evidencia real de la
   checklist §3 F3 del spec (orden `filled` + recordatorios + cron) es el primer residual de §5, no un
   hueco escondido. Precedente: F2 se cerró `completed` con el push real pendiente de la key APNs (audit
   F2 ruling 10). El **Step 5** (revisión independiente) lo dispatchea el controlador por fuera de esta
   task, como en F1/F2. **Coste si está mal**: cambiar un status.
9. **Retomar el reintento de la orden tras el `unknown` del 22 sep (autorizado por Jesús).** Tras el
   diagnóstico de la ruling 5 (`unknown` ≠ rechazo, hipótesis de hipo del forwarder/testnet) y los dos
   reintentos abortados por colisión de simulador (rulings 6–7), Jesús autorizó retomar el intento el
   23 sep con los mismos parámetros (2.00 AUSD, 1x, LONG BTC). El primer retomo de ese día se bloqueó de
   nuevo en Step 1 (pérdida de foreground hacia el Home Screen, con los 4 simuladores aún booteados y
   automatización de Proflores corriendo en paralelo) — ver §1.1. **Coste si está mal**: ninguno — es una
   autorización de reintento, no una acción que mueva dinero; el bloqueo se reportó sin especular la causa.
10. **Apagar los otros tres simuladores para aislar el UDID (autorizado por Jesús).** Diagnosticada la
    colisión de recursos como causa probable de los tres bloqueos anteriores (rulings 6, 7 y 9), el
    coordinador apagó `9D1E60C5`, `022E44BF` y `D009A318` (`xcrun simctl shutdown`) y confirmó por
    `simctl list devices booted` que sólo quedaba el UDID de Pickler antes de retomar. Con el simulador
    realmente exclusivo, el intento definitivo llenó sin ninguna otra pérdida de foreground (Step 1–4
    completos, ver §1.1) — confirma la hipótesis, no la contradice. **Coste si está mal**: ninguno directo;
    si la causa hubiera sido otra, el intento habría vuelto a bloquearse sin dañar nada (no se llegó a
    `Confirm` hasta verificar el foreground estable).

### Minors diferidos del ledger (sin corregir; ninguno con efecto observable en lo que F3 entrega)

- **Task 2**: `Reminder.kind`/`localReminderContent(kind)` inlinean `"pre" | "expiry"` en vez de importar
  `ReminderKind` de `level.ts` (byte-idéntico hoy); `postReminders`/`localReminderContent` sin consumidor
  hasta Task 3 (esperado, no es un defecto).
- **Task 4**: la fila `RESOLVES` de `LevelCard` muestra «Resolves 03:08 · in 3 h 59 m» (la palabra
  repetida con la etiqueta) — cosmético, visto en `04-levelcard.png`. `level` capturado en el render de
  `confirm`: si vence durante el fill, `reminder-set` responde `422 expired` y la nota muestra el copy de
  Task 2 — cubierto por el servidor, sin re-chequeo en cliente.
- **Task 6** (seis, todos en `marketData.ts`, ninguno alcanzado por los frames reales o el recorrido de
  Task 8): sin `sid` aún (antes del `mt: 6`) se acepta cualquier `sid` — un `mt: 16` antes del `mt: 15` de
  una conexión nueva se mezclaría con el libro de la anterior (guard sugerido: ignorar `mt: 16` hasta el
  snapshot de esa conexión); `code 0` sin `sid` emite `rejected {code 0, error ""}` — Task 7 no depende
  del texto; tras `rejected`, `attempt` no se resetea (un `connect()` posterior reporta "reconnecting");
  el parser trata `bid: null` como malformado y descarta el frame entero (sólo `undefined` = sin cambios;
  los 4 updates reales traen ambos arrays, así que no se ejercitó); tras un `1001` inmediato, `attempt`
  queda en 1 (asimetría documentada); test sintético nombrado "unchanged side" pero cambia el ask
  (`[...keys()].sort()` lexicográfico correcto por casualidad); sin test para `close()` con retry
  pendiente, `connect()` doble, frame tras `close()`, ni `FakeSocket.close()` que dispare `onclose`
  (rutas verificadas por lectura, plan-mandated); comentario de `perpl-config.test.ts` («Selectores
  confirmados…») quedó sobre el test nuevo en vez del test que describe. El minor de performance de
  `bestPrices`/`spreadBps`/`targetPosition` reordenando por render **se cerró** en Task 7 (ruling 4).

## 3. Correcciones a afirmaciones previas

Del **spec** (aplicadas en esta task, marcadas **(F3)** en el archivo):

| Dónde | Decía | Queda | Quién lo detectó |
|---|---|---|---|
| Cabecera **Estado** | F1/F2 ejecutadas | + F3 ejecutada; orden **FILLED** el 23 sep (tras un intento `unknown` y dos reintentos abortados por colisión de simulador), recordatorios y cron ejercitados end-to-end; sólo el push real queda pendiente de la key APNs | Esta task |
| D11 | «La semántica exacta de `mt: 16` (reemplazo por nivel vs. delta) se fija en F3 contra frames reales» | **Fijada**: `mt: 16` es delta por nivel de precio, `o: 0` borra — verificado contra los 4 updates reales del fixture (34 niveles con `o: 0`) | Task 5/6, Task 9 |
| D12 | Botón en hoja y card; recordatorios tras `filled`/`open` | + archivos reales (`level.ts`, `postReminders`, `LevelCard`), consumo del nivel sólo si se programaron, push de recordatorio sin `LevelCard` (P9); **verificado con datos reales el 23 sep**: dos filas en `mobile.reminders`, ambas procesadas por el cron | Tasks 1–4, Task 8, Task 9 |
| D14 | «Trade this level» no se renderiza hasta F3 (F2, P9) | Se renderiza: hoja (outline lima) y card sólo con la read `open` | Task 4, Task 9 |
| §3 F3 | «cerrar la posición a mano desde Markets» como si la orden se hubiera llenado | **Ya verificado tal cual, el 23 sep**: la orden llenó (Task 8, intento definitivo), la app llamó `reminder-set`, el cron procesó ambos recordatorios (`pushSent: 0`, sin push real por falta de la key APNs) y la posición se cerró a mano desde Markets como describía el spec desde el principio | Task 8, Task 9 |
| §4 (riesgos) | Cuenta #620 con dos keys sobrantes — revocar antes de F3 | Jesús, 2026-09-22: «todavía no revocadas» — sigue igual, residual heredado sin bloquear | Task 8 |

Del **plan** (no se edita el plan; queda anotado aquí):

- **MON del simulador**: el plan (Global Constraints) esperaba ~0.0551 MON; el valor real medido por RPC
  fue **0.03850114** — gas gastado en tasks/sesiones previas del mismo simulador compartido, no de esta
  fase. No bloquea nada (F3 no gasta MON fuera de la orden de prueba, que tampoco lo hizo al no llenar).
- **README de la app**: decía `244/244 esperado (33 suites)`; ahora `270/270 (35 suites)`.
- **Task 8, Step 2 del plan** asumía que la orden de prueba llenaría o se rechazaría con claridad; el
  resultado real (`unknown`, sin confirmación) es una tercera rama que el plan no nombraba explícitamente
  pero que el código de la app ya maneja (`OrderResult` tiene la variante `unknown`).

## 4. Estado de las cuentas y del servicio al cierre

- **Wallet del simulador**: `$SIM_ADDR` (`0xe371…51C1`).
  RPC (viem) al inicio del intento del 22 sep (`2026-09-22T05:36:08Z`): AUSD 29.00 · MON 0.03850114. RPC
  antes del intento definitivo del 23 sep (`2026-09-23T00:58:44Z`): idéntico. RPC **después** del cierre
  de la posición (`2026-09-23T01:33:29Z`): **AUSD 29.00 · MON 0.03850114 — sin cambio** en todo el
  recorrido (esperado: el margen y el PnL de una orden de Perpl viven en el saldo de trading ya
  depositado en la cuenta, no en una tx on-chain nueva). Ningún depósito, retiro, `Enable`/`Reconnect`/
  `Reset trading key`.
- **Trading · AUSD (cuenta Perpl #620)**: ciclo completo por el fill real — **104.86 AUSD free** antes de
  abrir → **103.13 free / 1.73 en posición** tras el `Confirm` (`FILLED` 0.00002 BTC LONG @ 86671.8,
  margen 2.00 AUSD, 1x, fee taker 0.0005 AUSD, `Confirm` único a las `2026-09-23T01:18:48Z`) → **104.86
  free / 0.00 en posición** tras el cierre a mano desde Markets (`FILLED` 0.00002 BTC @ 86588.1, fee
  0.0005 AUSD, a las `2026-09-23T01:33:06Z`). Costo neto de las dos fees (0.001 AUSD) invisible al
  redondeo a 2 decimales mostrado.
- **Orden**: **FILLED** el 23 sep, margen 2.00 AUSD, 1x, LONG BTC, nivel `+0.5% · 1H → 87014.1` (desde la
  celda de Ask, sin `readId`). Historia: el intento 1 (22 sep, desde una read `open`, nivel
  `+0.5%·1H → 85691.5`) quedó `unknown` — Perpl no confirmó dentro del timeout de 30 s, verificado por tres
  señales independientes (0 en posiciones, `mobile.reminders` vacío, `LevelCard` no consumido) que no
  hubo fill silencioso; dos reintentos posteriores se abortaron antes de `Confirm`/`Review` por colisión
  de simulador (Proflores en foreground, y una pérdida de foreground hacia el Home Screen) — ver §1.1 y
  §2 (rulings 5–7). Un tercer retomo el 23 sep volvió a bloquearse en Step 1 por el mismo patrón antes de
  que el coordinador apagara los otros tres UDIDs (ruling 9–10); con el simulador realmente exclusivo, el
  intento definitivo llenó sin más pérdidas de foreground.
- **Cierre**: **FILLED** el 23 sep (ver arriba) — 0.00002 BTC @ 86588.1, fee 0.0005 AUSD, cerrado a mano
  desde Markets como describe el spec.
- **Recordatorios (`mobile.reminders`)**: 0 filas durante todo el intento 1 y los reintentos abortados
  (verificado repetidamente, incluida la re-consulta previa al intento definitivo). Tras el fill del 23
  sep, **dos filas `scheduled`** para `0xe371…51C1`: `pre` `4d0db863-0ab0-4945-89f6-dd09ae120c03` (target
  870141, `fire_at` original `2026-09-23 01:50:45.309+00`) y `expiry` `af4b6755-c576-48e0-9fa8-f15a516808dc`
  (`fire_at` original `2026-09-23 02:05:45.309+00`). Ambas forzadas por SQL (`fire_at = now()`) y
  procesadas por el cron: `pre` → `status = sent` (`sent_at 2026-09-23 01:22:01.769503+00`), tick
  `{"refunded":0,"resolved":0,"voided":0,"remindersSent":1,"pushSent":0}` (id 3990); `expiry` → `status =
  sent` (`sent_at 2026-09-23 01:24:01.473184+00`), tick idéntico (id 3992). `select count(*) … where
  status = 'scheduled'` → **0** al cierre. **`pushSent: 0` en ambos ticks** — el pipeline de recordatorios
  corrió limpio end-to-end por primera vez en esta fase, pero **no hubo entrega real de push**: los
  secretos APNs siguen ausentes, así que `status = sent` significa "la fila fue procesada y despachada
  por `resolve-reads`", no "un dispositivo recibió una notificación". No hubo banner en el simulador
  durante este forzado (no se capturó ninguno), coherente con `pushSent: 0`.
- **`mobile.devices`**: sin cambios, `env sandbox`, `length(token) = 160` — **el token no se copia** (ni
  aquí ni en los reportes).
- **Ask credits**: **17 → 16** (1 gastado: la única read solicitada por el guardrail #3 para ver el botón
  de la `ReadCard`, en el intento 1; el intento definitivo del 23 sep usó la celda directa de Ask sin
  pedir otra read, sin gasto adicional).
- **Secretos de funciones**: sin cambio desde F1/F2. Presentes (sólo nombres): `ANTHROPIC_API_KEY`,
  `PERPL_REST`, `CRON_SECRET`. **Ausentes**: `APNS_KEY_P8_B64`, `APNS_KEY_ID`, `APNS_TEAM_ID` — esto es lo
  que explica `pushSent: 0` en los dos ticks de cron del fill real; ninguna función redesplegada, ninguna
  migración, F3 no tocó `services/reads`. El push de recordatorio probado en Task 8 fuera del fill real
  fue **sintético** (`xcrun simctl push` con un payload armado a mano, `reminderId:
  "synthetic-test-no-fill"`) — no vino de `resolve-reads`, sólo probó la navegación (`patchForPush`).
- **App/simulador**: dev build de `mobile-nav` (build 9) sin rebuild nativo (F3 no añade módulos nativos);
  Metro del worktree vivo toda la sesión; Face ID enrolado; permiso de notificaciones concedido.
  **Incidente de simulador compartido (historia, resuelto)**: durante los reintentos del 22 y 23 sep, el
  mismo UDID mostró en foreground la app de **Proflores** (`captura@proflores.app`, pedidos reales) y,
  por separado, la pantalla de inicio de iOS, en ambos casos sin ningún tap propio de por medio — otra
  sesión (o el propio simulador, con 4 UDIDs booteados y automatización de Proflores corriendo en
  paralelo) tomó el foreground de forma concurrente. Ningún tap de este recorrido tocó Proflores. El
  coordinador apagó los otros tres UDIDs (`9D1E60C5`, `022E44BF`, `D009A318`) y verificó exclusividad
  antes del intento definitivo, que corrió sin ninguna otra pérdida de foreground.
- **Cuenta Perpl #620**: la orden de prueba llenó y se cerró limpiamente; las dos trading keys sobrantes
  siguen sin revocar (Jesús, 2026-09-22: «No / todavía no»).
- **Rollback**: nada que revertir en el proyecto compartido — las dos filas de `mobile.reminders` del fill
  real ya quedaron en `sent`/procesadas (no hay `scheduled` colgado que limpiar) y la posición ya está
  cerrada. En la app, `git revert` por commit. Nada de esto se ejecutó.

## 5. Pendientes / residuales

Ordenados por peso — primero lo nuevo de esta fase, después lo heredado. **Resuelto en este cierre** (ya no
es residual): la colisión de simulador con Proflores que bloqueó dos reintentos — el coordinador apagó los
otros tres UDIDs y verificó exclusividad antes del intento definitivo, que corrió sin ninguna otra pérdida
de foreground (§1.1, ruling 10).

1. **Falta el push REAL de recordatorio**: `pushSent: 0` en los dos ticks de cron del fill real
   (`remindersSent` sí en 1) porque los secretos APNs (`APNS_KEY_P8_B64`, `APNS_KEY_ID`, `APNS_TEAM_ID`)
   siguen ausentes (Task 8, §1.1 y §4; residual 1 del audit F1/F2, sigue igual). El pipeline de
   recordatorios ya corrió limpio end-to-end en el simulador — `reminder-set`, las dos filas en
   `mobile.reminders` y el cron que las procesa a `sent` —, así que este residual ya **no** es «la orden
   nunca llenó»; es específicamente que ningún dispositivo recibió una notificación real. El tap del push
   sólo se probó con un payload sintético de `simctl push`, no con un `resolve-reads` real.
2. **Dos keys de trading sobrantes en la cuenta #620 sin revocar** (residual 12 del audit F2; Jesús,
   2026-09-22: «No / todavía no»). No bloquea — la key del simulador sigue enrolada y funciona.
3. **Capability Push Notifications en el App ID `fun.pickler.app`** (heredado del audit F2, residual 2):
   insumo de Jesús para el iPhone y el próximo build de TestFlight (F4).
4. **Persona real del agente `jesus` sigue en placeholder** (heredado de F1/F2, residual 8 del audit F2).
5. **Maestro `id:` no matchea en esta app** (accessibilityText, no resource-id): cualquier flujo futuro debe
   usar `tapOn` por texto o `accessibilityLabel`, no `id:` — documentado en tres tasks (4, 7, 8) para que no
   se repita el hallazgo.
6. **Nuevo — `market.tsx` no cierra el teclado numérico del margen**: el `decimal-pad` del campo de margen
   no tiene `Keyboard.dismiss()`, `TouchableWithoutFeedback` ni tecla de retorno/"Done" (sólo
   `keyboardShouldPersistTaps="handled"` en el `ScrollView` de `Page.tsx`). Con el teclado abierto, un tap
   sobre cualquier elemento geométricamente detrás de la línea visible del teclado (p. ej. el botón
   Review) golpea en realidad la tecla subyacente y agrega un dígito extra al margen — pasó dos veces en
   este recorrido (`2.002` en el reintento 1, `2.000` en el intento definitivo antes de corregirlo). Vale
   la pena que el equipo de producto le añada un cierre de teclado real a Trade.
7. **Nuevo — en Maestro, `tapOn` por texto exacto es poco confiable en esta app**: "Close" y "Back to
   Markets" fallaron repetidamente con "Element not found" pese a estar visibles en pantalla, mientras que
   el `accessibilityLabel` explícito (`back-to-markets`, `close-position`) siempre funcionó. Recomendación
   para cualquier corrida futura de Maestro en Pickler: preferir siempre `accessibilityLabel` sobre
   selector de texto.
8. **Minors diferidos del ledger** (§2, sin efecto observable en lo que F3 entrega): Task 2
   (`ReminderKind` inlineado en dos archivos), Task 4 (copy «Resolves … · in …» con palabra repetida;
   `level` capturado antes del fill sin re-chequeo de vencimiento), Task 6 (seis, todos en
   `marketData.ts`/tests, listados en §2; ninguno alcanzado por los frames reales o el recorrido de Task 8).
9. **Hallazgo informativo de Task 8** (sin acción): el MON real del simulador (0.03850114) no coincide con
   el 0.0551 que el plan daba por hecho — gas de sesiones anteriores en el mismo simulador compartido, no
   atribuible a F3.
10. **Todo lo que ya quedaba de F1/F2 y sigue igual**: rotar `SUPABASE_ACCESS_TOKEN`/`CRON_SECRET`, el
    `Tag` sin acento en «JESUS'S AGENT», `expo-notifications ~57.0.20` con tilde — ninguno tocado por F3.

## 6. Siguiente punto de decisión

**F3 queda verificada end to end** (2026-09-23): la orden llenó, la app llamó `reminder-set`, las dos
filas de `mobile.reminders` se procesaron por el cron y la posición se cerró a mano desde Markets — el
único residual nuevo de esta fase es el push **real** (`pushSent: 0`, key APNs pendiente, ver §5.1). El
merge y el push ya se hicieron: `feat/mobile-ask-f3` está mergeada y `main` (`38c3fa0`) está en
`origin/main`. 270/270 tests, 35 suites y `tsc` en verde; book L2 vivo, «Trade this level», `LevelCard` y
ahora también el fill/recordatorios/cierre reales en el simulador. Decide Jesús:
(1) **F4** — retitulada a «TestFlight con F3 (siguiente build tras el merge)» por P15, sigue `pending`,
prerequisito «F3; autorización explícita de Jesús» — F3 ya cumple su prerequisito, falta la autorización
para subir el build; (2) la **key APNs** (residual 4, heredado de F1/F2, ahora la única pieza que falta
para que el push de recordatorio sea real) y las **dos keys de trading sobrantes de #620** (residual 2,
respuesta de Jesús: «todavía no»); (3) si vale la pena que producto revise el hallazgo del `decimal-pad`
sin cierre de teclado (residual 6) antes del siguiente build. Quedan **20 días** para el bounty (13 oct
2026, 21:59 CST).

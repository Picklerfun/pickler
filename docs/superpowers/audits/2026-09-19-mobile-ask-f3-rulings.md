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

**No verificado end to end**: la única orden autorizada (2.00 AUSD, 1x, LONG BTC, nivel +0.5%·1H) quedó
**`unknown`** — Perpl no confirmó en ~20 s — y nunca llenó. Posiciones en 0.00 antes y después, saldo
`104.86 AUSD free in trading` sin cambio, `LevelCard` no consumido. Por guardrail no se reintentó más de
una vez en el primer intento; un reintento autorizado por Jesús se abortó **dos veces** antes de `Confirm`
por una colisión del simulador compartido con otra sesión (Proflores). **Consecuencia directa: `reminder-set`
nunca se llamó con datos reales, ninguna fila se creó en `mobile.reminders`, y el cron con `fire_at` forzado
y `remindersSent` nunca se ejercitó en la app** — esa ruta está cubierta por test unitario (Tasks 1–3, RED/
GREEN documentado) y por el curl server-side de F1, pero no por un recorrido real en el simulador. Esto se
declara sin adornos en este audit, en el spec (§3 F3) y en el overview.

Rama `feat/mobile-ask-f3`, base `main` (`5b9acfd`), **8 commits** (`5b9acfd` docs base del plan + 7 de código
`07dd719..5fb26fe`) más el de esta documentación; sin push y sin merge.
Spec: `docs/superpowers/specs/2026-09-19-mobile-ask-design.md` (D11, D12, D14 y §3/§4 marcados **(F3)**);
plan: `docs/superpowers/plans/2026-09-19-mobile-ask-f3.md` (P1–P15). Ejecutado con
subagent-driven-development: un implementador por task (Tasks 1–8), revisión por task, el controlador
commiteando por nombre de archivo y llevando el ledger (`.superpowers/sdd/2026-09-19-mobile-ask-f3/progress.md`).

**F3 queda `completed`** (ruling 8, abajo): D11 y D12 tienen implementación, tests y verificación visual
completos, y el único ítem sin evidencia real (la orden llenada + recordatorios + cron) es exactamente lo
que este audit declara como el primer residual, no algo escondido detrás del status.

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
| **8** — recorrido en el simulador: nivel, orden de 2.00 AUSD, recordatorios, cron | Ver §1.1 abajo. Resultado: orden `unknown`, sin fill, sin recordatorios, dos intentos de reintento abortados por colisión de simulador. |
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
`08e-confirming.png` (`SENT`) → tras ~20 s, **`08e-filled-note2.png`: `unknown` («No confirmation yet —
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
| Cabecera **Estado** | F1/F2 ejecutadas | + F3 ejecutada; orden nunca llenó, recordatorios/cron sin ejercitar end-to-end | Esta task |
| D11 | «La semántica exacta de `mt: 16` (reemplazo por nivel vs. delta) se fija en F3 contra frames reales» | **Fijada**: `mt: 16` es delta por nivel de precio, `o: 0` borra — verificado contra los 4 updates reales del fixture (34 niveles con `o: 0`) | Task 5/6, Task 9 |
| D12 | Botón en hoja y card; recordatorios tras `filled`/`open` | + archivos reales (`level.ts`, `postReminders`, `LevelCard`), consumo del nivel sólo si se programaron, push de recordatorio sin `LevelCard` (P9) | Tasks 1–4, Task 9 |
| D14 | «Trade this level» no se renderiza hasta F3 (F2, P9) | Se renderiza: hoja (outline lima) y card sólo con la read `open` | Task 4, Task 9 |
| §3 F3 | «cerrar la posición a mano desde Markets» como si la orden se hubiera llenado | Lo verificado y cómo (Task 8): la orden quedó `unknown`, sin fill; Steps 3–4 (recordatorios, cron, cierre) quedan N/A por esa causa, no por omisión | Task 8, Task 9 |
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

- **Wallet del simulador**: `$SIM_ADDR = 0xe3719a93b75cee42c5a8f3dce45e5b4b327851c1`. RPC (viem) **antes**
  (`2026-09-22T05:36:08Z`): **AUSD 29.00 · MON 0.03850114**. RPC **después** (`2026-09-22T05:47:20Z`, tras
  el intento de orden y la regresión): **AUSD 29.00 · MON 0.03850114** — sin cambio (esperado: el margen
  de una orden de Perpl sale del saldo ya depositado en la cuenta, no de una tx on-chain nueva; y esta
  orden ni siquiera llenó). Ningún depósito, retiro, `Enable`/`Reconnect`/`Reset trading key`.
- **Trading · AUSD (cuenta Perpl #620)**: **104.86 AUSD** en todo momento — `0.00 in positions · 104.86
  free` antes, durante y después del intento de orden y de los dos reintentos abortados. Ninguna orden se
  ejecutó realmente pese al `Confirm long` (resultado UI `unknown`).
- **Orden**: intento único autorizado, margen 2.00 AUSD, 1x, LONG BTC, nivel `+0.5% · 1H → 85691.5` (desde
  una read `open` pedida vía Ask). Resultado: **`unknown`** (no confirmation) tras ~20 s de espera.
  Verificado por tres señales independientes (0 en posiciones, `mobile.reminders` vacío, `LevelCard` no
  consumido) que no hubo fill silencioso. **No se reintentó una segunda vez con `Confirm`** — los dos
  reintentos autorizados se abortaron antes de llegar a esa pantalla, por colisión de simulador.
- **Cierre**: N/A — no existe posición que cerrar.
- **Recordatorios (`mobile.reminders`)**: **0 filas** en todo el recorrido (verificado 3 veces: Step 0,
  tras el intento de orden, y al cierre `2026-09-22T05:59:56Z`). Ningún `update … set fire_at` ejecutado
  (no había nada que forzar). Ningún tick de `resolve-reads` con `remindersSent`/`pushSent` distinto de 0
  atribuible a esta fase.
- **`mobile.devices`**: sin cambios, `env sandbox`, `length(token) = 160` — **el token no se copia** (ni
  aquí ni en los reportes).
- **Ask credits**: **17 → 16** (1 gastado: la única read solicitada por el guardrail #3 para ver el botón
  de la `ReadCard`; la hoja de Ask propiamente nunca se envió).
- **Secretos de funciones**: sin cambio desde F1/F2. Presentes (sólo nombres): `ANTHROPIC_API_KEY`,
  `PERPL_REST`, `CRON_SECRET`. **Ausentes**: `APNS_KEY_P8_B64`, `APNS_KEY_ID`, `APNS_TEAM_ID`. Ninguna
  función redesplegada, ninguna migración: F3 no tocó `services/reads`. El push de recordatorio usado en
  Task 8 fue **sintético** (`xcrun simctl push` con un payload armado a mano, `reminderId:
  "synthetic-test-no-fill"`) — no vino de `resolve-reads`, sólo prueba la navegación (`patchForPush`).
- **App/simulador**: dev build de `mobile-nav` (build 9) sin rebuild nativo (F3 no añade módulos nativos);
  Metro del worktree vivo toda la sesión (PID 55611); Face ID enrolado; permiso de notificaciones
  concedido. **Incidente de simulador compartido**: durante los dos reintentos de la orden, el mismo UDID
  mostró en foreground la app de **Proflores** (`captura@proflores.app`, pedidos reales) y después la
  pantalla de inicio de iOS, en ambos casos sin ningún tap propio de por medio — otra sesión (o el propio
  simulador) tomó el foreground de forma concurrente. Ningún tap de este recorrido tocó Proflores.
- **Cuenta Perpl #620**: sin tocar más allá del intento de orden que no llenó; las dos trading keys
  sobrantes siguen sin revocar (Jesús, 2026-09-22: «No / todavía no»).
- **Rollback**: nada que revertir en el proyecto compartido — ninguna fila nueva quedó en `mobile.reminders`
  ni en ninguna otra tabla (la única read de Task 8 ya la cubre el ledger de créditos existente). En la
  app, `git revert` por commit. Nada de esto se ejecutó.

## 5. Pendientes / residuales

Ordenados por peso — primero lo nuevo de esta fase, después lo heredado:

1. **La orden de prueba no llenó y la ruta real de `reminder-set`/cron nunca se ejercitó en la app**
   (Task 8, §1.1 y §4). `reminder-set` y el fallback local están cubiertos por test unitario (RED/GREEN de
   Tasks 1–3) y la resolución de reads por el curl server-side de F1, pero **nadie ha visto, en el
   simulador, una orden real que dispare dos filas `scheduled` en `mobile.reminders` y un cron que las
   procese con `fire_at` forzado.** Requiere una ventana exclusiva del simulador (sin colisión con
   Proflores u otra sesión) para reintentar el `Confirm`; vale también preguntar a alguien con más
   contexto de Perpl por qué el order forwarder no confirmó en ~20 s en testnet.
2. **Simulador `2B2A0BAD-…` compartido con otras sesiones (Proflores) sin coordinación**: el UDID que el
   plan reservó para Pickler cambió de foreground dos veces durante los reintentos de Task 8 sin ningún
   tap propio de por medio. Cualquier recorrido futuro en este simulador corre el riesgo de interferencia;
   coordinar una ventana de tiempo exclusiva o pedir un UDID dedicado antes de reintentar la orden.
3. **Dos keys de trading sobrantes en la cuenta #620 sin revocar** (residual 12 del audit F2; Jesús,
   2026-09-22: «No / todavía no»). No bloquea — la key del simulador sigue enrolada y funciona.
4. **Push real de recordatorio sin ver llegar**: depende de la key APNs (residual 1 del audit F1/F2, sigue
   pendiente); el tap se probó con un payload sintético de `simctl push`, no con un `resolve-reads` real.
5. **Capability Push Notifications en el App ID `fun.pickler.app`** (heredado del audit F2, residual 2):
   insumo de Jesús para el iPhone y el próximo build de TestFlight (F4).
6. **Persona real del agente `jesus` sigue en placeholder** (heredado de F1/F2, residual 8 del audit F2).
7. **Maestro `id:` no matchea en esta app** (accessibilityText, no resource-id): cualquier flujo futuro debe
   usar `tapOn` por texto, no `id:` — documentado en tres tasks (4, 7, 8) para que no se repita el hallazgo.
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

F3 termina aquí en `completed` (ruling 8): **sin push, sin merge y sin key APNs**, con el fill real de la
orden pendiente de una ventana exclusiva del simulador. La rama `feat/mobile-ask-f3` tiene 8 commits sobre
`main` (`5b9acfd`, 1 de docs base + 7 de código) más el de esta documentación; 270/270 tests, 35 suites y
`tsc` en verde; book L2 vivo, «Trade this level» y `LevelCard` reales en el simulador. Decide Jesús:
(1) si se **mergea/pushea F3** (y F1+F2, que siguen en `main` local sin llegar a `origin/main`); (2) si se
**reintenta la orden** en una ventana exclusiva del simulador para cerrar el residual 1 (fill real +
recordatorios + cron) antes o después del merge; (3) **F4** — retitulada a «TestFlight con F3 (siguiente
build tras el merge)» por P15, sigue `pending`, prerequisito «F3; autorización explícita de Jesús»; (4) la
**key APNs** (residual 4, heredado de F1/F2) y las **dos keys de trading sobrantes de #620** (residual 3,
respuesta de Jesús: «todavía no»). Quedan **21 días** para el bounty (13 oct 2026, 21:59 CST).

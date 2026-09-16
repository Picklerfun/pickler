# Handoff — port de la UI de pickler-mobile (2026-09-16)

Cierre de la sesión que reemplazó las dos pantallas de fase 1 (`Welcome`, `Home`) por
las 13 pantallas del prototipo `jjesusaf/pickler-mobile` (commit `365585e`), portadas a
TypeScript e inyectadas con el flujo real (passkey, saldos, faucet, Lock, Sign out) en
tres de ellas. Rama `feat/mobile-ui-port`, base `cfe3efa` (fin de fase 1).

## Qué quedó hecho y verificado

| Pieza | Evidencia |
|---|---|
| 13 pantallas del prototipo portadas a `.ts`/`.tsx`: Market, Search, Agent, Trade, Wallet access, Activity, Post, Ask, Portfolio, Position, Wallet, Deposit, Withdraw | `apps/mobile/src/screens/{discover,trade,follow,own}.tsx`; copy y estilos idénticos al prototipo salvo el párrafo "Dependency: …" eliminado de Wallet access |
| Wallet access (`signin`) | Create/Sign in reales vía Mera (passkey), spinner y `describeError`, gate `requireAccount` con `next`/`resume` |
| Wallet | "Available to spend" con AUSD real (`formatAusd`); bloque `TESTNET` (MON, Get test AUSD/MON, Refresh, aviso de tx o error); fila `SESSION` (Locked/Unlocked, Lock, Sign out) |
| Deposit | Dirección real completa en mono; "Copy address" copia y se queda en la pantalla |
| Gate de cuenta | `requireAccount(target, patch)` en tab bar (Wallet, Portfolio), barra Buy del agente y panel de dev; Market/Search/Agent/Activity/Post/Ask nunca piden cuenta |
| Panel de dev (⚙) | Solo `__DEV__`; USER STATE, SCREENS, TRANSACTION STATES (9 fases), THE FIVE JOURNEYS; sin barra falsa "9:41" |
| Tests | `npx tsc --noEmit` limpio; `npm test` 41/41 (19 de fase 1 + theme 4 + helpers 4 + store 13 + chain 1) |
| Prueba manual | 11/11 en simulador iPhone 17 Pro, iOS 26.5, Face ID inscrito. Capturas en el scratchpad de la sesión (`shots/`): `01-market.png` (Market con marca y tabs Trending/Volume/New), `02-signin.png` (Wallet access sin tarjeta violeta), `03-wallet.png` (Wallet recién creada con TESTNET y MOVEMENTS), `04-copy-address.png` (Deposit con botón en "Copied"), `04-faucet.png` (aviso de MON insuficiente sin abrir Face ID), `05-trade.png` (Buy → Trade con Quote y "Not enough AUSD"), `06-devpanel.png` (panel ⚙ abierto), `06-deposit-finish.png` (Deposit con tarjeta "to finish your purchase"), `06-trade-pickup.png` (Trade "Picking up where you left off"), `portfolio-holder.png` (Portfolio con Holder activo) |
| Proceso | 11 tareas del plan, cada una con revisión independiente; revisión final de la rama completa (opus, `cfe3efa..1183781`) con 1 *Important* corregido en la ola de fixes y re-revisado; 16 commits |

## Decisiones tomadas durante la ejecución

- **`ios.backgroundColor` sin `expo-system-ui`.** Prebuild avisa que ese campo requiere el
  plugin, pero no se agregó (la app ya pinta su propio fondo; YAGNI). Si el ruling está mal,
  el costo es un flash claro al arrancar, corregible después.
- **Hooks en `src/hooks/`, no en `src/account/`/`src/wallet/` como decía el spec.** Se
  mantuvo la ubicación real del código existente en vez de moverlo; si esto complica un
  futuro refactor, el costo es solo reorganizar imports, sin riesgo funcional.
- **El store recibe `hasAccount` (booleano), no `account` (el objeto completo).** Simplifica
  las funciones puras (`deriveUser`, `deriveBalance`, `deriveTradeHolds`) y sus tests; si el
  store necesitara más adelante otros campos de `account`, habría que ampliar la firma.
- **`pickler-mark.png` truncado en el prototipo se copió verbatim.** El blob del commit
  `365585e` (`dd8ed5f`, 196608 bytes) está truncado — PIL reporta "image file is truncated" —
  y por eso el header de Market muestra un hueco en vez del logo. Se conservó fiel al commit
  fijado en vez de arreglarlo, y queda como pendiente que decide Jesús (ver abajo). Costo si
  el ruling está mal: un hueco de 26px en el header hasta que se reemplace el PNG.
- **Ruling erróneo de Task 9 sobre `tradeHolds`, corregido en la ola de fixes.** Task 9 dio
  por sentado que `tradeHolds` (que habilita Sell y la tarjeta "Your position") nunca podía
  ser `true` sin cuenta porque `phase: "done"` solo lo pone el panel de dev. La revisión final
  encontró que `resetState` (Sign out) no limpiaba `phase`/`mode`, así que una combinación
  `phase: "done"` + `mode: "buy"` sobrevivía al Sign out y dejaba `tradeHolds` en `true` sin
  cuenta (solo alcanzable en build de dev, pero real). Se corrigió con `deriveTradeHolds`, una
  función pura que retorna `false` de inmediato si no hay cuenta, con tests que fallan contra
  el defecto.
- **`formatAusd` en el saldo de Wallet, no `money()`.** El spec §3.2 dice que "Available to
  spend" usa AUSD real con `formatAusd`; el porte inicial usó `money(balance)` (que redondea
  un número ya convertido). Se corrigió para seguir la autoridad del spec sobre el plan. Costo
  si el ruling está mal: ninguno visible salvo truncar vs. redondear centavos.
- **"Copied" en Deposit es un añadido del plan, no estaba en el prototipo original** (que
  navegaba a `trade` al copiar la dirección — un atajo de demo). El spec §3.3 fija que
  "Copy address" se queda en la pantalla; el feedback visual "Copied" se agregó en el porte y
  queda como pendiente que Jesús apruebe o quite.

## Lo aprendido

1. **Un Metro huérfano puede ocupar el puerto 8081.** Si otro worktree (por ejemplo
   `feat-mobile-fase1`) tiene un `expo start` corriendo, usar `--port 8090` en vez de matarlo
   — no es tuyo, no lo toques.
2. **Automatizar taps en el simulador sin GUI activa no funciona.** `osascript`/System
   Events no ve ventanas de Simulator si el display está dormido ("Display Asleep: Yes"). La
   solución que usó el implementador de Task 10: `caffeinate -d -u -t 1800` en background para
   mantener el display despierto, luego calibrar un mapeo píxel-captura → punto-pantalla-macOS
   contra un control observable, y usar `cliclick` con PIL para ubicar botones antes de tocar.
3. **Passkeys en simulador siguen igual que en fase 1**: Face ID inscrito vía
   `notifyutil` (`enrollmentChanged`) y "presentado" con
   `notifyutil -p com.apple.BiometricKit_Sim.fingerTouch.match`; sin cambios de procedimiento.
4. **El PNG de marca del prototipo está truncado en el commit fijado como fuente de verdad.**
   Copiar "verbatim" cuando la fuente de verdad tiene un defecto propaga el defecto; vale la
   pena decidir explícitamente si portar tal cual o corregir, en vez de asumir.
5. **Un ruling de "invariante seguro" necesita revisarse contra las rutas que lo rompen, no
   solo contra el flujo feliz.** El caso de `tradeHolds` (Task 9) pasó su propia revisión
   porque analizó cómo se llega a `phase: "done"`, pero no cómo `resetState` deja de limpiarlo;
   la revisión final de rama sí lo encontró.

## Pendientes que decide Jesús

Copy congelado por el spec — no se tocó en esta rama:

- `pickler-mark.png` truncado: reemplazar el asset en `pickler-mobile` o directamente aquí.
  Bloquea TestFlight, no bloquea el merge.
- Línea "50.00 AUSD pending · a deposit is still confirming" bajo el saldo real en Wallet.
- Subtítulo "One step, then back to your purchase" en Wallet access aunque se entre desde la
  tab (no solo desde una compra en curso).
- "250.00 AUSD of PKL (Pickle)" fijo en Deposit/Wallet access/Trade (copy de ejemplo, no
  calculado desde la compra real).
- "Copied" en Deposit: aprobar el añadido o quitarlo (ver decisión arriba).
- `.catch` en Sign out (mismo comportamiento heredado de fase 1).
- `DevControls` viaja inerte en el bundle de producción (mandato del plan; solo se monta con
  `__DEV__`, pero el código está en el bundle).

Pendientes técnicos:

- **Build 2 a TestFlight** llevaría ya esta UI — aplica la regla de `ios.buildNumber` de la
  fase 1 (`docs/05-handoff-fase1.md`).
- Recomendaciones de la revisión final para fase 2: un slot `quote` en `AppCtx` o un hook
  `useQuote`; conservar el `bigint` de AUSD en `AppCtx` para calcular tamaños de orden sin
  pasar por `number`; un slot `positions` real del que derive `holds` (hoy `holds` depende de
  `mockHolder`).

## Siguiente punto de decisión

**Merge de `feat/mobile-ui-port` a `main`** — decisión de Jesús; no se hizo push desde esta
rama. Después de eso, **fase 2 = Perpl** y la decisión de venue (Perpl vs. Polymarket), sin
cambios respecto a lo que ya dejó `docs/05-handoff-fase1.md`.

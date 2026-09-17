# Handoff — trading manual en Perpl, pestaña Trade (2026-09-16)

Cierre de la sesión que construyó la fase 2 de la app móvil: una pestaña **Trade** donde el usuario
habilita trading en Perpl (approve + createAccount + forwarding + API key Ed25519), ve saldo,
mercados y posiciones por WebSocket, abre y cierra perps con orden de mercado y mueve AUSD entre
la wallet y la cuenta de trading. Rama `feat/mobile-perpl`, base `main` (`2d928fc`). Spec:
`docs/specs/2026-09-16-mobile-perpl-design.md`; plan: `docs/plans/2026-09-16-mobile-perpl.md`;
spike previo: `docs/investigacion/perpl.md`.

## Qué quedó hecho y verificado

| Pieza | Evidencia |
|---|---|
| Módulos puros `src/perpl/` (config, context, orders, apiKey, onboarding, enable, ws, funds) + `storage/perpl.ts` + `hooks/useUnlock.ts` + `hooks/usePerpl.ts` + 3 pantallas + store/Shell/App/Wallet | 20 commits (19 de código y plan + este handoff); `npx tsc --noEmit` limpio; `npm test` **164/164** (55 previos + 109 nuevos), corridos por el coordinador al cierre |
| Fixtures **reales** de testnet (`__tests__/fixtures/perpl/`): `context.json`, `ws-frames.json` (snapshot, `sr 32`, fill, cierre, `lv` recortado, `mt 3` 400), `apikey-payload.json` | capturados con la cuenta KAT #619 antes de escribir el plan |
| **Enable trading** real desde la app (cuenta del simulador `0xe371…51C1`, 100 AUSD, 4 pasos en ~5 s, sin prompt porque la sesión ya estaba desbloqueada) → cuenta Perpl **#620** | approve [`0x8924c4…8c44`](https://testnet.monadscan.com/tx/0x8924c46cf5894f43e08b0dff94fdd8302ac8aa84bfebadbf16e501e3cde28c44), createAccount [`0xfe71c0…9ddb`](https://testnet.monadscan.com/tx/0xfe71c0d4d668d209daffdaa84cf08884f08fa1ad03b567cb09100dbbc51d9ddb) (202k gas), allowOrderForwarding [`0x1df4ca…af0c`](https://testnet.monadscan.com/tx/0x1df4ca06d0017dfdf9c8a0d0c1c71bcf585902dc43173f7efd2e36ebbd34af0c); `getAccountByAddr` por RPC → id 620, balance 100.00; capturas `10`–`13` |
| WebSocket **Live** desde RN (SocketRocket) con la key enrolada desde el teléfono | chip "Live", snapshot con saldo 100.00; captura `13-trade-ready.png` |
| **Long 1x, 10 AUSD en MON** → *Filled 444 MON at 0.02250* | capturas `20`–`24`; posición LONG 444 MON · 1x con PnL en vivo y liq. est. (`25`, `26`) |
| **Close** → *Closed 444 MON at 0.02234*; saldo 99.92, sin posiciones | capturas `27`–`29` |
| **Add funds** 10 AUSD (approve automático + deposit) → *Funds added* | approve [`0xe57e08…5abd`](https://testnet.monadscan.com/tx/0xe57e081912b9c3b500622851d10642deaaea869faf5071dcb61b91466f075abd), depositCollateral [`0xaf3c52…f6bd`](https://testnet.monadscan.com/tx/0xaf3c52a475234194859abda46ebbcbd491e045001c67868535b672a94466f6bd); wallet 24.00 / trading 109.92; capturas `30`–`32` |
| **Withdraw** 5 AUSD → *Withdrawn to wallet* | withdrawCollateral [`0x5a0b9f…5ae4`](https://testnet.monadscan.com/tx/0x5a0b9f686df95f5184a6e1c94b11e06d1d4980a61f2f3269b686e2f42d145ae4); wallet 29.00 / trading 104.92; capturas `33`, `34` |
| Wallet muestra "104.92 AUSD in trading · last seen · Trade tab" y los movimientos reales (−100 createAccount, −10 deposit) | captura `35-wallet-in-trading.png` |
| `maxPriorityFeePerGas` 20 gwei sin `maxFeePerGas` explícito: viem lo estima y el nodo acepta | las 7 tx anteriores, status 1 |
| Proceso | 14 tareas con revisión independiente por tarea (1 ronda de fix en Task 8: 3 *Important* del código del plan), revisión final de rama (opus) → 1 *Important* + 6 minors corregidos en una ola y re-revisados |

Capturas en el scratchpad de la sesión (`shots/`), no en el repo. Automatización con `idb ui describe-all/tap/text`
+ `simctl io screenshot`; Face ID con `notifyutil -p com.apple.BiometricKit_Sim.fingerTouch.match`.

## Rulings (decisiones tomadas durante plan y ejecución)

1. **`initial_margin` = apalancamiento máximo ×100.** Medido: `lv: 500` en MON (im 300) se acepta pero la
   posición queda con `lv: 300`. El selector muestra solo `LEVERAGES.filter(lv ≤ maxLeverage)`; MON: 1x·2x·3x.
   Desvía el "1x · 2x · 3x · 5x" fijo del spec.
2. **`maintenance_margin` es fracción del margen inicial en bps** (MON 500 = 5 %); fracción sobre nominal =
   `mm/10000/maxLeverage` (MON ≈ 1.67 %). La liquidación estimada usa esa fórmula (1x MON ≈ 0.0167×entrada).
3. **Fee taker con `ceil`** (2.221 AUSD × 345 micros = 766.2 → cobrado 767).
4. **`getAccountByAddr` devuelve un struct**; decodificar `uint256` lee el id (primer word).
5. **Paso 3 (forwarding) sin getter on-chain**: en Retry se reenvía `allowOrderForwarding(true)` salvo que ya
   se haya hecho en la sesión o el snapshot vivo diga `fw: true` (71k gas extra en el peor caso).
6. **Sin detección de gap de `sn` en el heartbeat** (no está en el spec; riesgo de reconexión espuria con
   órdenes en vuelo). El backoff cubre los cierres reales.
7. **`OrderOutcome.failed.order` opcional** (los rechazos del gateway no traen orden).
8. **Fix wave de la revisión final**: el saldo de la wallet solo se valida cuando aún no hay cuenta (antes
   bloqueaba Retry tras fallo en paso 3/4); `Max` deja sitio a la fee (`free − fee(free×lv)`, mejor que la
   literal del brief); el heartbeat ya no emite `state` (un re-render por segundo); `resetKey` no borra la key
   antes de enrolar; errores de Reset/Enable forwarding visibles; copy tras el 2.º `sr 32`.
9. **Copy de cierre**: "Closed N SYMBOL at P · Fee … · realised PnL shows in the trading balance" en vez de
   "Closed · realised ±x AUSD" (§3.4): el fill no trae PnL realizado.
10. El `expo run:ios` huérfano de la sesión anterior (worktree `mobile-wallet`, pid 77892) ocupaba :8090 y
    se terminó.

## Lo aprendido

1. **`lb` de la cuenta no es "colateral en posiciones"**: con la posición abierta la app mostró
   "0.00 locked in positions · 89.99 free" porque el colateral (10 AUSD) sale de `b` directamente y
   `lb` quedó en 0 (probablemente solo cuenta órdenes en libro). La línea es engañosa; hay que
   recalcular "locked" como Σ `c` de las posiciones o cambiar el copy.
2. **La fee se muestra como "0.00 AUSD"**: 444 MON × 0.0225 × 345 micros ≈ 0.0034 AUSD y `formatAusd`
   trunca a 2 decimales. Conviene 4 decimales para fees.
3. El WebSocket de RN (SocketRocket) manda `Origin` derivado de la URL y Perpl lo acepta (era la única
   superficie no medida en el spike).
4. Monad confirma en ~1 s: los 4 pasos del onboarding pasan tan rápido que la lista de pasos casi no
   se ve; no es un bug.
5. `idb ui tap` por etiqueta coincide por substring: "Wallet" tocó "Withdraw to wallet"; usar la
   etiqueta completa de la tab (`", Wallet"`).
6. Los revisores por tarea siguen encontrando defectos del **plan**: los 3 *Important* de Task 8 y el
   de Task 14/11 eran código escrito en el plan.
7. Un implementador usó `git stash` (con tag, y lo limpió) pese a la regla; la regla de "commitea el
   coordinador por nombre" evitó daños.

## Pendientes (minors diferidos, ninguno bloquea el merge)

- "locked in positions" con `lb` (ver aprendido 1) y fee con 2 decimales (aprendido 2).
- `head` solo avanza con `mt 19/100`; `mt 21/24/27` podrían refrescarlo. Botón **Enable** dentro del
  resultado *Failed* `sr 34` (hoy solo en el aviso de la pestaña Trade cuando `fw === false`). El texto
  de geobloqueo aparece en todo `keyRejected` (2×3401), no "tras 3 fallos".
- `usePerpl`: `isForwarding` lee `liveRef` que ya es null durante `enable` (actúa el reenvío);
  `enable`/`move` dependen de `treasury` inestable; sign-out durante un `enable` en vuelo puede pisar
  `none`; grace timer sin cleanup en unmount; sin tests del hook. `actionError` compartido entre los dos
  avisos de Trade.
- Socket: `authFailures` solo se resetea en `mt 19`; `close()` no resetea `attempt`; el estado no se
  limpia en drop ("last seen" deseado); `connect()` reentrante no falla pendientes del socket viejo.
- Parsers/validación: `instance.exchange` sin validar formato; `is_open` sin helper; `sizeFromAusd`
  `Number()` sin guard; `normalizeTypedData` no valida `chainId`/`time`; `isNoAccountRevert` acepta
  cualquier revert; `free` negativo si `lb > b`; `perpsMarkets` sin default de tipo; sin tests de I/O de
  SecureStore ni de componentes; "0.00 AUSD in trading" antes de la primera conexión; `amount` de Enable
  en `useState` local; cálculos por render y copy de slippage en perpsMarket; `LIVE_ORDER` sin comentario.
- Antes de mainnet (fuera de alcance; anotar en `docs/02-decisiones-abiertas.md`): gate biométrico de la
  key, ping 5 s, URLs/contrato por `extra`.
- Los trailers de un commit (`28aeb01`) dicen "Claude Sonnet 5" (lo escribió el subagente); el resto
  "Claude Opus 5 (1M context)".

Copy congelado y build 3: sin cambios respecto a `docs/06-handoff-ui-port.md`; esta rama no sube
`ios.buildNumber`.

## Estado de las cuentas de testnet al cierre

- Simulador `0xe3719a93b75Cee42C5a8f3dCe45e5b4B327851C1`: 29.00 AUSD y ~0.15 MON en wallet; cuenta
  Perpl **#620** con 104.92 AUSD, plana, forwarding activo, key `pickler.perpl.v1` en el SecureStore del
  simulador.
- KAT `0x2945…779f`: ~9,761 AUSD, ~4.98 MON; cuenta Perpl #619 con ~99.93 AUSD, plana (dos órdenes de
  100 MON abiertas y cerradas hoy para capturar fixtures y medir el `lv` máximo). Su API key del spike
  sigue en el scratchpad de la sesión anterior (`perpl/spike-key.json`).

## Siguiente punto de decisión

(Superado el 2026-09-16 por la noche: ver "Cierre" abajo. Se conserva el texto original.)

La rama está lista para merge a `main` (revisión final con fixes re-revisados, 164/164, flujo completo
verificado en el simulador con tx reales). Decide Jesús: (1) merge + push; (2) si va a TestFlight,
sumar la lista del build 3 y subir `ios.buildNumber`; (3) fase 3 = agente como operador delegado
(caps, D-02) sobre esta misma pestaña.

## Cierre (misma sesión, 2026-09-16 20:45)

Jesús aprobó merge + TestFlight:

- `main` = `35649b6` (merge de `feat/mobile-perpl` `5f76811` y de `feat/mobile-build3`), pusheado a
  `origin` junto con las ramas `feat/mobile-perpl`, `feat/mobile-wallet` y `feat/mobile-build3`.
- **Build 3** (`feat/mobile-build3`, revisión independiente + 1 fix): mensaje real de `PRF_UNAVAILABLE`
  (`src/wallet/prfMessage.ts`, iOS 18 solo si la versión es menor), `expo-build-properties` 57.0.20 con
  `deploymentTarget` 18.0, "Get test MON · copies address" + fila "Your address", README con la nota de
  proveedores de passkey, `ios.buildNumber` "3". 168/168.
- `.ipa` 0.1.0 (3), `MinimumOSVersion` 18.0, subido con `altool`: **UPLOAD SUCCEEDED**, Delivery UUID
  `3e4260cd-b9dd-48bb-a5cb-219ed050a434`. Falta que App Store Connect lo procese y añadir el build al
  grupo de testers (Jesús, Juvenal).
- Pendiente del build 3 no incluido: nada (el logo ya se arregló en la fase wallet).
- **Primer uso en teléfono real (Jesús, iPhone, WiFi Totalplay CDMX):** Enable trading OK (cuenta Perpl
  #621, 100 AUSD, tx 20:48) pero el WebSocket devolvió `3401` dos veces → aviso "Trading key rejected.
  Perpl isn't available in some regions". Causa real: **reloj del iPhone desfasado** (Perpl exige
  firmas dentro de ±30 s). Con "Ajustar automáticamente" activado, pasó a Live. Pendiente: detectar el
  desfase (comparar el header `Date` de `pub/context` con `Date.now()`) y decir "Your phone's clock is
  off by N s" en vez del copy de regiones.

## Estado al cerrar la sesión (2026-09-16, ~21:10)

- `main` = `20ac1fa`, igual que `origin/main`. Worktrees limpios: `mobile-perpl` (en `feat/mobile-build3`,
  ya mergeada), `mobile-wallet`, `mobile-ui-port` (todas mergeadas; se pueden borrar con
  `git worktree remove`).
- TestFlight: build **0.1.0 (3)** `VALID`, `IN_BETA_TESTING` para el grupo interno "Equipo" (acceso
  automático a todos los builds). Probado por Jesús en su iPhone: onboarding de Perpl OK (cuenta #621);
  el `3401` fue por reloj desfasado (arreglado al activar hora automática).
- Sin procesos de build/Metro corriendo. `.env.asc` copiado (gitignored) al worktree `mobile-perpl`.

### Lista propuesta para el build 4 (decide Jesús)

1. Detectar desfase de reloj (header `Date` de `pub/context` vs `Date.now()`) y aviso específico en vez
   del copy de regiones.
2. "locked in positions" calculado como Σ `c` de las posiciones (el `lb` de Perpl no lo es).
3. Fees con 4 decimales (hoy "0.00 AUSD").
4. **Tras Sign out + sign in, Trade vuelve a pedir "Enable trading" con 100 AUSD** aunque la cuenta de
   Perpl ya exista (reportado por Jesús). No es un bug de la key: Sign out la borra a propósito (spec §4)
   y cerrar/reabrir la app sí conserva el estado (verificado en el simulador: Live con 104.92 al
   relanzar). El hueco es de UX: en estado `none`, si `readAccountId(address) > 0`, mostrar
   "Reconnect trading" sin monto (solo reenrola la key y reenvía forwarding), en vez del formulario de
   100 AUSD. Hoy, si el usuario pulsa Enable con la cuenta existente, `runEnable` NO vuelve a mover AUSD
   (salta approve/createAccount), pero el copy lo sugiere.
5. Minors diferidos de las revisiones (sección "Pendientes") a criterio.

### Fase 3 (agente como operador delegado)

Reutiliza `src/perpl/*` (puro) y `usePerpl`; la decisión D-02 (caps) se reabre con las cuentas de Perpl.
Spec por escribir con brainstorming; el spike de Perpl y los fixtures reales ya cubren el protocolo.

# Handoff — wallet real (withdraw + movements) e iconos (2026-09-16)

Cierre de la sesión que hizo real la sección *Wallet* de la app móvil: *Withdraw* manda AUSD
de verdad en Monad Testnet, *Movements* lista las transferencias reales de la dirección vía
MonadScan, la tab bar tiene iconos y el header de Market recupera el logo. Rama
`feat/mobile-wallet`, base `main` (`286bd0a`). Spec: `docs/superpowers/specs/2026-09-16-mobile-wallet-design.md`;
plan: `docs/superpowers/plans/2026-09-16-mobile-wallet.md`.

## Qué quedó hecho y verificado

| Pieza | Evidencia |
|---|---|
| Tab bar con Ionicons (`storefront`/`pulse`/`pie-chart`/`wallet`, relleno activo) vía `@expo/vector-icons` 15.1.1 | `src/Shell.tsx`; captura `01-market-icons.png` |
| Logo del header sin truncar (`assets/pickler-mark.png`, 160×160 RGBA desde `PickerLogo.png`) | misma captura; PIL carga el PNG completo |
| Withdraw real: destino (Paste) + monto (Max) → review con fee real en MON → Confirm (Face ID si está `locked`) → recibo | `src/screens/own.tsx`, `src/wallet/chain.ts` (`sendAusd`, `estimateAusdTransferFee`), `src/wallet/withdraw.ts`; **tx real de 1 AUSD** [`0x3f2b6b9f…808a`](https://testnet.monadscan.com/tx/0x3f2b6b9f49560155294d28f55343faf178c58cdd9e0068f2a659fa60274a808a) (status 1, `transfer` de 1,000,000 unidades a `0x2945…779f`), capturas `03-withdraw-review.png`, `04-withdraw-done.png` |
| Movements reales (Faucet / Deposit / Withdrawal) desde Etherscan V2 `chainid=10143`, con filas *Confirming* para tx propias en vuelo, *Reverted* hasta el siguiente refresh manual, aviso + Retry si el explorer falla, timeout de 15 s | `src/wallet/explorer.ts`, `src/hooks/useTreasury.ts`; capturas `02-wallet-movements.png`, `05-wallet-after.png` (Withdrawal −1.00 AUSD · Complete), `08-wallet-explorer-error.png` |
| Línea de pending real ("N transfers confirming" / "Nothing pending.") | `05-wallet-after.png` |
| Validación contra el defecto | `06-withdraw-invalid-address.png`, `07-withdraw-over-balance.png` |
| Tests | `npx tsc --noEmit` limpio; `npm test` **55/55** (41 previos + chain 4 + transfer 2 + explorer 4 + withdraw 4), corridos por el coordinador al cierre |
| Proceso | 9 tareas, cada una con revisión independiente (2 rondas de fix: Task 6 y Tasks 7+8); revisión final de rama completa (opus) con 2 *Important* corregidos en una ola y re-revisados; 13 commits |

Las capturas viven en el scratchpad de la sesión (`shots/`), no en el repo.

## Decisiones tomadas durante la ejecución (rulings)

1. **Historial vía MonadScan, no vía RPC.** Medido: el RPC público limita `eth_getLogs` a 100
   bloques; Ankr/dRPC/monadinfra limitan igual; SQD sin key tarda ~12 min con `529`. La key
   gratuita de Etherscan V2 vive en `app.config.ts → extra.monadscanKey` (override
   `PICKLER_MONADSCAN_KEY`); es pública, solo lectura, testnet. Costo si está mal: rotar la key.
2. **`MONADSCAN_API`/`MONADSCAN_CHAIN_ID` en `wallet/explorer.ts`, no en `config/explorer.ts`**
   (el spec los ponía juntos). `config/explorer.ts` lee `expo-constants` y lanza sin key; si
   `wallet/explorer.ts` lo importara, los tests no podrían cargarlo sin mocks.
3. **`load()` vs `refresh()` en `useTreasury`.** El plan hacía que `track` llamara `refresh()`
   justo después de marcar una fila `Reverted`, y `refresh()` la filtraba en el mismo tick:
   la fila nunca se veía. Se separó `load()` (saldos + movimientos, no toca `pending`) de
   `refresh()` (filtra `Reverted` + `load`). Además `track` quita la fila si `waitForReceipt`
   lanza (timeout de 180 s de viem), para no dejar *Confirming* huérfanas.
4. **Estado `unknown` en Withdraw.** Si `withdraw` rechaza después de `onSent` (recibo que no
   llega), la pantalla pasa a "Sent · confirmation not received" con el error y "Back to
   wallet" en vez de un spinner sin salida. No estaba en el spec; la regla "todo estado tiene
   salida" sí.
5. **Saldos independientes del explorer.** `load()` aplica `setBalances` en su propia rama del
   `Promise.all`; un explorer colgado ya no deja `balances` en `null` (que hacía que Withdraw
   validara contra 0.00). Y el fetch del explorer tiene timeout de 15 s con
   `AbortController` + `setTimeout` — **no** `AbortSignal.timeout`, que compila en TS pero no
   existe en el runtime de RN 0.86 (polyfill `abort-controller` 3.0.0).
6. **Max usa `formatUnits(ausd, 6)`**, no `formatAusd` (2 decimales), para no dejar polvo.
7. **Prueba manual con `idb` en vez de `cliclick`/`osascript`.** La sesión no tenía Screen
   Recording/Accessibility sobre macOS; el agente usó `idb ui describe-all`/`tap`/`text` (árbol
   de accesibilidad del propio simulador) y `simctl io screenshot`. El método cambió, la
   evidencia (capturas + recibo en cadena) no.
8. **Paralelismo de subagentes en un solo worktree**: los agentes que corrían en paralelo no
   commiteaban; el coordinador commiteó sus archivos por nombre al terminar, para que un
   `git add` por nombre no arrastrara staging ajeno. Tres commits del batch salieron con los
   trailers pegados al asunto y se corrigieron con `filter-branch --msg-filter` (sin push).

## Lo aprendido

1. **Un worktree nuevo no tiene `node_modules`.** Hay que correr `npm ci` una vez antes de
   soltar agentes; dos installs concurrentes corrompen `node_modules`.
2. **APIs web "modernas" en código RN se verifican contra el polyfill de RN, no contra Node/TS.**
   `AbortSignal.timeout` es el ejemplo: tsc y jest en verde, y la app habría fallado en cada
   carga de Movements.
3. **`extra` de `app.config.ts` no se refresca con `expo start` en un dev-client ya instalado**;
   para que la app vea otra key (p. ej. probar el explorer caído) hay que rehacer
   `expo run:ios`. Documentado en el README.
4. **Monad confirma en ~1 s**: el estado "Sent · waiting for confirmation" casi no se alcanza a
   ver ni a capturar. No es un bug.
5. **La cuenta de prueba del repo (vector KAT `fill(7)`, `0x2945…779f`) sirve para fondear
   cuentas de simulador** con un script de usar-y-tirar que deriva la llave con `src/hd/hd.ts`.
   Es una llave pública por definición; solo testnet.
6. **Los revisores por tarea encuentran defectos del plan, no solo del implementador.** Los dos
   *Important* de esta rama (fila Reverted invisible, estado `sent` sin salida) eran código
   escrito en el plan. Vale la pena que el revisor lea el brief con el spec como autoridad.

## Pendientes

Minors diferidos de las revisiones (ninguno bloquea el merge):

- Fuga de la dirección anterior tras Sign out con una tx en vuelo (pre-existente de fase 1;
  fix: `addrRef` y salir de `load` si cambió).
- Hueco entre quitar la fila *Confirming* al recibo y que el explorer indexe la tx (el spec
  manda quitarla; alternativa: dejarla como *Complete* en `pending` hasta que el explorer la
  devuelva — el dedupe por hash ya lo soporta).
- `"1,000"` se parsea como 1 AUSD (`,` → `.`); Review muestra el monto parseado a 30 pt, así
  que se ve, pero conviene decidir el separador.
- Sin Retry de la estimación de fee en review (Edit → Review vuelve a estimar); tras un error de
  estimación, Confirm cambia "unavailable" por "estimating…".
- Carrera Edit → Review con estimación lenta (contador de petición); "0.00 AUSD available"
  cuando el RPC está caído; doble tap en Confirm sin ref de guardia.
- `FAUCET_AMOUNT` fijo en la fila *Confirming* del faucet; `key={hash}` colisionará si una tx
  emite dos `Transfer` (llegará con Perpl: llevar `logIndex`).
- Pulido: guard muerto en `parseAusd`, `walletClient` duplicado, `shortHash` sin validar
  longitud, estilos duplicados y unión `WithdrawStep` en una línea, error de dirección visible
  antes de tocar el campo, `fetchAusdTransfers` sin test con `fetch` mockeado.

Copy congelado y build 3: sin cambios respecto a `docs/superpowers/audits/2026-09-16-mobile-ui-port-f1-rulings.md` (la lista del
build 3 sigue pendiente; esta rama no sube `buildNumber`).

## Siguiente punto de decisión

La rama está lista para merge a `main` (revisión final limpia, 55/55, withdraw real
confirmado). Decide Jesús: (1) merge + push; (2) si va a TestFlight, sumar la lista del build 3
de `docs/superpowers/audits/2026-09-16-mobile-ui-port-f1-rulings.md` y subir `ios.buildNumber` a `"3"`; (3) fase 2 = Perpl y la
decisión de venue, sin cambios.

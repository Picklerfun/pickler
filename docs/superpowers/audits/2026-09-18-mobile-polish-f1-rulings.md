# Handoff — pulido de navegación: coming soon, arranque en Wallet, gestos y PnL en Trade (2026-09-18)

Cierre de F1 de `mobile-polish`: los tres tabs en mock dicen "coming soon" con la estética de
la app, la app arranca en Wallet, Wallet y Trade se refrescan jalando, las pantallas con `←`
regresan con swipe desde el borde, y Trade muestra el PnL no realizado con "in positions /
free" calculados con Σ `c` y `b`. Rama `feat/mobile-polish`, base `main` (`09a7ac9`), 8
commits (`aefc1bd..0f6d208`), sin push. Spec:
`docs/superpowers/specs/2026-09-18-mobile-polish-design.md`; plan:
`docs/superpowers/plans/2026-09-18-mobile-polish-f1.md`. Ejecutado con
subagent-driven-development: un implementador y un revisor independiente por tarea (7 tareas,
7 revisiones `Approved`, 0 rondas de fix) más la revisión final de rama (ver abajo).

## Qué quedó hecho y verificado

| Pieza | Evidencia |
|---|---|
| Tests | `npm test` → **24 suites, 176/176** (línea base 168 + 8 nuevos: store ×3, gestures ×2, orders ×2, comingSoon ×1). `npx tsc --noEmit` limpio. README actualizado (decía 41/41). |
| Coming soon (D1/D2/D4) | Simulador iPhone 17 Pro, flujo Maestro `01-coming-soon.yaml` en verde: Market/Activity/Portfolio muestran disco lima con el ícono del tab, tag punteado COMING SOON, copy exacto y "Go to Wallet"; header "Coming soon" sin ★/Alerts; capturas `02-market`, `03-activity`, `04-portfolio`. El mock sigue en `SCREENS`. |
| Arranque en Wallet (D3) | Con cuenta: `01-boot-wallet.png` (Wallet directo). Sin cuenta: Sign out → `stopApp` → `launchApp` → "Wallet access" con "I already have one" (`23-boot-no-account.png`); tras el passkey aterriza en Wallet `0xe371…51C1` (`26-after-signin.png`). |
| Pull-to-refresh (D5/D6) | Video del simulador durante el gesto (`pull.mp4`, fotogramas `strip-wallet.png` / `strip-trade.png`): la tarjeta baja con el spinner lima y se suelta sola; en Trade pasa por *Connecting…* → *Live*. El botón Refresh ya no existe (`assertNotVisible "Refresh"` en verde); el Retry del error de RPC se conserva. |
| Swipe atrás (D7) | Maestro `02-gestures.yaml`: Deposit → swipe desde `1%` → "Available to spend" visible en < 3 s (`08-after-edge-swipe.png`). El mismo swipe en Wallet no hace nada. |
| Trade: PnL y colateral (D9–D12) | Ver medición D12. Con posición abierta: "10.02 in positions · 94.89 free" y línea "−0.00 / +0.00 unrealised PnL" que coincide con la fila del `PositionRow` (`17-trade-with-position.png`, `18-positions.png`). Sin posiciones la línea desaparece (`21-final.png`). |
| Docs | `npm run agents:check` errors `[]`; `npm run docs:check` 15/15; overview `2026-09-18-mobile-polish.html` con F1 `completed`, 9 tasks marcadas y rulings; captura 390 px mirada. |

Capturas y video en el scratchpad de la sesión (`shots/`, `maestro/`); no se versionan.

### Medición D12 — `b` vs `c` en la cuenta Perpl #620 (simulador)

| Momento | `b` (Trading balance) | Σ `c` (in positions) | free mostrado | PnL |
|---|---|---|---|---|
| Plana | 104.92 | 0.00 | 104.92 | (oculto) |
| Long 415 MON @ 0.02412, 1x, 10 AUSD | **94.89** | **10.02** | 94.89 | −0.00 → +0.00 |
| Cerrada @ 0.02403 | 104.87 | 0.00 | 104.87 | (oculto) |

`b` bajó 10.03 al abrir (≈ `c` 10.02 + redondeo) y volvió al cerrar menos la pérdida
(415 × 0.00009 ≈ 0.04): **`b` excluye el colateral**, como midió el audit del 16 sep. "free = `b`"
es correcto; D10 se mantiene sin cambios.

## Decisiones tomadas durante la ejecución (rulings)

1. **R0 — `backState` con stack vacío cae a `wallet`** (antes `market`). El spec fija Wallet como
   inicio y `market` es ahora coming soon; el spec no lo decía. Costo si está mal: un `back` de
   más aterriza en Wallet en vez de Market; una línea.
2. **R1 — `COMING_SOON_COPY` vive en `src/screens/comingSoonCopy.ts`** (puro) y `comingSoon.tsx`
   lo re-exporta. Importar el `.tsx` desde Jest falla con `Cannot find module 'expo-asset' from
   expo-font/build/FontLoader.js` (jest-expo no resuelve Ionicons). El test apunta al módulo
   puro. Costo: un archivo extra.
3. **R2 — Paralelismo con commits del coordinador.** T1/T3/T4 y T2/T5 y T6/T7 se implementaron
   en paralelo (archivos disjuntos); los implementadores no commitearon y el coordinador
   commiteó por nombre tras cada revisión, para que un `git add` por nombre no arrastrara
   staging ajeno (precedente del audit mobile-wallet). Efecto: los reports de T1/T3/T4 hablan
   de conteos de suite mezclados; los commits son limpios.
4. **Sign out sigue aterrizando en Market** (ahora coming soon). El spec lo dejó explícito ("Sign
   out no cambia"); se respeta y va a Pendientes como decisión de Jesús.
5. **No se re-habilitó trading en el simulador tras el Sign out de prueba.** Hacerlo exigiría
   `Get test AUSD` (10,000) + `enable(100)`, que depositaría 100 AUSD más en #620 y ensuciaría
   la medición. Se deja documentado (ver cuentas).

## Lo aprendido

1. **Dos simuladores arrancados → `booted` es ambiguo.** Otra sesión tenía
   `Proflores-Login-20260916` arrancado; `xcrun simctl io booted screenshot/recordVideo` caía
   ahí y grababa la pantalla de inicio mientras Maestro reportaba la app en verde. Usar
   siempre el UDID (`2B2A0BAD-7B14-4DAE-8652-C7E9472505E0`) y `maestro --udid`.
2. **Maestro no ve los textos dentro de `Touch`/`TouchCard`** (tabs, filas de mercado, botón
   Close): `tapOn: text` falla y hay que tocar por `point` en porcentajes (tabs al 93 % de alto:
   Market 11 %, Trade 30 %, Activity 50 %, Portfolio 69 %, Wallet 89 %). Los textos sueltos
   (`T` fuera de un `Touch`, botones con label) sí se encuentran. Añadir `accessibilityLabel`
   a `Touch` es una mejora barata para automatizar.
3. **`simctl recordVideo` necesita correr como tarea de fondo real** (con `&` en subshell sin
   tty muere en 0.07 s); detenerlo con `pkill -INT -f recordVideo`. `ffmpeg … tile=10x14
   -frames:v 1 -update 1` da una hoja de contacto para localizar el spinner.
4. **`hideKeyboard` de Maestro falla en este simulador**; tocar fuera del input funciona.
5. **`expo run:ios` instaló y "abrió" la app pero `simctl launch` decía NotFound** hasta
   reinstalar con `simctl install <udid> <ruta .app>`; con dos simuladores arrancados expo
   eligió bien pero `booted` no.
6. **Face ID del simulador se des-inscribe al reiniciar**: `notifyutil -s
   com.apple.BiometricKit.enrollmentChanged 1 && notifyutil -p …enrollmentChanged` y luego
   `notifyutil -p com.apple.BiometricKit_Sim.fingerTouch.match` para "presentar la cara".
   El simulador tiene **dos** passkeys "pickler"; la primera de la lista es `0xe371…51C1`.

## Estado de las cuentas de testnet al cierre

- Simulador `0xe3719a93b75Cee42C5a8f3dCe45e5b4B327851C1`: 29.00 AUSD y 0.0718 MON en wallet.
  Cuenta Perpl **#620** con **104.87 AUSD**, plana (long de 415 MON abierto y cerrado hoy para la
  medición D12; pérdida ≈ 0.05 AUSD con fees). **La app del simulador quedó sin key de Perpl**:
  el Sign out de prueba borró `pickler.perpl.v1` del SecureStore y Trade vuelve a pedir "Enable
  trading" con mínimo 100 AUSD (la wallet tiene 29). Es exactamente el caso "Reconnect trading"
  de la lista del build 4; hasta que exista, para operar #620 desde el simulador hay que pedir
  AUSD al faucet y `enable(100)` (deposita 100 más en #620) o restaurar la key a mano.
- KAT `0x2945…779f`: sin cambios respecto al audit del 16 sep (no se tocó).
- iPhone de Jesús: sesión real con su long de BTC; no se tocó.

## Pendientes

Minors diferidos por los revisores (ninguno bloquea):

- `orders.ts:56` variable local `any` → `matched`.
- `comingSoon.tsx:16` fallback silencioso a `COMING_SOON_COPY.market`; un check `never` lo haría
  explícito.
- `Shell.tsx` `useCallback(onRefresh)` no memoiza de verdad (`treasury`/`perpl` son objetos nuevos
  por render); sin efecto en corrección.
- Sin test del empate `|dx| === |dy|` en `shouldCaptureEdgeSwipe`; sin test de componente de
  `ComingSoonScreen` (limitación jest-expo/expo-font).

Producto (decide Jesús):

- **Tras Sign out la app aterriza en Market (coming soon).** Propuesta: `resetTo("signin")` con
  `next: "wallet"`, o directamente Wallet gated. Hoy el usuario tiene que tocar Wallet y pasar
  por Sign in.
- **Sign in en el arranque muestra `←`** con stack vacío (lleva a Wallet sin cuenta, que
  muestra "—"); y su subtítulo "One step, then back to your purchase" es copy del flujo de
  compra. Ambos heredados.
- **PnL de ±0.00**: con una posición que vale −0.004 AUSD la línea dice "−0.00 unrealised PnL"
  (misma regla que la fila). Si molesta, tratar |pnl| < 0.005 como "+0.00".
- Wallet dice "0.00 AUSD in trading" mientras el socket no ha conectado (sin " · last seen"
  porque `lastBalance` es `null` al arrancar); heredado de fase 2.
- Añadir `accessibilityLabel` a `Touch`/`TouchCard` para que Maestro (y VoiceOver) encuentren
  tabs y filas por texto.
- Build 4 de TestFlight: este cambio es candidato natural junto con la lista existente
  (desfase de reloj, fees con 4 decimales, "Reconnect trading").

## Siguiente punto de decisión

La rama está lista para revisión de merge a `main` local (sin push): 8 commits, tests y tsc en
verde, verificación en simulador con capturas. Decidir (1) si se mergea, (2) si "Sign out →
Market coming soon" se cambia antes del merge o va al build 4, y (3) si el build 4 se registra
ya con `pickler-dev-new` incluyendo este pulido.

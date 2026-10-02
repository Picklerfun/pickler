# Handoff — rediseño hi-fi F1: tema, primitivas, Shell y tabs; Wallet, Sign in y coming soon (2026-09-18)

Cierre de F1 de `mobile-hifi`: la app entera corre con el tema del diseño hi-fi
(`jjesusaf/pickler-mobile@a0e353e`, portado de `Pickler Mobile App.dc.html`) — gradiente azul con
puntos de estrella, Chakra Petch en los títulos, iconos lucide y la tab bar
MARKETS · LAUNCHPAD · ACTIVITY · PORTFOLIO · WALLET. Wallet, Deposit, Withdraw y Sign in quedaron
re-vestidos sin perder lógica; Launchpad, Activity y Portfolio son *coming soon*; el mock del
wireframe se borró. Markets, Market y Funds sólo se adaptaron mecánicamente a las primitivas nuevas
— su re-maquetado es F2. Rama `feat/mobile-hifi`, base `main` (`48f82a4`), 11 commits
(`6cb7aa9..HEAD`), sin push y sin merge. Spec:
`docs/superpowers/specs/2026-09-18-mobile-hifi-design.md` (D4–D12, D16–D18, D22–D24 son F1); plan:
`docs/superpowers/plans/2026-09-18-mobile-hifi-f1.md`. Ejecutado con subagent-driven-development:
un implementador por task (Tasks 0–9) y el coordinador commiteando por nombre de archivo.

## Qué quedó hecho y verificado

| Pieza | Evidencia |
|---|---|
| Tests y tipos | `npm test` → **23 suites, 169/169** (`Time: 3.151 s`, `Ran all test suites.`). `npx tsc --noEmit` limpio (exit 0). README actualizado (decía 178/178 y 24 suites). |
| Rebuild nativo (D11) | `npx expo prebuild --platform ios --clean` → `✔ Created native directory` · `✔ Finished prebuild` · `✔ Installed CocoaPods`. `ios/Podfile.lock` trae `ExpoLinearGradient (57.0.2)` y `RNSVG (15.15.4)` con sus checksums. `npx expo run:ios --device 2B2A0BAD-…05E0` → `› Build Succeeded` · `› 0 error(s), and 1 warning(s)` (el warning es `ignoring duplicate libraries: '-lc++'` del linker) · `› Installing on iPhone 17 Pro` · `› Opening on iPhone 17 Pro (fun.pickler.app)` · `iOS Bundled 3872ms index.ts (4352 modules)`. |
| Tema, backdrop y header (D8–D10) | En las once capturas: gradiente `bgTop → bgMid → bgBottom` con los puntos de estrella visibles sobre el azul, header con logo `pickler-mark` 24 px (o `←` en círculo 31 px), título en Chakra Petch y subtítulo `faint`, `⚙` a la derecha. **No hay** fila "9:41 ⚙" y **no se ve ningún texto en fuente del sistema** (todo Manrope / JetBrains Mono / Chakra Petch). |
| Tab bar (D4) | `01`…`11`: cinco tabs con iconos lucide (chart, rocket, activity, layers, wallet), etiqueta mono 9 px, activo en lima y el resto en `faint`. `tab-markets`…`tab-wallet` responden a Maestro por texto. |
| Wallet (D16) | `03-wallet.png`: card `AVAILABLE · AUSD` con **29.00** en display, `0xe371…51C1 · CONNECTED` en mono, "Nothing pending.", fila Deposit/Withdraw `outline2`, `MOVEMENTS` con seis filas reales de MonadScan (kind, fecha · hash en mono, monto en lima/`ink`, `COMPLETE`), `TESTNET` con MON (GAS) 0.0718 y la dirección, y más abajo `SESSION`. |
| Deposit (D16) | `04-deposit.png`: `←` + "Deposit AUSD / Monad network", KV `ASSET · AUSD` / `NETWORK · Monad`, caja punteada `QR CODE · DEPOSIT ADDRESS`, `YOUR DEPOSIT ADDRESS` con la dirección completa en mono, `Btn lime` **Copy address** e `I've sent it` en `outline2`. |
| Withdraw (D16) | `05-withdraw-edit.png`: `DESTINATION ADDRESS` con la dirección y el chip `Paste`, `AMOUNT · AUSD` con la cifra en display, chip `MAX`, `AVAILABLE 29.00 AUSD` y `Btn lime` "Review withdrawal →". `06-withdraw-review.png`: dirección completa, `YOU WITHDRAW · AUSD` **0.01**, KV `NETWORK` MONAD / `NETWORK FEE` ~0.0056 MON / `PLATFORM FEE` 0.00 AUSD / `YOU RECEIVE` 0.01 AUSD en lima, y `Edit` + `Confirm withdrawal`. **No se confirmó el retiro**: la evidencia se detiene aquí. |
| Coming soon (D17) | `07-launchpad.png`, `08-activity.png`, `09-portfolio.png`: disco de 72 px con borde `vioBd40` e icono lucide violeta (rocket / activity / layers), título en Chakra Petch 22, chip **COMING SOON** punteado en lima, copy centrado exacto del spec ("Agents with a token", "What the agents you follow are doing", "Tokens · Perps · Reads") y `Btn outline` "Go to Wallet". El subtítulo del header dice "Coming soon" en los tres (D22). |
| Sign in (D18) | `01-signin.png`: "Wallet access / Passkey on this device", copy del hi-fi "Reading and following never need an account. The wallet appears the first time money moves.", `Btn lime` **Create a wallet**, `Btn outline` **I already have one** y el pie "Connecting is not signing. Every operation is confirmed on its own." Ya no aparece el copy heredado "One step, then back to your purchase". |
| Markets y Market compilan (D24) | `10-markets.png`: header "Markets / Perps on Perpl · Monad", gate **Enable trading** con input `display`, "29.00 AUSD in wallet · minimum 100.00", el aviso en `warn` y el botón deshabilitado; `Tag MARKETS` y la lista real de Perpl (BTC 81284.0 +5.72 %, ETH 2618.53, SOL 113.54, MON 0.02463, ZEC, LIT) con las marcas en mono. `11-market.png`: "BTC Perp / Perpl · isolated margin · market order", `Segmented` Long/Short con el long en lima, card `Amount in AUSD` con cifra display y chip `Max`, `LEVERAGE` 1x–5x y KV `SIZE` / `EST. PRICE` 81298.9 / `FEE` / `LIQUIDATION EST.`. Su look final es F2. |
| DevControls podado (D23) | `12-devcontrols.png`: `screen: market · account: locked · perpl: none`, grupos **Perpl** (Markets / Market · ticket / Trading funds), **Wallet** (Wallet / Deposit / Withdraw / Wallet access) y **Coming soon** (Launchpad / Activity / Portfolio) con `pill(on)` lima en la pantalla actual, y `SESSION` con "Account, balances and Perpl are real; nothing here is mocked." + Sign out. Sin *holder*, *dataCase* ni fases de token. |
| Pull-to-refresh en Wallet (D7) | Video del simulador durante el gesto (`pull.mp4`, hoja de contacto `pull-contact.png`, fotograma `03c-wallet-refresh.png`): al arrastrar hacia abajo la tarjeta `AVAILABLE` baja y aparece el spinner lima sobre el gradiente; al soltar vuelve sola a su sitio con los mismos saldos. |
| Swipe atrás (D7) | Maestro en Deposit: `swipe` de `40%,50%` → `95%,50%` y después `assertVisible "copy-address"` **en verde** (no regresó); `swipe` de `1%,50%` → `90%,50%` y después `assertVisible "deposit"` **en verde** (volvió a Wallet). El umbral de borde del audit de `mobile-polish` sigue vivo con el `Shell` nuevo. |
| Docs | `npm run agents:check` → `"errors": []`; `npm run docs:check` → `processed=16 skipped=0 errors=0`; overview `2026-09-18-mobile-hifi.html` con F1 `completed`, las 11 tasks marcadas y `<details class="followups">`; captura de 390 px mirada (status board y phase-card F1 en `completed`, sin desbordes). |

Capturas, flujos de Maestro y el video viven en el scratchpad de la sesión (`f1-shots/`); no se versionan.

### Saldos re-medidos por RPC

Script temporal con **el código del proyecto** (`src/wallet/chain.ts`, `src/perpl/onboarding.ts`,
`src/config/chain.ts`) bajo `node --experimental-strip-types` con un hook de `resolve` que añade la
extensión `.ts` (los imports relativos del proyecto no la llevan y el ESM de Node 22 la exige):

```
RPC 2026-09-19T02:10:56.568Z
addr       0xe3719a93b75Cee42C5a8f3dCe45e5b4B327851C1
AUSD raw   29000000 => formatAusd 29.00
MON  raw   71816980000000000 => formatMon  0.0718
perpl id   620
```

Coincide con lo que pinta la app (`03-wallet.png`: 29.00 AUSD, MON (GAS) 0.0718) y con el audit del
pulido. `readAccountId` confirma que la wallet sigue siendo dueña de la cuenta Perpl **#620**.

## Decisiones tomadas durante la ejecución (rulings)

1. **`tsc` estuvo en rojo a propósito entre las Tasks 0 y 8.** Las Global Constraints del plan lo
   fijaron así: reescribir `theme.ts`, `primitives.tsx` y `store.ts` antes que las pantallas deja
   tipos rotos por diseño, y exigir verde en cada task habría obligado a fixes de relleno que la
   task siguiente borraba. Volvió a verde en la Task 8, al adaptar Markets/Market/Funds y borrar el
   mock; la Task 9 lo confirmó y esta task lo vuelve a medir (exit 0).
2. **Los commits de los subagentes llevan el modelo del subagente en el `Co-Authored-By`.** La rama
   mezcla `Claude Fable 5.1` (Tasks 0 y docs), `Claude Haiku 4.5` (Tasks 1–6) y `Claude Sonnet 5`
   (Tasks 7–8); cada trailer nombra al modelo que escribió ese código. Se acepta como veraz: es la
   atribución correcta, no un descuido.
3. **La verificación del export de fuentes en la Task 0 se hizo leyendo la fuente del paquete.**
   `require("@expo-google-fonts/chakra-petch")` falla bajo Node 22 por el choque ESM/CJS del
   paquete, así que el implementador comprobó los nombres de export (`ChakraPetch_600SemiBold`,
   `ChakraPetch_700Bold`) abriendo el código del módulo en `node_modules`. Es evidencia válida:
   quien consume esos nombres es Metro, no Node.
4. **`assets/pickler-mark.png` se conserva como logo del header.** El `assets/logo.png` del diseño
   mide 1536×1024; a los 24 px del header queda ilegible. La marca cuadrada de 160×160 es la que se
   ve en `03-wallet.png`, `07`…`09`.
5. **`resume` desaparece del store; la tarjeta de acción retenida se deriva de `next`.** El campo
   `resume` sólo servía al flujo de compra del wireframe, que se borró. `heldActionFor(S.next)`
   produce el texto de D18 ("Trading on Perpl", "Moving trading funds", "A deposit",
   "A withdrawal") y devuelve `null` para `wallet` y para `undefined`.
6. **Después de `launchApp`, Maestro tiene que esperar antes del primer `tapOn`.** El primer intento
   tocó `deposit`, Maestro lo dio por `COMPLETED` y la app se quedó en Wallet: el efecto de boot
   (`useLayoutEffect` con `bootState`) corre después y sobreescribe la navegación. Sin `launchApp`
   —con la app ya arrancada— el mismo tap funciona. No es un bug de la app; es la carrera del
   arranque.
7. **Los chips de `DevControls` hay que tocarlos por punto.** Maestro encuentra por texto los `Btn`
   y los `Touch` con `accessibilityLabel`, pero `PChip` no pasa ninguno, así que
   `tapOn: "Wallet access"` falla con *Element not found* aunque el chip esté visible. Se tocó por
   `point: "69%,77%"`. Es el mismo residual que el audit del pulido dejó abierto, ahora acotado a
   DevControls.
8. **A `market` se llegó por DevControls, no tocando una fila de Markets.** Con el gate en `none`
   las `TouchCard` de mercado llevan `onPress={readOnly ? undefined : …}` (D13), así que no son
   tocables. Es el comportamiento que pide el spec; para la captura se usó el salto
   "Market · ticket" del panel ⚙.
9. **No se hizo Sign out y por eso falta `02-signin-held.png`.** La tarjeta "We kept what you were
   about to do" sólo aparece con `S.next ≠ wallet`, y eso exige el gate, que exige estar sin cuenta.
   `hasAccount = account !== null && account.status !== "none"` — con la cuenta `locked` sigue
   habiendo cuenta, así que ningún tab la dispara. Salir habría exigido volver a entrar con la
   passkey, y no había forma de comprobar antes la inscripción de Face ID del simulador sin una
   acción con dinero (faucet o retiro), las dos prohibidas en esta task. La pantalla de Sign in sí
   se capturó (`01-signin.png`) por el salto de DevControls, y el texto de la tarjeta queda cubierto
   por `store.test.ts` ("the held action names what the gate kept, and is null when it kept
   nothing"). Queda como pendiente para la pasada de F2, que necesita el estado sin cuenta de todos
   modos para *Reconnect trading*.
10. **No se re-habilitó trading ni se movió dinero.** El gate "Enable trading" de `10-markets.png`
    es el estado esperado: la key de Perpl del simulador la borró el Sign out de la fase anterior y
    la wallet tiene 29 AUSD contra un mínimo de 100. Se deja así.

### Correcciones tras la revisión final

Commit `3efb6ca` (`fix(mobile): legible Withdraw amount, Markets copy, dev chip a11y label`) cerró
tres hallazgos de la revisión final de F1:

1. `wallet.tsx`: el input de monto de Withdraw cambió de `lh: 1` / `paddingVertical: 0` a
   `lh: 1.3` / `paddingVertical: 4` (sin quitar `display`). Verificado en el simulador
   (`2B2A0BAD-7B14-4DAE-8652-C7E9472505E0`): "0.01" se ve completo, sin recortar. Sólo se tocó este
   input — `market.tsx`, `markets.tsx` y `perpsFunds.tsx` no usan `display` y no se modificaron.
2. Copy muerto "Back to Trade" → "Back to Markets" en los tres botones de `market.tsx` y
   `perpsFunds.tsx` que ya navegaban a `markets`.
3. `DevControls.tsx`: `PChip` ahora reenvía `accessibilityLabel={`dev-${label...}`}` a `Chip`, así
   que los controles de desarrollo son ubicables por accesibilidad y por Maestro (cierra el
   residual de la ruling 7).

## Lo aprendido

1. **`expo prebuild` avisa que `ios.backgroundColor` no se aplica sin `expo-system-ui`**
   (`» ios: ios.backgroundColor: Install expo-system-ui to enable this feature`). El
   `backgroundColor: "#05061A"` de D10 queda declarado en `app.config.ts` pero no llega al nativo.
   En la práctica no se nota porque el `Backdrop` pinta el gradiente encima, pero el color de fondo
   real durante el arranque no es el del diseño.
2. **La cifra `display 30` dentro de un `TextInput` se recorta por arriba — sólo en Withdraw.** En
   `05-withdraw-edit.png` el "0.01" aparece con el tercio superior cortado; en
   `06-withdraw-review.png`, donde la misma cifra es un `T`, se ve entera. La causa es
   `textStyle(700, 30, { lh: 1, display: true })` con `paddingVertical: 0` en `wallet.tsx`: en un
   `TextInput` de iOS ese line height no deja sitio a los ascendentes de Chakra Petch. El input de
   monto del ticket (`market.tsx`) y el de Enable trading (`markets.tsx`) usan Manrope, no
   `display`, así que el defecto **no** los alcanza — la revisión final lo corrigió sólo en
   `wallet.tsx` (ver "Correcciones tras la revisión final").
3. **Siguen los dos simuladores arrancados**, así que `booted` sigue siendo ambiguo: todo
   (`expo run:ios --device`, `simctl io … screenshot`, `maestro --udid`) se hizo con el UDID
   `2B2A0BAD-7B14-4DAE-8652-C7E9472505E0`.
4. **`hideKeyboard` de Maestro sigue fallando en este simulador**; se tocó fuera del input. El
   teclado numérico se quedó abierto en `05-withdraw-edit.png` porque el toque cayó en el header, que
   no lo cierra — no afecta lo que había que ver.
5. **Maestro se cuelga cuando quedan drivers viejos vivos.** Tras varios flujos, `maestro test`
   empezó a agotar el tiempo sin ejecutar nada; `pkill -f maestro` y reintentar lo arregla. Conviene
   envolver cada flujo en `timeout`.
6. **Para capturar un gesto, el video gana a la ráfaga de capturas.** 40 `simctl io … screenshot`
   seguidos salieron los 40 idénticos (el arranque de Maestro tarda más que la ráfaga);
   `simctl io … recordVideo` en segundo plano + `pkill -INT` + `ffmpeg … tile` sí atrapó el spinner.
7. **Node 22 puede ejecutar el código del proyecto sin `tsx`**: `--experimental-strip-types` más un
   hook de `resolve` de ocho líneas que prueba `.ts` / `.tsx` / `/index.ts` cuando el import sin
   extensión falla. Sirve para medir saldos por RPC con las mismas funciones que usa la app.

## Estado de las cuentas de testnet al cierre

- Simulador `0xe3719a93b75Cee42C5a8f3dCe45e5b4B327851C1`: **29.00 AUSD** y **0.0718 MON** en wallet,
  re-medidos por RPC (ver arriba) y confirmados en pantalla. Cuenta Perpl **#620** (`readAccountId`
  → `620`), sin tocar en esta fase; su saldo de trading no se re-midió porque vive en la API de
  Perpl y la app del simulador **sigue sin key de Perpl** (la borró el Sign out de `mobile-polish`),
  por lo que Markets muestra el gate "Enable trading". El último valor conocido es 104.87 AUSD del
  audit del pulido. No se movió dinero: no se pidió faucet, no se habilitó trading y el retiro de
  prueba se detuvo en el paso de review.
- El retiro de prueba se preparó contra `0xd236c18D274E54FAccC3dd9DDA4b27965a73ee6C` (el faucet de
  AUSD) sólo como dirección válida; **nunca se confirmó**.
- KAT `0x2945…779f` y el iPhone de Jesús: sin tocar.

## Pendientes

No bloqueantes, salidos de esta verificación:

- **`expo-system-ui` ausente**: sin él, `ios.backgroundColor` de D10 no llega al nativo.
- **Falta `02-signin-held.png`**: la tarjeta de acción retenida está verificada por test, no en
  simulador (ruling 9).
- **El pill activo de apalancamiento en `market` se ve blanco, no lima** (`11-market.png`): revisar
  `pill(on)` contra el diseño al re-maquetar en F2.
- Residuales heredados del audit de `mobile-polish` que F1 no tocó porque viven en pantallas de F2.

## Siguiente punto de decisión

F1 termina aquí: **sin merge a `main`, sin push, sin TestFlight y sin tocar `buildNumber`**. La rama
`feat/mobile-hifi` tiene 11 commits sobre `48f82a4`, 169/169 tests y `tsc` en verde, build nativo
reproducido desde cero con los pods nuevos y once capturas miradas una a una. Falta la revisión
independiente de rama, que corre el coordinador.

Decide Jesús: (1) si se mergea F1 a `main` local, y (2) si se abre el plan de **F2** —
re-maquetado de Markets (D13), Market con los pills Ask · Trade · Agents y el ticket real (D14) y
Funds (D15), más los tres fixes del build 5 (desfase de reloj D19, fees a 4 decimales D20,
*Reconnect trading* D21) y los minors de D22 — que cierra con el **build 5 de TestFlight**
registrado con `pickler-dev-new`. Quedan 25 días para el bounty (13 oct 2026, 21:59 CST).

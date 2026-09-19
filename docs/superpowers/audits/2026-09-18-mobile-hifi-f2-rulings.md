# Handoff — rediseño hi-fi F2: Markets, Market y Funds re-maquetados + los tres fixes del build 5 (2026-09-19)

Cierre de F2 de `mobile-hifi`: las tres pantallas de Perpl quedaron re-maquetadas con las primitivas
del hi-fi —Markets con la card `TRADING · AUSD`, el gate **Reconnect trading** y POSITIONS (D13);
Market con los pills Ask · Trade · Agents y el ticket real (D14); Trading funds con su StatGrid y la
review card (D15)— y entraron los tres fixes que el build 5 debía traer: aviso de reloj desfasado
leído del header `Date` de `pub/context` (D19), fees con cuatro decimales (D20) y *Reconnect trading*
con `enable(0n)` sobre una cuenta ya existente (D21), más los minors de D22. Rama
`feat/mobile-hifi-f2`, base `main` (`5289aa8`, merge de F1), **14 commits** (`0088052..2684d57`) más
el commit de esta documentación; sin push y sin merge. Spec:
`docs/superpowers/specs/2026-09-18-mobile-hifi-design.md` (D13–D15 y D19–D22 son F2); plan:
`docs/superpowers/plans/2026-09-18-mobile-hifi-f2.md`. Ejecutado con subagent-driven-development: un
implementador por task (Tasks 0–9), revisión por task y el coordinador commiteando por nombre de
archivo. **La Task 10 —build 0.1.0 (5) de TestFlight— no se ejecutó**: necesita autorización
explícita de Jesús en sesión.

## Qué quedó hecho y verificado

| Pieza | Evidencia |
|---|---|
| Tests y tipos | `npm test` → **24 suites, 179/179** (`Time: 3.158 s`, `Ran all test suites.`). `npx tsc --noEmit` → exit 0, sin salida. Medido de nuevo en la Task 9 sobre `2684d57`. Base al arrancar F2: 23 suites, 169/169. README actualizado al número real. |
| Rebuild nativo (Task 0 y Task 8) | `npx expo prebuild --platform ios --clean` con `expo-system-ui` ya instalado: desaparece el aviso `» ios: ios.backgroundColor: Install expo-system-ui…` que dejó abierto el audit de F1. `npx expo run:ios --device 2B2A0BAD-7B14-4DAE-8652-C7E9472505E0` → `› Build Succeeded` · `0 error(s), 1 warning(s)` (el conocido `ignoring duplicate libraries: '-lc++'`) · `› Installing on iPhone 17 Pro` · `iOS Bundled 1062ms index.ts (4353 modules)`. Log en `<scratch>/build.log`. |
| Gate *Reconnect trading* (D21) | `01-reconnect-gate.png`: card **Reconnect trading** con el copy exacto del spec —"This wallet already has Perpl account #620. Reconnect registers a trading key on this phone; no AUSD moves."— botón lima **Reconnect** y la lista de mercados atenuada (`readOnly`). Tras tocarlo, `03-markets-live.png`: `TRADING · AUSD`, chip **LIVE**, **104.87**, "0.00 in positions · 104.87 free" y la fila Add funds / Withdraw to wallet. `03b-positions-empty.png`: "No open positions. Pick a market above." |
| Market, pills y ticket (D14, D20) | `04-market-trade-empty.png`: header "MON Perp / Perpl · isolated margin · market order", pills Ask · **Trade** (lima) · Agents, Segmented Long/Short con Long en lima, card `MARGIN · AUSD`, chips `1x 2x 3x` con **1x en lima** (cierra el pendiente "pill blanco" de F1), KV NOTIONAL / EST. PRICE / FEE · TAKER / LIQUIDATION ≈ y el botón deshabilitado. `07-ticket-filled.png` (margen 2): NOTIONAL ≈ 1.98 AUSD · 81 MON, EST. PRICE 0.02445, **FEE · TAKER ≈ 0.0006 AUSD** (cuatro decimales, ≠ 0.0000), LIQUIDATION ≈ 0.00041, `Review long · 2.00 AUSD →` en `outline` con flecha (P8). `08-ticket-3x.png`: a 3x, FEE ≈ 0.0020 AUSD, LIQUIDATION ≈ 0.01674 en rosa y el aviso ámbar "Higher leverage means a closer liquidation price.". `05-market-ask.png` y `06-market-agents.png`: las `ComingSoonCard` de Ask y Agents. |
| Orden real abierta y cerrada (D13, P6) | `09-review.png`: `YOU OPEN · LONG MON · 1X · MARKET`, cifra display "2.00 AUSD" y **Confirm long** en lima. `11-filled.png`: **"Filled 81 MON at 0.02464"** con "Fee 0.0006 AUSD · LONG 1x". `12-position.png`: POSITIONS con chip `LONG`, "81 MON · 1x", PnL **+0.00 AUSD** en lima (nunca «−0.00»), línea `0.02464 → 0.02453 · LIQ. EST. 0.00041` y botón Close. `12b-balance-in-positions.png`: **102.86** arriba, "2.00 in positions · 102.86 free". `13-close-confirm.png`: `YOU CLOSE · AT MARKET`, "81 MON LONG", `EST. PNL +0.00 AUSD`. `14-closed.png`: **"Closed 81 MON at 0.02455"** con "Fee 0.0006 AUSD · realised PnL shows in the trading balance". `15-markets-flat.png`: **104.86**, "0.00 in positions · 104.86 free". |
| Trading funds (D15) | `16-funds-add.png`: StatGrid `WALLET 29.00 AUSD` / `TRADING · FREE 104.86 AUSD`, Segmented **Add funds** \| Withdraw, card `AMOUNT TO ADD · AUSD`, "Minimum 10.00 AUSD" y Review deshabilitado. `17-funds-review.png`: `YOU ADD TO TRADING · AUSD` "10.00", KV FROM Wallet / TO Trading account / NETWORK Monad · gas in MON y los botones Edit / Confirm deposit — se tocó **Edit**, nunca Confirm. `18-funds-withdraw.png`: `AMOUNT TO WITHDRAW · AUSD`, "Minimum 0.01 AUSD · only free balance". **No se movió ni un centavo.** |
| Aviso de reloj desfasado (D19, P4) | `20b-devcontrols-skew-real-0s.png`: el panel ⚙ muestra `screen: markets · account: unlocked · perpl: ready · skew: 0s` — **primera medición real del desfase del simulador contra Perpl: 0 s** (y −5 s en una segunda lectura tras el Sign out, `21a-after-signout.png`), muy por dentro del umbral de ±20 s y del ±30 s del servidor. **Corrección tras la revisión final:** esa segunda lectura de −5 s no era el reloj del simulador — `pub/context` está detrás de Cloudflare (`cache-control: max-age=10`) y el `Date` de un hit de caché puede tener hasta 10 s de antigüedad; `serverTime` ahora suma el header `Age` (commit `486a6fa`). Con el chip `Clock +2 min`, `19-clock-warn.png`: Warn ámbar **"Your phone's clock is off by 120 s."** con el cuerpo "Perpl rejects signatures more than 30 s off — turn on Set automatically in Settings › General › Date & Time."; `20-devcontrols-skew.png` marca `skew: 120s`. Al desactivarlo, `20c` vuelve a `skew: 0s` y `20d-markets-no-warn.png` confirma Markets limpio. |
| Tarjeta "We kept what you were about to do" (D18) | `21-signin-held.png`: tras `dev-sign-out` y tocar el tab Markets sin cuenta, Wallet access muestra la tarjeta violeta **"We kept what you were about to do"** con "Trading on Perpl. You come straight back after this step."; `21a-after-signout.png` prueba que sin `next` la tarjeta **no** aparece. `22-after-signin-markets.png`: tras el sign-in aterriza en **Markets** (el `next` retenido) con el gate Reconnect y `#620`. **Cierra el pendiente 9 del audit de F1**, que quedó verificado sólo por test. |
| Passkey y cuenta | Ver "Lista de passkeys del sheet" más abajo. El sign-in aterrizó en `0xe371…51C1` las dos veces (Wallet: `0xe371…51C1 · CONNECTED`, AUSD 29.00, MON 0.0718) y el gate leyó `Perpl account #620`. Nunca se tocó "Create a wallet". |
| Docs | `npm run docs:html`, `npm run docs:check`, `npm run agents:check` y la captura de 390 px del overview: salidas en el reporte de la Task 9. Overview con la phase-card F2 en `completed`, las diez tasks 0–9 marcadas (la 10 no) y `<details class="followups">` con los pendientes reales; manifest con `{ num: 2, status: 'completed' }` y `status: 'active'` global hasta que el build 5 esté `shipped`. |

Las 36 capturas y los flujos de Maestro viven en el scratchpad de la sesión (`f2-shots/`, `f2-flows/`);
no se versionan.

### Lista de passkeys del sheet

El sheet del sistema ("Iniciar sesión · Elige cómo iniciar sesión en tu cuenta de Pickler") mostró
**exactamente dos** entradas, ambas etiquetadas `pickler` / `Llave de acceso`, con la **primera
preseleccionada** (palomita azul). Se usó siempre "Usar llave seleccionada", es decir la primera, y
las dos veces (arranque y Step 8) el sign-in aterrizó en **`0xe371…51C1`**, la wallet del simulador.
Capturas: `00b-passkey-sheet.png`, `21b-passkey-sheet.png`.

### Saldos re-medidos por RPC

Con la receta del audit de F1 (el código del proyecto bajo `node --experimental-strip-types` con un
hook de `resolve` que añade la extensión). Antes del recorrido:

```
RPC 2026-09-19T22:14:37.589Z
addr       0xe3719a93b75Cee42C5a8f3dCe45e5b4B327851C1
AUSD raw   29000000n => formatAusd 29.00
MON  raw   71816980000000000n => formatMon  0.0718
perpl id   620n
```

Después:

```
RPC 2026-09-19T22:44:35.416Z
addr       0xe3719a93b75Cee42C5a8f3dCe45e5b4B327851C1
AUSD raw   29000000n => formatAusd 29.00
MON  raw   55159060000000000n => formatMon  0.0551
perpl id   620n
```

**El AUSD de la wallet no se movió** (29.00 → 29.00), como exigía el plan, y la wallet sigue siendo
dueña de la cuenta Perpl **#620**. El MON bajó **0.0167** (0.0718 → 0.0551): son los dos
`allowOrderForwarding` de los **dos** Reconnect —el del Step 3 y el del Step 8—, ≈ 0.0083 MON cada
uno. Es la prueba de que `enable(0n)` **sí manda tx** (forwarding + alta de key) aunque no mueva
colateral.

Saldo de trading (vive en la API de Perpl, no en la cadena): **104.87 AUSD** tras el primer Reconnect
(`03-markets-live.png`) y **104.86 AUSD** tras cerrar la posición (`15-markets-flat.png`,
`23-reconnected-again.png`). La diferencia de −0.01 cuadra con dos fees de 0.0006 AUSD más un PnL de
81 MON × (0.02455 − 0.02464) ≈ −0.0073 AUSD: ≈ −0.0085 que el formato a dos decimales muestra como
−0.01.

## Decisiones tomadas durante la ejecución (rulings)

Todas las tomó el coordinador sin consultar a Jesús. En orden de aparición en el ledger.

1. **El umbral de `formatPnl` es un centavo mostrado (`ONE_CENT = 10_000n`), no los `5_000n` del
   plan.** La revisión de la Task 1 encontró que con `5_000n` un PnL en `[-9_999n, -5_000n]` sigue
   imprimiendo "−0.00", porque `formatAusd` **trunca**: el signo se decide con el umbral pero los
   decimales se truncan a 0.00. El spec dice `|x| < 0.005 → "+0.00"` (D22), pero su intención
   declarada es "nunca −0.00", y con truncado sólo el centavo lo garantiza. Se subió el umbral a
   `10_000n`, se ajustaron los tests (±9_999n → "+0.00"; −10_000n → "−0.01") y los colores de la
   Task 6 pasaron a `<= -10_000n`. **Qué cuesta si está mal:** un PnL entre −0.005 y −0.0099 se
   pinta en lima como "+0.00" en vez de en rosa — cosmético, nunca engaña sobre el monto. El plan y
   los briefs 1 y 6 se corrigieron en `0255441`; el spec queda anotado en D22 por esta task.
2. **Los commits llevan el `Co-Authored-By` del modelo que realmente escribió cada uno, no el que
   fijó el plan.** El plan pedía `Claude Fable 5.1` en todos. La rama trae `Claude Fable 5.1` en
   once commits, `Claude Haiku 4.5` en `7a208e1` (Task 2) y `Claude Opus 5 (1M context)` en los tres
   fixes de la Task 8 (`d158540`, `48f914f`, `2684d57`). Se acepta como **atribución veraz** —la
   misma ruling 2 del audit de F1— y **no se reescribe historia**. **Qué cuesta si está mal:**
   trailers heterogéneos dentro de una misma rama; quien audite por trailer no puede asumir un solo
   autor. Se levantó dos veces (revisión de la Task 2 y revisión de la Task 8, esta última aparcada
   como *Important* procedimental) y se resolvió igual las dos veces.
3. **`KEY_REJECTED_COPY` pasa a ser sólo el cuerpo del aviso; el título lo pone el `Warn`.** La
   revisión de la Task 6 detectó que el `Warn` de `markets.tsx` ya lleva
   `title="Trading key rejected"` y el copy de D19 empezaba con "Trading key rejected. ", así que la
   frase salía duplicada en pantalla. El copy queda como "Check the phone clock first; if it is
   right, Perpl may not be available in your region." y el título lo aporta el `Warn`. **Qué cuesta
   si está mal:** el string completo de D19 queda partido en título + cuerpo, así que un
   `grep` del copy del spec ya no lo encuentra entero en una sola constante. Corregido en `d158540`
   dentro de la pasada de defectos de la Task 8, con el test ajustado en el mismo commit.
4. **Fix no previsto en el plan: el `Shell` resetea el scroll al cambiar de pantalla.** Defecto
   encontrado *durante* el recorrido de la Task 8, no en la revisión: el `Shell` comparte una sola
   `ScrollView` entre pantallas, así que entrar a Market desde una lista de Markets ya scrolleada
   abría el ticket a media página, con los pills Ask · Trade · Agents fuera de cuadro (así salió la
   primera captura de `04`). Se arregló en `48f914f` aunque no estuviera en el alcance escrito.
   **Qué cuesta si está mal:** un `scrollTo(0)` de más en el primer mount (no-op) y un cambio en un
   archivo que ninguna task de F2 tenía asignado.
5. **El mínimo de depósito de Trading funds es 10.00 AUSD, no los `5` del plan.** El brief de la
   Task 8 pedía escribir `5` y tocar `review`; con ese monto el botón queda deshabilitado y aparece
   "Minimum deposit is 10.00 AUSD." (el mínimo se lee de `pub/context`), así que la card de review
   es **inalcanzable**. Se documentó el estado con `16b-funds-add-5-below-min.png` y se usó **10**
   —dentro de los 29.00 AUSD de la wallet— tocando **Edit**, nunca Confirm. **Qué cuesta si está
   mal:** nada en el código; es un error del plan, y queda corregido aquí y no en la app.

### Correcciones tras la revisión final

Commit `486a6fa` (`fix(mobile): sondeo de cuenta estable durante el Reconnect, Age del CDN en
serverTime, copy del guard sin cuenta`) cerró tres hallazgos de la revisión final de la rama entera:

1. **`usePerpl.ts` — el sondeo de `existingAccountId` se anulaba a mitad del Reconnect.** El efecto
   de la Task 3 (minor diferido de arriba) resolvía a `null` en cuanto `state.status` dejaba de ser
   `"none"`, así que al tocar **Reconnect** (`state` pasa a `"onboarding"`) el gate perdía el id de
   cuenta conocido y el título podía retitularse a "Enable trading" a mitad de los cuatro pasos. El
   efecto ahora conserva el valor durante `"onboarding"`, sólo sondea mientras no se conoce (no
   repite el RPC una vez que hay respuesta) y mantiene el último valor si el RPC falla en vez de
   volver a `null`; sólo resetea con `!address`, `"ready"` o `"loading"`. Sin test dedicado — no hay
   suite de `usePerpl` (ver Pendientes) — verificado por lectura del efecto y por `npx tsc --noEmit`
   (exit 0) y el resto de la suite Perpl (`npm test` → 24 suites, 179/179) sin regresiones.
2. **`context.ts` — `serverTime` no contaba el `Age` del CDN.** `pub/context` está detrás de
   Cloudflare (`cache-control: max-age=10`); un *hit* de caché trae un header `Date` de hasta 10 s de
   antigüedad, que `parseServerTime` ignoraba. Ahora `parseServerTime(dateHeader, ageHeader)` suma
   `age * 1000` ms cuando el header `Age` es un número finito y positivo, e ignora valores no
   numéricos. Cubierto en `__tests__/perpl-context.test.ts`: `parseServerTime(..., "7")` →
   `Date.UTC(2026, 8, 18, 22, 35, 7)`, `parseServerTime(..., "x")` → sin sumar (header inválido), y un
   tercer caso de `fetchContext` con `age: "10"` → `Date.UTC(2026, 8, 18, 22, 35, 10)`. Explica la
   lectura de "−5 s" del audit (ver la fila de reloj arriba): no era el reloj del simulador.
3. **`enable.ts` — el copy del guard sin cuenta decía "Enter an amount."** El paso 1 de Reconnect
   (`amount === 0n` y `readAccountId() === 0n`) no tiene formulario de monto que "entrar", así que el
   mensaje no correspondía al recorrido; pasa a "This wallet has no Perpl account yet." Actualizado
   en `__tests__/perpl-enable.test.ts` ("reconnect with amount 0 but no account on-chain…").

Anotaciones de documentación de la misma pasada (sin código): spec `2026-09-18-mobile-hifi-design.md`
— rama F2 en el encabezado, D19 con el matiz de `KEY_REJECTED_COPY`/título del `Warn` y la suma del
`Age`, D7 con el reset de scroll de F2, y la fila de riesgos del header `Date` con la caché de
Cloudflare; `apps/mobile/README.md` con el matiz del `Age` en el bullet del reloj.

### Minors diferidos (revisados y aceptados sin arreglar)

En orden de aparición; ninguno bloquea el build 5.

- **Task 0** — el brief daba `5289aa8` como BASE, pero la base real fue `0088052` (el commit del
  plan, ya en la rama). Sin efecto sobre el diff.
- **Task 3** — `setExistingAccountId(null)` es incondicional dentro del efecto de sondeo; no provoca
  render extra, pero un comentario ahorraría la duda al siguiente lector.
- **Task 5** — `TradeTab` repite el `find()` del mercado y lo desreferencia con `!` (sancionado por
  el brief: `MarketScreen` ya comprobó que existe). Podría pasarse como prop.
- **Task 6** — el `Warn` de key rechazada repetía "Trading key rejected" en título y cuerpo →
  promovido a la ruling 3 y corregido en la Task 8.
- **Task 7** — el `tag` del `StatusCard` de Funds se deriva de `st.step.toUpperCase()`: acoplamiento
  latente entre el nombre interno del paso y lo que se pinta.
- **Task 8** — `scrollTo(0)` también corre en el primer mount (no-op); el monto `5` del brief contra
  el mínimo real de 10.00 AUSD (ruling 5); y **dos claves de trading de más** enroladas en la cuenta
  #620 (el límite es 16).

### Decisiones del plan (P1–P8), tal como se aplicaron

| # | Decisión | Cómo quedó |
|---|---|---|
| P1 | La primitiva `Screen` pasa a llamarse **`Page`** (el tipo `Screen` de `store.ts` no cambia) | Aplicada en `11a7f3e`; `wallet.tsx` y `signin.tsx` importan `Page`. Anotada en el spec (D12) por esta task. |
| P2 | `isComingSoonTab(screen): screen is ComingSoonTab` en `store.ts`, en vez de la aserción de tipo y del `isTab` local | Aplicada en `11a7f3e`. |
| P3 | `PillTabs` etiqueta cada pill como `pill-<key>` | Aplicada en `11a7f3e`; verificada en el recorrido (`taplabel.sh pill-ask`, `pill-agents`). |
| P4 | `clockSkewMs` medido en `refreshContext` con el `Date.now()` posterior al `await`, más `setClockSkewOverride` bajo `__DEV__` | Aplicada en `5d37e80` y `995ed95` (chip `Clock +2 min`). Sirvió para las dos cosas: **medir** el desfase real (0 s) y **forzar** 120 s sin tocar el reloj de nadie. |
| P5 | `runEnable` con `amount === 0n` y `readAccountId() === 0n` falla en el paso 1 con "Enter an amount." sin llamar `createAccount` | Aplicada en `5d37e80`, cubierta por `__tests__/perpl-enable.test.ts`. No se pudo ejercitar en pantalla: exigiría una wallet sin cuenta de Perpl. |
| P6 | `formatPnl(raw)` nueva en `perpl/orders.ts`, usada por la fila de posición, el PnL no realizado y la confirmación de cierre | Aplicada en `4837b26` **con el umbral corregido a `10_000n`** por la ruling 1 (`622e085`). Verificada en pantalla: `12-position.png` y `13-close-confirm.png` muestran "+0.00 AUSD", nunca "−0.00". |
| P7 | Tocar una fila de Markets navega con `{ perpsMarketId, perpsSide: "long", marketTab: "trade" }` | Aplicada en `0fb5d92`; `04-market-trade-empty.png` abre en el pill **Trade** tras haber mirado Ask. |
| P8 | "Review …" es `Btn` `outline` con `arrow`; el de confirmación es `lime` | Aplicada en `4b550b2`; se ve en `07-ticket-filled.png` (Review en outline) y `09-review.png` (Confirm long en lima). |

## Defectos encontrados en el recorrido y sus fixes

| # | Defecto | Commit | Verificación **contra el defecto** |
|---|---|---|---|
| 1 | `KEY_REJECTED_COPY` empezaba con "Trading key rejected. " y el `Warn` ya pone ese título → frase duplicada | `d158540` | `npx jest __tests__/perpl-clock.test.ts` → 3/3, con la aserción vieja reemplazada en el mismo commit: revertir el copy rompe el test. |
| 2 | El `Shell` comparte una sola `ScrollView`: entrar a Market desde Markets scrolleado abría el ticket a media página | `48f914f` | Reproducido antes del fix (captura original de `04`, con los pills fuera de cuadro) y repetido después con el mismo gesto: el ticket abre desde arriba. `04-market-trade-empty.png` se re-capturó. |
| 3 | El botón **Close** del panel Dev controls era el único control sin `accessibilityLabel` | `2684d57` | Antes: `taplabel.sh dev-close` → `NOT_FOUND`. Después: lo encuentra en la jerarquía (`91%,59%`) y cierra el panel. |

Los tres se probaron sobre el simulador recargando el bundle desde Metro (`simctl terminate` +
relaunch), no sólo en tests.

## Lo aprendido

1. **`id:` no sirve con React Native en iOS en Maestro 2.4.0.** Los `accessibilityLabel` de RN salen
   en la jerarquía como `accessibilityText`, no como `resource-id`: hay que buscarlos con el selector
   **`text:`** anclado (`^label$`). El plan y los briefs decían `tapOn: { id: … }` y eso falla con
   "Element with Id matching regex … not found".
2. **`tapOn` por texto es poco fiable si el elemento está fuera de pantalla**: reporta `COMPLETED` y
   toca otra cosa. Un `tapOn review` acabó tocando el pill *Ask*, que además **borró el monto del
   ticket** al cambiar de pill. De ahí `taplabel.sh`, que vuelca la jerarquía, calcula el centro del
   elemento en porcentaje y toca por punto; acabó siendo la herramienta de casi todo el recorrido.
3. **`tapOn: point` sólo acepta porcentajes enteros**: `50.0%,82.7%` revienta con
   `NumberFormatException: For input string: "50.0"`.
4. **El volcado de jerarquía falla de forma intermitente con un `Modal` abierto** (el panel Dev
   controls): a veces devuelve el árbol completo y a veces nada. Hubo que tocar por coordenada leída
   de la captura — y de ahí salió el defecto 3.
5. **`hideKeyboard` sigue sin funcionar** (ya estaba en el audit de F1) y el tap "fuera" tiene que
   caer **dentro** de la `ScrollView` (`keyboardShouldPersistTaps="handled"`): tocar el header no
   cierra el teclado. El punto fiable es el margen izquierdo de la página (2–3 % del ancho); tocar a
   ciegas por debajo de ~50 % de alto cae en el teclado y **escribe un dígito** (así salió un "52" en
   el input de Funds).
6. **Face ID del simulador se pierde al reiniciarlo** y hay que re-inscribirlo antes de cualquier
   recorrido con passkey (`notifyutil -s com.apple.BiometricKit.enrollmentChanged 1` +
   `notifyutil -p …`; presentar cara con `…BiometricKit_Sim.fingerTouch.match`). Queda anotado en el
   README.
7. **`expo run:ios` reinstala la app y borra la cuenta local.** El recorrido arrancó en "Wallet
   access" en vez de Markets, así que el sign-in con passkey tuvo que ocurrir *antes* del paso que
   lo pedía. Conviene contarlo en el plan del siguiente recorrido en vez de asumir estado previo.
8. **El desfase real del simulador contra Perpl es 0 s.** Era una incógnita desde el build 4: el
   `3401` del iPhone se atribuyó al reloj, pero nunca se había medido. En el simulador no hay
   desfase, así que el `Warn` de D19 sólo se pudo ver con el override; confirmar la hipótesis del
   reloj exige el iPhone de Jesús.

## Estado de las cuentas de testnet al cierre

- **Simulador `0xe3719a93b75Cee42C5a8f3dCe45e5b4B327851C1`**: **29.00 AUSD** (sin cambio) y
  **0.0551 MON** en wallet, re-medidos por RPC (ver arriba). Cuenta Perpl **#620** con
  **104.86 AUSD** de saldo de trading, leídos en `23-reconnected-again.png` ("0.00 in positions ·
  104.86 free", chip `LIVE`). **La key de Perpl está presente**: el simulador quedó reconectado tras
  el segundo Reconnect del Step 8, así que la app abre en Markets en modo `LIVE` y no en el gate.
  Sin posiciones abiertas. **Ojo:** el recorrido dejó **dos claves de trading de más** enroladas en
  #620 (el Sign out borra la local pero no la revoca en Perpl); el límite es 16 por cuenta y se
  revocan en `testnet.perpl.xyz/apikeys`.
- **No se movió dinero**: no se pidió faucet, no se retiró a ninguna dirección externa y la única
  posición fue de 2.00 AUSD de margen a 1x, abierta y cerrada en la misma sesión. El único gasto fue
  gas: 0.0167 MON en total.
- **KAT `0x2945…779f` y el iPhone de Jesús: sin tocar.**

## Pendientes

No bloqueantes, ordenados por lo que más pesa:

- **Falta el build 5 de TestFlight** (Task 10 del plan): sólo con autorización explícita de Jesús en
  la sesión. Es la razón de que el proyecto siga `active` en el manifest aunque las dos fases estén
  `completed`.
- **iPhone de Jesús: el mismo recorrido con su cuenta real vía TestFlight build 5 (lo hace Jesús).**
  Es lo único que puede confirmar si el `3401` del build 4 era realmente el reloj: en el simulador el
  desfase medido fue 0 s.
- **El copy de key rechazada sigue sin verse en pantalla.** No se puede provocar sin una key
  inválida; queda cubierto por `__tests__/perpl-clock.test.ts` (`KEY_REJECTED_COPY`) y por lectura
  del JSX (`src/screens/markets.tsx:207`, `<Warn title="Trading key rejected" body={KEY_REJECTED_COPY}>`).
- **Dos claves de trading de más en la cuenta #620** (límite 16): revisar
  `testnet.perpl.xyz/apikeys` antes de repetir este recorrido muchas veces.
- **La cifra grande de la card `TRADING · AUSD` es el saldo *libre*, no el total.** Con la posición
  abierta se leyó **102.86** arriba y "2.00 in positions · 102.86 free" abajo, cuando el capital eran
  104.86: puede leerse como que el saldo "se encogió" al abrir la posición. No se tocó porque es una
  decisión de spec, no un bug; conviene decidirla antes del build 5.
- **Faltan los estados intermedios de dos flujos**: `02-reconnect-steps.png` muestra el Reconnect ya
  terminado (acabó en menos de lo que tarda una captura y **no pidió Face ID**, porque la cuenta
  seguía desbloqueada del sign-in) y `10-sent.png` muestra el fill en vez del `StatusCard` `SENT` con
  spinner. La lista de cuatro pasos con sus ✓/spinner **no quedó verificada en pantalla**.
- **Gas**: quedan 0.0551 MON y cada Reconnect gasta ≈ 0.0083 MON. Alcanza para varios recorridos,
  pero no es infinito.
- Minors diferidos de las revisiones por task (lista arriba), ninguno con efecto observable.

### Items de producto de la revisión final (para Jesús)

- La cifra grande de la card `TRADING · AUSD` es el saldo **libre** (D13), no el capital: con una
  posición abierta se ve más chico que el total. Decidir si se muestra el capital, un desglose, o se
  deja así con el label actual.
- El copy de Reconnect no dice "· gas in MON" aunque `allowOrderForwarding` sí gasta gas (≈ 0.0083 MON
  por Reconnect, medido en este audit): la tarjeta puede leerse como que el paso es gratis.
- El `Warn` de reloj desfasado (D19) sólo se pinta en la rama `ready` de Markets; el gate
  `none`/`onboarding` (Enable/Reconnect trading) no lo muestra aunque el mismo desfase pueda tumbar el
  enrolamiento de la key.
- El reset de scroll al cambiar de pantalla (ruling 4) sólo se probó yendo hacia adelante; falta
  verificar también al volver atrás, porque iOS puede restaurar la posición de scroll al hacer `pop`.
- Revocar las **dos claves de trading de más** en la cuenta #620 en `testnet.perpl.xyz/apikeys` antes
  de repetir este recorrido (límite 16 por cuenta; ya señalado arriba).
- Sigue sin existir una suite de tests para `usePerpl` — el fix 1 de esta pasada (sondeo estable de
  `existingAccountId`) sólo quedó verificado por lectura y por el resto de la suite Perpl, no por un
  test directo del hook.

## Siguiente punto de decisión

F2 termina aquí: **sin merge a `main`, sin push, sin TestFlight y sin tocar `buildNumber`**. La rama
`feat/mobile-hifi-f2` tiene 14 commits sobre `5289aa8` más el de esta documentación, 179/179 tests,
`tsc` en verde, build nativo reproducido desde cero y 36 capturas del recorrido completo con la
cuenta #620. Falta la **revisión independiente de la rama entera**, que corre el coordinador después
de esta task.

Decide Jesús: (1) si se mergea F2 a `main` local, (2) si se hace push, y (3) si se autoriza el
**build 0.1.0 (5) de TestFlight** —Task 10, con su tracker `testflight-build5` vía
`pickler-dev-new`— que es lo que habilita el recorrido en su iPhone. Quedan 24 días para el bounty
(13 oct 2026, 21:59 CST).

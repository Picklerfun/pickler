# Pickler mobile

App Expo/iOS de Pickler. UI del sistema **light** del Handoff de Claude Design, en
[`jjesusaf/pickler-mobile`](https://github.com/jjesusaf/pickler-mobile) commit `1808d5b`, carpeta `design/`
(`Pickler Mobile Handoff.dc.html` y las pantallas `* Mobile Light.dc.html`; se ven con
`python3 -m http.server 8765 --directory design`). Spec: `docs/mobile/superpowers/specs/2026-09-28-mobile-light-design.md`.
Tab bar de 4 botones fijos: MARKETS · AGENTS · PORTFOLIO · WALLET, cada uno con su tinte (`TAB_TINT`).
Reales: Wallet (passkey, AUSD/MON, deposit con QR, withdraw, movimientos), Markets (Perpl, búsqueda local),
Market (Trade it / Ask an agent, con el **board nivel × tiempo** del Handoff — mismo componente en los dos
modos — y una barra fija «Review» que sólo aparece en edición y con trading key), Agents (récord real; la
tarjeta abre el **perfil del agente**, con calibración y récord calculados en la app a partir de tus reads),
Portfolio (Positions, Reads; Backed es *coming soon*) y la pantalla Read (con su propia barra fija «Trade
this market»). Tras **crear** una wallet salen 3 hojas de **onboarding**, una sola vez por dispositivo.
Launchpad y Activity siguen registradas en el navegador, pero **no se pintan** en la barra.
El panel ⚙ del header (solo en dev) salta a cualquier pantalla o estado de la sesión.

### Fuentes

- Display: `ArchivoPickler-Bold` (`assets/fonts/ArchivoPickler-Bold.ttf`), Archivo instanciado a `wdth 112` /
  `wght 700` — el `font-variation-settings:'wdth' 112` del Handoff; RN no garantiza ejes variables en iOS, así
  que se genera un TTF estático con `scripts/archivo-instance.sh <dir-temporal>` (fonttools en un venv; baja
  Archivo de `google/fonts@main`, sin pin).
- Cuerpo: Instrument Sans 400/500/600/700 (`@expo-google-fonts/instrument-sans`).
- Mono (cifras, etiquetas): JetBrains Mono 400/500/700 (`@expo-google-fonts/jetbrains-mono`).

**Trampa: la lima no se lee como texto sobre blanco.** `C.lime` (`#C8F03A`) es sólo relleno (botón primario,
punto, barra); como texto o borde va `C.limeInk` (`#3F6B00`) o `C.limeBd`, y sobre ink `C.limeOnInk`. Lo mismo
con el ámbar: `C.pending` es relleno y punto, `C.warn` (`#8A6200`) es texto. `__tests__/theme.test.ts` lo vigila.

## Correr en simulador

```bash
npx expo prebuild --platform ios --clean   # genera ./ios (gitignored)
npx expo run:ios                            # build + instala en el simulador por defecto
npx expo start                              # metro, si necesitas recargar JS sin rebuild nativo
```

`expo run:ios` levanta metro automáticamente la primera vez; si lo cierras,
`npx expo start` lo vuelve a levantar y la app conectada lo detecta sola.

Para elegir un simulador o device específico: `npx expo run:ios --device <nombre-o-udid>`.
Ojo: el UDID que hay que pasar es el de `hardwareProperties.udid` en
`xcrun devicectl list devices --json-output out.json` (formato clásico
`00008140-...`), **no** el `Identifier` que imprime la tabla de
`xcrun devicectl list devices` (ese es un UUID de emparejamiento distinto).

`react-native-svg` y las fuentes son nativas: tras cambiar dependencias o `assets/fonts`,
`npx expo prebuild --platform ios --clean` antes de `run:ios`. `expo-linear-gradient` y
`expo-haptics` salieron con el rediseño light.

## Navegación

`react-navigation` nativo (`native-stack` sobre `react-native-screens`, dentro de
`bottom-tabs`): `NavigationContainer` → `RootStack` con `Tabs` y `signin`; `Tabs`
(tab bar custom) con **una pila por pestaña**, así el gesto atrás, el «adelante»
animado y el botón `←` son los de iOS:

```
Tabs
├── MarketsTab   (native-stack) markets → market
├── AgentsTab    (native-stack) agents → agent (perfil real, F2)
├── PortfolioTab (native-stack) portfolio → read
├── WalletTab    (native-stack) wallet → deposit → withdraw → perpsFunds
├── LaunchpadTab (native-stack) launchpad   (registrada, no se pinta en la barra)
└── ActivityTab  (native-stack) activity    (registrada, no se pinta en la barra)
signin  (RootStack, encima de Tabs cuando hace falta cuenta; raíz si no hay ninguna)
```

- `src/navigation/screens.ts` — `Screen`, `GATED`, `CAN_BACK`, `SHOW_TABS`, `ROOT_OF`
  (re-exportados desde `store.ts`; viven aquí para romper el ciclo de imports
  `store.ts ↔ navigation/routes.ts` que Metro avisaba con un `Require cycle`).
- `src/navigation/routes.ts` — tipos de params por stack, `TAB_OF`/`TAB_ROOT`/`TAB_ORDER`/
  `SCREENS_ALL`, `screenOfRoute(name)`, `gateTarget(hasAccount, target)` (puros, con test).
- `src/navigation/ref.ts` — adaptador sobre `navigationRef`: `navigateTo(screen, signinParams?)`,
  `switchTab(tab)`, `goBackIfCan()`, `resetRootTo(route)`, `flushPending()` (cola hasta
  `navigationRef.isReady()`, la usa el push en frío).
- `src/navigation/context.tsx` — `AppCtxProvider`/`useAppCtx()` (contexto de React separado
  del store, para romper el ciclo `Page`/`TabBar` ↔ `Navigator`).
- `src/navigation/Navigator.tsx` — arma el árbol de arriba y registra cada pantalla con
  `withPage(screen, Component)`.
- `src/ui/Page.tsx` — cabecera propia por ruta (los stacks van con `headerShown: false`, así
  la cabecera viaja con la página durante el gesto), `ScrollView` con pull-to-refresh y el
  sello `UPDATED`/`COULDN'T REFRESH` (`useRefreshSeal`), fondo opaco (`Backdrop`).
- `src/ui/TabBar.tsx` — tab bar custom (prop `tabBar` de bottom-tabs); siempre montada,
  absoluta; se esconde deslizando fuera de `SHOW_TABS` (D13).

### Tab bar

La geometría pura vive en `src/ui/tabBarLayout.ts` — no `tabbar.ts`: ese nombre choca en
mayúsculas/minúsculas con `TabBar.tsx` en macOS y rompía la resolución de módulos de
`./TabBar` (`ROW_TOP`, `ROW_H`, `ROW_BOTTOM`, `tabBarHeight`, con tests en `__tests__/tabBarLayout.test.ts`).

`TabBar.tsx` pinta 4 botones fijos (icono lucide + etiqueta mono); el activo lleva fondo de control
(`C.ctl`) y el tinte de su pestaña (`TAB_TINT`: Markets `#3F6B00`, Agents `#5B3CE0`, Portfolio `#8A6200`,
Wallet `#C62C62`). Ya no hay pastilla arrastrable ni haptics. Tocar una pestaña llama a `switchTab` (nunca
gatea: `requireAccount` sigue siendo el camino para el resto de la app) y siempre emite `tabPress`, así
re-tocar la pestaña enfocada hace `popToTop`. La barra queda siempre montada y absoluta; en pantallas
no-raíz se esconde deslizando hacia abajo (`translateY` con `withTiming`, 220 ms) en vez de desmontarse,
y las páginas raíz reservan su hueco con `paddingBottom` (`tabBarHeight` en `Page.tsx`).

**Para añadir una pantalla**: el `Screen` en `screens.ts`, su entrada en `TAB_OF`
(`routes.ts`), el `Screen` en la pila de su pestaña dentro de `Navigator.tsx`, y
registrarla con `withPage`.

**react-navigation 7**: `navigate` a una ruta ya presente en la pila **apila** en vez
de volver a ella — hace falta `{ pop: true }` explícito (semántica v6 asumida por error
en el plan de F1, corregida en la ejecución). Las pantallas nunca llaman a
`navigationRef` directamente: usan `ctx.nav` / `ctx.back` / `ctx.requireAccount` (el
adaptador de `ref.ts`) y, para la tab bar, `switchTab`.

**Face ID del simulador se pierde al reiniciarlo.** Volver a inscribirlo antes de
cualquier recorrido con passkey:

```bash
# desde el Mac: xcrun simctl spawn <UDID> notifyutil …
notifyutil -s com.apple.BiometricKit.enrollmentChanged 1 && \
  notifyutil -p com.apple.BiometricKit.enrollmentChanged   # inscribe
notifyutil -p com.apple.BiometricKit_Sim.fingerTouch.match  # presenta la cara
notifyutil -p com.apple.BiometricKit_Sim.pearl.match        # Face ID (iPhone 17)
```

**Dynamic Type en vivo:** cambiar el tamaño de texto con la app abierta
(`xcrun simctl ui <UDID> content_size extra-extra-extra-large`) deja las pantallas ya montadas con el
layout viejo (texto recortado); relanzar la app antes de juzgar un recorte. Maestro lee los
`accessibilityLabel` como texto: `tapOn: "tab-wallet"`, no `tapOn: {id: …}`.

## Carga y splash

Skeleton (`Skeleton`/`Reveal` en `src/ui/primitives.tsx`) sólo mientras el dato de esa
card es `null` y no hay error; con dato entra el contenido (fade 150 ms), con error su `Warn`.
El pull-to-refresh deja `UPDATED HH:MM:SS` por pantalla vía `useRefreshSeal`
(`src/hooks/useRefreshSeal.ts`, consumido por `Page` — el sello ya no vive en `Shell.tsx`,
que se eliminó en mobile-nav F1) (`COULDN'T REFRESH` 3 s si fallan todas las fuentes
pedidas). El splash nativo muestra
`assets/splash-mark.png` (`python3 scripts/splash-mark.py assets/icon.png
assets/splash-mark.png`, requiere PIL); `prebuild --clean` regenera el storyboard.

## Tests

```bash
npm test          # jest, 303/303 esperado (44 suites)
npx tsc --noEmit   # debe salir limpio
```

## Dominio de passkeys (Associated Domains)

El RP ID es `pickler.fun` (`ios.associatedDomains: ["webcredentials:pickler.fun"]`
en `app.config.ts`). Verificar que el AASA esté vivo y bien formado:

```bash
curl -sI https://pickler.fun/.well-known/apple-app-site-association | head -5
# esperado: 200, content-type application/json (aunque no tenga extensión .json)
```

El App ID `fun.pickler.app` tiene la capability **Associated Domains** habilitada
en developer.apple.com (Identifiers → App IDs); se registró a mano ahí, igual que
el registro de la app en App Store Connect. El build de device solo crea o
refresca el perfil de aprovisionamiento (con `-allowProvisioningUpdates`, ver
abajo); no crea el App ID ni la capability.

**Proveedor del passkey:** Pickler necesita la extensión PRF. Apple Passwords
(iCloud Keychain) la soporta; Bitwarden y otros gestores de terceros no
devuelven el secreto y el alta falla con «Your passkey provider didn't return
the secret…». Al crear la cuenta, elegir Apple Passwords.

### Historial de movimientos (MonadScan)

*Wallet → Movements* lee las transferencias AUSD de la dirección desde Etherscan V2
(`chainid=10143`, MonadScan). La key va en `app.config.ts` → `extra.monadscanKey`
(override con `PICKLER_MONADSCAN_KEY`). Es una key pública de solo lectura; si se
agota la cuota (100k llamadas/día) se crea otra en https://etherscan.io/myapikey.
El RPC público no sirve para esto: `eth_getLogs` está limitado a 100 bloques.
En un dev-client ya instalado, `expo start` no refresca `extra` de `app.config.ts`;
para que la app vea otra key hay que rehacer `expo run:ios`.

## Perpl (tab MARKETS)

Trading manual de perps en Perpl testnet (`https://testnet.perpl.xyz`). Sin backend: las tres tx de
onboarding (`approve`, `createAccount ≥ 100 AUSD`, `allowOrderForwarding`) y la firma EIP-712 de la
API key las hace la wallet de Mera; las órdenes van por WebSocket firmadas con una llave Ed25519 que
vive en SecureStore (`pickler.perpl.v1`, sin Face ID: solo puede operar, nunca retirar). Sign out
conserva la trading key (atada a la wallet; no hay borrado desde la UI — "Reset trading key", sólo con
key rechazada, enrola una nueva; máx. 16 por cuenta, revocar en `testnet.perpl.xyz/apikeys`); sin key,
Market → *Trade it* muestra **Enable trading** (o *Reconnect trading*) en lugar del ticket, y Portfolio →
Positions manda a abrir un mercado.

- Colateral: el mismo AUSD de la wallet. Mínimos (100 / 10 / 0.01) se leen de `pub/context`.
- Apalancamiento: 1x–5x, capado por mercado (`initial_margin / 100`; MON permite 3x).
- URLs con override para mainnet: `PICKLER_PERPL_REST` / `PICKLER_PERPL_WS` en `app.config.ts`
  (`extra` solo se refresca con `expo run:ios`). En un dev client ya instalado, reiniciar Metro
  con la variable puesta y relanzar la app **no** basta: `Constants.expoConfig` no recoge el
  cambio hasta un rebuild real (`run:ios`), confirmado el 2026-09-21 (audit F1 de `mobile-loading`).
- Perpl geobloquea US, GB, UA, RU, BY, CU, IR, KP, SY: el sign-in del WS falla con `3401`.
- *Reconnect trading*: sin key pero con cuenta on-chain (`readAccountId > 0`), el gate reconecta con
  `enable(0n)` — sólo forwarding + key, sin mover AUSD.
- Desfase de reloj: `pub/context` trae el header `Date`; con más de 20 s de diferencia Markets avisa
  (Perpl rechaza firmas a ±30 s; fue la causa real de los `3401` del iPhone), descontando el header
  `Age` del CDN.
- Fees se muestran con 4 decimales; saldos y montos con 2.
- Trampas medidas: `docs/mobile/investigacion/perpl.md` (`rq = lfr + 1`, `lb = head + ttl`, nonce vivo).
- Order book L2 en Trade: `wss://testnet.perpl.xyz/ws/v1/market-data` (override `PICKLER_PERPL_MARKET_DATA_WS`,
  mismas reglas de `run:ios` que las otras URLs), un socket por ticket visible con una sola suscripción
  `order-book@<id>`, sin pings (10 requests/min por conexión; el `mt: 5` es el único). `mt: 15` reemplaza el
  libro, `mt: 16` es un delta por nivel (`o: 0` borra). `src/perpl/marketData.ts` es puro; los frames reales se
  graban con `node scripts/perpl-market-data-capture.mjs --market 16 --seconds 20` (Node 22, sin cuenta) en
  `__tests__/fixtures/perpl/market-data-frames.json`.

## Ask an agent, Agents y Reads

Backend en `services/reads` (Supabase `pickler`, esquema `mobile`; URL en `src/config/reads.ts`, override
`PICKLER_READS_URL`; en un dev client ya instalado, igual que con `PICKLER_PERPL_REST`, un reinicio de
Metro no lo aplica — hace falta `run:ios`). La app firma una vez al día `pickler-reads:<address>:<ts>` con la wallet (Face ID si está
bloqueada) y guarda `{ address, ts, sig }` en SecureStore (`pickler.reads.v1`); Sign out lo borra. Créditos simulados:
20 por wallet, 1 por lectura, reembolso si el agente falla. El push de resolución lo manda el servidor por APNs
(`expo-notifications`, entorno `sandbox` en dev); tocarlo abre Portfolio → Read (el recordatorio abre Market en Trade, sin nivel). Para probar el
tap sin APNs: `xcrun simctl push <UDID> fun.pickler.app payload.apns` con `{ "pickler": { "kind": "read", "readId", "marketId" } }`.
`PUSH_MODE = "local"` (fallback D10) programa una notificación local al vencer en vez de esperar el push.
`expo-notifications` es nativo: tras instalar, `prebuild --clean` + `run:ios`.
El board nivel × tiempo (`src/screens/board.tsx`, F2) reemplaza a la matriz del prototipo en Ask y en Trade:
5 filas de nivel × 4 horizontes (los del backend), banda MARK, trayectoria de los últimos marks que la app
vio y celdas con punto donde ya hay reads. La geometría, el tono y los rótulos son puros y tienen test
(`src/reads/board.ts`); `src/perpl/marks.ts` y `src/reads/matrix.ts` siguen dando los niveles, horizontes y
el historial de marks.
«Trade this level» (hoja de la celda y card de una read `open`) pone `S.tradeLevel`, sugiere el lado (nivel + → long)
y abre Trade con la `LevelCard`; cuando la orden queda `filled` u `open` la app llama `reminder-set` (firmado, misma
sesión de Ask) y el servidor programa `pre` (15 min antes, si faltan más de 15) y `expiry`; `resolve-reads` los manda
con el mark del momento. Nada cierra la posición. `src/reads/level.ts` es puro y tiene test.

## Subir a TestFlight

Requiere `apps/mobile/.env.asc` (gitignored, **nunca se commitea**) con:

```
ASC_KEY_ID=...
ASC_ISSUER_ID=...
```

La misma App Store Connect API key que usa Proflores (team `2PBQJ37Q8W`), con el
`.p8` en `~/.appstoreconnect/private_keys/AuthKey_<ASC_KEY_ID>.p8`. Y una
identidad **Apple Distribution** en el llavero (Xcode → Settings → Accounts →
Manage Certificates → + → Apple Distribution).

```bash
npm run ios:archive   # xcodebuild archive + export -> build/export/Pickler.ipa
npm run ios:upload    # xcrun altool --upload-app
```

`ios:upload` falla con exit 1 si detecta "UPLOAD FAILED" / "ERROR ITMS" /
"Validation failed" en la salida de `altool`, aunque `altool` mismo haya salido
con 0.

**Regla del buildNumber:** cada subida a TestFlight necesita un `ios.buildNumber`
distinto en `app.config.ts` (App Store Connect rechaza un build ya subido para la
misma versión). Súbelo antes de repetir `npm run ios:archive`.

Después de "✓ subida aceptada": App Store Connect → TestFlight tarda unos
minutos en pasar el build de "Processing" a listo para testers. Agregar a los
testers al grupo interno correspondiente.

## Conseguir MON de testnet

La cuenta necesita gas (MON) antes de poder pedir AUSD del faucet:

1. Copiar la dirección desde *Wallet → Deposit* (botón "Copy address").
2. `https://faucet.monad.xyz` → pegar la dirección → pedir MON de testnet.
   (O que alguien con MON de testnet te transfiera ~0.1 MON directo.)
3. Refrescar en *Wallet → TESTNET* (botón "Refresh", o "Retry" si
   hubo error de RPC) hasta ver MON > 0.
4. *Get test AUSD* ya lee el balance de MON fresco antes de pedir Face ID:
   si sigue en 0 avisa sin abrir el prompt biométrico. Con MON > 0 pide una
   firma (Face ID) y manda la tx al faucet de AUSD
   (`0xd236c18D274E54FAccC3dd9DDA4b27965a73ee6C`); espera "Confirmed: 0x…".

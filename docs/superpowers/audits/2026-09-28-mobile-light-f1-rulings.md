# Handoff — rediseño light F1: sistema y re-vestido (2026-09-28)

Cierre de F1 de `mobile-light`: la app adopta el sistema **light** del Handoff de Claude Design
(`jjesusaf/pickler-mobile@1808d5b`, carpeta `design/`) —tokens, Archivo `wdth 112` + Instrument Sans +
JetBrains Mono, primitivas, tab bar de 4 botones fijos con tinte por pestaña, cabecera clara— y re-viste
Sign in, Wallet, Deposit (QR), Withdraw, Trading funds, Markets (búsqueda) y Market (Trade it / Ask an
agent), y crea Agents (lista), Portfolio (Positions / Reads / Backed) y la pantalla Read. La lógica de
Perpl, wallet y reads no cambia. Rama `feat/mobile-light`, worktree `.claude/worktrees/mobile-light`,
base `3702ffe` (spec + plan + overview); commits `1d490b1..353eb51` más el de esta documentación; sin
push, sin merge y sin TestFlight. Spec: `docs/superpowers/specs/2026-09-28-mobile-light-design.md`;
plan: `docs/superpowers/plans/2026-09-28-mobile-light-f1.md`. Ejecutado con
subagent-driven-development: un implementador por task (0–15), revisión por task y el coordinador
llevando el ledger.

## Qué quedó hecho y verificado

| Pieza | Evidencia |
|---|---|
| Tests y tipos | `npm test` → **Test Suites: 40 passed, 40 total · Tests: 279 passed, 279 total** (medido tras los dos fixes de la Task 15, sobre `353eb51`). `npx tsc --noEmit` → exit 0, sin salida. Base de la Task 0: 271. README actualizado a 279/40. |
| Rebuild nativo | `npx expo prebuild --clean --platform ios` → `✔ Finished prebuild` · `✔ Installed CocoaPods` (sin `expo-haptics` ni `expo-linear-gradient`, con `ArchivoPickler-Bold.ttf`). `npx expo run:ios --device 700707EF-53E1-42F2-BE6B-893515BDB95C` → `› Build Succeeded` · `› 0 error(s), and 1 warning(s)` (el conocido `ignoring duplicate libraries: '-lc++'`) · `› Installing on pickler-mobile-light` · `iOS Bundled 8642ms index.ts (5333 modules)`. Metro sin `ERROR`; sólo los `WARN` conocidos de `@noble/hashes/crypto.js`. |
| Simulador | Propio, creado en esta task: `pickler-mobile-light` (iPhone 17, **iOS 27.0**, udid `700707EF-53E1-42F2-BE6B-893515BDB95C`). El runtime 27.1 instalado no admite ningún iPhone 17 (`Incompatible device`, `supportedDeviceTypes` vacío), por eso 27.0. Face ID inscrito con `notifyutil` vía `simctl spawn`. No se tocó `iPhone 17 splash-semilla` (`2BD58B10…`). |
| Wallet nueva | Sign up → *Create with Face ID* → sheet del sistema «¿Guardar una llave de acceso?» → *Agregar llave de acceso* (Apple Passwords, PRF ok) → Wallet con **`0xd6da229A45113cC88f50E8719262E61EC37AEd23`**, AUSD 0.00, MON 0.0000. El passkey **sí** se crea en el simulador. |
| Recorrido con capturas | 36 capturas de la app y 8 del Handoff (Playwright sobre `python3 -m http.server 8766`), todas abiertas y comparadas; detalle abajo. |
| Fixes de la Task 15 | `f3f3aa8` (TOTAL de Portfolio sin skeleton infinito sin key) y `353eb51` (probabilidad «32%» sin espacio). Ver *Correcciones*. |
| Docs | `node scripts/docs-md-to-html.mjs docs/superpowers/plans/2026-09-28-mobile-light-f1.md`, `npm run docs:check`, `npm run agents:check` y el render del overview a 390 px: salidas en el reporte de la Task 15. Overview con la phase-card F1 en `completed`, las 16 tasks marcadas con su commit y `<details class="followups">`; manifest con `{ num: 1, status: 'completed' }` y `status: 'active'` global (F2 sigue `pending`). |

### Capturas miradas (simulador vs Handoff)

Viven en el scratchpad de la sesión (`f1-*.png`, `ref-*.png`, flujos de Maestro en `flows/`); no se versionan.

| Captura | Qué se vio | Frente al Handoff |
|---|---|---|
| `f1-01-launch` | Sin cuenta, Sign in es la raíz: «PICKLER», segmentado Sign in \| Sign up, «GET IN.», card ink «Continue with Face ID · PASSKEY · SAME ACCOUNT ON WEB» con el icono en `limeOnInk`. | Igual salvo: sin logo junto a «PICKLER» y sin el bloque CREATORS/email (fuera de alcance, spec §fuera). |
| `f1-02-signup`, `f1-03-signup-waiting` | «BUILD AN AGENT.», «Create with Face ID»; al tocar, «Waiting on Face ID…» con spinner lima sobre ink. | Coincide. |
| `f1-32-signin-after-*` (sheet `sheet-signin`) | Sign in: **idle** (Continue with Face ID) → **waiting** («Waiting on Face ID…» + sheet «Iniciar sesión») → **done** («0xd6da…Ed23 · MONAD TESTNET» y banner lima claro «WELCOME BACK · 0XD6DA…ED23» con texto `limeInk`) → Wallet. | Los tres estados de D20. |
| `f1-04-after-passkey`, `f1-05-wallet-pending` | InkBlock AVAILABLE · AUSD **0.00**, Deposit lima / Withdraw baldosa ink, «Monad testnet · CONNECTED» (verde `up`), Activity \| Pending («Nothing has ever arrived…», «Nothing pending.»), TESTNET, SESSION. Tinte de Wallet `#C62C62`. | Coincide en estructura. Sin fila **IN TRADING**: sólo aparece con `perpl.state === "ready"` (no hay key). «AUSD» va en la etiqueta y no junto a la cifra. |
| `f1-06-deposit` | ASSET AUSD / NETWORK Monad, **QR real**, dirección completa, Copy address lima / I've sent it. | Coincide (D18). |
| `f1-07-withdraw` | Destino con Paste, AMOUNT · AUSD 0.00 con MAX, Review deshabilitado (lima pálido). | Coincide. |
| `f1-08-markets`, `f1-09-markets-mon`, `f1-10-markets-30s` | Búsqueda; tarjetas con avatar, «MAX N× · 3 AGENTS» (agentes reales), mark, 24h con color, sparkline, Ask (lavanda) / Trade (lima). «mon» filtra a MON-PERP. A los ~30 s la sparkline ya tiene forma. | Sin chips de categoría (D9). Precio sin separador de miles (`83556.0`). Color del avatar según el signo del 24h, no por símbolo. |
| `f1-11-market-trade-nokey`, `f1-21-trade-level-nokey` | Market ETH-PERP: cabecera con atrás circular, mark y 24h; segmentado Trade it \| Ask an agent; sin key, **Enable trading** dentro de Trade con 100 AUSD, avisos en `C.warn` (`#8A6200`) y botón deshabilitado. «Trade this level» desde una read también cae aquí (sin key no hay LevelCard). | D7. El ticket del Handoff no se pudo ver: no hay key. |
| `f1-13-market-ask`, `f1-16-ask-sheet-2`, `f1-29-agents-ask-drift` | CREDITS 20, HISTORY · MARK, matriz 5 niveles × 1H/4H/12H/24H con la **banda MARK** en ink, sparkline a la izquierda; al tocar una celda, fila y columna en violeta suave y hoja con «Asking Drift · 1 credit» + Change, pregunta, steppers y «Ask Drift · 1 credit». Tras la read, **punto violeta** en la celda +1.0 % · 4H. | La sparkline del Handoff cruza las celdas; aquí vive en su columna. Celdas grises (`card`) en vez de blancas. |
| `f1-18-ask-reading` | ReadCard inline: tag «ETH +1.0% · 4H · JESUS'S AGENT», pregunta, **32%** + chip NO, WHY, LIMITS en ámbar claro, «Trade this level» lima / Ask another. | D14/D12. Antes del fix salía «32 %». |
| `f1-22-portfolio`, `f1-23-portfolio-reads`, `f1-24-portfolio-backed` | TOTAL VALUE · AUSD con baldosas POSITIONS / AVAILABLE / BACKED; Positions → «Trading not enabled» + «Open a market»; Reads → fila «32% · ETH +1.0% · 4H · IN WINDOW»; Backed → «Backing agents comes with Launchpad.». Tinte de Portfolio `#8A6200`. Capturadas a las 17:46 con el fix ya guardado en el árbol (Fast Refresh) pero **antes** del commit `f3f3aa8` (17:52); la captura previa al fix, con el skeleton, se sobrescribió. | Sin posiciones no hay con qué comparar las cards del Handoff. |
| `f1-22b-portfolio-after-fix` | Evidencia del fix `f3f3aa8`, tomada a las 18:07 sobre `78f4120` tras relanzar la app con Metro nuevo: bajo TOTAL VALUE · AUSD sale **«—»** en `onInkDim`; la jerarquía de accesibilidad lo confirma como texto (`—` en `[36,188][366,232]`, 44 pt de alto), no como skeleton. Antes del fix (visto a las 17:45, archivo sobrescrito) era un bloque gris redondeado de ~60 % del ancho que nunca resolvía. | — |
| `f1-25-read`, `f1-26-read-2`, `f1-27-read-trade` | Read: avatar JE, «READ · 1 CREDIT · ETH +1.0% · 4H», etiqueta OPEN, bloque THE QUESTION con **32%** a 64 px, ASKED 17:42 / EVALUATES 3 h 55 m, WHY con puntos violeta/lima/ámbar, LIMITS, «Trade this market» → Market ETH en Trade. | Bloque en violeta sólido con texto blanco (Handoff: lavanda con cifra violeta). ASKED en vez de DELIVERED IN (ruling). Barra fija → botón al final (ruling). |
| `f1-28-agents` | Lista: avatar con iniciales, nombre, «BY JESUS / BY PICKLER», descripción, baldosas HIT · N RESOLVED y BRIER, «Ask · 1 credit». Tinte `#5B3CE0`. | D15 (sin etapa, curva, net, Back it). «BRIER · LOWER IS BETTER» parte en dos líneas y desalinea las cifras. |
| Tab bar (todas) | 4 botones fijos, activo con fondo de control y su tinte; **Launchpad y Activity no aparecen**. | Coincide. |
| `f1-33..36-xxxl-*` (sheet `sheet-xxxl`) | Dynamic Type XXXL: Markets y Portfolio se leen, cifras completas; las etiquetas de las baldosas de Portfolio parten a media palabra («POSITION S», «AVAILABL E»). Wallet, montada antes del cambio, salía recortada («Depos», «0.00(»); **relanzada** a XXXL se ve bien. | Ver residuales 6 y 9. |

Ningún texto lima ni ámbar sobre blanco y ninguna superficie navy en las capturas: la lima sólo va como
relleno (botones, punto) o como `limeInk`/`limeOnInk`; el ámbar de texto es `C.warn`.

## Decisiones tomadas durante la ejecución (rulings)

Todas las tomó el coordinador o el plan sin consultar a Jesús.

1. **Comandos `git` desde la raíz del worktree** (ledger, Ruling 1): `git diff --name-only` imprime rutas
   relativas a la raíz. **Qué cuesta si está mal:** un `git add` falla y se ve de inmediato.
2. **El simulador se pasa por udid explícito** (ledger, Ruling 2). **Qué cuesta si está mal:** sólo el
   comando de arranque.
3. **T1 tocó `primitives.tsx` (PillTabs lima → limeInk) fuera de su lista de archivos** (ledger, Ruling 3):
   lo exige la regla global «la lima nunca es texto». **Qué cuesta si está mal:** nada; PillTabs se borró en T10.
4. **El commit de T6 (`63e26a3`) lleva el trailer `Claude Sonnet 5`** en vez del de constraints; se acepta sin
   reescribir historia (ledger, Ruling 4). **Qué cuesta si está mal:** un trailer inconsistente en un commit local.
5. **T14 absorbió los minors de copy/limpieza de T2/T3/T4/T8/T10** (ledger, Ruling 5). **Qué cuesta si está
   mal:** un diff de T14 algo más grande.
6. **El simulador del plan (`2B2A0BAD…`, con Face ID y la cuenta #620 con key) ya no existe**; T15 creó uno
   propio y verificó con una wallet nueva; el recorrido de dinero y Positions LIVE quedan para Jesús (ledger,
   Ruling 6). **Qué cuesta si está mal:** Trade con key y posiciones quedan sin evidencia en F1 (residual 1).
7. **Sin fila `IF IT HITS` en el ticket** (plan, T10): su cálculo sería una promesa nueva que la lógica no
   tiene; las filas son SIZE, EST. PRICE, FEE · TAKER, LIQUIDATION ≈ y LEVEL. **Qué cuesta si está mal:** el
   ticket enseña una fila menos que el Handoff.
8. **«See it in Portfolio»** como botón primario del resultado de apertura (plan, T10): así se implementa el
   «lands in Portfolio» del flujo F1 del Handoff. **Qué cuesta si está mal:** un toque más que el aterrizaje
   automático del Handoff. Sin verificar en simulador (residual 1).
9. **ASKED en vez de DELIVERED IN** en la pantalla Read (plan, T13): el DTO no guarda `latency`; se usa
   `createdAt`. **Qué cuesta si está mal:** se pierde el dato «tardó N min»; volverlo exige tocar el backend.
10. **Agents → Ask en F1** (plan, T11): el perfil (`agent`) es de F2; tocar la tarjeta o «Ask» abre Market en
    Ask con ese agente elegido (la ruta `agent` queda registrada con un stub). Verificado: Ask de Drift →
    Market en Ask con «Asking Drift · 1 credit» (`f1-29`). Abre el último mercado usado (`askMarketId`), no
    uno elegido. **Qué cuesta si está mal:** el usuario no ve el perfil ni el récord del agente hasta F2.
11. **Dependencias sin uso** (plan, T1/T4/T14): `expo-linear-gradient` salió en `3018bfc` (T1) y `expo-haptics`
    en `d5dfc53` (T14), ambas sin consumidores tras el rediseño; `react-native-gesture-handler` y
    `react-native-worklets` se quedan (los exige reanimated y el `GestureHandlerRootView`). **Qué cuesta si está
    mal:** volver a instalarlas y hacer prebuild si F2 quiere haptics.
12. **Barras fijas → botón al final del contenido** (plan, T13): «Trade this market» (D14) y «Long to X within
    4H · Review» (D11) no quedan fijas; fijarlas exige un `footer` en `Page` con estado elevado del ticket, y
    eso va en F2 con el board. **Qué cuesta si está mal:** en pantallas largas el CTA queda bajo el pliegue
    (visto en `f1-25-read`).
13. **Runtime iOS 27.0 para el simulador propio** (T15): 27.1 no admite iPhone 17 en este Xcode. **Qué cuesta
    si está mal:** nada visual conocido; el iPhone de Jesús es la prueba real.

## Correcciones

Lo que el propio proceso afirmó o dejó y resultó falso:

1. **T11, ronda 1** (revisión de la task): Market se quedaba en skeleton infinito si el fetch de Perpl fallaba
   (`contextError`), y `recordLabel` quedó sin uso. Corregido en `e91e7d2`.
2. **T13, ronda 1** (revisión): el estado `fetched`/`missing` de la pantalla Read no se indexaba por `readId`
   y podía mostrar la read anterior. Corregido en `da295fc`.
3. **T14, ronda 1** (revisión): `BookCard` pintaba dos `book-target` (uno por estado del plegado). Corregido en
   `670d2e4`.
4. **T15, recorrido** (detectado en `f1-22-portfolio`): **el TOTAL de Portfolio era un skeleton que nunca
   resolvía** sin trading key — `Totals` sólo tiene dato con balance de Perpl o `lastBalance`. Ahora el
   skeleton sólo se pinta con `perpl.state` en `loading`/`ready`; si no, «—». `f3f3aa8`, verificado en
   `f1-22b-portfolio-after-fix` (18:07, app relanzada).
5. **T15, recorrido** (detectado en `f1-18`): `formatProbability` heredaba «32 %» (con espacio) del diseño
   navy; en mono se leía como dos piezas en ReadCard y Portfolio → Reads, mientras Read ya decía «32%» y el
   Handoff «41%». Test primero (`reads-matrix.test.ts` falló: `1 failed, 16 passed`), luego el cambio
   (`17 passed`). `353eb51`.
6. **README**: describía la tab bar vieja (pastilla lima arrastrable con haptics), el árbol de 5 pestañas, el
   diseño `a0e353e` con Chakra Petch, «270/270 (35 suites)», «Market → Ask → My reads» para el push y
   `expo-linear-gradient` como nativo. Corregido en el commit de esta documentación.

## Evidencia cara

- **El passkey con PRF se crea en un simulador nuevo** (iOS 27.0, Apple Passwords), sin iCloud: sheet
  «¿Guardar una llave de acceso?» → *Agregar llave de acceso* → `notifyutil … pearl.match`. Sign in con la misma
  llave: sheet «Iniciar sesión» → *Usar llave de acceso* → wallet `0xd6da…Ed23`.
- **Maestro lee los `accessibilityLabel` como texto**, no como id: `tapOn: "segment-up"` funciona,
  `tapOn: {id: "segment-up"}` no. Los botones anidados en `TouchCard` (Ask de Agents/Markets) no aparecen en
  la jerarquía; se tocan por coordenada (`tapOn: {point: "201,621"}`).
- **Cambiar Dynamic Type con la app abierta deja el layout viejo** en pantallas ya montadas (Wallet recortada);
  relanzar la app lo arregla. Antes de juzgar un recorte, relanzar.
- **Una read real en el backend compartido**: la wallet nueva pidió una read a *Jesús's agent* sobre ETH +1.0 %
  · 4H (32 %, NO, creada 17:42 CST del 28 sep, resuelve ~21:42) y gastó **1 crédito simulado** (20 → 19).
- **Sin AUSD ni MON no hay camino a Trade**: Enable trading exige 100 AUSD y gas; el faucet de MON es externo.

## Residuales abiertos (de mayor a menor peso)

1. **Sin evidencia en simulador, por falta de key y fondos**: ticket del Handoff con key (Long · up / Short ·
   down, MARGIN, chips de apalancamiento, KV), book L2 plegado y desplegado, LevelCard de «Trade this level»,
   **recorrido de dinero** (long 2 AUSD a 1× → «See it in Portfolio» → Close, con saldos antes/después) y
   **Positions en LIVE** sin pasar por Markets, y la fila IN TRADING de Wallet. Los hace Jesús con #620 en su
   iPhone (o con MON de faucet en una wallet nueva). No se intentó ningún atajo que moviera fondos.
2. **Barras fijas de D14 y D11** (ruling 12): F2.
3. **Matriz de Ask**: sparkline en su columna en vez de cruzar las celdas; celdas grises. F2 (board).
4. **Read**: bloque THE QUESTION en violeta sólido (Handoff: lavanda `#EEEAFF` con la cifra violeta); cabecera
   «READ» + fila del agente en vez de atrás + avatar + agente en una línea.
5. **Precios sin separador de miles** (`formatPrice`): el Handoff escribe `63,584.2`. Es lógica compartida con
   el ticket y los tests; no se tocó.
6. **Dynamic Type XXXL**: las etiquetas de las baldosas de Portfolio parten a media palabra; Agents desalinea
   las baldosas HIT/BRIER por «BRIER · LOWER IS BETTER» en dos líneas (también a tamaño normal).
7. **Accesibilidad**: Ask/Trade anidados en `TouchCard` (Markets, Agents) no se exponen a VoiceOver/Maestro
   como botones propios (minor diferido de T9, confirmado aquí); el toque funciona.
8. **Wallet**: separación ancha entre el logo y el título («WALLET»/«MARKETS»…) frente al Handoff; «AUSD»
   junto a la cifra del Handoff va aquí en la etiqueta.
9. **Relayout en vivo con Dynamic Type** (comportamiento de RN, no del rediseño): pantallas montadas antes del
   cambio quedan recortadas hasta relanzar.
10. **Minors diferidos del ledger aún abiertos**: `archivo-instance.sh` descarga de `google/fonts@main` sin pin
    y no limpia `$TMP` (T0); JSDoc desactualizados en `Avatar` y `SegmentedProps.tone` y el comentario
    «display (Chakra Petch)» en `primitives.tsx:12` (T2); comentario obsoleto en `comingSoonCopy.ts:5` (T3);
    `TabBar.select` y el cast `TAB_ROOT[name] as keyof TABS` (T4); carrera preexistente en `loadReads` al
    cambiar de cuenta (T6); `fetchOne` abre Face ID desde el efecto de Read (T6, aceptado); DevControls sigue
    listando Launchpad/Activity y «Coming soon · Portfolio» y no tiene Agents (dev-only). Los de copy de
    T2/T3/T4/T8/T10 que T14 barrió (Ruling 5) quedan cerrados en `d5dfc53`.

## Rollback

Nada se escribió en TestFlight, contratos ni cuentas de terceros. En entornos compartidos quedan: la wallet
`0xd6da229A45113cC88f50E8719262E61EC37AEd23` (sin fondos, su passkey vive sólo en el simulador
`pickler-mobile-light`), su sesión de reads y **una read** con 1 crédito simulado en Supabase `pickler`
(esquema `mobile`). Son inocuas; borrarlas no es necesario. El simulador `pickler-mobile-light` queda
arrancado y se puede borrar con `xcrun simctl delete 700707EF-53E1-42F2-BE6B-893515BDB95C`.

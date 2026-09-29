# Handoff — rediseño light F2: board, barras fijas, perfil de agente y onboarding (2026-09-28)

Cierre de F2 de `mobile-light`: Market gana el board nivel × tiempo del Handoff (igual en *Trade it* y
*Ask an agent*), Market/Read/perfil de agente ganan su barra de acción fija, la tarjeta de Agents abre un
perfil con calibración y récord calculados en la app, y tras **crear** una wallet salen 3 hojas de
onboarding una sola vez. La lógica de Perpl, wallet, reads y push no cambia. Rama `feat/mobile-light`,
worktree `.claude/worktrees/mobile-light`, plan commit `3302949` (F1 ya en `main` local); commits
`3302949..6608731` más el de esta documentación; sin push, sin merge y sin TestFlight. Spec:
`docs/superpowers/specs/2026-09-28-mobile-light-design.md`; plan: `docs/superpowers/plans/2026-09-28-mobile-light-f2.md`;
audit previo: `docs/superpowers/audits/2026-09-28-mobile-light-f1-rulings.md`. Ejecutado con
subagent-driven-development: un implementador por task (0–8), revisión por task, una revisión final de
toda la rama, una ola de arreglos visuales sobre el recorrido en simulador, y el coordinador llevando el
ledger (`.superpowers/sdd/2026-09-28-mobile-light-f2/progress.md`).

## Qué quedó hecho y verificado

| Pieza | Evidencia |
|---|---|
| Tests y tipos | `npm test` → **Tests: 301 passed, 301 total (44 suites)**, sobre la base de la Task 0 (**282 passed, 41 suites**, HEAD `3302949`). `npx tsc --noEmit` → limpio en cada task y al cierre. |
| Board nivel × tiempo (D10–D12) | `screens/board.tsx` con `boardRows`/`cellTone`/`boardCaption`/`trajectory` puros (`reads/board.ts`, 8 tests); en Trade y en Ask, con banda MARK, precios verde arriba/rojo abajo, trayectoria y punto «now», y los puntos violeta de reads existentes. Verificado en simulador (`f2-02` a `f2-04`, `f2-22a` tras los arreglos de trayectoria). |
| Barras fijas (D11, D14) | `Page` con modo `bare`, `PageScroll` y `FooterBar`; Market muestra «Review · X AUSD» sólo en el paso `edit` y con `perpl.state.status === "ready"` (sin key, sin barra — `f2-04`); Read muestra «Trade this market» siempre (`f2-06`). |
| Perfil de agente (D15, D16, D23) | `screens/agent.tsx`: stats HIT/BRIER, ITS BEAT, CALIBRATION (vacía con < 5 resueltas), THE RECORD con filtro ALL/RIGHT/WRONG/OPEN. Calibración y récord puros en `reads/calibration.ts` (4 tests). Verificado con la cuenta real `0xd6da…Ed23` (`f2-08`, filtro corregido en `f2-23-profile-fixed`). |
| Onboarding (D21) | 3 hojas sólo tras Sign up, una vez; `shouldOnboard`/`onboardingExit` puros (3 tests) + 1 test de `routes` + 1 de `store` (`headerFor`/`finishSignin`/`startOnboarding`). Verificado creando una wallet nueva `0x91f7…CC64` (`f2-13` a `f2-17`); Sign in con `0xd6da…Ed23` (con fondos) no muestra hojas (`f2-19..21`, Review Focus 3). |
| Dynamic Type XXXL | Market, board y perfil legibles con filas de 48 fijas y precios que caben (`f2-26/27`). AX5 (accesibilidad, un nivel más allá de XXXL) deja Markets ilegible («M…») — heredado de F1, fuera de alcance de F2. |
| Revisión final de rama y arreglos visuales | Revisión sobre `3302949..799bf1c`: 2 Important + 8 minors, cerrados 10/10 en la ola de arreglos (`7fa5758..a129933`), re-revisión limpia. Recorrido en simulador: 5 grupos de arreglos visuales, cerrados 5/5 (`534b222..6608731`), re-revisión limpia con 2 minors nuevos (ver Residuales). |
| Docs | Este audit; overview con la phase-card F2 en `completed`, las 9 tasks marcadas con su commit y `<details class="followups">`; manifest con `{ num: 2, status: 'completed' }` y `status` global `'active'` (ruling 20); README con 301/44 y lo nuevo de F2. |

### Capturas miradas (simulador vs Handoff)

Viven en el scratchpad de la sesión (`f2-*.png`), no se versionan. Simulador `pickler-mobile-light`
(iPhone 17, iOS 27.0), Metro propio en 8081, app relanzada sobre `a129933` y luego `6608731` (Fast Refresh).

| Captura | Qué se vio | Frente al Handoff / defecto corregido |
|---|---|---|
| `f2-01-markets` | Markets igual que F1; sparklines crecen con el polling. | Sin cambios de F2. |
| `f2-02-ask-eth`, `f2-22a` (post-fix) | Board 5 × 4 en Ask: CREDITS 19, banda MARK, precios verde arriba/rojo abajo, punto violeta de la read de F1 en +1.0 % · 4H, punto «now», rótulo «TAP A SQUARE», leyenda «YOU ASKED AN AGENT HERE». | Antes del fix, el área lavanda de la trayectoria (ya encima) teñía las filas bajo la línea y la línea tachaba «MARK» → corregido en `534b222`: sin área, rótulo de la banda por encima de la capa. |
| `f2-03-ask-cell` | Celda −0.5 % · 24H: tinte y pill ASK, rótulo violeta «ASK ABOUT 2647.47 WITHIN 24H», `AskSheet` con «Asking Jesús's agent · 1 credit». | Coincide con D12. |
| `f2-04-trade` | Board en Trade sin key: celda +0.5 % · 4H → pill LONG, rótulo «LONG TO 2674.07 WITHIN 4H» (`limeInk`); Enable trading a ~14 px del board (Important de T3 cerrado en T4); avisos en `C.warn`; sin barra fija (correcto sin key). | Board de Ask 3 pt más ancho que Trade (padding 15 vs 18) → corregido en `b91d34c`. |
| `f2-05-portfolio` | Portfolio sin cambios de F1. | — |
| `f2-06-read` | Barra fija «Trade this market» + «A read is not a trading permission.»; el cuerpo (LIMITS) pasa por debajo de la barra. | D14. |
| `f2-07-agents` | Lista; iniciales ahora «JA» (`initials` movida a `agentsCopy`). | Coincide. |
| `f2-08-profile`, `f2-23-profile-fixed` | Perfil Jesús's agent: avatar en cabecera, «BY JESÚS», stats 100 % · 8 RESOLVED / 0.15 · 9 READS, ITS BEAT, CALIBRATION vacía («Not enough resolved reads yet — 5 needed.», con 1 read OPEN propia), THE RECORD con fila ETH +1.0 % · 4H OPEN, barra «Ask · 1 credit». | El filtro ALL/RIGHT/WRONG/OPEN se salía por la derecha junto al título → corregido en `db32227` (fila propia, 4 pills `flex: 1`); `f2-23` lo confirma. |
| `f2-09-signout` (accidental) | Tocar abajo en el perfil pulsó la barra «Ask» → Market ETH en Ask con Jesús's agent elegido. | Verifica D13 desde el perfil. |
| `f2-10..f2-12` | Sign out → Sign in raíz → Sign up «BUILD AN AGENT.» → «Waiting on Face ID…» + sheet «¿Guardar una llave de acceso?» → Agregar llave de acceso. | Igual que F1. |
| `f2-13/14-onb1` | Onboarding hoja 1 tras Sign up (wallet nueva `0x91f7…CC64`): fondo Markets atenuado, SKIP, arte de 3 reads, «01 · WHAT THIS IS / AGENTS READ THE MARKET.», puntos, Next. | Toast de LogBox dev por un `WARN` benigno de RN («Sending onAnimatedValueUpdate with no listeners registered»); ver residuales. |
| `f2-15-onb2` | Hoja 2 «PICK A SQUARE.» con arte board. | Defectos vistos: banda en 3 tramos, punto redondo, CTA sin flecha → corregidos en `6608731`, **sin nueva captura** (exigiría otra wallet); verificado por código en la re-revisión — ver residuales. |
| `f2-16-onb3` | SKIP → hoja 3 «ASK, OR TRADE.», SKIP oculto, CTA lima «Go to markets». | D21. |
| `f2-17-after` | «Go to markets» → Markets con tab bar. | — |
| `f2-18-newwallet` | Wallet de la cuenta nueva `0x91f7…CC64`. | — |
| `f2-19..21` | Sign out → Sign in → selector con 2 llaves «pickler» → la segunda → Wallet `0xd6da…Ed23`, **sin** hojas de onboarding. | Review Focus 3 (Sign in nunca muestra hojas). |
| `f2-24/25` | Content size accessibility-XXXL (AX5, por error): Markets ilegible («M…»). | Fuera del alcance de F2 (F1 residual 6/9). |
| `f2-26/27` | Extra-extra-extra-large (XXXL): Markets y board de Market bien; filas de 48 fijas, precios caben. | — |

No verificado por falta de key ni fondos (MON = 0 en `0xd6da…Ed23`, medido por RPC a las 20:39): barra
fija de Trade con key, teclado sobre la barra, scroll estable edit↔review, orden desde una celda del
board con recordatorios y Face ID diario, long → Portfolio → Close. Ver Residuales #1.

## Decisiones tomadas durante la ejecución (rulings)

Todas las tomó el coordinador o el plan sin consultar a Jesús.

1. **T0 no exige F1 en `main`**: la ejecución sigue en `feat/mobile-light` sobre `3302949`; el merge de F1
   a `main` lo corre Jesús cuando quiera. **Qué cuesta si está mal:** si Jesús corre el merge de F1 a mitad
   de la ejecución de F2, `main` recibiría F2 parcial; cada commit de F2 deja los tests en verde, así que un
   `main` a medio camino no rompería la suite, sólo quedaría incompleto.
2. **El recorrido de dinero de F1 (previo a F2 según el plan) no bloquea F2**: se hace cuando llegue el MON
   del faucet. **Qué cuesta si está mal:** F2 se construyó sin haber visto el ticket con key en el
   simulador ni un long real; el board, la barra fija y el perfil no tienen evidencia visual con key — ver
   Residuales #1.
3. **«Variant oscuro» de T7 = `Btn variant="ink"`**: es el único variant oscuro que existe. **Qué cuesta si
   está mal:** nada.
4. **5 × 4 en el board, no 6 × 3 del Handoff** (plan, Task 3 Step 1): los niveles y horizontes vienen del
   backend (`LEVELS_BPS`, `HORIZONS_MIN`); el Handoff dibuja una maqueta de 6 × 3. **Qué cuesta si está
   mal:** no es discrecional — si el backend cambiara su malla, el board tendría que rehacerse igual; no
   hay alternativa que lo mantenga fiel a las reads y recordatorios reales.
5. **Leyenda «YOU ASKED AN AGENT HERE»** en vez de «AN AGENT HAS A CALL HERE» del Handoff (plan, Task 3
   Step 1): los puntos violeta marcan las reads del usuario, no llamadas del agente (D10). **Qué cuesta si
   está mal:** el texto original sugeriría que el punto es una posición del agente y no una pregunta hecha
   por el usuario — confundiría el dato mostrado.
6. **Pill ASK en modo Ask** (plan, Task 8 Step 4): el Handoff no diseña «Ask» sobre el board — es novedad
   de F2. **Qué cuesta si está mal:** sin el pill, la celda seleccionada en Ask no tendría el mismo
   feedback visual que Trade (tinte + pill), rompiendo la simetría entre los dos modos del mismo
   componente.
7. **Sin `pk-slide`** (animación de desplazamiento de la trayectoria) (plan, Task 3 Step 1): el polling ya
   mueve la línea. **Qué cuesta si está mal:** la trayectoria puede saltar entre polls en vez de deslizarse;
   cosmético, no afecta el dato.
8. **Conteo final de T8 recalculado dos veces**: el plan decía «+17»; a mitad de ejecución el conteo real
   era 298 (282 + 17 − 1 por el test de `GRID_ACCENT` borrado en T3). **Qué cuesta si está mal:** nada — el
   número final, tras la ola de la revisión final y los arreglos visuales, es **301**, no 298 (ver Qué
   quedó hecho).
9. **T6 (perfil) se ejecutó antes que T4 (barras fijas)**, orden distinto al plan: T6 no comparte archivos
   con T3 en revisión, T4 sí. **Qué cuesta si está mal:** nada; ambas tasks terminaron sin conflictos de
   archivo entre sí.
10. **El Important de T3** (`market.tsx:59-64`, doble `Page` sin key → ~34 px entre el board y Enable
    trading) **se trasladó a T4**, que reestructura el mismo árbol a `PageScroll`, en vez de abrir una ronda
    de arreglos concurrente con T6 en el mismo repo. **Qué cuesta si está mal:** si T4 no lo hubiera
    cerrado, quedaría un espacio de más entre el board y Enable trading sin key; se cerró en `c65df5f`,
    verificado por la revisión de T4.
11. **Barras de CALIBRATION en fila de 118 con base en 118 y diagonal (0,100)→(100,8.47)**, en vez de
    (0,88)→(100,8) del Handoff: esa escala no casaba con la de las barras (T6, ronda 2). **Qué cuesta si
    está mal:** la diagonal «prometido» difiere un poco de la escala literal del Handoff; aquí coincide con
    la escala de las barras, que es lo que el usuario compara.
12. **Filtro ALL/RIGHT/WRONG/OPEN en vez de ALL/WON/LOST del Handoff** (plan D16 / Task 8 Step 4): manda la
    spec, con los estados reales de una read. **Qué cuesta si está mal:** con WON/LOST se perdería el
    estado OPEN — el más común mientras una read no resuelve — y el filtro dejaría fuera reads vigentes.
13. **Sin NET AUSD, reglas del agente ni «Trade $HALF» en el perfil** (plan D15 / Task 8 Step 4): fuera de
    alcance explícito de la spec (§5). **Qué cuesta si está mal:** nada — es alcance, no discrecional.
14. **Onboarding sin `blur(2px)`** (plan, Task 7 Step 4): RN no difumina un `View` sin `expo-blur`, y D2
    descarta dependencias nuevas en F2 (sin prebuild). **Qué cuesta si está mal:** el fondo atenuado
    (`opacity: 0.55` + overlay) se ve menos «vidrioso» que el Handoff; instalar `expo-blur` exigiría
    prebuild, fuera del alcance de F2.
15. **«Continue» sólo en el CTA de cierre (última hoja) cuando hay `next`, «Go to markets» si no** (plan,
    Task 7 Step 4, y ledger T7): el brief lo describe en el cierre, no en cada hoja. **Qué cuesta si está
    mal:** con «Go to markets» mostrado pese a tener una acción retenida, el usuario esperaría aterrizar en
    Markets pero caería en el gate (p. ej. Portfolio) — una promesa incumplida por el botón.
16. **La barra fija de Market (Review) sólo aparece en el paso `edit` con `perpl.state.status === "ready"`**
    (plan, Task 4 Step 1 / Task 8 Step 4): sin key o en otros pasos no hay ticket armado que reseñar. **Qué
    cuesta si está mal:** mostrarla sin key duplicaría el CTA de Enable trading; mostrarla en review/result
    duplicaría «Confirm»/«Change amount» o dejaría un botón sin acción tras cerrar el ticket.
17. **La capa de trayectoria (área, línea y punto «now») se pinta ENCIMA de las filas y de la banda**, con
    `pointerEvents="none"`, en vez de detrás como el Handoff (revisión final de rama). **Qué cuesta si está
    mal:** se aparta del Handoff (línea detrás); si se hubiera visto mal en T8 se revertía, pero la
    verificación (`f2-22a`) confirma que se lee bien: la línea cruza la fila +0.5 % y el punto «now» es
    visible sobre la banda.
18. **La ola de arreglos de la revisión final deja fuera 4 minors** (tests de `finishSignin(fallback)` /
    `startOnboarding`, timer de signin tras desmontar, push durante el onboarding, `cellTone` con bps 0):
    son baratos pero no comparten archivo con la ola, o exigen verificación en simulador, no en unit test.
    **Qué cuesta si está mal:** los 4 quedan sin cerrar y pasan a Residuales #4, #5, #6, #7.
19. **Se aceptan los commits `534b222..6608731` con el trailer «Claude Sonnet 5»** en vez del de
    constraints, sin reescribir historia (igual que el ruling 4 de F1). **Qué cuesta si está mal:** un
    trailer inconsistente en esos commits locales (la atribución real es Claude Opus 5.5).
20. **El `status` global del manifest queda `'active'` aunque la fase F2 cierre en `'completed'`**: faltan
    el recorrido con dinero (sin MON) y la barra con teclado (sin key). **Qué cuesta si está mal:**
    `'completed'` afirmaría una cobertura que no existe; `'active'` es el reflejo correcto del estado real
    del proyecto — el bounty no se cierra hasta que ese recorrido se vea.

## Correcciones

Rondas de arreglo detectadas por revisión, no por el propio plan.

1. **T6, ronda 1** (revisión de la task, `af2f5ab8`): dos Important — (a) la barra de un bucket con `actual`
   `null` medía 2 px en vez de 0 (el `Math.max(2, …)` se aplicaba también sin dato); (b) el `gap: 9` debía
   ser vertical (barra↔etiqueta dentro de cada columna) y el `gap: 7` horizontal entre columnas, pero salió
   con las etiquetas en una fila aparte con `gap: 9`, desalineadas de sus barras. Corregido en `3929e3b`
   (fix round 1 sobre `FIX_BASE c65df5f`); re-revisión: 2 direcciones cerradas, 2 nuevas abiertas (base de
   las barras en ~98 px y overflow > 0,91).
2. **T6, ronda 2** (`ac7aa78a`): base de las barras corregida a 118 (no 98) y la diagonal recalculada a
   (0,100)→(100,8.47) para que «prometido» quede en la misma escala que las barras (ruling 11). Corregido en
   `243aeb6` (fix round 2 sobre `FIX_BASE 3929e3b`); re-revisión limpia (`aa6dc94e`).
3. **Revisión final de rama** (`a9939ea4` sobre `3302949..799bf1c`): Needs fixes con 2 Important y 8 minors.
   Important: (1) trayectoria y punto «now» tapados por la banda MARK; (2) el rótulo del board en Trade
   recalculaba el target con el mark vivo y divergía de `level.target`. Minors 3–10: fila de nivel exacta a
   `BOARD_CELL_H` incluyendo el borde; `stickyPhrase` decía «Short to <precio arriba>» cuando el lado no
   coincidía con el signo del nivel; nota de `LevelCard` sin mencionar el Face ID diario de Ask para los
   recordatorios; THE RECORD en skeleton eterno con `listError`; `agentsError` tapaba un perfil ya
   encontrado; `TradeTab` perdía el scroll al pasar edit↔review por no tener un único `PageScroll` estable;
   sin avatar en la cabecera del perfil; puntos del onboarding sin `hitSlop`. Corregido en la ola
   `7fa5758..a129933` (7 commits: `7fa5758` cubre Important 1–2 y el minor de fila exacta; `8440673`,
   `da3199f`, `e113667`, `0075a0e`, `9d5433b`, `a129933` cierran el resto uno por uno); re-revisión 10/10
   direcciones cerradas, sin nuevas roturas (`acc26899`). **Nota de proceso**: el fixer de esta ola usó
   `git stash` (el plan lo prohíbe por el stack compartido); el ledger registra `stash list` vacío tras su
   uso — no quedó una entrada huérfana, pero es una desviación de la regla que conviene no repetir.
4. **Arreglos visuales del recorrido en simulador** (T8, base `a129933`, 5 grupos dispatchados juntos):
   (1) el polígono de área de la trayectoria (encima de las filas) teñía de lavanda todas las filas bajo la
   línea, como si estuvieran seleccionadas — se quitó el área, quedó sólo la polyline y el punto «now»; (2)
   la línea cruzaba la palabra «MARK» de la banda — el rótulo de la banda se repinta por encima de la capa de
   trayectoria; (3) el filtro de THE RECORD se salía por la derecha — pasó a su propia fila, 4 pills
   `flex: 1`; (4) Ask usaba `paddingHorizontal: 15` contra 18 de Trade — alineado a 18; (5) onboarding: CTA
   sin flecha (se agregó `arrow`), arte «board» con la banda en 3 tramos (ahora una sola pieza) y el punto
   redondo (ahora cuadrado 7×7 radio 2), arte «ways» con la flecha de «Trade» a la izquierda (movida a la
   derecha). Corregido en `534b222`, `db32227`, `b91d34c`, `6608731`; re-revisión 5/5 direcciones cerradas,
   sin roturas nuevas (`a53f3119`), con 2 minors nuevos anotados (ver Residuales #9).

## Evidencia cara

- **Wallet nueva con onboarding real**: Sign up → Face ID → sheet «¿Guardar una llave de acceso?» → Agregar
  → wallet **`0x91f7…CC64`**, sin fondos, con su passkey creado en el simulador `pickler-mobile-light`
  (Apple Passwords). Las 3 hojas de onboarding se vieron una sola vez; «Go to markets» aterrizó en Markets.
- **Sign in sin hojas**: con `0xd6da…Ed23` (la wallet con la read de F1) el selector de llaves ofreció las
  dos («pickler»), y entrar con la segunda no mostró ninguna hoja de onboarding (Review Focus 3).
- **MON = 0 en `0xd6da…Ed23`**, medido por RPC a las 20:39 CST del 2026-09-28 — es el dato que bloquea todo
  el recorrido con key (Residual #1); no se intentó ningún atajo que moviera fondos.
- **El toast de LogBox** visto en la hoja 1 del onboarding («Sending onAnimatedValueUpdate with no
  listeners registered») es un `WARN` benigno y conocido de React Native, no un error de la hoja.
- **La read de F1 sigue viva en la ventana**: el punto violeta en +1.0 % · 4H de ETH apareció en el board de
  Ask sin volver a pedirla — confirma que `dots`/`dotKey` leen la misma read entre F1 y F2.

## Revisión final de rama

Ver *Correcciones* #3 y #4 para el detalle de qué se encontró y cómo se cerró. Resumen: la revisión final
de rama (`3302949..799bf1c`) encontró 2 Important y 8 minors, todos cerrados en la ola `7fa5758..a129933`
con re-revisión limpia; el recorrido en simulador (T8) encontró 5 grupos de defectos visuales, todos
cerrados en `534b222..6608731` con re-revisión limpia y 2 minors nuevos (MarkLabel duplicado y su
acoplamiento con `boardRows`, ver Residuales #9).

## Residuales abiertos (de mayor a menor peso)

1. **El recorrido con dinero y todo lo que exige key**: la barra fija de Trade con key («Long to X within
   4H» + «Review · X AUSD»), el teclado decimal tapando y liberando la barra con el monto actualizado
   (Review Focus 4), el scroll estable al pasar edit↔review, una orden desde una celda del board con sus
   recordatorios y el Face ID diario de Ask, y un long → «See it in Portfolio» → Close con saldos antes y
   después. Nada de esto tiene evidencia en simulador: `0xd6da…Ed23` sigue en MON = 0. Lo hace Jesús con MON
   de faucet o con la cuenta #620 en su iPhone.
2. **El onboarding desde un gate con `next`**: el camino (a) del plan (Sign out → Sign up desde un gate que
   pide cuenta, p. ej. Ask desde una celda) no se ejecutó — se probó Sign up directo desde la raíz. El CTA
   «Continue» en vez de «Go to markets» con acción retenida (ruling 15) está verificado por los tests de
   `onboardingExit`/`store.headerFor`, pero no por una captura real aterrizando fuera de Markets.
3. **La evidencia visual del ítem 5 del onboarding no se capturó**: los arreglos de `6608731` (flecha en el
   CTA, banda de una pieza, punto cuadrado, flecha de «Trade» a la derecha) se verificaron por código en la
   re-revisión, no con una captura nueva — repetirla exige crear otra wallet (el flag `pickler.onboarded.v1`
   ya quedó en `true` para `0x91f7…CC64`).
4. **Los tests del cableado `finishSignin(fallback)` / `startOnboarding`**: el repo sólo prueba lógica pura;
   este cableado se verificó en simulador (T8), no con un test unitario o de integración (deferred en la
   ola de la revisión final, ruling 18).
5. **El timer de signin tras desmontar** (`signin.tsx:34-35`, `doneTimer` durante el `await
   loadOnboarded()`): si el componente se desmonta mientras espera el flag, el timer puede dispararse sobre
   un componente ya fuera del árbol. Detectado en la revisión de T7, no cerrado (fuera de la ola).
6. **El push durante el onboarding**: si llega una notificación de resolución de read mientras las 3 hojas
   están abiertas, puede sacar al usuario del onboarding sin que `saveOnboarded()` se haya llamado —
   repetiría las hojas en el siguiente alta. Detectado en la revisión de T7, no cerrado.
7. **`cellTone` con bps 0**: clasifica un bps de 0 como `short` (la rama `bps > 0 ? "long" : "short"` no
   tiene caso para 0). No ocurre con `LEVELS_BPS` real (`[250, 100, 50, -50, -100]`, sin cero), así que es
   inocuo hoy; queda documentado por si el backend agrega un nivel en 0.
8. **`useAppCtx()` llamado dos veces** (en `Page` y en `PageScroll`, minor de T2): redundante pero inocuo.
9. **`MarkLabel` duplicado y su acoplamiento con `boardRows`**: el rótulo de la banda (precio + «MARK») se
   repite (una vez detrás de la trayectoria, otra encima para taparla, arreglo visual #2) en vez de un solo
   componente con `zIndex`; y el `top` de la capa de trayectoria se calcula por índice de fila, acoplado al
   orden que produce `boardRows`. Ambos, minors nuevos de la re-revisión de los arreglos visuales
   (`a53f3119`), no cerrados.
10. **El gap 8 del wrapper** entre el `Board` y su leyenda («YOU ASKED AN AGENT HERE»): decisión propia de
    T3, sin dato del Handoff que lo confirme o lo contradiga.
11. **El label de Review sin la variante con nivel**: el botón de la barra fija de Market dice siempre
    «Review · X AUSD»; la frase «Long to X within 4H» va arriba, por separado, en vez de en el propio botón
    (minor de T4, deferred).
12. **El aviso de LogBox en dev**: el `WARN` de RN «Sending onAnimatedValueUpdate with no listeners
    registered», visto en la hoja 1 del onboarding, es preexistente y no se investigó su origen exacto.
13. **La wallet extra `0x91f7…CC64`** quedó creada en el simulador para probar el onboarding — ver Rollback.
14. **El trailer «Claude Sonnet 5»** en los commits `534b222..6608731` (ruling 19), en vez del de Opus 5.5.
15. **El AX5 ilegible**, heredado de F1 (residual 6/9 de ese audit): a un nivel de accesibilidad por encima
    de XXXL, Markets se lee «M…». Fuera del alcance de F2.

## Rollback

Nada se escribió en TestFlight, contratos ni cuentas de terceros. En entornos compartidos quedan: la wallet
`0x91f7…CC64`, creada durante la verificación del onboarding, **sin fondos**, con su passkey en el
simulador `pickler-mobile-light` (Apple Passwords) y su sesión de reads activa; no se hizo ninguna read
nueva con ella. La wallet de F1, `0xd6da…Ed23`, sigue sin fondos (MON = 0, medido por RPC) y con la misma
read de F1 sin tocar. Ambas son inocuas; borrarlas no es necesario. Números de cierre: tests **282 → 301**
(44 suites), `tsc --noEmit` limpio en cada task y al final, commits `3302949..6608731` sobre la rama
`feat/mobile-light`, sin push, sin merge y sin TestFlight.

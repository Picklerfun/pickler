# App móvil Pickler — Rediseño light (Handoff): 4 pestañas, board nivel × tiempo, Agents y Portfolio

**Fecha**: 2026-09-28
**Estado**: spec en revisión; sin planes
**Slug**: `mobile-light`
**Rama**: `feat/mobile-light`, base `main` (`4041315`), worktree `.claude/worktrees/mobile-light`
**Contexto**: el 2026-09-22 el equipo subió a `jjesusaf/pickler-mobile` (`781f0ed`, visor en
`1808d5b`, carpeta `design/`) el prototipo de Claude Design **Pickler Mobile Handoff**. Es la
iteración siguiente del hi-fi que la app adoptó en `mobile-hifi` (`a0e353e`, navy + Chakra Petch).
Trae un sistema **claro** (Archivo + Instrument Sans + JetBrains Mono), 4 pestañas y 9 pantallas.
Versión viva: https://claude.ai/design/p/c03aadb4-7bb2-429e-aa49-98ae4218bc1f. Los datos del
prototipo son de ejemplo y sus botones no hacen nada.

Jesús pidió **adoptar este diseño como tema de UI/UX sin cambiar la lógica**: donde el diseño supone
algo que no tenemos, se conserva la lógica actual y el diseño se adapta. Los conflictos (C1–C6) se
resolvieron uno por uno el 2026-09-28. Quedan 15 días para el bounty (13 oct 2026, 21:59 CST).

---

## TL;DR

1. **Tema claro del Handoff** en toda la app: tokens, fuentes, primitivas y tab bar de 4 botones fijos.
2. **Pestañas**: MARKETS · AGENTS · PORTFOLIO · WALLET. Launchpad y Activity **salen de la barra, pero
   se quedan en el código** para integrarlas después.
3. **Dos saldos, como hoy**: Wallet muestra AVAILABLE (la wallet) con una baldosa IN TRADING.
   Portfolio reparte POSITIONS / AVAILABLE (trading) / BACKED (coming soon). Enable trading y
   Reconnect viven en Market, donde se toca Trade.
4. **Market = un solo board** nivel × tiempo con segmentado *Trade it / Ask an agent*. Se conservan los
   niveles y horizontes del backend (4 columnas). La orden sigue siendo de mercado con recordatorios.
5. **Agents** con datos reales. El **perfil** usa tus reads con ese agente y calcula la calibración en
   la app. Sin backend nuevo.
6. **Read** es una pantalla propia con el diseño del Handoff; créditos simulados como hoy.
7. **Sin backend nuevo, sin DDL, sin cambios en Perpl.**
8. Dos fases con checkpoint; un spike de velas de Perpl va aparte.

---

## 1. Decisiones

| # | Decisión | Valor | Por qué |
|---|---|---|---|
| D1 | Pestañas (C1) | `TAB_ORDER` = MARKETS (`grid`) · AGENTS (`user`) · PORTFOLIO (`chart`) · WALLET (`wallet`), los iconos de la barra del Handoff. Corrección del 2026-09-28 al escribir el plan F1: decía `chart` / `layers`, heredados de la barra anterior. Launchpad y Activity **se quitan de `TAB_ORDER`**, pero sus pantallas (`comingSoon.tsx`), su copy (`comingSoonCopy.ts`) y sus nombres de ruta se conservan, con un comentario que las marca como "a integrar". | Jesús: "no lo elimines por completo, lo vamos a integrar después". |
| D2 | Tab bar | 4 botones fijos: icono lucide de 19 px (stroke 1.9) y etiqueta mono de 10.5 px. Activo: fondo `#F1F2F7` y color por pestaña según la barra del Handoff (MARKETS `#3F6B00`, AGENTS `#5B3CE0`, PORTFOLIO `#8A6200`, WALLET `#C62C62`). Inactivo: `#6B7186`. Barra blanca al 96 % **sin blur** (evita `expo-blur`) y con una hairline arriba. **Se retira la pastilla arrastrable** (`TabBar.tsx` / `tabBarLayout.ts`). Se sigue ocultando en pantallas que no son raíz. | Es la barra del diseño. El mapa del Handoff usa otros colores para Wallet y Portfolio; manda la barra hi-fi. |
| D3 | Tokens | `ui/theme.ts` adopta la paleta del Handoff:<br>• Superficies y tinta: ink `#0B0D1A`; texto `#5A5F78` / `#6B7186`; fondo `#FFFFFF`; tarjeta `#F5F6FA`; control `#F1F2F7`; bloque oscuro `#0B0D1A` con baldosa `#15182A` y texto `#9AA0B8` / `#C7CAD8`.<br>• Acentos: money/lima `#C8F03A`; ask/violeta `#5B3CE0`; win `#2E7D32`; loss `#C62C62`; pending `#FFC93F`; short `#FF5FA2`; punto de agente `#9B7BFF`.<br>• Tintes: `#F3F8E0`, `#EDF7CE`, `#EEEAFF`, `#FBF0D4`, `#FDF0F5`; tintas `#3F6B00` y `#8A6200`.<br>• Grises: `#E2E5EE`, `#D3D6E2`; hairlines `rgba(11,13,26,.06/.08/.1)`.<br>Los nombres viejos que ya no correspondan desaparecen y `theme.test.ts` fija los valores nuevos. | Portar 1:1 desde el diseño evita inventar equivalencias, igual que en `mobile-hifi` D8. |
| D4 | Fuentes | Display: **Archivo 700** con ancho ~112 (`wdth 112` en el diseño). Se usa la instancia estática más cercana al ancho 112 de los archivos de Google Fonts; si no hay una, Archivo 700 normal. El plan lo verifica renderizado. Cuerpo: **Instrument Sans** 400/500/600. Mono: **JetBrains Mono** 500/700 (ya cargada). **Sale Chakra Petch; Manrope sale** si no queda ningún consumidor. | RN no garantiza ejes variables en iOS; una instancia estática es predecible. |
| D5 | Forma | Pill en todo control; radio 20 en tarjetas, 22 en bloques oscuros y 12–16 en baldosas; padding de pantalla 18; casi sin sombras. **Se retira el `Backdrop`** (gradiente navy con puntos). Status bar oscura y `expo-system-ui` en blanco. | Reglas de forma del Handoff. |
| D6 | Primitivas | Las primitivas de `ui/primitives.tsx` se re-visten con el vocabulario del Handoff; mismos nombres donde ya coinciden. Botones: primario lima, Ask (`#EEEAFF` / `#5B3CE0` con burbuja), oscuro, atrás circular de 38 px y la flecha → final. Chips de filtro, segmentado ink sobre `#F1F2F7`, barra de progreso de 8 px. | Diff legible contra el diseño. |
| D7 | Dos saldos (C2, opción A) | **Wallet**: bloque ink "AVAILABLE · AUSD" = saldo de la wallet, con Deposit (lima) y Withdraw (`#15182A`). Debajo, la baldosa "IN TRADING · X AUSD", que abre Trading funds (Add / Withdraw, la `perpsFunds` actual). **Portfolio**: bloque ink con TOTAL = valor de la cuenta de trading (margen en posiciones + libre + PnL no realizado) y 3 baldosas: POSITIONS, AVAILABLE y BACKED (coming soon, "—"). AVAILABLE es el libre **con la fórmula del ticket** (`b − lb`, `market.tsx`). POSITIONS usa el `locked` que hoy muestra la card de Markets, más el PnL no realizado. El plan fija la suma exacta y la verifica con la cuenta #620. Hoy la card de Markets rotula `b` como "free" y eso no coincide con el ticket; desde aquí manda `b − lb`. El saldo de la wallet **no** se suma: vive en Wallet. **Enable trading / Reconnect** aparecen como card dentro de Market en modo Trade, en lugar del `TradeGate` que mandaba a Markets. **Markets queda solo con la lista.** | Jesús eligió A. Un saldo sumado engañaría: withdraw sólo saca lo que está en la wallet. |
| D8 | Avisos de trading | Desfase de reloj, key rechazada (Reset / Open Perpl) y forwarding apagado se muestran en Market (modo Trade) y en Portfolio → Positions, con el estilo de aviso nuevo. | Hoy viven en la card de Markets, que desaparece. |
| D9 | Markets | Cabecera "MARKETS" y buscador **local** por símbolo y nombre. Cada tarjeta lleva avatar con símbolo, par, "MAX N× · 3 AGENTS" (agentes reales), mark, cambio 24h con color según signo, sparkline y los botones **Ask** (abre Market en modo Ask) y **Trade** (abre Market en modo Trade); al tocar la tarjeta se abre Trade. **Sin chips de categoría.** Sparkline: marks acumulados en memoria (`perpl/marks.ts`), vacía al abrir y crece con el polling; su color sigue el cambio 24h real. | C6. Perpl sólo lista crypto, así que las categorías no filtrarían nada. No hay API de historial en la app. |
| D10 | Market: board (C3) | Cabecera: atrás, par, "N AGENTS · MAX N×", mark en vivo, % 24h y segmentado **Trade it / Ask an agent**, que reemplaza a los PillTabs Ask/Trade/Agents. `S.marketTab` queda en `trade \| ask`; **esta parte entra en F1** porque la pill Agents se va con D15. Board del Handoff (F2): banda ink del MARK en medio, filas de nivel con precio absoluto (verde arriba, rojo abajo) y % de distancia, celdas de 48 px, trayectoria de precio al fondo con los marks en memoria y punto "now". Puntos violeta donde ya hay reads tuyas. **Niveles y horizontes del backend**: +2.5 / +1 / +0.5 / −0.5 / −1 % × 1H / 4H / 12H / 24H. | Jesús aprobó 4 columnas. `reads.level_bps` y `horizon_min` ya tienen CHECK con esos valores. |
| D11 | Market: Trade it | Al tocar un cuadro se infiere el lado (arriba del mark = long) y se prellena el ticket actual con el nivel (LevelCard) y el horizonte. Ticket del Handoff: segmentado "Long · up / Short · down", MARGIN AUSD con Max, chips de apalancamiento **del mercado** y KV SIZE / IF IT HITS / LIQUIDATION ≈ con **nuestros** cálculos (notional, precio estimado, fee taker). Barra fija "Long to X within 4H" + "Review · X AUSD". Review en tinta y resultado en lima (sent / filled / failed / unknown), según los wireframes. **La lógica no cambia**: orden de mercado firmada por WS más `reminder-set`. **No hay** TP ni cierre por deadline, y el copy no dice "three orders". El **order book L2** (`book.tsx`) queda como card plegable bajo el ticket. | "Si hay lógica que no es compatible, dejamos la lógica". |
| D12 | Market: Ask an agent | Al tocar un cuadro se abre el `AskSheet` actual re-vestido: chip del agente con "Change" (es el "agent picker" del diseño), pregunta generada, steppers y "Ask · 1 credit" con el saldo de créditos. `SessionGate` (Face ID diario) re-vestido. El resultado se sigue mostrando **inline** en Market (`ReadCard` con el estilo de D14), sin empujar otra pantalla. **Se retira el segmentado New / My reads** de Ask: la lista vive en Portfolio → Reads (D17). | C5. |
| D13 | Entradas a Ask (C5) | "Ask" desde una tarjeta de Agents o desde el perfil: cambia a la pestaña Markets y abre `market` en modo Ask con ese agente elegido, en el último mercado usado o, si no hay, BTC. "Ask" desde Markets abre ese mercado en modo Ask. | Una read exige mercado, nivel y horizonte; no se le pregunta a un agente en abstracto. |
| D14 | Pantalla Read | Ruta nueva `read`, **sólo en la pila de Portfolio**, porque `TAB_OF` asigna una pestaña por pantalla. Desde el récord del perfil se cambia a Portfolio y se abre `read`. Datos: la read se busca por id en la lista de `useReads`; si no está (llegó por push), se pide con `fetchRead` (`reads/api.ts`, hoy sin consumidor). Cabecera: atrás, avatar, agente, "READ · N CREDITS". Bloque violeta THE QUESTION con la pregunta y la probabilidad en 64 px. Relojes DELIVERED / EVALUATES, ITS READ, WHY (las `reasons`) y LIMITS (bloque ámbar). Estado como etiqueta: READING / OPEN / RIGHT / WRONG / VOID / FAILED. **No van** "BOOK IS AT" ni SOURCES. Barra fija "Trade this market", que abre Market en Trade con el nivel de la read ya marcado. | Coincide casi 1:1 con `ReadCard`. Book % no aplica a perps y no guardamos fuentes. |
| D15 | Agents (C4) | Pestaña con la lista de `agents-list`: avatar con iniciales, nombre, "by owner", una línea de descripción, baldosas HIT % · N RESOLVED y BRIER, y botón "Ask · N credits". Al tocar la tarjeta se abre el perfil. **Sin** etapa, curva, mcap, net AUSD, "Back it", "Trade it" ni chips de beat. La descripción es un **mapa en la app** por `agent.id`; la `persona` no se expone. | Datos reales disponibles. Back it y los tokens van con Launchpad. |
| D16 | Perfil de agente (C4, opción A) | Ruta nueva `agent` (pila de Agents). Cabecera con avatar, nombre, owner. Stats de `agent_records`. ITS BEAT = la descripción de D15. **CALIBRATION** se calcula en la app con **tus** reads resueltas de ese agente: 5 buckets de probabilidad, con la tasa real frente a la diagonal prometida. Con menos de 5 resueltas muestra un estado vacío. **THE RECORD** muestra tus reads con ese agente (ALL / RIGHT / WRONG / OPEN), filtradas en la app por `agent_id` sobre la lista de `useReads` (D26). `reads-list` devuelve como máximo 50, así que el récord y la calibración salen de esa ventana. Cada fila abre la Read (Portfolio → `read`). Barra fija "Ask · N credits". | Jesús eligió A: sin backend nuevo. El récord es personal, no público. |
| D17 | Portfolio | Ruta `portfolio` real (deja de ser coming soon). Bloque ink de D7 y segmentado **Positions / Reads / Backed**. **Positions**: las posiciones de Perpl que hoy están en Markets, con la tarjeta del diseño (lado y tamaño, lv, PnL, ENTRY / MARK / LIQ. EST.) y **Close** con su confirmación inline actual. **Sin** la barra "TO THE LEVEL": la posición no guarda su nivel (`tradeLevel` se borra tras `reminder-set`) y no hay endpoint de reminders. El resultado de Close se queda en Portfolio. Sin trading key: una card "Trading not enabled" que abre Market en Trade. **Reads**: la lista "My reads" actual (`reads-list`, polling 15 s) con la tarjeta del diseño; al tocar, Read. **Backed**: coming soon. | C1. Mueve lo que ya existe; no inventa datos. |
| D18 | Wallet | Bloque ink de D7, tarjeta de red ("Monad testnet", dirección, CONNECTED) y segmentado **Activity / Pending** sobre los movimientos actuales (Complete en Activity; Confirming en Pending; Reverted en Activity, marcado). Al final, TESTNET (MON, "Get test AUSD", "Get test MON") y SESSION (Lock, Sign out) re-vestidos. Pie: "Withdrawals always ask for Face ID." Pull-to-refresh y el sello UPDATED se conservan. | C6-8. Sin faucets no se puede probar en TestFlight. |
| D19 | Deposit / Withdraw / Trading funds | Siguen siendo **pantallas push** (no bottom sheet), re-vestidas. Deposit gana un **QR real** de la dirección con `react-native-qrcode-svg` (JS puro sobre `react-native-svg`, que ya está instalado). `perpsFunds` pasa a la pila de Wallet; su botón de vuelta (hoy "Back to Markets", `nav("markets")`) vuelve a `wallet`. | Pasar a sheet es cambio de navegación sin mucha ganancia. El QR es barato y hoy es placeholder. |
| D20 | Sign in | Cabecera con logo y "PICKLER", segmentado **Sign in / Sign up**. Títulos "GET IN." y "BUILD AN AGENT.". Tarjeta ink de passkey con estados idle / "Waiting on Face ID…" / done (dirección), que llama al `signIn` / `createAccount` actuales; al terminar, banner "ACCOUNT CREATED" / "WELCOME BACK" durante ~1 s y después `finishSignin()`, que hoy navega de inmediato. Se conserva la card "We kept what you were about to do". **Sin** email, magic link ni NAME. | C6-6. |
| D21 | Onboarding | Ruta nueva `onboarding` en el RootStack. **Sólo después de `createAccount`**, nunca al recuperar la cuenta. 3 hojas del Handoff sobre Markets desenfocado, con SKIP (salta a la última), puntos tocables y CTA "Next" / "Go to markets". Copy **reescrito** para lo que la app hace: (1) los agentes leen el mercado, (2) "PICK A SQUARE." el board, (3) "ASK, OR TRADE." — sin deportes ni "Back it". Un flag persistido evita que vuelva a salir. Si había una acción retenida (`next`), se ejecuta al cerrar. Si no, termina en Markets. La pestaña inicial al arrancar sigue siendo **Wallet**, como hoy (`Navigator.tsx`). | C6-5. |
| D22 | Deep links de push | `read` → pestaña Portfolio → `read`. `reminder` → Markets → `market` en Trade **sin nivel**, como hoy: el payload no trae target ni vencimiento (`reads/push.ts`) y agregarlo sería tocar el backend. El encolado en arranque en frío se conserva. | Las rutas cambian de lugar. |
| D23 | Gates de cuenta | `GATED` = los de hoy (markets, market, perpsFunds, wallet, deposit, withdraw) **más** portfolio, read y agent. **Agents (lista) sigue siendo pública**: al tocar un agente sin cuenta, `requireAccount("agent", …)` desvía a Sign in y vuelve al perfil. | "Reading and following never need an account" aplica a la lista. |
| D24 | Estados sin diseño | Vacío, carga (los `Skeleton` actuales) y error se derivan del sistema nuevo. Ninguna pantalla queda sin sus tres estados. | El Handoff no los trae. |
| D25 | Verificación visual | Cada pantalla se compara renderizada en el simulador contra su archivo `* Mobile Light.dc.html`, con capturas en el audit. También se revisa con Dynamic Type grande. | Regla del repo: mirar antes de afirmar. |
| D26 | Datos: cambios de cableado (declarados) | Para que Portfolio, Agents y el perfil tengan datos, se cambia **sólo el cableado**, no la lógica de negocio:<br>• `useReads` pide `reads-list` **sin filtro de mercado** (hoy filtra por `perpsMarketId`, `App.tsx`); el board filtra por mercado en la app.<br>• El polling de reads corre en `market` (Ask), `portfolio` y `agent`, no sólo en Market/Ask.<br>• `PERPL_SCREENS` suma `portfolio`, para que el socket y el contexto corran ahí (hoy sólo markets, market y perpsFunds). Wallet sigue usando el último saldo de trading visto.<br>• Markets pide `agents-list` para el "N AGENTS". | Sin esto, Portfolio y el perfil cargarían vacíos (hallazgo de la revisión del spec). |
| D27 | Dependencias nuevas | `@expo-google-fonts/instrument-sans` y `@expo-google-fonts/archivo` (o los `.ttf` de la instancia de D4 en `assets/fonts`), `react-native-qrcode-svg` y la instancia local de Archivo. `expo-system-ui` ya estaba instalada (`57.0.4`): basta con cambiar los fondos de `app.config.ts`, y eso exige `prebuild --clean` y `expo run:ios`. Corrección del 2026-09-28, al escribir el plan F1: la versión anterior de esta fila la daba por nueva. **No** `expo-blur`. Salen `@expo-google-fonts/chakra-petch` y, si queda sin uso, `manrope`. | Lista cerrada para el plan. |

---

## 2. Rutas y pilas resultantes

| Pila | Rutas |
|---|---|
| Root | `Tabs`, `signin`, `onboarding` |
| MarketsTab | `markets` → `market` |
| AgentsTab | `agents` → `agent` (Ask cambia a MarketsTab/`market`; una fila del récord cambia a PortfolioTab/`read`) |
| PortfolioTab | `portfolio` → `read` (→ "Trade this market" cambia a MarketsTab/`market`) |
| WalletTab | `wallet` → `deposit` · `withdraw` · `perpsFunds` |

Siguen existiendo sin pestaña: `launchpad`, `activity` (D1). `perpsFunds` pasa de la pila de Markets
a la de Wallet. Las reglas de `mobile-nav` siguen vigentes: navegar con `{pop:true}`, usar
`ctx.nav` / `requireAccount` y no llamar `navigationRef` directo.

## 3. Lógica nueva (pura y con tests)

- `calibration(reads)` → 5 buckets `{promised, actual, n}`; con menos de 5 resueltas, vacío.
- `portfolioTotals(trading)` → total, positions, available (sin saldo de wallet).
- `filterMarkets(markets, query)`.
- Flag de onboarding (leer / escribir) y la regla de cuándo mostrarlo (sólo tras crear).
- Mapeo del board: nivel → fila/precio absoluto, lado inferido y celda con read.
- `routes` / `TAB_ORDER` / `GATED` actualizados en `navigation.test` y `routes.test`.

Aparte del cableado de D26, la lógica de Perpl, wallet, reads y push **no se toca**.

## 4. Fases

- **F1 — Sistema y re-vestido.** D2–D9, D13–D15, D17–D20 y D22–D27, más la parte de D10 que corresponde al segmentado y a `marketTab`. Tokens, fuentes,
  primitivas, tab bar de 4, pilas nuevas, Sign in, Wallet, Deposit (QR), Withdraw, Trading funds,
  Markets con búsqueda, Agents (lista), Portfolio (Positions / Reads / Backed) y la pantalla Read.
  Market queda funcional con el segmentado Trade it / Ask an agent y con el ticket y el Ask (con la
  `MatrixGrid` actual) re-vestidos, pero sin el board nuevo. **Read entra en F1** porque Portfolio → Reads la necesita.
- **F2 — Board y perfil.** El resto de D10, más D11–D12 (board unificado), D16 (perfil con calibración) y D21 (onboarding).
- **Aparte (spike)**: ¿Perpl expone velas o historial de precio? Si sí, la sparkline de Markets y la
  trayectoria del board se conectan después. No bloquea F1 ni F2.

Cada fase termina con su audit y un checkpoint. Una subida a TestFlight sólo ocurre con
autorización explícita.

## 5. Fuera de alcance

Back it, tokens de agente, bonding curve, Launchpad y Activity (se integran después). Magic link /
email / NAME de creadores. Chips de categoría y de beat. Pago de reads en AUSD. "BOOK IS AT" y
SOURCES. TP y cierre por deadline ("three orders"). Bottom sheets para Deposit / Withdraw / Ask /
Back. Récord público de agentes (necesita `agent-get`). Cualquier cambio en backend, DDL o Perpl.

## 6. Riesgos

- **Fuente display**: la instancia estática de Archivo puede verse distinta al `wdth 112`. Mitigación:
  comparación visual en F1 y fallback documentado (D4).
- **Tema claro**: pueden quedar colores oscuros sueltos (status bar, fondo nativo, teclado, alertas).
  Mitigación: `expo-system-ui` y revisar cada pantalla (D25). Requiere `prebuild --clean` y
  `expo run:ios`.
- **Socket de Perpl en Portfolio** (D26): arrancarlo en otra pestaña cambia cuándo se conecta.
  Hay que verificar que reconecta bien al cambiar de pestaña y que no abre dos sockets.
- **Calibración con pocos datos**: con 3 agentes y reads personales, casi siempre queda vacía. Está
  aceptado (D16).
- **Tests sólo de lógica**: no hay tests de componentes. La verificación visual es manual y queda
  con capturas.

// Catálogo de proyectos y devs del dashboard de Pickler.
//
// Este archivo es la fuente de verdad de qué entries aparecen en el index.
// Está separado del HTML para que cada cambio de status toque solo este
// archivo (diffs limpios en git).
//
// Formato de cada entry:
//   {
//     date: 'YYYY-MM-DD',
//     title: '...',
//     summary: '...',
//     file: 'YYYY-MM-DD-<topic>.html' | 'dev/YYYY-MM-DD-<slug>.html',
//     types: ['spec'] | ['plan'] | ['spec','plan'] | ['fix'] | ['feature'] | ['refactor']
//          | ['exploration'] | ['pr'] | ['playground'] | ['report'],
//     status: 'active' | 'completed' | 'paused' | 'cancelled'
//           | 'pending' | 'in_progress' | 'shipped',
//     tags: ['...'],
//     phases: [{ num: 0, status: 'plan_ready' }, ...] // opcional, omite para devs
//   }
//
// Status posibles para phases:
//   'completed' | 'in_progress' | 'plan_ready' | 'pending'
//
// Para agregar una entrada nueva: abre index.html en el browser y usa el botón
// "+ Nueva entrada" (atajo 'n'). El form genera el bloque JS y lo copia al
// clipboard, listo para pegar al array de abajo.

window.DOCS = [
  // ← Las entradas nuevas se pegan aquí (más reciente primero).
  {
    date: '2026-09-21',
    title: 'TestFlight build 9',
    summary: 'Build 0.1.0 (9): navegación nativa F2 — tab bar con pastilla lima arrastrable (cambia al soltar, háptica) y barra que se esconde deslizando al entrar/salir de no-raíz; cierra el proyecto mobile-nav. VALID en App Store Connect y en el grupo «Equipo».',
    file: 'dev/2026-09-21-testflight-build9.html',
    types: ['feature'],
    status: 'shipped',
    tags: ['mobile', 'testflight', 'ios', 'navigation'],
  },
  {
    date: '2026-09-21',
    title: 'TestFlight build 8',
    summary: 'Build 0.1.0 (8): navegación nativa F1 (react-navigation 7, pilas por pestaña) — gesto atrás interactivo de iOS, adelante animado, cabecera que viaja con la página; primer build con screens/gesture-handler/reanimated. UPLOAD SUCCEEDED; VALID en App Store Connect y en el grupo «Equipo».',
    file: 'dev/2026-09-21-testflight-build8.html',
    types: ['feature'],
    status: 'shipped',
    tags: ['mobile', 'testflight', 'ios', 'navigation'],
  },
  {
    date: '2026-09-21',
    title: 'Navegación nativa en la app móvil — gesto atrás iOS, pilas por pestaña y tab bar con pastilla arrastrable',
    summary: 'Migrar la navegación a react-navigation nativa (native-stack + bottom-tabs, una pila por pestaña) sin cambiar la API de las pantallas: gesto atrás interactivo, adelante animado, cabecera que viaja con la página; y una tab bar con pastilla lima que se arrastra sin despegar el dedo y selecciona al soltar.',
    file: '2026-09-21-mobile-nav.html',
    types: ['spec', 'plan'],
    status: 'completed',
    tags: ['mobile', 'expo', 'navigation', 'ui'],
    phases: [
      { num: 1, status: 'completed' },
      { num: 2, status: 'completed' },
    ],
  },
  {
    date: '2026-09-21',
    title: 'TestFlight build 7',
    summary: 'Build 0.1.0 (7): carga visible F1 — skeletons por sección, sello UPDATED / COULDN\'T REFRESH por pantalla y splash nativo con la P lima; fixes de la revisión final (in trading sin socket, sello por cuenta). UPLOAD SUCCEEDED; VALID en App Store Connect y en el grupo «Equipo».',
    file: 'dev/2026-09-21-testflight-build7.html',
    types: ['feature'],
    status: 'shipped',
    tags: ['mobile', 'testflight', 'ios', 'loading'],
  },
  {
    date: '2026-09-21',
    title: 'Carga visible en la app móvil — skeletons por sección, sello «Updated» al jalar y splash con la marca',
    summary: 'Cada card o lista con datos remotos pinta su propio skeleton hasta que llega su dato; el pull-to-refresh deja un sello UPDATED HH:MM:SS; expo-splash-screen muestra la P lima sobre #05061A hasta que la cuenta local se resuelve.',
    file: '2026-09-21-mobile-loading.html',
    types: ['spec', 'plan'],
    status: 'completed',
    tags: ['mobile', 'expo', 'ui', 'loading'],
    phases: [
      { num: 1, status: 'completed' },
    ],
  },
  {
    date: '2026-09-21',
    title: 'TestFlight build 6',
    summary: 'Build 0.1.0 (6): Ask F1+F2 (Ask, Agents, push de resolución, My reads) y el fix Markets/trading key; primer build con aps-environment; VALID en App Store Connect, grupo «Equipo».',
    file: 'dev/2026-09-21-testflight-build6.html',
    types: ['feature'],
    status: 'shipped',
    tags: ['mobile', 'testflight', 'ios', 'ask', 'perpl'],
  },
  {
    date: '2026-09-21',
    title: 'Markets abre Ask sin trading key; sign out conserva la key',
    summary: 'El gate de Perpl vive en Trade; Ask y Agents funcionan sin key; cerrar sesión ya no obliga a Reconnect (tx + key nueva).',
    file: 'dev/2026-09-21-markets-ask-gate.html',
    types: ['fix'],
    status: 'shipped',
    tags: ['mobile', 'perpl', 'ask', 'fix'],
  },
  {
    date: '2026-09-20',
    title: 'Matriz de Ask como el Grid del prototipo',
    summary: 'Sparkline real, escalera de precios, celdas con punto y hoja violeta con steppers; corrige D14 del spec de Ask.',
    file: 'dev/2026-09-20-mobile-ask-matrix.html',
    types: ['feature'],
    status: 'shipped',
    tags: ['mobile', 'ask', 'ui'],
  },
  {
    date: '2026-09-19',
    title: 'App móvil Pickler — Ask, Agents y Trade con order book: lecturas de agente sobre la matriz nivel × horizonte, medidas contra Perpl',
    summary: 'Ask y Agents dejan de ser «coming soon»: un agente (Claude Sonnet 5 con su persona) da una lectura pagada con créditos simulados sobre una celda nivel × horizonte, un cron la resuelve right/wrong contra el mark de Perpl y avisa por push; Agents lista agentes con récord real; Trade sigue manual y gana order book L2 y «Trade this level» con recordatorios. Backend propio en el esquema mobile del Supabase pickler compartido.',
    file: '2026-09-19-mobile-ask.html',
    types: ['spec', 'plan'],
    status: 'active',
    tags: ['mobile', 'expo', 'perpl', 'supabase', 'claude', 'agentes', 'push'],
    phases: [
      { num: 1, status: 'completed' },
      { num: 2, status: 'completed' },
      { num: 3, status: 'pending' },
      { num: 4, status: 'pending' },
    ],
  },
  {
    date: '2026-09-19',
    title: 'TestFlight build 5',
    summary: 'Build 0.1.0 (5) con la fase F2 del rediseño hi-fi: Markets, Market y Trading funds re-vestidos, "Reconnect trading" tras Sign out + sign in, aviso de reloj desfasado y fees a cuatro decimales; subido a App Store Connect. El grupo interno "Equipo" recibe cada build automáticamente (hasAccessToAllBuilds).',
    file: 'dev/2026-09-19-testflight-build5.html',
    types: ['feature'],
    status: 'shipped',
    tags: ['mobile', 'testflight', 'ios', 'perpl'],
  },
  {
    date: '2026-09-18',
    title: 'App móvil Pickler — Rediseño hi-fi: tema, MARKETS, Wallet y Trade re-vestidos',
    summary: 'La app adopta el diseño hi-fi (pickler-mobile@a0e353e): tema azul con Chakra Petch, tab bar MARKETS · LAUNCHPAD · ACTIVITY · PORTFOLIO · WALLET; Wallet y el trading en Perpl se re-visten sin perder lógica, el resto queda en «coming soon» y entran los tres fixes del build 5 (reloj, fees, Reconnect trading).',
    file: '2026-09-18-mobile-hifi.html',
    types: ['spec', 'plan'],
    status: 'active',
    tags: ['mobile', 'expo', 'ui', 'perpl', 'diseño', 'testflight'],
    phases: [
      { num: 1, status: 'completed' },
      { num: 2, status: 'completed' },
    ],
  },
  {
    date: '2026-09-18',
    title: 'App móvil Pickler — Pulido de navegación: coming soon, arranque en Wallet, gestos y PnL en Trade',
    summary: 'Market, Activity y Portfolio dicen «coming soon» con la estética de la app; la app arranca en Wallet; Wallet y Trade se refrescan jalando y las pantallas con «←» regresan con swipe desde el borde; Trade muestra el PnL no realizado bajo el saldo con «in positions / free» corregidos.',
    file: '2026-09-18-mobile-polish.html',
    types: ['spec', 'plan'],
    status: 'completed',
    tags: ['mobile', 'expo', 'ui', 'perpl', 'navegación'],
    phases: [
      { num: 1, status: 'completed' },
    ],
  },
  {
    date: '2026-09-18',
    title: 'Sistema de documentación con manifest (modelo Proflores)',
    summary: 'Manifest, overviews, dev trackers, specs/planes con HTML autogenerado y un audit por fase — el modelo completo de documentación de Proflores, adoptado para que el estado de Pickler viva en un solo lugar máquina-legible.',
    file: '2026-09-18-docs-manifest.html',
    types: ['spec', 'plan'],
    status: 'completed',
    tags: ['docs', 'tooling', 'agentes', 'skills'],
    phases: [
      { num: 1, status: 'completed' },
      { num: 2, status: 'completed' },
      { num: 3, status: 'completed' },
    ],
  },
  {
    date: '2026-09-17',
    title: 'TestFlight build 4',
    summary: 'Build 0.1.0 (4) con el pulido de navegación (coming soon, arranque en Wallet, pull-to-refresh, swipe atrás, PnL en Trade); en el grupo interno "Equipo". Desfase de reloj, fees a 4 decimales y "Reconnect trading" quedan para el build 5.',
    file: 'dev/2026-09-17-testflight-build4.html',
    types: ['feature'],
    status: 'shipped',
    tags: ['mobile', 'testflight', 'ios'],
  },
  {
    date: '2026-09-16',
    title: 'TestFlight build 3',
    summary: 'Build 0.1.0 (3) con el mensaje real de PRF_UNAVAILABLE, iOS 18 como mínimo y "Get test MON" que copia la dirección; en el grupo interno "Equipo".',
    file: 'dev/2026-09-16-testflight-build3.html',
    types: ['feature'],
    status: 'shipped',
    tags: ['mobile', 'testflight', 'ios'],
  },
  {
    date: '2026-09-16',
    title: 'App móvil Pickler — Fase 2: trading manual en Perpl',
    summary: 'Una pestaña nueva Trade donde el usuario, con su cuenta de Mera y su AUSD, habilita trading, ve saldo y posiciones, abre y cierra perps con orden de mercado, y mueve fondos entre la wallet y la cuenta de trading.',
    file: '2026-09-16-mobile-perpl.html',
    types: ['spec', 'plan'],
    status: 'completed',
    tags: ['mobile', 'expo', 'perpl', 'mera', 'ausd', 'wallet'],
    phases: [{ num: 1, status: 'completed' }],
  },
  {
    date: '2026-09-16',
    title: 'App móvil Pickler — Wallet real (withdraw + movements) e iconos',
    summary: 'Tab bar con iconos, logo del header rehecho, withdraw real de AUSD (destino, monto, review, firma, recibo) y movimientos reales vía MonadScan; ningún backend, ningún cambio nativo.',
    file: '2026-09-16-mobile-wallet.html',
    types: ['spec', 'plan'],
    status: 'completed',
    tags: ['mobile', 'wallet', 'expo', 'monad', 'ausd'],
    phases: [{ num: 1, status: 'completed' }],
  },
  {
    date: '2026-09-16',
    title: 'App móvil Pickler — Port de la UI de pickler-mobile',
    summary: 'Se reemplaza la app de dos pantallas (Welcome, Home) por las 13 pantallas del prototipo pickler-mobile, portadas a TypeScript dentro de apps/mobile/src.',
    file: '2026-09-16-mobile-ui-port.html',
    types: ['spec', 'plan'],
    status: 'completed',
    tags: ['mobile', 'expo', 'ui', 'mera', 'passkey'],
    phases: [{ num: 1, status: 'completed' }],
  },
  {
    date: '2026-09-15',
    title: 'App móvil Pickler — Fase 1: passkey + tesorería AUSD',
    summary: 'Login con passkey vía Mera, cuenta EVM derivada en el dispositivo, balances de AUSD/MON en Monad Testnet y tx al faucet de Agora; construida en React Native / Expo (no Swift) y subida a TestFlight.',
    file: '2026-09-15-mobile-fase1.html',
    types: ['spec', 'plan'],
    status: 'completed',
    tags: ['mobile', 'expo', 'mera', 'passkey', 'ausd'],
    phases: [{ num: 1, status: 'completed' }],
  },
];

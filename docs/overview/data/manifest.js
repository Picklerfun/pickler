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

// Catálogo de proyectos y devs del dashboard de Pickler.
//
// Este archivo es la fuente de verdad de qué entries aparecen en el index.
// Está separado del HTML para que cada cambio de status toque solo este
// archivo (diffs limpios en git, ver F1 del HTML Maximalism roadmap).
//
// Formato de cada entry:
//   {
//     date: 'YYYY-MM-DD',
//     title: '...',
//     summary: '...',
//     file: 'YYYY-MM-DD-<topic>.html' | 'dev/YYYY-MM-DD-<slug>.html',
//     types: ['spec'] | ['plan'] | ['spec','plan'] | ['fix'] | ['feature'] | ['refactor']
//          | ['exploration'] | ['pr'] | ['playground'] | ['report'],   ← F4 nuevos
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
  // ← Las entradas nuevas se pegan aquí.
];

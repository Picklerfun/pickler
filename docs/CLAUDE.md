# docs/ — Convenciones para specs, plans y dashboards de proyecto

La documentación es parte del entregable. Antes de crear o cambiar un artefacto,
leer la sección correspondiente de [convenciones detalladas](agent-reference.md).

- Un proyecto tiene un spec de decisiones, planes por fase y **un solo overview vivo**
  en `docs/overview/`. Nombrar `YYYY-MM-DD-<topic>`; no hacer un dashboard por fase.
- Spec/plan Markdown es la fuente: generar su HTML vecino con
  `node scripts/docs-md-to-html.mjs <archivo.md>` (todos: `npm run docs:html`;
  verificar: `npm run docs:check`). No editar HTML generado a mano.
- Overview se edita en su estructura existente, usando `_project-template.html`,
  `_styles.css`, paleta Pickler (dark por defecto) y componentes canónicos; no
  regenerarlo como si fuera un spec.
- Mantener `data-phase`, `data-status`, phase-card, status board, progreso, tasks y
  `data/manifest.js` sincronizados. `completed` exige evidencia; no cerrar follow-ups
  pendientes ni confundir cancelación con implementación.
- Manifest es el registro; el index consume `window.DOCS`. Una entrada por spec real;
  nunca borrar entradas ni inventar fases sin brainstorm.
- Cada fase ejecutada deja audit con rulings, correcciones, evidencia y residuales.
  No commitear sin petición, aunque una guía antigua diga «commitear el audit».
- Dev tracker para un cambio de un PR o un build de TestFlight:
  `.agents/skills/pickler-dev-new/`; proyectos multifase:
  `.agents/skills/pickler-overview-new/`. Retomar contexto: `pickler-retomar`.
- Abrir y mirar el HTML renderizado, incluyendo móvil, antes de afirmar calidad visual.
  Los scripts de estado no pueden sustituir esa comprobación.

## Lectura por tarea

[Referencia detallada](agent-reference.md), organizada así (buscar el encabezado, leer
solo la sección necesaria y sus dependencias):

- Estructura
- Tres artefactos por proyecto, tres roles distintos
- Reglas obligatorias
- 1. Un proyecto = un HTML overview
- 2. Cada fase escrita debe reflejarse en el HTML
- 3. Cada fase implementada debe reflejarse en el HTML
- 4. Entrada en el manifest
- 5. Un audit por fase ejecutada
- 6. Reglas del HTML
- Naming convention
- Spec → plan → ejecución
- Dev tracker — fixes y features chiquitos también van al index
- Cuándo usar el modo "dev"
- Estructura del HTML "dev" (one-pager)
- Entry en manifest para modo "dev"
- Cuándo NO hacer dev tracker
- Research — expedientes de investigación
- Anti-patterns
- Estructura
- Sincronización spec ↔ HTML
- Estilo y seguridad
- AGENTS.md

Actualiza la referencia al cambiar el contrato. No vuelvas a pegar historiales o
procedimientos extensos en este punto de entrada; `npm run agents:check` mide la cadena.

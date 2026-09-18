> Referencia detallada adoptada el 2026-09-18. Las mediciones y estados fechados son
> históricos: revalidar contra código/configuración antes de actuar. El contrato activo
> y el índice de lectura están en `CLAUDE.md`; no importar esta referencia automáticamente.

# docs/ — Convenciones para specs, plans y dashboards de proyecto

Este archivo manda en todo lo que vive bajo `docs/`. Si choca con el root `CLAUDE.md`, este gana para temas de documentación; el root manda para todo lo demás (app, tooling, bounty).

El sistema está inspirado en ["The Unreasonable Effectiveness of HTML"](https://x.com/trq212/status/2052809885763747935) (Thariq Shihipar, Anthropic, 2026-05-17). El CSS compartido, el conversor MD→HTML y los sub-catálogos se adoptaron completos de Proflores el 2026-09-18 (spec `docs/superpowers/specs/2026-09-18-docs-manifest-design.md`).

## Estructura

```
docs/
  00-historia.md … 04-roadmap-bounty.md   ← documentos de producto (vista humana; el roadmap enlaza a los overviews)
  superpowers/
    specs/                  YYYY-MM-DD-<topic>-design.md         ← spec del proyecto
    specs/                  YYYY-MM-DD-<topic>-design.html       ← AUTOGENERADO — no editar
    plans/                  YYYY-MM-DD-<topic>-{f0,f1,...}.md    ← plan ejecutable por fase
    plans/                  YYYY-MM-DD-<topic>-{f0,f1,...}.html  ← AUTOGENERADO — no editar
    audits/                 YYYY-MM-DD-<topic>-f<N>-rulings.md   ← un audit por fase ejecutada
  investigacion/
    <topic>.md              ← expediente de investigación (venue, protocolo, mercado)
  fuentes/                  ← texto primario (documentos fundacionales, extraídos a texto plano)
  overview/
    _styles.css             ← paleta + componentes compartidos (fuente única de tokens)
    _syntax.js              ← highlighter standalone language-{ts,sql,json}
    _project-template.html  ← plantilla canónica para project overviews (clona y rellena)
    index.html              ← catálogo navegable + form "+ Nueva entrada" (atajo `n`)
    YYYY-MM-DD-<topic>.html ← project overview interactivo (UNO por proyecto)
    data/
      manifest.js           ← window.DOCS = [...]  (source de entries del catálogo)
    dev/
      _template.html        ← plantilla one-pager editable (contenteditable + Descargar HTML)
      YYYY-MM-DD-<slug>.html
    explorations/           ← grid de 4 enfoques side-by-side antes de decidir
    prs/                    ← HTML explainer por PR con diff annotated
    playgrounds/            ← sliders/knobs interactivos → JSON live → Copy as JSON
    reports/                ← snapshots fechados (actividad, builds, incidentes)
    assets/<slug>/          ← screenshots y mockups por slug
scripts/
  docs-md-to-html.mjs       ← regenera HTML autogenerado de specs/plans (`npm run docs:html` / `docs:check`)
  lib/md-parser.mjs         ← parser MD standalone sin deps
  agent-infra/              ← check.mjs (`npm run agents:check`), branches.mjs (`agents:inventory`), render-check.mjs
  test-lock.sh              ← lock global de tests (`npm run agents:test`)
.agents/skills/
  pickler-overview-new/     ← crea nuevo project overview
  pickler-dev-new/          ← crea dev one-pager
  pickler-retomar/          ← retoma contexto: manifest, git, audits, deadline, build, cuentas
```

Las skills viven en `.agents/skills/` y se descubren por symlink desde `.claude/skills/`; editar sólo la fuente en `.agents/`.

## Tres artefactos por proyecto, tres roles distintos

| Artefacto | Vive en | Rol |
|---|---|---|
| **Spec** (`.md`) | `docs/superpowers/specs/` | Visión, decisiones, modelo, fuera de scope, roadmap por fases. Inmutable después de aprobado (excepto correcciones de errores). El humano lo lee a través del HTML autogenerado al lado. |
| **Plan** (`.md`) | `docs/superpowers/plans/` | UN archivo por fase. Tasks TDD bite-sized (2-5 min cada step), con código completo y comandos exactos. Spec dice **qué**; plan dice **cómo**. HTML autogenerado al lado con checkboxes interactivos. |
| **HTML overview** | `docs/overview/` | **UNO solo por proyecto** (no uno por plan). Dashboard vivo: status board + roadmap + decisiones + glosario. Se actualiza cuando avanzan las fases. **Escrito a mano** (no autogenerado). |
| **Audit** (`.md`) | `docs/superpowers/audits/` | UNO por fase ejecutada. Lo que se decidió **sin el humano**, las correcciones a afirmaciones previas, la evidencia que costó trabajo, los residuales abiertos y el rollback. Es lo único que responde "¿por qué está así?" dentro de seis meses. |

## Reglas obligatorias

### 1. Un proyecto = un HTML overview

Cuando arranque un proyecto nuevo, lo más rápido es invocar la skill **`pickler-overview-new`** (pide "crea overview para X" y ella hace todo). Manualmente:

1. Crear `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md`.
2. Clonar `docs/overview/_project-template.html` → `docs/overview/YYYY-MM-DD-<topic>.html`, cambiar `<body data-slug="...">` y rellenar placeholders `[[…]]`.
3. Abrir `docs/overview/index.html`, presionar `n` (o click "+ Nueva entrada"), llenar el form y copiar el JS. Pegarlo al array de `docs/overview/data/manifest.js`.

Si el proyecto tiene varias fases (F0, F1, F2…), **no creas un HTML nuevo por fase**. Editas el existente.

**Interactividad heredada del template**:
- Cada `.phase-card` tiene un dropdown de status (`pending` / `plan_ready` / `in_progress` / `completed`) que muta `data-status` y actualiza el status board + barra de progreso en vivo.
- Cada task dentro de `<details>` es un checkbox persistido en `localStorage` con key `pickler-docs:<slug>:state`.
- Botones "Copy progress as MD" y "Copy HTML diff for Claude" exportan el delta vs el snapshot inicial — pegar al chat para que Claude aplique al HTML committed.
- Botón "Reset local changes" borra solo el key de ese slug.

### 2. Cada fase escrita debe reflejarse en el HTML

Cuando escribas `plan-fN.md`:
1. Cambia la `.phase-card` correspondiente de `data-status="pending"` → `data-status="plan_ready"` (y selecciona el mismo valor en el dropdown).
2. Actualiza el status board: `Planes escritos N/total`.
3. Mueve el segmento del progressbar a `data-status="plan_ready"`.
4. **Agrega un `<details class="tasks">` colapsable dentro de la `.phase-body` con la lista de tasks del plan**. Esta regla aplica a TODAS las fases, no solo a F0. Cada `<li>` envuelve un `<label><input type="checkbox"> …</label>` con texto conciso (1-2 líneas) que referencia el componente/servicio/pantalla principal y opcionalmente el commit SHA si ya está implementado.

### 3. Cada fase implementada debe reflejarse en el HTML

Cuando completes la implementación de una fase:
1. Cambia la `.phase-card` de `data-status="plan_ready"` → `data-status="completed"` (y el dropdown).
2. Actualiza el status board: `Implementación N/total`.
3. Mueve el segmento del progressbar a `data-status="completed"`.
4. Marca los items del `<details>` de tasks (`<input type="checkbox" checked>`).
5. Si hay follow-ups conocidos (issues importantes no-blockers), agrega un segundo `<details class="followups">` debajo. Mantén la doc sincronizada con la realidad — no escondas tech debt.

`completed` exige evidencia (comando corrido, build probado, captura mirada). No cierres follow-ups pendientes ni confundas una fase cancelada con una implementada.

### 4. Entrada en el manifest

`docs/overview/data/manifest.js` tiene `window.DOCS = [...]` que el index carga via `<script src>`. Cada entrada:

```js
{
  date: 'YYYY-MM-DD',
  title: '...',
  summary: '...',
  file: 'YYYY-MM-DD-<topic>.html',
  types: ['spec'] | ['plan'] | ['spec','plan']
       | ['fix'] | ['feature'] | ['refactor']
       | ['exploration'] | ['pr'] | ['playground'] | ['report'],
  status: 'active' | 'completed' | 'paused' | 'cancelled'
        | 'pending' | 'in_progress' | 'shipped',
  tags: [...],
  phases: [{ num: 0, status: 'completed' }, { num: 1, status: 'plan_ready' }, ...],
}
```

- **Una entrada por proyecto** (no por doc). `types`, `phases` y `status` describen artefactos realmente escritos: no se inventan fases futuras "para verlas en el dashboard".
- Cuando una fase avance, actualiza solo el `status` de ese item en `phases` y, si el proyecto cierra, el `status` global. **No borres entradas** al completar — el índice es histórico.
- El index muestra una mini-barra de progreso automática si el `phases` array está presente.
- El index **construye DOM con `createElement`** — nunca `innerHTML` con contenido dinámico (XSS).
- `npm run agents:check` compara `phases` del manifest contra los `data-status` del HTML y falla si difieren.

### 5. Un audit por fase ejecutada

Cuando cierres una fase que se ejecutó con subagentes, escribe
`docs/superpowers/audits/YYYY-MM-DD-<topic>-f<N>-rulings.md` y déjalo listo para que Jesús pida el commit.

**Por qué es obligatorio y no opcional:** el ledger de la corrida vive en `.superpowers/`, que
está **git-ignored**. Todo lo que el controller decidió sin preguntar, la evidencia que costó
dos corridas reunir y los hallazgos aparcados **se pierden al borrar el worktree**.

Qué lleva, en este orden:

1. **Rulings** — tabla de decisiones tomadas sin el humano, cada una con *qué cuesta si está
   mal*. Sin el costo, un ruling no es auditable.
2. **Correcciones** a lo que el propio proceso afirmó y resultó falso, diciendo quién lo
   detectó. Un spec que se contradice a sí mismo en silencio es peor que uno incompleto.
3. **Evidencia cara** que no debe re-derivarse (pruebas de que una falla es preexistente,
   mediciones contra testnet, cuentas y estados que no viven en git).
4. **Residuales abiertos**, ordenados por cuál pesa más.
5. **Rollback**, si la fase escribió en un entorno compartido (TestFlight, contratos, cuentas).

El commit message no alcanza para esto: explica *qué* cambió, no *qué se descartó y por qué*.

Los cuatro handoffs anteriores a este sistema (`docs/05` a `docs/08`) se conservan tal cual como audits de fase 1 de cada sub-proyecto; el formato de arriba aplica a los audits nuevos.

### 6. Reglas del HTML

- **Standalone**: cero deps externas, abre con `file://` offline. (Google Fonts via `@import` / `<link>` es progressive enhancement; el HTML debe ser legible sin red.)
- **Paleta canónica** (marca Pickler, **dark por defecto**; tokens en `docs/overview/_styles.css`, fuente única — no los dupliques localmente):
  - Brand: lima `#C8F03A`, soft `rgba(200,240,58,.14)`, dark `#E2F98A`.
  - Accent (in-progress / violeta): `#7A5CFF`, soft `rgba(122,92,255,.18)`.
  - Status semantics: pass `#7BE38A` (completed), warn `#F5C35B` (plan_ready), fail `#F2777A`, info `#5AD8FF`, pending neutro `#8C8C88` (`--ink-3`).
  - Canvas dark `#08080A` (por defecto), light `#F7F7F4` bajo `prefers-color-scheme: light` (el esquema claro ajusta brand/accent a tonos legibles sobre blanco; ya está en `_styles.css`).
  - Tipografías: `Manrope` (UI) y `JetBrains Mono` (code, fechas, paths).
- **Carga compartida**: HTMLs nuevos incluyen `<link rel="stylesheet" href="_styles.css">` y `<script defer src="_syntax.js"></script>` (`../` desde subcarpetas) y solo agregan `<style>` local para componentes únicos. Snippets con `<pre><code class="language-ts|sql|json">` se highlightan solos.
- **SVG inline** para diagramas: no uses CSS vars dentro del `<svg>` (no se evalúan via `file://`); hardcodea los hex del dark mode (`#C8F03A`, `#7A5CFF`, `#8C8C88`, `#0F0F13`).
- **Print-friendly**.
- **Estructura del HTML** (en este orden):
  1. **Hero** con breadcrumb a `index.html`, eyebrow, título, lede.
  2. **Status board prominente** justo después del hero (estado global, spec ✅/⬜, planes escritos `N/total`, implementación `N/total`, próximo paso, barra de progreso segmentada por fase + leyenda).
  3. **TOC sticky**.
  4. **TL;DR** en card brand.
  5. **Roadmap** como sección principal (sección 2). Una `.phase-card` por fase con `data-status="…"`, descripción, entregable, prerequisitos, y `<details class="tasks">` con tasks si tiene plan escrito. Encima del roadmap, bloque `.roadmap-actions` con los 3 botones (Copy MD / Copy diff / Reset).
  6. Resto del spec en secciones cortas (decisiones, modelo, pantallas, contratos, etc.).
  7. **Glosario** al final (sólo si el spec lo tiene).
  8. **Footer** con paths a `.md` fuente (spec, plan, audit) y nota de "dashboard vivo".
- **Mirar el render** (desktop y 390 px) antes de afirmar calidad visual; `node scripts/agent-infra/render-check.mjs <scratch>` captura con el Chrome local, pero la captura hay que abrirla.

## Naming convention

| Archivo | Formato |
|---|---|
| Spec | `YYYY-MM-DD-<topic>-design.md` (+ `.html` autogenerado al lado) |
| Plan | `YYYY-MM-DD-<topic>-f<N>.md` (uno por fase) o `YYYY-MM-DD-<topic>.md` si es proyecto sin fases (+ `.html` autogenerado al lado) |
| Audit | `YYYY-MM-DD-<topic>-f<N>-rulings.md` (fecha del cierre de la fase; `<topic>` = slug del spec) |
| HTML overview | `YYYY-MM-DD-<topic>.html` (el del proyecto, **no** por fase) |
| HTML dev | `dev/YYYY-MM-DD-<slug>.html` |
| Exploration | `explorations/YYYY-MM-DD-<slug>.html` |
| PR explainer | `prs/<n>-<slug>.html` (con `<n>` = número del PR) |
| Playground | `playgrounds/YYYY-MM-DD-<slug>.html` |
| Report | `reports/YYYY-MM-DD-<slug>.html` |
| Investigación | `investigacion/<topic>.md` (sin fecha — expediente vivo, con fuentes en `fuentes/`) |

La fecha es la del primer escrito del artefacto. No la cambias después; refleja el día que arrancó. Ejemplo: el spec `2026-09-16-mobile-perpl-design.md` tiene plan `2026-09-16-mobile-perpl.md`, overview `2026-09-16-mobile-perpl.html` y audit `…-mobile-perpl-f1-rulings.md`.

Para explorations / PRs / playgrounds / reports no hay skill: clona `docs/overview/<carpeta>/_template.html`, usa `body data-slug="…"` para que las llaves de `localStorage` sean per-artefacto y agrega la entrada al manifest con su `types`. Un report **no se actualiza** después de publicado; para info fresca escribes otro.

## Spec → plan → ejecución

El flujo canónico con `superpowers`:

1. `superpowers:brainstorming` → ronda de aclaraciones, presenta diseño, escribe spec en `docs/superpowers/specs/`, crea HTML overview en `docs/overview/` (clonado del `_project-template.html` — o usa la skill `pickler-overview-new` que lo hace en un paso). **Parar** y esperar aprobación de Jesús.
2. `superpowers:writing-plans` → escribe el plan de **una** fase en `docs/superpowers/plans/`. Cada vez que se escribe un plan, **se actualiza** el HTML overview agregando el `<details class="tasks">` a la `.phase-card` correspondiente y subiendo el status a `plan_ready`. El HTML autogenerado del plan aparece al lado del `.md` (`npm run docs:html`). **Parar.**
3. `superpowers:subagent-driven-development` (o `executing-plans`) → ejecuta el plan task por task. Al terminar la fase, **se actualiza** el HTML overview marcando la fase como `completed` y los items del `<details>` con checkbox checked.
4. **Audit de la fase** → `docs/superpowers/audits/` con los rulings y los residuales (regla 5). Es el paso que más se olvida y el único que no se puede reconstruir después. Checkpoint antes de la siguiente fase.

Cierre de cada etapa: `npm run agents:check` (manifest ↔ HTML ↔ symlinks ↔ enlaces) y `npm run docs:check` (HTML autogenerado al día) en verde, con la salida pegada como evidencia.

## Dev tracker — fixes y features chiquitos también van al index

La regla anterior (spec + plan + HTML) aplica a **proyectos** (algo con múltiples fases, decisiones que sobreviven más allá del PR, cambios de contrato). Para todo lo demás — **bug fixes, mejoras puntuales de UI, features single-PR, builds de TestFlight** — **igual queda registro visual**, pero más liviano:

### Cuándo usar el modo "dev"

| Modo | Cuándo | Artefactos |
|---|---|---|
| **Proyecto** (`spec + plan + overview`) | Multi-fase, decisiones que afectan más de un módulo, cualquier cosa que tome >1 día | `specs/.md` + `plans/*-fN.md` + `overview/YYYY-MM-DD-<topic>.html` + entry en `manifest.js` con `types: ['spec','plan']` |
| **Dev** (`overview/dev/` liviano) | Fix de bug, mejora visual, feature de un solo PR, refactor acotado, lista de un build de TestFlight | UN HTML one-pager en `overview/dev/YYYY-MM-DD-<slug>.html` + entry en `manifest.js` con `types: ['fix'] \| ['feature'] \| ['refactor']` |

### Estructura del HTML "dev" (one-pager)

Misma paleta y reglas del overview (standalone, marca Pickler dark por defecto, esquema claro, print-friendly). Pero más corto — apunta a `~150-300 líneas`. Estructura mínima:

1. **Hero** con breadcrumb a `../index.html`, eyebrow (`Fix` / `Feature` / `Refactor`), título, lede de 1-2 líneas.
2. **Status board chico** (estado: `pending` / `in_progress` / `shipped`, fecha del PR o del build si aplica, link al PR).
3. **Qué cambió** — bullets concisos de los cambios funcionales (lo que un usuario nota).
4. **Por qué** — 1-2 párrafos del problema o motivación.
5. **Archivos tocados** — lista con paths relativos al repo (sin enlaces, son referencia).
6. **Follow-ups** (opcional) — `<details class="followups">` si quedan known issues no-blockers.
7. **Footer** con commit SHA / PR # / número de build cuando exista.

Plantilla canónica: **`docs/overview/dev/_template.html`** (editable con `contenteditable` + botón "⬇ Descargar HTML"). Skill `pickler-dev-new` automatiza el flow.

### Entry en manifest para modo "dev"

```js
{
  date: 'YYYY-MM-DD',
  title: 'Fix: Reconnect trading tras Sign out no repite el depósito',
  summary: '...',
  file: 'dev/YYYY-MM-DD-<slug>.html',  // ← path relativo desde index.html
  types: ['fix'],                       // o ['feature'] / ['refactor']
  status: 'shipped',                    // 'pending' / 'in_progress' / 'shipped'
  tags: ['mobile', 'perpl'],
  // omite `phases` — los devs no tienen fases
}
```

El index renderiza los tipos `fix` / `feature` / `refactor` con su propio chip de color (brand para `feature`, warn para `fix`, info para `refactor`).

### Cuándo NO hacer dev tracker

- Typos en docs, renombrar variables internas, ajustar logs. Si la diff es <20 líneas y no afecta nada visible, no necesita HTML.
- Commits de "wip" o "limpia tests". El registro vive en git log, no en docs/.

La meta es: **abriendo `index.html` se ve qué se ha estado moviendo en el dashboard**, no solo proyectos grandes.

## Research — expedientes de investigación

No todo lo que vive en `docs/` es código. Venues, protocolos, contratos de terceros y mercado
van a `docs/investigacion/<topic>.md` (hoy: `polymarket.md`, `perpl.md`), con la misma
disciplina que un spec:

| Archivo | Rol |
|---|---|
| `investigacion/<topic>.md` | El expediente: hallazgos, fundamentos **con cita textual**, decisiones, preguntas abiertas y siguiente paso. |
| `fuentes/` | El **texto primario** (documento original y `.txt` extraído grepeable). |

Reglas:

- **Cita el texto primario, no el resumen.** Un resumen de segunda mano se salta la oración que
  cambia la decisión (límites de apalancamiento, condiciones de liquidación, fees). Un
  expediente que se va a usar para diseñar una pantalla o un contrato no puede citar de oídas.
- **Guarda la fuente offline.** Re-derivarla cuesta una sesión y una API de testnet no siempre
  está disponible. `fuentes/` es el activo; el expediente es la lectura.
- **Marca las correcciones dentro del expediente.** Lo que se daba por bueno y resultó falso
  vale más que lo que se confirmó — es lo que evita repetir el error.
- **Separa lo verificado de lo que se va a preguntar.** Si la fuente no lo resuelve, va como
  pregunta abierta, no como afirmación.
- Un expediente suelto **no crea entrada en el manifest**: entra al catálogo cuando se convierte
  en spec (una entrada por spec). Sí enlázalo desde el spec que lo usa.

## Anti-patterns

Aprendidos al construir el sistema. Consolidados aquí — si reconoces que estás a punto de hacer uno, replantea.

### Estructura

- ❌ Un HTML por fase. (Es UNO por proyecto.)
- ❌ Borrar entradas del catálogo `window.DOCS` cuando se completa o cancela un proyecto. (Actualiza `status`, no borres.)
- ❌ Embeber el array `DOCS` dentro del HTML del index. Vive separado en `data/manifest.js` para que los diffs de status sean de 1 línea.
- ❌ Hacer un fix o feature visible sin entry en `manifest.js`. La regla aplica también al modo dev.
- ❌ Inventar entradas o fases para sub-proyectos que todavía no tienen brainstorm ni spec.

### Sincronización spec ↔ HTML

- ❌ Escribir un plan sin actualizar el HTML overview con su `<details class="tasks">`.
- ❌ Cerrar una fase ejecutada por subagentes sin su audit. El ledger es git-ignored: lo que no se commitea, se borra con el worktree.
- ❌ Completar una fase sin marcar los checkboxes del `<details>` y bajar la fase a `data-status="completed"`.
- ❌ Specs y planes desincronizados con la realidad del código. Si la implementación se desvió, actualiza el plan/spec o agrega una nota; no dejes la doc en estado fantasma.
- ❌ Editar el HTML autogenerado en `docs/superpowers/{specs,plans}/*.html`. El próximo Write al `.md` lo sobrescribe — siempre edita el `.md` y regenera con `npm run docs:html`.

### Estilo y seguridad

- ❌ `innerHTML` con contenido dinámico en cualquier HTML interactivo. (Usa `createElement` / `textContent`.)
- ❌ HTML que dependa de CDN o assets externos para funcionar. (Las Google Fonts son progressive enhancement; el HTML debe ser legible sin red.)
- ❌ Reescribir un overview existente desde el template canónico. La migración a HTML interactivo es **in-place** — preservas el contenido textual, solo agregas `data-status`, dropdowns, checkboxes y los 3 botones.
- ❌ Cambiar la paleta (lima `#C8F03A` + violeta `#7A5CFF`, dark por defecto) o volver light-first. Es la identidad de Pickler en la app y la landing.
- ❌ Duplicar tokens CSS localmente cuando deberían ir en `_styles.css`.
- ❌ Usar CSS vars dentro de `<svg>` inline (no se evalúan con `file://` — hardcodea los hex del dark mode).

## AGENTS.md

`docs/AGENTS.md` es un **symlink** a `docs/CLAUDE.md` (para herramientas que leen ese nombre en vez de `CLAUDE.md`). Edita solo `docs/CLAUDE.md`; `npm run agents:check` valida el symlink y mide la cadena de instrucciones (≤ 24 KiB).

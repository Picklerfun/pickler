# Sistema docs/manifest · F3 Skills — plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dejar operables las tres skills del modelo (`pickler-retomar`, `pickler-overview-new`, `pickler-dev-new`) con symlinks, casos de routing y los residuales de template/referencia que F2 dejó, y probar `pickler-retomar` en una sesión limpia.

**Architecture:** Las skills se adaptan de las de Proflores (`~/Documents/Proflores/proflores-monorepo/.agents/skills/proflores-*`) conservando estructura, comandos y anti-patterns; cambian rutas, marca, npm, y lo específico de Pickler (una fase por plan, deadline del bounty, estado del build de TestFlight, cuentas de testnet). Antes de las skills se cierran los residuales de F2 en template/CSS/referencia para que las skills describan lo que existe. `check.mjs` valida frontmatter, `name` = directorio, ≤ 16 KB, enlaces y symlinks.

**Tech Stack:** Markdown (SKILL.md con frontmatter YAML), symlinks relativos, `npm run agents:check`, `render-check.mjs`.

**Spec:** `docs/superpowers/specs/2026-09-18-docs-manifest-design.md` (§5 Skills, D9). Residuales: `docs/superpowers/audits/2026-09-18-docs-manifest-f2-rulings.md` §Residuales 1–2; riesgos F3 en `…-f1-rulings.md`.

## Global Constraints

- Worktree `.claude/worktrees/docs-manifest`, rama `chore/docs-manifest`. Commits por nombre por el coordinador; subagentes no commitean. Sin push.
- Skills en `.agents/skills/pickler-<name>/SKILL.md`; symlink `.claude/skills/pickler-<name>` → `../../.agents/skills/pickler-<name>`. Frontmatter: `name` igual al directorio, `description` entre comillas si contiene `:`; ≤ 16 000 bytes; enlaces Markdown relativos resolubles (rutas del repo como código inline, no como enlace).
- Origen (sólo lectura): `ORIGEN=/Users/josedejesusacevedoflores/Documents/Proflores/proflores-monorepo/.agents/skills/proflores-{retomar,overview-new,dev-new}/SKILL.md`. Español. `pnpm` → `npm run`. Sin nombres de proyectos de Proflores.
- Reglas que las skills deben codificar (del audit de F2): `<title>` = h1 completo + " · Pickler"; overviews con `data-slug` sin fecha, dev con fecha; una `phase-card` por plan ejecutado, `data-phase` numérico y coincidente con el manifest; contar `<article class="phase-card"`, no cadenas; bloque "Rulings en ejecución" en Decisiones; sección "Validación" en dev; "Próximo paso" es runtime salvo `data-done`; manifest más reciente primero; render con `render-check.mjs` y **mirar** la captura; no inventar fases/assets; `shipped`/`completed` exigen evidencia.
- No tocar `apps/mobile`, `scripts/agent-infra/*.mjs` ni `scripts/docs-md-to-html.mjs`.

---

### Task 1: Residuales de template, CSS, referencia y overviews

**Files:**
- Modify: `docs/overview/_styles.css` (añadir 2 reglas al final, antes del bloque `@media print` si existe), `docs/overview/_project-template.html`, `docs/overview/dev/_template.html`, `docs/agent-reference.md`, los 4 overviews (`docs/overview/2026-09-1*-mobile-*.html`)

- [ ] **Step 1: `_styles.css`** — añadir al final de la sección de tablas de decisiones (buscar `table.decisions`):

```css
/* Identificadores largos en decisiones no deben desbordar a 390 px */
table.decisions { table-layout: fixed; }
table.decisions td, table.decisions th { overflow-wrap: anywhere; word-break: break-word; }
/* Subtítulo dentro de una sección (p. ej. "Rulings en ejecución") */
.section-sub { font-size: 14px; font-weight: 700; margin: 20px 0 8px; color: var(--ink); }
.section-sub + ol, .section-sub + ul { font-size: 13.5px; color: var(--ink-2); line-height: 1.6; padding-left: 20px; margin: 0; }
```

- [ ] **Step 2: `_project-template.html`**
- En la sección `#decisions`, después de la tabla de decisiones, añadir:

```html
      <h3 class="section-sub">Rulings en ejecución</h3>
      <ol>
        <li>[[RULING_1]]</li>
        <li>[[RULING_2]]</li>
      </ol>
```

- En el script del status board, la línea `$next.textContent = nextPhase ? \`F${nextPhase.num}: ${nextPhase.title}\` : '— todo completo';` pasa a `$next.textContent = nextPhase ? \`F${nextPhase.num}: ${nextPhase.title}\` : ($next.dataset.done || '— todo completo');` y el `<div class="v" data-sb="next">` del template gana `data-done="[[DONE_TEXT]]"` con comentario `<!-- data-done: texto cuando todas las fases están completed; el script lo usa en vez de "— todo completo" -->`.
- En el comentario de cabecera: "`<title>` = texto completo del h1 (principal + acento) + ' · Pickler'".

- [ ] **Step 3: `dev/_template.html`** — `<body>` → `<body data-slug="[[SLUG]]">` (con fecha: `YYYY-MM-DD-<slug>`); después de la sección "Archivos tocados" añadir:

```html
    <section>
      <h2>Validación</h2>
      <p contenteditable="true" data-placeholder="Tests, build, TestFlight, prueba manual — con cifras y fuente (audit, commit).">Tests, build, TestFlight, prueba manual — con cifras y fuente (audit, commit).</p>
    </section>
```

- [ ] **Step 4: Los 4 overviews** — sustituir `<h3 style="font-size:14px;font-weight:700;margin:20px 0 8px;color:var(--ink)">` por `<h3 class="section-sub">`; quitar `style="…"` de `<ol>`/`<ul>` que sigan a ese h3 y de `<table class="decisions">` (wallet, perpl); aplicar el cambio del script (`$next.dataset.done`) en la copia inline de cada overview y poner `data-done="Cerrado el 2026-09-16 — siguiente en docs/04-roadmap-bounty.md"` en su `[data-sb="next"]` (el texto estático interior puede quedar igual).

- [ ] **Step 5: `docs/agent-reference.md`** — en "Estructura del HTML dev": añadir "6. **Validación** — tests, build, TestFlight, prueba manual, con cifras y fuente" y renumerar; en "6. Reglas del HTML" añadir: `<title>` = h1 completo + " · Pickler"; `data-done` en `[data-sb="next"]`; contar `<article class="phase-card"` (el script del template contiene la cadena); `.section-sub` para subtítulos; en "4. Entrada en el manifest": "más reciente primero"; en "Naming": `data-slug` sin fecha en overviews, con fecha en dev. Mantener ≤ 24 KB.

- [ ] **Step 6: Verificar**
Run: `grep -rn 'style="' docs/overview/2026-09-1*-mobile-*.html | grep -v "font-family:var(--mono)\|width:" | wc -l` → 0 (o sólo estilos del template original; listar). `npm run agents:check` → exit 0. `node scripts/agent-infra/render-check.mjs <scratch>/render` (todo) → exit 0, `overflow:false` en 14, y `board` de cada overview con `next` = "Cerrado el 2026-09-16 — siguiente en docs/04-roadmap-bounty.md". Mirar wallet-390 y perpl-390 (tablas sin desbordar). `diff` de `_styles.css` contra el origen desde "Reset & base": sólo `--on-brand` (F1) y estas reglas nuevas.

- [ ] **Step 7: Commit**

```bash
git add docs/overview/_styles.css docs/overview/_project-template.html docs/overview/dev/_template.html docs/agent-reference.md docs/overview/2026-09-15-mobile-fase1.html docs/overview/2026-09-16-mobile-ui-port.html docs/overview/2026-09-16-mobile-wallet.html docs/overview/2026-09-16-mobile-perpl.html
git commit -m "feat(docs): reglas compartidas (decisions, section-sub), data-done, bloque Rulings y Validación en templates"
```

---

### Task 2: `pickler-overview-new`

**Files:**
- Create: `.agents/skills/pickler-overview-new/SKILL.md`
- Read: `$ORIGEN/proflores-overview-new/SKILL.md`, `docs/agent-reference.md` (Reglas 1–6, Naming), `docs/overview/_project-template.html` (placeholders), `docs/overview/2026-09-16-mobile-perpl.html` (ejemplo real), `docs/overview/data/manifest.js`

- [ ] **Step 1: Frontmatter** — `name: pickler-overview-new`; `description` en inglés como el original, con triggers "nuevo overview", "crea overview para X", "abre dashboard para X", "necesito un overview de Y", y "Clones _project-template.html, fills placeholders from the approved spec, adds manifest entry, renders and looks at it".
- [ ] **Step 2: Cuerpo** — adaptar el original: rutas `docs/superpowers/{specs,plans}`; `node scripts/docs-md-to-html.mjs <spec>` tras crear el spec stub; **una `phase-card` por plan** (si el proyecto tiene un solo plan, F1; si el brainstorm definió fases, una card por fase en `pending`); placeholders nuevos (`[[RULING_*]]`, `[[DONE_TEXT]]`: vacío hasta que cierre); `<title>` = h1 completo; `data-slug` sin fecha; sección Modelo/Glosario sólo con contenido real (ejemplo: los 4 overviews de F2 las recortaron); tags en minúsculas; entrada del manifest **al principio** del array; validación final con `npm run agents:check` y `node scripts/agent-infra/render-check.mjs <scratch> <nombre>` + **abrir la captura 390** antes de decir "listo"; "Cuándo NO usar": fix/feature/build → `pickler-dev-new`; explorations/prs/reports → clonar template a mano. Sin `proflores`, sin `pnpm`, sin `frontend-design`. ≤ 12 KB.
- [ ] **Step 3: Verificar** — `node -e "import('./scripts/agent-infra/check.mjs').then(m=>console.log(m.skillMetadata(require('fs').readFileSync('.agents/skills/pickler-overview-new/SKILL.md','utf8')).name))"` → `pickler-overview-new`; `wc -c` ≤ 12 000; `grep -in "proflores\|pnpm"` → 0.

---

### Task 3: `pickler-dev-new`

**Files:**
- Create: `.agents/skills/pickler-dev-new/SKILL.md`
- Read: `$ORIGEN/proflores-dev-new/SKILL.md`, `docs/agent-reference.md` (Dev tracker), `docs/overview/dev/_template.html`, `docs/overview/dev/2026-09-16-testflight-build3.html` (ejemplo real)

- [ ] **Step 1: Frontmatter** — `name: pickler-dev-new`; description entre comillas (contiene `:`), triggers "nuevo dev tracker", "registra este fix", "documenta este feature", "trackea este refactor", "one-pager de este cambio", **"registra el build N de TestFlight"**, "documenta el build".
- [ ] **Step 2: Cuerpo** — adaptar: tipos `fix`/`feature`/`refactor`; para builds de TestFlight: `types: ['feature']`, slug `testflight-buildN`, sección "Validación" con `.ipa`, `UPLOAD SUCCEEDED`, estado en App Store Connect y prueba en dispositivo, con fuente (audit/commit); `shipped` sólo con evidencia de merge o de build `VALID`, si no `in_progress`/`pending`; `data-slug` con fecha; "Archivos tocados" desde `git show --stat`; "Qué cambió" desde el audit/diff, nunca especulativo; entrada del manifest al principio; render + mirar. "Cuándo NO usar": multi-fase → `pickler-overview-new`; typo/wip → git log basta. ≤ 10 KB.
- [ ] **Step 3: Verificar** — igual que Task 2 Step 3.

---

### Task 4: `pickler-retomar`

**Files:**
- Create: `.agents/skills/pickler-retomar/SKILL.md`
- Read: `$ORIGEN/proflores-retomar/SKILL.md` (completo), `docs/overview/data/manifest.js`, `scripts/agent-infra/branches.mjs` (salida), `docs/superpowers/audits/2026-09-16-mobile-perpl-f1-rulings.md` §"Estado de las cuentas de testnet al cierre", `docs/04-roadmap-bounty.md` §1

- [ ] **Step 1: Frontmatter** — `name: pickler-retomar`; description en inglés con los triggers del original ("retomar", "/retomar", "¿en qué íbamos?", "dónde quedamos", "qué tengo pendiente", "sigamos con X", "continuamos") + "Reads the manifest, every git branch, the audits, the bounty deadline, the latest TestFlight tracker and the testnet accounts, and reports the COMPLETE inventory".
- [ ] **Step 2: Cuerpo** — conservar del original: los dos modos (inventario vs "sigamos con X"), "nada vive en el chat", "inventario, no resumen", el snippet `node -e` del manifest **tal cual** (funciona con `window.DOCS`; las entradas sin `phases` son dev trackers: reportarlas en su propia tabla con `status`), `node scripts/agent-infra/branches.mjs origin/main` con la lectura de `integrated_ancestry`/`patch_equivalent_review`/`unknown_review`, `gh pr list` opcional, `ls -t docs/superpowers/audits/*.md | head -5`, las dos tablas del reporte, "Cuando ya eligió" (spec → audit → overview → re-medir), anti-patterns. Quitar las anécdotas de Proflores (REPSE, Porfirio's, WhatsApp, 121 entradas) y sustituir por las de Pickler que existan (p. ej. el `3401` por reloj desfasado como ejemplo de "re-medir"; el manifest tiene 6 entradas y 4 comparables).
- [ ] **Step 3: Lo específico de Pickler** (spec §5), como sección "4b. Lo que sólo Pickler pierde entre sesiones":

```bash
# Deadline del bounty (docs/04-roadmap-bounty.md §1): 13 oct 2026 21:59 CST
node -e "const d=(new Date('2026-10-13T21:59:00-06:00')-Date.now())/864e5;console.log('Bounty: faltan '+Math.floor(d)+' días')"
# Build de TestFlight: el tracker testflight-* más reciente del manifest (no el contador del index, que cuenta pending)
node -e "global.window={};require('./docs/overview/data/manifest.js');const t=window.DOCS.filter(d=>/testflight/.test(d.file)).sort((a,b)=>b.date.localeCompare(a.date));for(const d of t)console.log(d.date,d.status.padEnd(9),d.title)"
# Cuentas de testnet: el audit más reciente con esa sección
grep -l "Estado de las cuentas" docs/superpowers/audits/*.md | sort | tail -1 | xargs -I{} sed -n '/## Estado de las cuentas/,/^## /p' {}
```

Y las reglas: el `date` del manifest es fecha de registro, no de trabajo (build 4 = 2026-09-17 por spec); `shipped` con `VALID` no prueba distribución; las cuentas del audit son "al cierre de esa sesión", no verdad viva (re-medir con RPC si va a operar); los `.md` de `docs/00–04` son producto/decisiones, no estado de ejecución.
- [ ] **Step 4: Reporte** — tabla 1 "lo que se puede perder" (git); tabla 2 proyectos con fases; tabla 3 dev trackers (`date · status · título`); línea de deadline; bloque de cuentas; residual más pesado del audit más reciente; pregunta "¿con cuál sigues?" sólo en modo inventario. ≤ 14 KB.
- [ ] **Step 5: Verificar** — frontmatter válido; `wc -c`; ejecutar los tres comandos de Step 3 en el worktree y pegar la salida en el reporte (deben imprimir días restantes, `2026-09-17 pending TestFlight build 4` / `2026-09-16 shipped TestFlight build 3`, y la sección de cuentas del audit de Perpl).

---

### Task 5: Symlinks, `behavior-cases.json`, README y check

**Files:**
- Create: `.claude/skills/pickler-retomar`, `.claude/skills/pickler-overview-new`, `.claude/skills/pickler-dev-new` (symlinks), `scripts/agent-infra/behavior-cases.json`
- Modify: `scripts/agent-infra/README.md` (una frase sobre `behavior-cases.json`), `CLAUDE.md` raíz (una línea: skills disponibles)

- [ ] **Step 1: Symlinks**

```bash
mkdir -p .claude/skills
ln -s ../../.agents/skills/pickler-retomar .claude/skills/pickler-retomar
ln -s ../../.agents/skills/pickler-overview-new .claude/skills/pickler-overview-new
ln -s ../../.agents/skills/pickler-dev-new .claude/skills/pickler-dev-new
ls -la .claude/skills/ && ls .claude/skills/pickler-retomar/SKILL.md
```

- [ ] **Step 2: `behavior-cases.json`** — mismo formato que Proflores (`prompt`, `expected`, `skill`), 8 casos:

```json
[
  {"prompt":"¿En qué íbamos?","expected":"Inventario completo: manifest (6 entradas, 4 con fases), git, audits, deadline, build, cuentas. No resumir ni filtrar.","skill":"pickler-retomar"},
  {"prompt":"Sigamos con Perpl","expected":"Cargar spec/audit/overview de mobile-perpl y continuar el alcance autorizado; no volver a preguntar qué proyecto.","skill":"pickler-retomar"},
  {"prompt":"¿Cómo va el build de TestFlight?","expected":"Leer el tracker testflight-* más reciente del manifest y el audit; no inferir distribución de VALID ni subir nada.","skill":"pickler-retomar"},
  {"prompt":"Registra el build 4","expected":"Dev tracker con types feature; status pending o in_progress hasta tener evidencia; Validación con fuente; no shipped.","skill":"pickler-dev-new"},
  {"prompt":"Documenta este fix que aún no mergeo","expected":"Tracker con diff y pruebas; sin shipped; campos conocidos completos.","skill":"pickler-dev-new"},
  {"prompt":"Crea overview para la fase 3 de agentes","expected":"Sin spec aprobado no se inventan fases: proponer brainstorming; si hay spec, una phase-card por fase pendiente y entrada al manifest.","skill":"pickler-overview-new"},
  {"prompt":"Abre dashboard para el harness","expected":"Overview desde _project-template con placeholders reales; render y mirar antes de reportar; manifest al principio del array.","skill":"pickler-overview-new"},
  {"prompt":"Ya terminé, ¿lo marco completed?","expected":"completed exige evidencia (tests, render, audit); actualizar phase-card, manifest y escribir audit; no commitear sin petición.","skill":"pickler-overview-new"}
]
```

- [ ] **Step 3: README y CLAUDE.md** — README de agent-infra: "`behavior-cases.json` registra casos semánticos de routing de las skills `pickler-*`; se revisan a mano, no son una evaluación automática." `CLAUDE.md` raíz: línea "Skills del repo: `pickler-retomar` (retomar contexto), `pickler-overview-new` (nuevo sub-proyecto), `pickler-dev-new` (fix/feature/build)" — mantener ≤ 2 KB.

- [ ] **Step 4: Check**
Run: `npm run agents:check` → exit 0, `errors: []`, `skills: 3`. Contra el defecto: romper el symlink (`ln -sfn ../../.agents/skills/nope .claude/skills/pickler-dev-new`) → `broken skill discovery link`, exit 1; restaurar → 0. `npm run agents:test` → 11/11.

- [ ] **Step 5: Commit**

```bash
git add .agents/skills .claude/skills scripts/agent-infra/behavior-cases.json scripts/agent-infra/README.md CLAUDE.md
git commit -m "feat(agents): skills pickler-retomar, pickler-overview-new y pickler-dev-new con symlinks y casos de routing"
```

---

### Task 6: Prueba de `pickler-retomar` en sesión limpia, revisión final y audit

**Files:**
- Create: `docs/superpowers/audits/2026-09-18-docs-manifest-f3-rulings.md`

- [ ] **Step 1: E2E** — despachar un subagente **sin contexto** con sólo: la ruta del worktree, "el usuario dice: ¿en qué íbamos?", y la instrucción de leer y seguir `.claude/skills/pickler-retomar/SKILL.md`. Debe entregar el reporte de la skill. Verificar en su salida: las 4 entradas con fases y las 2 dev; `chore/docs-manifest` como `unknown_review` con N commits y las `feat/*` integradas; días restantes al 13 oct; build 3 `shipped` / build 4 `pending`; cuentas `#620`/`#621`/KAT; el audit más reciente; la pregunta final. Lo que falte es un defecto de la skill → fix + repetir.
- [ ] **Step 2: Revisión final de rama (F3)** — spec §5 y D9, plan, diff `c071066..HEAD`, salida del E2E. Pedir: que las tres skills no contradigan `docs/agent-reference.md`; que `pickler-retomar` no dependa de memoria de Claude ni de rutas de home; tamaños; symlinks; que el `data-done` no rompa overviews sin el atributo.
- [ ] **Step 3: Fixes** en una ola + re-revisión acotada.
- [ ] **Step 4: Audit F3** y commit. Checkpoint con Jesús: la rama queda lista para su decisión de merge (`superpowers:finishing-a-development-branch`).

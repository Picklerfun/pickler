# Sistema docs/manifest · F1 Infraestructura — plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dejar en `predict` la infraestructura del modelo Proflores (rutas, tooling, templates con marca Pickler, contratos, manifest vacío) con `agents:check`, `agents:test` y `docs-md-to-html --all --check` en verde.

**Architecture:** Copia literal desde `~/Documents/Proflores/proflores-monorepo` (medido 2026-09-18) de `scripts/agent-infra`, `scripts/docs-md-to-html.mjs` + `scripts/lib/md-parser.mjs`, `scripts/test-lock.sh` y `docs/overview/*` templates; adaptación mínima: strings de marca, tokens de color (dark por defecto), fuentes, claves de localStorage, y `render-check` con `puppeteer-core` + Chrome local. Los `.md` existentes se mueven con `git mv` a `docs/superpowers/`.

**Tech Stack:** Node 22, npm, `yaml` 2.9.0, `puppeteer-core` ^24, Python 3 (stdlib, `html-facts.py`), bash 3.2 (`test-lock.sh`).

**Spec:** `docs/superpowers/specs/2026-09-18-docs-manifest-design.md`

## Global Constraints

- Worktree `.claude/worktrees/docs-manifest`, rama `chore/docs-manifest`. Todo comando desde ahí. Sin push.
- Commits por nombre de archivo (nunca `git add -A`), conventional commits, trailer `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.
- Origen canónico: `ORIGEN=/Users/josedejesusacevedoflores/Documents/Proflores/proflores-monorepo`. **Sólo lectura** ahí; ningún comando git contra ese repo.
- Marca (spec D6): brand `#C8F03A`, accent `#7A5CFF`, up `#7BE38A`, down `#F2777A`, warn `#F5C35B`, blue `#5AD8FF`, fondo `#08080A`, ink `#F3F1EC`; fuentes Manrope + JetBrains Mono; `prefers-color-scheme: light` como esquema secundario. Strings "Proflores" → "Pickler"; localStorage `pickler-docs:` / `pickler-md:` / `pickler-pr:`.
- Chrome local (spec D5): `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`, override `PICKLER_CHROME`.
- No editar HTML autogenerado a mano. No tocar `apps/mobile`.
- Al terminar cada task: `grep -ri proflores <archivos tocados>` debe dar 0 salvo donde el plan diga lo contrario (`test-lock.sh` conserva su lock compartido).

---

### Task 1: Mover specs y plans a `docs/superpowers/`

**Files:**
- Move: `docs/specs/*.md` → `docs/superpowers/specs/`, `docs/plans/*.md` → `docs/superpowers/plans/`
- Modify: `README.md` (dos enlaces a `docs/specs/…`), `docs/04-roadmap-bounty.md` (un enlace), `docs/00-historia.md` si enlaza specs

**Interfaces:**
- Produces: `docs/superpowers/specs/` con 5 `.md` (4 movidos + `2026-09-18-docs-manifest-design.md`), `docs/superpowers/plans/` con 5 `.md` (4 movidos + este).

- [ ] **Step 1: Mover con git**

```bash
git mv docs/specs/2026-09-15-mobile-fase1-design.md docs/superpowers/specs/
git mv docs/specs/2026-09-16-mobile-perpl-design.md docs/superpowers/specs/
git mv docs/specs/2026-09-16-mobile-ui-port-design.md docs/superpowers/specs/
git mv docs/specs/2026-09-16-mobile-wallet-design.md docs/superpowers/specs/
git mv docs/plans/2026-09-15-mobile-fase1.md docs/superpowers/plans/
git mv docs/plans/2026-09-16-mobile-perpl.md docs/superpowers/plans/
git mv docs/plans/2026-09-16-mobile-ui-port.md docs/superpowers/plans/
git mv docs/plans/2026-09-16-mobile-wallet.md docs/superpowers/plans/
```

- [ ] **Step 2: Verificar renames y que no queden restos**

Run: `git status --short` · Expected: 8 líneas `R  docs/specs/... -> docs/superpowers/specs/...`; `ls docs/specs docs/plans` → "No such file or directory".

- [ ] **Step 3: Actualizar enlaces**

Run: `grep -rn "docs/specs\|docs/plans" README.md docs/0*.md apps/mobile/README.md docs/superpowers` · Reemplazar cada ocurrencia por `docs/superpowers/specs` / `docs/superpowers/plans` (incluidos los enlaces relativos dentro de los specs/planes movidos, p. ej. `../plans/` → `../plans/` sigue válido; `docs/specs/` → `docs/superpowers/specs/`). Volver a correr el grep: 0 resultados fuera de este plan y del spec.

- [ ] **Step 4: Commit**

```bash
git add README.md docs/0*.md docs/superpowers docs/specs docs/plans
git commit -m "chore(docs): mover specs y plans a docs/superpowers (modelo Proflores)"
```

---

### Task 2: Tooling — `package.json` de raíz, `scripts/agent-infra`, conversor MD→HTML

**Files:**
- Create: `package.json` (raíz), `scripts/test-lock.sh`, `scripts/lib/md-parser.mjs`, `scripts/docs-md-to-html.mjs`, `scripts/agent-infra/{check.mjs,check.test.mjs,branches.mjs,branches.test.mjs,build-state.mjs,build-state.test.mjs,check-changed-docs.mjs,generator.test.mjs,html-facts.py,render-check.mjs,README.md}`
- Test: los cuatro `*.test.mjs` copiados

**Interfaces:**
- Produces: `npm run agents:check` (JSON `{errors, metrics}`), `npm run agents:test`, `npm run agents:inventory [base]`, `node scripts/docs-md-to-html.mjs <md>|--all [--check|--missing]`, `node scripts/agent-infra/render-check.mjs <outDir> <slug>`.

- [ ] **Step 1: `package.json` de raíz**

```json
{
  "name": "predict",
  "private": true,
  "description": "Monorepo de Pickler. Este package.json sólo trae el tooling de documentación y agentes; apps/mobile es independiente.",
  "type": "module",
  "engines": { "node": ">=22" },
  "scripts": {
    "agents:check": "node scripts/agent-infra/check.mjs",
    "agents:test": "bash scripts/test-lock.sh node --test --test-concurrency=1 scripts/agent-infra/*.test.mjs",
    "agents:inventory": "node scripts/agent-infra/branches.mjs",
    "docs:html": "node scripts/docs-md-to-html.mjs --all",
    "docs:check": "node scripts/docs-md-to-html.mjs --all --check"
  },
  "devDependencies": {
    "puppeteer-core": "^24.24.1",
    "yaml": "2.9.0"
  }
}
```

Run: `npm install` · Expected: `node_modules/yaml` y `node_modules/puppeteer-core` presentes, `package-lock.json` creado, **sin** descarga de Chromium.

- [ ] **Step 2: Copiar scripts literales**

```bash
mkdir -p scripts/agent-infra scripts/lib
cp "$ORIGEN/scripts/test-lock.sh" scripts/
cp "$ORIGEN/scripts/lib/md-parser.mjs" scripts/lib/
cp "$ORIGEN/scripts/docs-md-to-html.mjs" scripts/
for f in check.mjs check.test.mjs branches.mjs branches.test.mjs build-state.mjs build-state.test.mjs check-changed-docs.mjs generator.test.mjs html-facts.py render-check.mjs; do cp "$ORIGEN/scripts/agent-infra/$f" scripts/agent-infra/; done
```

`test-lock.sh` se copia **sin cambios**: su lock `/tmp/proflores-test.lock` se comparte a propósito con los checkouts de Proflores (misma máquina, misma RAM); se documenta en el README del paso 5.

- [ ] **Step 3: Adaptar `scripts/docs-md-to-html.mjs`**

Cambios exactos (línea de referencia del original):
- l.51, l.66: comentario `proflores-md:` → `pickler-md:`.
- l.68: `` const KEY = \`proflores-md:\${SLUG}:tasks\`; `` → `` \`pickler-md:\${SLUG}:tasks\` ``.
- l.147: `· Proflores</title>` → `· Pickler</title>`.
- l.150: `family=Inter:wght@400;500;600;700;800` → `family=Manrope:wght@400;500;600;700;800`.

Run: `grep -n "proflores\|Inter" scripts/docs-md-to-html.mjs` · Expected: 0 líneas.

- [ ] **Step 4: Adaptar `scripts/agent-infra/render-check.mjs`**

Reemplazar las líneas 1–15 del original por:

```js
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import puppeteer from 'puppeteer-core';
// Usa el Chrome ya instalado (spec D5); override con PICKLER_CHROME.
const executablePath =
  process.env.PICKLER_CHROME ||
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
if (!existsSync(executablePath))
  throw new Error(`Chrome no encontrado en ${executablePath}; define PICKLER_CHROME`);
const out = process.argv[2] || '/tmp/pickler-agent-render';
mkdirSync(out, { recursive: true });
// Sin argumento: index más todos los overviews del manifest (Pickler tiene pocos).
globalThis.window = {}; // el manifest asigna window.DOCS
const manifest = await import(pathToFileURL(resolve('docs/overview/data/manifest.js')).href)
  .then(() => globalThis.window.DOCS)
  .catch(() => []);
const files = process.argv[3]
  ? [process.argv[3]]
  : ['index', ...manifest.map((d) => d.file.replace(/\.html$/, ''))];
const browser = await puppeteer.launch({ headless: true, executablePath });
```

Además, en las dos llamadas a `page.screenshot`, el nombre de archivo usa `file.replace(/[^a-z0-9._-]+/gi, '_')` en vez de `file` (un slug con `/` o `..` crearía subcarpetas inexistentes). El resto del archivo (bucle de páginas, `results.json`, exit code) queda igual.

Run: `node scripts/agent-infra/render-check.mjs /private/tmp/claude-501/-Users-josedejesusacevedoflores-Documents-predict/64a5594f-a44f-4f33-b282-e9b599056eb8/scratchpad/render index` · Expected en este punto: error `ENOENT docs/overview/index.html` (aún no existe; Task 3 lo crea). Lo importante: **no** debe fallar antes por Chrome ni por `puppeteer-core`.

- [ ] **Step 5: README de `scripts/agent-infra`**

Copiar `$ORIGEN/scripts/agent-infra/README.md` y reescribir: `pnpm` → `npm run`; eliminar las secciones "Skills personales y preferencias globales" y el párrafo del parche 2026-09-05 (no se copian `personal/`, `codex-kit/`); en "Navegador y CI" decir que `render-check` usa `puppeteer-core` con el Chrome local (`PICKLER_CHROME`) y que sin argumento renderiza `index` + todos los overviews del manifest; en el bloque de tests añadir: "`test-lock.sh` comparte el lock `/tmp/proflores-test.lock` con Proflores a propósito: el límite es la máquina, no el repo". Quitar la mención a `test.yml`/`build-images.yml` (predict no tiene CI) y a `behavior-cases.json` (llega en F3 con las skills `pickler-*`).

- [ ] **Step 6: Correr los tests**

Run: `npm run agents:test` · Expected: 4 archivos, todos `pass`, `fail 0`. Si `check.test.mjs` falla por `python3`, verificar `python3 --version` (3.14.5 medido).

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json scripts/test-lock.sh scripts/lib/md-parser.mjs scripts/docs-md-to-html.mjs scripts/agent-infra
git commit -m "chore(agents): tooling de docs y agentes copiado de Proflores (npm, puppeteer-core)"
```

---

### Task 3: `docs/overview` — templates, estilos, index y manifest vacío con marca Pickler

**Files:**
- Create: `docs/overview/{index.html,_project-template.html,_styles.css,_syntax.js}`, `docs/overview/data/manifest.js`, `docs/overview/dev/_template.html`, `docs/overview/explorations/_template.html`, `docs/overview/prs/_template.html`, `docs/overview/playgrounds/_template.html`, `docs/overview/reports/_template.html`, `docs/overview/assets/.gitkeep`

**Interfaces:**
- Produces: `window.DOCS = []` cargable con `node -e "global.window={};require('./docs/overview/data/manifest.js')"`; hoja `_styles.css` con los mismos nombres de token que Proflores (`--brand`, `--accent`, `--status-pass`, …) para que templates y conversor no cambien.

- [ ] **Step 1: Copiar literales**

```bash
mkdir -p docs/overview/data docs/overview/dev docs/overview/explorations docs/overview/prs docs/overview/playgrounds docs/overview/reports docs/overview/assets
for f in index.html _project-template.html _styles.css _syntax.js; do cp "$ORIGEN/docs/overview/$f" docs/overview/; done
for d in dev explorations prs playgrounds reports; do cp "$ORIGEN/docs/overview/$d/_template.html" docs/overview/$d/; done
touch docs/overview/assets/.gitkeep
```

- [ ] **Step 2: `data/manifest.js` vacío**

Copiar el comentario de cabecera del original (líneas 1–26, con "Proflores" → "Pickler") y dejar:

```js
window.DOCS = [
  // ← Las entradas nuevas se pegan aquí.
];
```

Run: `node -e "global.window={};require('./docs/overview/data/manifest.js');console.log(window.DOCS.length)"` · Expected: `0`.

- [ ] **Step 3: Tokens de `_styles.css` (dark por defecto)**

Reemplazar el bloque `:root { … }` (l.23–63) y el bloque `@media (prefers-color-scheme: dark) { … }` completo por:

```css
:root {
  /* Surfaces & ink (dark por defecto: Pickler es dark-first) */
  --bg:#08080A;
  --surface:#0F0F13;
  --surface-2:#17171B;
  --ink:#F3F1EC;
  --ink-2:#B9B9B4;
  --ink-3:#8C8C88;
  --line:rgba(243,241,236,0.14);
  --line-2:rgba(243,241,236,0.22);

  /* Brand (lime Pickler) */
  --brand:#C8F03A;
  --brand-soft:rgba(200,240,58,0.14);
  --brand-dark:#E2F98A;

  /* Accent (violeta) */
  --accent:#7A5CFF;
  --accent-soft:rgba(122,92,255,0.18);

  /* Status semantics */
  --warn:#F5C35B;
  --warn-soft:rgba(245,195,91,0.16);
  --info:#5AD8FF;
  --info-soft:rgba(90,216,255,0.12);
  --status-pass:#7BE38A;
  --status-pass-soft:rgba(123,227,138,0.14);
  --status-fail:#F2777A;
  --status-fail-soft:rgba(242,119,122,0.16);
  --gray-soft:#1C1C22;

  /* Radii / shadows */
  --radius:14px;
  --radius-s:8px;
  --shadow:0 1px 3px rgba(0,0,0,.4), 0 1px 2px rgba(0,0,0,.3);
  --shadow-lg:0 10px 30px rgba(0,0,0,.5), 0 4px 12px rgba(0,0,0,.35);

  /* Typography */
  --mono:"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  --sans:"Manrope", -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
}

@media (prefers-color-scheme: light) {
  :root {
    --bg:#F7F7F4;
    --surface:#FFFFFF;
    --surface-2:#EFEFEA;
    --ink:#121214;
    --ink-2:#44444A;
    --ink-3:#77777C;
    --line:#E2E2DC;
    --line-2:#CFCFC8;

    --brand:#7FA300;
    --brand-soft:#EEF7C9;
    --brand-dark:#5C7600;

    --accent:#6A4CF0;
    --accent-soft:#ECE7FF;

    --warn:#9A6B00;
    --warn-soft:#FBF1D6;
    --info:#0E86B8;
    --info-soft:#E0F4FB;
    --status-pass:#2E8B45;
    --status-pass-soft:#E1F5E5;
    --status-fail:#C63B3F;
    --status-fail-soft:#FBE3E4;
    --gray-soft:#EDEDE8;

    --shadow:0 1px 3px rgba(0,0,0,.04), 0 1px 2px rgba(0,0,0,.03);
    --shadow-lg:0 10px 30px rgba(0,0,0,.06), 0 4px 12px rgba(0,0,0,.04);
  }
}
```

Si el bloque dark original define tokens que no aparecen arriba (revisar l.90–100 del original), conservarlos con valor dark en `:root` y valor claro en el `@media`. Cabecera del archivo: "Proflores" → "Pickler", "paleta verde brand" → "paleta lime/violeta de Pickler".

- [ ] **Step 4: Strings, fuentes y claves en los HTML/JS**

En los 9 archivos de `docs/overview` (y subcarpetas):
- `· Proflores</title>` → `· Pickler</title>`; `Proflores · Design Docs` → `Pickler · Design Docs`; comentarios "de Proflores" → "de Pickler".
- `family=Inter:wght@400;500;600;700;800` → `family=Manrope:wght@400;500;600;700;800` (6 `<link>`).
- `proflores-docs:` → `pickler-docs:` (`_project-template.html` l.21, 410, 416); `proflores-pr:` → `pickler-pr:` (`prs/_template.html` l.277, 279).
- `index.html` l.154–155: `proflores-overview-new` / `proflores-dev-new` → `pickler-overview-new` / `pickler-dev-new`.
- `_project-template.html` l.269–282 (prompt y SVG de ejemplo): `paleta verde Proflores #2F6F4E brand, #F2A65A accent` → `paleta Pickler #C8F03A brand, #7A5CFF accent`; `.box-g { fill:#E4F1E4; stroke:#2F6F4E` → `fill:rgba(200,240,58,0.14); stroke:#C8F03A`; `.box-a { fill:#FCEFD9; stroke:#F2A65A` → `fill:rgba(122,92,255,0.18); stroke:#7A5CFF`; `.lbl { font-family: "Inter"… fill:#1A2E22` → `"Manrope"… fill:#F3F1EC`.
- `prs/_template.html` l.174–194: `'Inter'` → `'Manrope'`; `fill:#1A2E22` y `fill:#1F4F37` → `fill:#F3F1EC`; `fill="#E4F1E4" stroke="#2F6F4E"` → `fill="rgba(200,240,58,0.14)" stroke="#C8F03A"`; `fill="#FCEFD9" stroke="#F2A65A"` → `fill="rgba(122,92,255,0.18)" stroke="#7A5CFF"`; `stroke="#2F6F4E"` en los `<path>` → `stroke="#C8F03A"`.
- `_syntax.js` l.2: "Proflores" → "Pickler".

Run: `grep -rin "proflores\|Inter:wght\|#2F6F4E\|#1F4F37\|#E4F1E4\|#F2A65A\|#1A2E22\|#FCEFD9" docs/overview` · Expected: 0 líneas.

- [ ] **Step 5: Render del index vacío y mirarlo**

Run: `node scripts/agent-infra/render-check.mjs /private/tmp/claude-501/-Users-josedejesusacevedoflores-Documents-predict/64a5594f-a44f-4f33-b282-e9b599056eb8/scratchpad/render index` · Expected: exit 0, `errors: []`, `overflow: false` en 1440 y 390. **Abrir** `index-1440.png` e `index-390.png` con Read y confirmar: fondo oscuro, eyebrow "Pickler · Design Docs", tipografía Manrope (no fallback serif), estado vacío legible.

- [ ] **Step 6: Commit**

```bash
git add docs/overview
git commit -m "feat(docs): catálogo docs/overview con templates y estilos de Pickler (manifest vacío)"
```

---

### Task 4: HTML vecino de los 10 Markdown

**Files:**
- Create: `docs/superpowers/specs/*.html` (5), `docs/superpowers/plans/*.html` (5)

- [ ] **Step 1: Generar**

Run: `npm run docs:html` · Expected: `[backfill] procesando 10 archivos…` … `done · processed=10 skipped=0 errors=0`.

- [ ] **Step 2: Verificar paridad y marca**

Run: `npm run docs:check` · Expected: `processed=10 … errors=0`, exit 0.
Run: `grep -l "Pickler</title>" docs/superpowers/specs/*.html docs/superpowers/plans/*.html | wc -l` · Expected: `10`.

- [ ] **Step 3: Contra el defecto**

Run: `rm docs/superpowers/specs/2026-09-15-mobile-fase1-design.html && npm run docs:check; echo exit=$?` · Expected: `[err] … HTML missing or stale`, `exit=1`. Luego `npm run docs:html` y `npm run docs:check` → exit 0.

- [ ] **Step 4: Abrir uno y mirarlo**

Run: `node scripts/agent-infra/render-check.mjs <scratch>/render ../superpowers/specs/2026-09-16-mobile-perpl-design` · (render-check resuelve `docs/overview/<arg>.html`, por eso el `../`). Expected: exit 0, sin overflow a 390. Abrir la captura 390 y confirmar tabla de rulings legible en dark.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/specs/*.html docs/superpowers/plans/*.html
git commit -m "docs: vistas HTML autogeneradas de specs y planes"
```

---

### Task 5: Contratos `CLAUDE.md`/`AGENTS.md` y cierre de F1

**Files:**
- Create: `CLAUDE.md`, `AGENTS.md` (symlink → `CLAUDE.md`), `docs/CLAUDE.md`, `docs/AGENTS.md` (symlink → `CLAUDE.md`), `docs/agent-reference.md`

**Interfaces:**
- Consumes: `check.mjs` exige que cada `AGENTS.md` sea symlink relativo exacto `CLAUDE.md`, que ningún enlace Markdown de esos archivos apunte a ruta inexistente y que la cadena de AGENTS ≤ 24 576 bytes.

- [ ] **Step 1: `CLAUDE.md` de raíz (≤ 2 KB)**

Contenido: título "Pickler (repo `predict`)"; párrafo: monorepo del producto Pickler, app móvil en `apps/mobile` (Expo, npm, ver su README), tooling de docs/agentes en la raíz (`npm run agents:check|agents:test|agents:inventory|docs:html|docs:check`); reglas: español, worktree por tarea en `.claude/worktrees/`, commits por nombre, sin push/merge/TestFlight sin autorización, contrato de documentación en [`docs/CLAUDE.md`](docs/CLAUDE.md), estado del producto en [`docs/04-roadmap-bounty.md`](docs/04-roadmap-bounty.md) y en el catálogo `docs/overview/index.html`; deadline del bounty 13 oct 2026 21:59 CST. Nada de lo que ya dice `~/.agents/global.md`.

```bash
ln -s CLAUDE.md AGENTS.md
```

- [ ] **Step 2: `docs/CLAUDE.md` y `docs/agent-reference.md`**

`docs/CLAUDE.md`: copiar `$ORIGEN/docs/CLAUDE.md` y cambiar: `pnpm agents:check` → `npm run agents:check`; `proflores-dev-new` / `proflores-overview-new` → `pickler-dev-new` / `pickler-overview-new`; la lista "Lectura por tarea" se recorta a los encabezados que existan en el reference adaptado.

`docs/agent-reference.md`: copiar `$ORIGEN/docs/agent-reference.md` y adaptar: rutas ya coinciden (`docs/superpowers/*`); `pnpm` → `npm run`; skills `proflores-*` → `pickler-*`; en "6. Reglas del HTML" reemplazar la paleta por la de Pickler (brand `#C8F03A`, accent `#7A5CFF`, pass `#7BE38A`, warn `#F5C35B`, fail `#F2777A`, canvas dark `#08080A` por defecto, light `#F7F7F4`; Manrope + JetBrains Mono); eliminar la sección "Convenciones por fase (F2–F6)" y sus subsecciones (historia del roadmap HTML Maximalism de Proflores) dejando una línea: "El CSS compartido, el conversor MD→HTML y los sub-catálogos se adoptaron completos de Proflores el 2026-09-18 (spec `docs/superpowers/specs/2026-09-18-docs-manifest-design.md`)"; eliminar referencias a `apps/render-service`, VPS, Stripe y cualquier proyecto de Proflores en los ejemplos (sustituir por `mobile-perpl`). Mantener: Tres artefactos, Reglas 1–6, Naming, Spec→plan→ejecución, Dev tracker, Research, Anti-patterns.

```bash
ln -s CLAUDE.md docs/AGENTS.md
```

Run: `ls -la AGENTS.md docs/AGENTS.md` · Expected: ambos `-> CLAUDE.md`. `grep -rn "proflores\|pnpm" CLAUDE.md docs/CLAUDE.md docs/agent-reference.md` · Expected: sólo la línea histórica de adopción.

- [ ] **Step 3: `agents:check` en verde**

Run: `npm run agents:check` · Expected: exit 0 y

```json
"errors": [],
"metrics": { "instructions": 2, "skills": 0, "manifest": 0, "comparable": 0, "mdCount": 10, "maxChain": { "bytes": <≤ 24576>, "path": "docs/AGENTS.md" } }
```

- [ ] **Step 4: Contra el defecto**

Run: `rm docs/AGENTS.md && npm run agents:check; echo exit=$?` · Expected: `docs/CLAUDE.md: missing AGENTS twin`, `exit=1`. Restaurar con `ln -s CLAUDE.md docs/AGENTS.md`; check → exit 0.

- [ ] **Step 5: Inventario git**

Run: `npm run agents:inventory -- origin/main` · Expected: las cuatro `feat/mobile-*` como `integrated_ancestry`; `chore/docs-manifest` como `unknown_review` con N commits (los de F1); sin stashes.

- [ ] **Step 6: Commit**

```bash
git add CLAUDE.md AGENTS.md docs/CLAUDE.md docs/AGENTS.md docs/agent-reference.md
git commit -m "docs: contratos CLAUDE/AGENTS de raíz y de docs (modelo Proflores)"
```

---

### Task 6: Revisión independiente y audit de F1

**Files:**
- Create: `docs/superpowers/audits/2026-09-18-docs-manifest-f1-rulings.md`

- [ ] **Step 1: Revisión independiente (subagente)**

Enviar al revisor: el spec, este plan, `git diff main...HEAD --stat`, la salida de `agents:check`, `agents:test`, `docs:check` y las capturas. Pedir: (1) que confirme que ningún archivo copiado conserva rutas o marca de Proflores fuera de lo documentado; (2) que `render-check` no descarga Chromium (`ls node_modules/puppeteer` no existe); (3) que los `git mv` conservan historial (`git log --follow --oneline docs/superpowers/specs/2026-09-15-mobile-fase1-design.md` ≥ 2 commits); (4) defectos en la paleta light (contraste brand `#7FA300` sobre blanco). Corregir *Important*; anotar minors en el audit.

- [ ] **Step 2: Audit**

Formato canónico (`docs/agent-reference.md` §5): Rulings (tabla decisión / costo si está mal: p. ej. lock compartido con Proflores, `behavior-cases.json` diferido a F3, valores de la paleta light elegidos sin referencia de diseño), Correcciones, Evidencia (salidas de los comandos de cierre, con cifras), Residuales (lo que F2 y F3 heredan), Rollback ("no se escribió en producción; `git revert` de los commits de la rama").

- [ ] **Step 3: HTML vecino del plan y del audit no aplica al audit; sí regenerar el plan**

Run: `npm run docs:html && npm run docs:check && npm run agents:check` · Expected: todo exit 0 (`mdCount` sigue 10; el audit no cuenta).

- [ ] **Step 4: Commit y checkpoint**

```bash
git add docs/superpowers/audits/2026-09-18-docs-manifest-f1-rulings.md docs/superpowers/plans/2026-09-18-docs-manifest-f1.md docs/superpowers/plans/2026-09-18-docs-manifest-f1.html
git commit -m "docs: audit de F1 del sistema docs/manifest"
```

Reportar a Jesús: qué quedó, evidencia, residuales y **parar** antes de F2.

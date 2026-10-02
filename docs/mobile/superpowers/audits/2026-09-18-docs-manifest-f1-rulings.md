# Sistema docs/manifest · F1 Infraestructura — audit

**Estado:** F1 ejecutada el 2026-09-18 en `.claude/worktrees/docs-manifest`, rama
`chore/docs-manifest` (base `647bbb7` = `main`). Seis commits + este audit. Sin push, sin merge.
Spec: `docs/superpowers/specs/2026-09-18-docs-manifest-design.md`; plan:
`docs/superpowers/plans/2026-09-18-docs-manifest-f1.md`. Ejecución con subagentes (Tasks 2, 3 y 5
en paralelo sobre archivos disjuntos; Tasks 1 y 4 por el coordinador), revisión por task y
revisión final de rama independiente.

## Rulings

| Decisión | Motivo y costo si fuera incorrecta |
|---|---|
| Tasks 2, 3 y 5 en paralelo **sin commitear**; el coordinador commitea por nombre | Regla global de Jesús (delegar subtareas independientes; commits por nombre) y evita conflictos de index entre agentes. Costo: autoría de commits en un solo punto; ninguno estructural. |
| Tasks 1 y 4 las ejecuta el coordinador | Triviales y secuenciales (`git mv`, `docs:html`). Costo: sin revisión por task; las cubre la revisión final. |
| Tokens del esquema claro re-elegidos: `--brand #5C7600`, `--brand-dark #3F5200`, `--status-pass #247A3A`, `--info #0B6F99` | El revisor de Task 3 midió `#7FA300` (valor del plan, elegido sin referencia de diseño) a 2.9:1 sobre blanco. Los nuevos dan ≥4.8:1 sobre `#FFFFFF` y `#F7F7F4`, recalculados por implementador y re-revisor. Costo: el esquema claro se ve más apagado que la app; se re-tokeniza en un commit si Jesús quiere otros valores. |
| `scripts/test-lock.sh` copiado sin cambios, con el lock `/tmp/proflores-test.lock` compartido con Proflores | El límite que protege es la máquina (RAM), no el repo. Costo: `PROFLORES_TEST_LOCK=0` es el escape también aquí; si confunde, se parametriza. |
| `behavior-cases.json` diferido a F3 | Sus casos son de routing de skills de Proflores; los de Pickler se escriben con las skills `pickler-*`. Costo: `agents:check` no lo consume; ninguno. |
| Task 5 despachada en paralelo aceptando sólo errores `generated HTML missing` hasta Task 4 | Archivos disjuntos. Costo: repetir `agents:check` (barato). |
| `render-check` sin argumento renderiza `index` + todos los overviews del manifest; nombres de captura saneados (`/`→`_`) | Pickler tiene pocos overviews; la lista fija de Proflores no aplica. Costo: con muchos overviews tardará; se pasa un slug. Nota: un slug con `../` produce capturas que empiezan por `.` (ocultas a `ls`). |
| Spec §6 corregido de `mdCount: 9` a "todos los `.md` de specs y plans" | El plan de F1 es el décimo `.md`. Costo: ninguno. |
| Mensajes de commit sin el título exacto del plan en Task 1 (se añadió "Incluye el spec y el plan de F1") | El spec y el plan se commitearon junto con el `git mv`. Costo: ninguno. |

## Correcciones a lo afirmado antes

- El plan esperaba `metrics.instructions: 2`; son **3** porque `apps/mobile/AGENTS.md` (plantilla Expo,
  commit `00a75ec`) ya existía y `check.mjs` lo exceptúa por diseño. No es error.
- El plan decía "6 `<link>`" de Inter; eran **7** (incluye `index.html`). Se reemplazaron los 7.
- El plan decía que `AGENTS.md` es "el par" de `CLAUDE.md`; en Proflores es un **symlink** con target
  exacto `CLAUDE.md` y así lo exige `check.mjs`. Así se creó.

## Evidencia

- `npm run agents:check` → exit 0, `errors: []`, `{instructions: 3, skills: 0, manifest: 0, comparable: 0, mdCount: 10, maxChain: 4253 B}`.
- Contra el defecto: manifest temporal con `phases:[{num:0,status:"completed"}]` sobre `_project-template.html` (card F0 `pending`) → `phase IDs/status differ from manifest`, exit 1; restaurado → exit 0. Sin `docs/AGENTS.md` → `missing AGENTS twin`, exit 1. Sin un HTML vecino → `docs:check` exit 1 con `HTML missing or stale`.
- `npm run agents:test` → 11/11 (`check`, `branches`, `build-state`, `generator`).
- `npm run docs:check` → `processed=10 errors=0`.
- `npm run agents:inventory -- origin/main` → cuatro `feat/mobile-*` y `main` = `integrated_ancestry`; `chore/docs-manifest` = `unknown_review` (6 commits); sin stashes.
- Render con Chrome local (`puppeteer-core`, sin `node_modules/puppeteer`): `index` y el spec de Perpl a 1440/390 → `errors: []`, `overflow: false`. Capturas miradas por el coordinador (spec a 390: dark, lime, Manrope) y por implementador y revisor de Task 3 (index).
- Copias literales verificadas con `diff` contra el origen por los revisores de Tasks 2 y 3: `test-lock.sh`, `md-parser.mjs`, `check*`, `branches*`, `build-state*`, `check-changed-docs`, `generator.test`, `html-facts.py` byte-idénticos; `docs-md-to-html.mjs` y `render-check.mjs` sólo con los hunks del plan; `_styles.css` idéntico desde "Reset & base".
- `git log --follow` de un spec movido muestra `a332e9d` (anterior a la rama): historial conservado.

## Residuales (ordenados por peso)

1. **Paleta light sin referencia de diseño**: los tokens claros cumplen AA pero no vienen de la marca; si Pickler define un tema claro, sustituirlos.
2. `docs/agent-reference.md` l.53 describe `.agents/skills/` + symlinks `.claude/skills/` que llegan en **F3**; hasta entonces un agente puede buscar un directorio inexistente.
3. `CLAUDE.md` de raíz repite tres frases de `~/.agents/global.md` (español, `git add -A`, autorización previa). ~120 B; recortar si molesta.
4. `scripts/lib/md-parser.mjs` deja los backticks literales en los headings del TOC (heredado de Proflores).
5. `npm audit`: 3 *high* en `extract-zip` vía `@puppeteer/browsers` (descarga de Chromium, ruta que este repo no ejecuta). Subir a `puppeteer-core@25` cuando convenga.
6. `scripts/test-lock.sh` l.3–4 sigue diciendo "checkouts de proflores"; `render-check.mjs` l.35 conserva un filtro redundante del origen.
7. `behavior-cases.json` pendiente para F3.

## Rollback

No se escribió en producción ni fuera del worktree (salvo `node_modules/` y `package-lock.json` en la
rama). Deshacer = no mergear la rama, o `git revert` de `f6d6a3c..338ce5b`.

## Revisión final de rama

Revisor independiente (Opus) sobre `647bbb7..338ce5b`: **APPROVE WITH FIXES**. Verificó cobertura de
F1 contra el spec, exclusiones D7, nada bajo `apps/`, historial por rename, copias byte-idénticas
(`cmp` contra el origen), residuo de marca y `agents:check`. Dos *Important* que ninguna revisión por
task vio, porque cada una miraba su archivo:

1. `color: white` sobre `var(--brand)`/`--brand-dark`/`--status-pass` en 9 reglas (7 en `_styles.css`,
   `dev/_template.html`, `explorations/_template.html`): con lima da **1.31:1** y se veía en el propio
   index ("Todos", "+ Nueva entrada"). La afirmación "estado vacío legible" de Task 3 era falsa para
   esos controles. Fix: token `--on-brand` (`#08080A` dark / `#FFFFFF` light) → 15.2:1 sobre lima.
2. SVG de ejemplo de `_project-template.html` y `prs/_template.html` con rellenos claros (`#FFFFFF`,
   `#F4F2EC`) bajo texto `#F3F1EC`: 1.0–1.1:1, regresión de la rama que F2 habría clonado 4 veces.
   Fix: cajas `#17171B` (15.8:1 con el ink), grises `#8C8C88`, comentario corregido.

Minors arreglados en la misma ola (commit `36bee09`): checklist de `prs/_template.html` con `pnpm …`
→ comandos de este repo; comentarios "HTML Maximalism" en `manifest.js`; cláusula del instalador en
el README; `--warn` claro `#7E5700` (5.4:1 sobre `--accent-soft`). Re-revisión acotada: 6/6
ADDRESSED, sin rotura nueva. Minor diferido: el footer del conversor cita una sección "MD → HTML
autogenerado" de `docs/CLAUDE.md` que no existe (heredado; se toca si se edita el conversor).

Limitación conocida: los SVG de ejemplo usan hex fijos (no CSS vars en `file://`), así que en
esquema claro las cajas quedan oscuras dentro de una superficie clara. Preexistente en Proflores.

Riesgos que el revisor deja para F2/F3 (además de los residuales de arriba):

- `check.mjs` exceptúa `apps/mobile/AGENTS.md` por ruta fija y exige `apps/mobile/CLAUDE.md` =
  `@AGENTS.md`; si Expo regenera ese archivo o se añade otra app, `agents:check` fallará sin que
  `agent-reference.md` lo documente.
- F3: symlinks `.claude/skills/<name>` relativos, `name` = directorio, SKILL.md ≤ 16 000 B, enlaces
  Markdown relativos resolubles.
- F2: `comparePhases` sólo mira `<article class="phase-card" data-phase data-status>`; los overviews
  deben usar `data-phase="1"` y el manifest `phases:[{num:1,status:'completed'}]`; los dev trackers
  sin `phases`.
- `render-check` sin argumento renderiza 7+ páginas × 2 anchos con `networkidle0` y Google Fonts:
  sin red, 30 s de timeout por página.
- Al mover `docs/05..08` (D4), ningún check valida los enlaces del README ni del roadmap: revisarlos
  a mano.

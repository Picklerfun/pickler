# Sistema docs/manifest · F2 Retro-relleno — plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Poblar el catálogo con el trabajo ya hecho de Pickler — 4 overviews, 2 dev trackers, 6 entradas del manifest y los 4 handoffs como audits — sin inventar nada que spec, plan o handoff no digan, con `agents:check` en verde y el render mirado.

**Architecture:** Cada overview se clona de `docs/overview/_project-template.html` y se rellena desde su spec (decisiones, TL;DR), su plan (tasks) y su audit (evidencia); una `phase-card` F1 `completed` por sub-proyecto porque cada uno tuvo un solo plan. Los dev trackers se clonan de `dev/_template.html`. El manifest se escribe al final desde los bloques que cada overview reporta. Los handoffs se mueven con `git mv` y se actualizan las referencias.

**Tech Stack:** HTML/CSS del catálogo (F1), `npm run agents:check|docs:html|docs:check`, `render-check.mjs`.

**Spec:** `docs/superpowers/specs/2026-09-18-docs-manifest-design.md` (§4 Retro-relleno, D3, D4). Audit de F1 con riesgos: `docs/superpowers/audits/2026-09-18-docs-manifest-f1-rulings.md`.

## Global Constraints

- Worktree `.claude/worktrees/docs-manifest`, rama `chore/docs-manifest`. Commits por nombre por el coordinador; los subagentes no commitean. Sin push.
- **Fidelidad**: nada en un overview o dev tracker que no esté en su spec, plan, handoff o `git log`. Si un placeholder no tiene fuente, se elimina el bloque (regla de `docs/agent-reference.md`: no inventar assets, fases ni decisiones).
- `agents:check` compara `phases` del manifest con `<article class="phase-card" data-phase="N" data-status="…">`: los 4 overviews usan **`data-phase="1"` `data-status="completed"`** y el manifest `phases: [{ num: 1, status: 'completed' }]`. Los dev trackers no llevan `phases`.
- Nombres (spec §4): `2026-09-15-mobile-fase1.html`, `2026-09-16-mobile-ui-port.html`, `2026-09-16-mobile-wallet.html`, `2026-09-16-mobile-perpl.html`, `dev/2026-09-16-testflight-build3.html`, `dev/2026-09-17-testflight-build4.html`. `<body data-slug>` = slug sin fecha para overviews (`mobile-fase1`, …) y con fecha para dev (`2026-09-16-testflight-build3`), como manda `docs/agent-reference.md`.
- Audits (D4): `docs/superpowers/audits/2026-09-16-mobile-{fase1,ui-port,wallet,perpl}-f1-rulings.md`, contenido **sin reescribir**; sólo se actualizan rutas cruzadas entre ellos.
- HTML standalone, `_styles.css` relativo (`_styles.css` en overviews, `../_styles.css` en dev), sin `innerHTML` con contenido dinámico, sin nuevos tokens de color.
- No tocar `apps/mobile` ni el tooling de F1.

---

### Task 1: Handoffs → audits, referencias y README

**Files:**
- Move: `docs/05-handoff-fase1.md` → `docs/superpowers/audits/2026-09-16-mobile-fase1-f1-rulings.md`; `docs/06-handoff-ui-port.md` → `…/2026-09-16-mobile-ui-port-f1-rulings.md`; `docs/07-handoff-wallet.md` → `…/2026-09-16-mobile-wallet-f1-rulings.md`; `docs/08-handoff-perpl.md` → `…/2026-09-16-mobile-perpl-f1-rulings.md`
- Modify: `README.md` (§Estado, tabla "Por dónde empezar"), `docs/04-roadmap-bounty.md:28`, los 4 audits movidos (referencias `docs/0N-handoff-*.md` entre sí), `docs/superpowers/specs/2026-09-16-mobile-ui-port-design.md:6`, `docs/superpowers/specs/2026-09-16-mobile-wallet-design.md:7,156`
- No modificar: los planes (`docs/superpowers/plans/*.md` citan `docs/06-…` como comandos históricos; se dejan).

- [ ] **Step 1: `git mv` de los cuatro**

```bash
git mv docs/05-handoff-fase1.md docs/superpowers/audits/2026-09-16-mobile-fase1-f1-rulings.md
git mv docs/06-handoff-ui-port.md docs/superpowers/audits/2026-09-16-mobile-ui-port-f1-rulings.md
git mv docs/07-handoff-wallet.md docs/superpowers/audits/2026-09-16-mobile-wallet-f1-rulings.md
git mv docs/08-handoff-perpl.md docs/superpowers/audits/2026-09-16-mobile-perpl-f1-rulings.md
```

- [ ] **Step 2: Referencias**

Run: `grep -rn "0[5-8]-handoff" README.md docs/0*.md docs/superpowers/specs docs/superpowers/audits` y reemplazar cada `docs/05-handoff-fase1.md` → `docs/superpowers/audits/2026-09-16-mobile-fase1-f1-rulings.md` (y análogos para 06/07/08). Repetir el grep: 0 fuera de `docs/superpowers/plans`.

- [ ] **Step 3: README**

`## Estado` → "## Estado: fase 2 (Perpl) en `main` y en TestFlight build 3 (2026-09-16)" con dos oraciones: fase 1 (passkey, tesorería) y fase 2 (pestaña Trade: enable, orden de mercado, cierre, fondos) hechas y verificadas con trades reales; build 4 pendiente (lista en el audit de Perpl); fases 3 y 4 sin spec. Enlaces: `docs/04-roadmap-bounty.md`, `docs/overview/index.html` ("catálogo de specs, planes y trackers; ábrelo en el navegador"), audit de Perpl. En la tabla "Por dónde empezar": la fila del handoff de fase 1 pasa a "`docs/superpowers/audits/`" con texto "Audits de cada fase ejecutada (rulings, lo aprendido, pendientes); el más reciente es el de Perpl"; añadir fila `docs/overview/index.html` → "Catálogo visual: estado de cada sub-proyecto y build". Añadir al final de "Flujo de trabajo": "Cada sub-proyecto tiene además un overview en `docs/overview/` y una entrada en `docs/overview/data/manifest.js`; cada fase ejecutada deja un audit en `docs/superpowers/audits/`. Reglas en `docs/CLAUDE.md`."

- [ ] **Step 4: Regenerar vistas y verificar**

Run: `npm run docs:html && npm run docs:check && npm run agents:check` · Expected: todos exit 0; `agents:check` con `errors: []`, `mdCount: 11` (se suma este plan).

- [ ] **Step 5: Commit**

```bash
git add README.md docs/04-roadmap-bounty.md docs/superpowers/audits docs/superpowers/specs docs/superpowers/plans/2026-09-18-docs-manifest-f2.md docs/superpowers/plans/2026-09-18-docs-manifest-f2.html docs/05-handoff-fase1.md docs/06-handoff-ui-port.md docs/07-handoff-wallet.md docs/08-handoff-perpl.md
git commit -m "docs: handoffs como audits en docs/superpowers/audits; README al estado real"
```

---

### Task 2–5: Un overview por sub-proyecto (cuatro tasks con la misma forma)

| Task | Overview | Spec | Plan (tasks) | Audit |
|---|---|---|---|---|
| 2 | `docs/overview/2026-09-15-mobile-fase1.html`, slug `mobile-fase1` | `specs/2026-09-15-mobile-fase1-design.md` | `plans/2026-09-15-mobile-fase1.md` (10 tasks) | `audits/2026-09-16-mobile-fase1-f1-rulings.md` |
| 3 | `docs/overview/2026-09-16-mobile-ui-port.html`, slug `mobile-ui-port` | `specs/2026-09-16-mobile-ui-port-design.md` | `plans/2026-09-16-mobile-ui-port.md` (11 tasks) | `audits/2026-09-16-mobile-ui-port-f1-rulings.md` |
| 4 | `docs/overview/2026-09-16-mobile-wallet.html`, slug `mobile-wallet` | `specs/2026-09-16-mobile-wallet-design.md` | `plans/2026-09-16-mobile-wallet.md` (9 tasks) | `audits/2026-09-16-mobile-wallet-f1-rulings.md` |
| 5 | `docs/overview/2026-09-16-mobile-perpl.html`, slug `mobile-perpl` | `specs/2026-09-16-mobile-perpl-design.md` | `plans/2026-09-16-mobile-perpl.md` (15 tasks) | `audits/2026-09-16-mobile-perpl-f1-rulings.md` |

**Files:** Create el overview; Read spec, plan (sólo `### Task N:` y sus `**Files:**`), audit. Nada más.

**Interfaces:**
- Produces: el HTML y, en el reporte, el bloque de manifest exacto (ver Step 6) que Task 7 pega.

- [ ] **Step 1: Clonar** `docs/overview/_project-template.html` → destino. Leer el template completo una vez para conocer status board, `roadmap-actions`, phase-cards, `<details class="tasks">`, decisiones, modelo, glosario, footer.

- [ ] **Step 2: Hero y meta**
- `<body data-slug="[[SLUG]]">` → slug de la tabla (sin fecha).
- `<title>[[PROJECT_TITLE]] · Pickler</title>` y el `<h1>`: título = el `# ` del spec sin el sufijo "— design spec"; `[[ACCENT_TITLE]]` = la última frase entre paréntesis o las 2–3 últimas palabras.
- `[[LEDE]]` = primera oración del TL;DR del spec. `[[TLDR_BODY]]` = el TL;DR del spec (párrafo o lista, ≤ 6 líneas).

- [ ] **Step 3: Status board y roadmap**
- Estado global "Completado"; Spec ✅; Planes escritos **1/1**; Implementación **1/1**; Próximo paso: "Cerrado el 2026-09-16 — siguiente en `docs/04-roadmap-bounty.md`".
- Dejar **una** `<article class="phase-card" data-phase="1" data-status="completed">` (eliminar la F0 del template y ajustar el `data-phase`): nombre "F1 · <título corto del plan>", descripción = 1–2 oraciones del `**Goal:**` del plan, entregable = lo que el audit lista en "Qué quedó hecho y verificado" (1 línea), prerequisitos "Ninguno".
- `<details class="tasks">` con un `<li><label><input type="checkbox" checked> Task N: <título></label></li>` por cada `### Task N:` del plan, en orden, **todas marcadas** (el audit acredita la fase completa).
- `<details class="followups">` con la lista "Pendientes" del audit (títulos cortos, ≤ 8 ítems; si hay más, "y N minors más en el audit").
- Barra de progreso y leyenda: un solo segmento `data-status="completed"`; el dropdown de status en `completed`.

- [ ] **Step 4: Decisiones y resto**
- Sección Decisiones: una fila/tarjeta por decisión de "## 1. Decisiones que fija este spec" (título = columna Decisión + Valor; razón = Por qué, recortada a 1–2 líneas). Añadir después un bloque "Rulings en ejecución" con las decisiones del audit (sección "Decisiones tomadas durante la ejecución"/"Rulings"), ≤ 10, cada una en una línea.
- Sección Modelo: **eliminar** el SVG de ejemplo, la tabla `[[TABLE_NAME]]`, el snippet `[[MODULE]]` y la figura `[[SCREENSHOT_*]]` (no hay assets). Si el spec tiene una sección "Unidades"/"Archivos"/"Estructura del repo", sustituir el bloque por una lista de sus rutas (`<code>`), sin comentarios.
- Glosario: eliminar la sección (ningún spec tiene glosario). Eliminar del TOC los enlaces a secciones eliminadas.
- Footer: paths reales a spec, plan y audit; nota "dashboard vivo" del template intacta.

- [ ] **Step 5: Verificar**
Run: `grep -c "\[\[" <overview>` → `0`. `grep -c 'class="phase-card"' <overview>` → `1`. `grep -c 'type="checkbox" checked' <overview>` → número de tasks del plan. Abrir en render: `node scripts/agent-infra/render-check.mjs <scratch>/render <nombre-sin-.html>` → exit 0, `overflow: false` a 390, `phases: [{num:"1",status:"completed",selected:"completed"}]`. Mirar la captura 390 con Read: hero, status board 1/1, card completada.

- [ ] **Step 6: Reportar el bloque de manifest** (en el reporte, sin tocar `manifest.js`):

```js
{
  date: '<fecha del archivo>',
  title: '<título del h1, sin acento HTML>',
  summary: '<lede>',
  file: '<nombre>.html',
  types: ['spec', 'plan'],
  status: 'completed',
  tags: [<3–5 tags en minúsculas: 'mobile', 'expo', 'mera', 'passkey', 'ausd', 'perpl', 'wallet', 'ui'…>],
  phases: [{ num: 1, status: 'completed' }],
},
```

---

### Task 6: Dos dev trackers de TestFlight

**Files:**
- Create: `docs/overview/dev/2026-09-16-testflight-build3.html`, `docs/overview/dev/2026-09-17-testflight-build4.html`
- Read: `docs/overview/dev/_template.html`, `docs/superpowers/audits/2026-09-16-mobile-perpl-f1-rulings.md` (§"Cierre", §"Estado al cerrar la sesión", §"Lista propuesta para el build 4"), `git log --oneline 5f76811..35649b6`, `git show --stat f2b4ff7 a78b36c`

- [ ] **Step 1: Build 3** (`shipped`)
- `<body data-slug="2026-09-16-testflight-build3">`, `<title>TestFlight build 3 · Pickler</title>`, breadcrumb `dev/2026-09-16-testflight-build3`, eyebrow `dev-eyebrow feature` / "Feature", h1 "TestFlight build 3" (acento: "PRF, iOS 18, faucet"), lede: "Build 0.1.0 (3) con el mensaje real de PRF_UNAVAILABLE, iOS 18 como mínimo y 'Get test MON' que copia la dirección; en el grupo interno 'Equipo'."
- Status board: pill `shipped` "Shipped"; PR: "— (merge directo `35649b6`)"; commit: `a78b36c`; fecha `2026-09-16`.
- "Qué cambió": los 4 puntos del audit de Perpl §Cierre (PRF_UNAVAILABLE con `src/wallet/prfMessage.ts`; `expo-build-properties` 57.0.20 con `deploymentTarget` 18.0; "Get test MON · copies address" + fila "Your address"; `ios.buildNumber` "3"). "Por qué": lista del build 3 acordada en los handoffs de ui-port y wallet (PRF en Bitwarden, iOS 18). "Archivos tocados": los de `git show --stat f2b4ff7 a78b36c` (rutas reales). "Validación": 168/168, `.ipa` 0.1.0 (3) `UPLOAD SUCCEEDED`, TestFlight `VALID`/`IN_BETA_TESTING`, probado en el iPhone de Jesús (cuenta Perpl #621; el 3401 fue reloj desfasado). "Follow-ups": ninguno del build 3.
- Quitar `contenteditable` de los campos que rellenes (los datos son definitivos), conservar el botón "Descargar HTML".

- [ ] **Step 2: Build 4** (`pending`)
- slug `2026-09-17-testflight-build4`, title "TestFlight build 4 · Pickler", eyebrow "Feature", h1 "TestFlight build 4" (acento: "propuesta"), lede: "Lista propuesta tras probar el build 3 en teléfono real; decide Jesús qué entra."
- Status board: pill `pending` "Pending"; PR "—"; commit "—"; fecha `2026-09-17`.
- "Qué cambió" → renombrar el h2 a "Qué entra (propuesta)": los 5 puntos del audit de Perpl §"Lista propuesta para el build 4", literales (desfase de reloj vs header `Date`; "locked in positions" = Σ `c`; fees a 4 decimales; "Reconnect trading" tras Sign out; minors diferidos a criterio). "Por qué": el 3401 en teléfono real y lo reportado por Jesús tras sign out. "Archivos tocados": "Por definir con el plan". "Validación": "Pendiente". Campos de PR/commit quedan `contenteditable`.

- [ ] **Step 3: Verificar**
Run: `grep -c "\[\[" docs/overview/dev/*.html` → 0 en ambos (el template `_template.html` no se toca). Render de ambos (`dev/2026-09-16-testflight-build3` y `dev/2026-09-17-testflight-build4`) → exit 0; mirar la 390 del build 3.

- [ ] **Step 4: Reportar los dos bloques de manifest**

```js
{ date: '2026-09-16', title: 'TestFlight build 3', summary: '<lede>', file: 'dev/2026-09-16-testflight-build3.html', types: ['feature'], status: 'shipped', tags: ['mobile', 'testflight', 'ios'] },
{ date: '2026-09-17', title: 'TestFlight build 4', summary: '<lede>', file: 'dev/2026-09-17-testflight-build4.html', types: ['feature'], status: 'pending', tags: ['mobile', 'testflight', 'ios'] },
```

---

### Task 7: Manifest, verificación de cierre y commit

**Files:**
- Modify: `docs/overview/data/manifest.js`

- [ ] **Step 1: Pegar las 6 entradas** de los reportes de Tasks 2–6 en `window.DOCS`, **más reciente primero** (perpl, wallet, ui-port, fase1 el 09-15; los dev con su fecha), antes del comentario `// ← Las entradas nuevas se pegan aquí.`. Comillas simples como en Proflores.

- [ ] **Step 2: Check**
Run: `npm run agents:check` · Expected: exit 0, `errors: []`, `manifest: 6`, `comparable: 4`.

- [ ] **Step 3: Contra el defecto**
Cambiar en el manifest la fase de `mobile-wallet` a `pending` → `agents:check` exit 1 con `2026-09-16-mobile-wallet.html: phase IDs/status differ from manifest`; revertir → exit 0.

- [ ] **Step 4: Render de todo y mirar**
Run: `node scripts/agent-infra/render-check.mjs <scratch>/render` (sin slug: index + 6) · Expected: exit 0, 14 capturas, `overflow: false` en todas, `phases` con `selected === status`. Abrir con Read: `index-1440-viewport.png` (6 tarjetas, contadores "6 trabajos", filtros), `2026-09-16-mobile-perpl-390.png` (completo), `dev/…build3` a 390. Si el index muestra "Último trabajo" o "En implementación" con valores raros, revisar `status`/`date` de las entradas.

- [ ] **Step 5: Commit**

```bash
git add docs/overview/2026-09-15-mobile-fase1.html docs/overview/2026-09-16-mobile-ui-port.html docs/overview/2026-09-16-mobile-wallet.html docs/overview/2026-09-16-mobile-perpl.html docs/overview/dev/2026-09-16-testflight-build3.html docs/overview/dev/2026-09-17-testflight-build4.html docs/overview/data/manifest.js
git commit -m "feat(docs): overviews de fase 1, UI port, wallet y Perpl; trackers de build 3 y 4; manifest con 6 entradas"
```

---

### Task 8: Revisión final de rama (F2) y audit

**Files:**
- Create: `docs/superpowers/audits/2026-09-18-docs-manifest-f2-rulings.md`

- [ ] **Step 1: Revisión independiente** con spec, este plan, `git diff --stat <commit de Task 1>^..HEAD`, evidencia de Task 7 y capturas. Pedir: fidelidad (muestreo: 3 decisiones y 3 tasks por overview contra spec/plan; los 5 puntos del build 4 contra el audit), `data-phase`/manifest, enlaces del README y roadmap (ningún check los valida), residuos `[[…]]`, y que los audits movidos no cambiaron de contenido (`git diff -M --stat` muestra renames ≥ 95 %).
- [ ] **Step 2: Fixes** en una ola + re-revisión acotada.
- [ ] **Step 3: Audit F2** (rulings con costo, correcciones, evidencia, residuales, rollback) y commit. Checkpoint con Jesús antes de F3.

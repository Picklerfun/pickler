# Sistema docs/manifest · F2 Retro-relleno — audit

**Estado:** F2 ejecutada el 2026-09-18 en `.claude/worktrees/docs-manifest`, rama
`chore/docs-manifest`, sobre F1 (`3a97b4a`). Commits `ad8051f` (handoffs → audits, README, plan),
`25df1ac` (6 HTML + manifest) y `79587df` (ola de fixes de la revisión final). Sin push, sin merge.
Spec: `docs/superpowers/specs/2026-09-18-docs-manifest-design.md` §4; plan:
`docs/superpowers/plans/2026-09-18-docs-manifest-f2.md`. Ejecución: Task 1 y 7 por el
coordinador; Tasks 2–6 por cinco subagentes en paralelo (archivos disjuntos, sin commit);
revisión final de rama independiente (Opus) con muestreo de fidelidad ampliado a todo.

## Rulings

| Decisión | Motivo y costo si fuera incorrecta |
|---|---|
| Un solo `phase-card` F1 `completed` por overview, con las N tasks del plan marcadas | Cada sub-proyecto tuvo un único plan; inventar fases viola la regla de fidelidad. Costo: los overviews se ven "planos" (1/1); si un sub-proyecto reabre, se añade F2 en su overview y en el manifest. |
| Summaries de wallet y fase1 en el manifest redactados por el coordinador desde los TL;DR | La primera oración literal del TL;DR de wallet ("Cuatro piezas, ningún backend…") no describía nada en una tarjeta. Verificado por el revisor: nada que spec/audit no digan. Costo: texto de tarjeta; se edita en `manifest.js`. |
| "Rulings en ejecución" del overview de fase 1 se llenó con "Lo aprendido" del audit y se renombró a "Lo aprendido (audit)" | Ese handoff no tiene sección de rulings. Costo: ninguno. |
| Overflow de `table.decisions` a 390 px en wallet y perpl arreglado con `style` inline, no en `_styles.css` | Regla de F1: no tocar el tooling copiado. Costo: dos estilos inline que la skill `pickler-overview-new` no debe propagar; en F3 se mueve a `_styles.css` (`table.decisions td { overflow-wrap: anywhere }`) y se añade el bloque "Rulings en ejecución" al template. |
| Los planes históricos (`docs/superpowers/plans/2026-09-16-*.md`) conservan `docs/06-handoff-…` en sus comandos | Son historia de ejecución; reescribirlos obliga a regenerar su HTML y no aporta. Costo: un grep de `0[5-8]-handoff` sigue dando resultados ahí. |
| Build 4 con fecha 2026-09-17 en archivo y manifest (spec §4) aunque la lista se escribió la noche del 16 | Se respeta el spec. Costo: `pickler-retomar` no debe inferir "trabajo del 17" de esa fecha (riesgo anotado para F3). |
| Sección "Validación" en los dev trackers, no prevista en `docs/agent-reference.md` §"Estructura del HTML dev" | Tiene fuente (audit) y es lo que un build necesita. Costo: la referencia y `pickler-dev-new` deben listarla en F3 o los siguientes trackers divergen. |
| Minor 7 del revisor (el script del template pisa "Estado"/"Próximo paso" cuando todas las fases están `completed`) diferido a F3 | Es tooling de F1 (`_project-template.html:511-535`); decidir en la skill qué manda. Costo: el texto estático "Cerrado el 2026-09-16…" no se ve en el navegador; `pickler-retomar` que lea el HTML verá otra cosa que el usuario. |

## Correcciones a lo afirmado antes

- El plan pedía 4 puntos en "Qué cambió" del build 3; el audit de Perpl §Cierre lista **5** (falta el
  README con la nota de proveedores de passkey). Corregido en la ola de fixes.
- El plan decía "el roadmap enlaza a los overviews"; Task 1 sólo cambió una ruta. Añadido el párrafo
  con enlaces al catálogo y a los 4 overviews en `docs/04-roadmap-bounty.md`.
- Los `<title>` de ui-port y fase1 quedaron truncados al partir el h1 en el em dash; corregidos a
  h1 completo. Regla nueva para F3: `<title>` = h1 completo + " · Pickler".
- `grep -c 'class="phase-card"'` da 3 en cada overview por el script del template (`buildHtmlDiff`
  contiene la cadena); el DOM tiene 1 y `html-facts.py` ignora `<script>`. La skill debe contar
  etiquetas, no cadenas.

## Evidencia

- `npm run agents:check` → exit 0, `errors: []`, `manifest: 6`, `comparable: 4`, `mdCount: 11`.
- Contra el defecto: fase de wallet a `pending` en el manifest → `2026-09-16-mobile-wallet.html: phase IDs/status differ from manifest`, exit 1; restaurado → exit 0.
- `npm run docs:check` → `processed=11 errors=0`.
- Render sin argumento (index + 6): 14 capturas, `overflow: false` en todas, `phases.selected === status`. Miradas por el coordinador: `index-1440.png` (6 tarjetas, "6 trabajos", "Último 2026-09-17", "1 en implementación" = build 4 pending, cuatro barras 1/1) y `2026-09-16-mobile-perpl-390-viewport.png`; por los implementadores, la 390 de cada archivo; por el revisor final, index, wallet-390, build3-390 y recortes de las tablas a 390.
- Fidelidad (revisor final, muestreo total): fase1 7/7 decisiones, 10/10 tasks, 8/8 aprendidos, 8/8 pendientes; ui-port 7/7, 11/11, 7/7; wallet 9/9, 9/9, 8/8, 7 pendientes; perpl 15/15, 15/15, 10/10, 5 follow-ups = lista del build 4; build 3: 8 archivos = unión exacta de `git show --stat f2b4ff7 a78b36c`, merge `35649b6` verificado; build 4: 5 puntos literales. Ninguna afirmación sin fuente.
- Handoffs: 4 renames con similarity 100/99/98/96 %; líneas cambiadas sólo con sustitución de rutas.
- Enlaces de `README.md` y `docs/04-roadmap-bounty.md`: 12 Markdown, 0 rotos (script del revisor). `0[5-8]-handoff` fuera de `docs/superpowers/plans/` y del HTML generado: 0.
- Residuo `[[…]]` fuera de los templates: 0. "proflores" en overviews: 3 líneas, todas citas literales del spec de fase 1 (Team Apple, "Como Proflores v1", ASC key) — fidelidad, no marca.

## Residuales (ordenados por peso)

1. **F3 — tooling y template**: regla compartida para `table.decisions` y un bloque "Rulings en
   ejecución" en `_project-template.html`; `data-slug` en `dev/_template.html`; decidir si el script
   del status board respeta el texto estático cuando todo está `completed`; documentar "Validación"
   en la estructura dev de `agent-reference.md`; regla de `<title>`.
2. **F3 — `pickler-retomar`**: leer `status` del tracker `testflight-*` más reciente (no el contador
   "En implementación" del index, que cuenta `pending`); no inferir fechas de trabajo del `date` del
   manifest; contar `<article class="phase-card">`, no cadenas.
3. Estilos inline repetidos (h3 "Rulings en ejecución" ×4; `ol`/`ul` en perpl).
4. `docs/superpowers/plans/2026-09-16-*.md` citan rutas viejas de handoffs (histórico, por decisión).

## Rollback

No se escribió en producción ni fuera del worktree. Deshacer = `git revert` de los commits de F2
(`ad8051f`, `25df1ac` y la ola de fixes); los renames vuelven con el revert.

## Revisión final de rama

Revisor independiente (Opus): **APPROVE WITH FIXES** — 0 Critical, 0 Important, 7 Minor. Minors 1–6
corregidos en una ola (F1 doblado en dos `phase-title`; 5.º punto del build 3; etiqueta "Lo aprendido";
`<title>` completos; roadmap → catálogo; placeholders del footer del build 4) y re-revisados; Minor 7
diferido a F3 (ruling arriba).

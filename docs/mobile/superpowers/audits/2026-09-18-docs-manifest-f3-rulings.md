# Sistema docs/manifest · F3 Skills — audit

**Estado:** F3 ejecutada el 2026-09-18 en `.claude/worktrees/docs-manifest`, rama
`chore/docs-manifest`, sobre F2 (`c071066`). Cierra el proyecto: las tres fases del spec están
hechas. Sin push, sin merge (decisión de Jesús). Spec:
`docs/superpowers/specs/2026-09-18-docs-manifest-design.md` §5/D9; plan:
`docs/superpowers/plans/2026-09-18-docs-manifest-f3.md`. Ejecución: Tasks 1–4 por cuatro
subagentes en paralelo (template/CSS, y una skill cada uno), Task 5 por el coordinador, Task 6 con dos
pruebas E2E en sesión limpia (`pickler-retomar` y `pickler-overview-new`) y revisión final de rama
independiente.

## Rulings

| Decisión | Motivo y costo si fuera incorrecta |
|---|---|
| Las skills se escribieron en paralelo con los cambios de template que describen | Archivos disjuntos; la revisión final compara ambos. Costo: una regla descrita y no materializada; se detectaría en el primer uso. |
| `data-done` en `[data-sb="next"]`: el script del status board respeta ese texto cuando todas las fases están `completed`; en cualquier otro caso manda el runtime | Mínimo cambio al script heredado (una expresión). Costo: si Proflores cambia ese script, este hunk hay que reaplicarlo. |
| Reglas compartidas en `_styles.css` (`table.decisions`, `.section-sub`) en vez de estilos inline; perpl conserva dos inline justificados (un `<ol>` que no es hermano directo del h3 y el `<ul>` de Modelo) | Evita que la skill propague inline. Costo: dos excepciones documentadas en el reporte de Task 1. |
| Comentario "← Las entradas nuevas se pegan aquí (más reciente primero)" movido al **inicio** del array del manifest | Contradecía la regla "más reciente primero" (hallazgo de la autora de `overview-new`). Costo: ninguno. |
| Snippet de cuentas de `pickler-retomar` en `node -e` en vez de `grep … \| xargs sed` | El sandbox de sesiones en worktree rechaza comandos con rutas calculadas; el E2E lo demostró. Costo: ninguno; el node es más largo pero determinista. |
| El proyecto docs-manifest entra al manifest con overview de 3 fases | Regla "una entrada por spec"; el E2E de `retomar` lo reportó como caja negra. Se creó con un agente sin contexto siguiendo `pickler-overview-new` (dogfood). Costo: una entrada más que mantener. |
| `pickler-overview-new` corregida tras el dogfood: fases con historial, spec existente, assets opcional, `phase-title` sin prefijo, ruido del scratchpad de render | Lagunas reales al usarla sobre un proyecto ya en marcha. Costo: la skill crece a ~10 KB; sigue bajo el límite. |
| `behavior-cases.json` con 8 casos de las skills `pickler-*`, revisados a mano (no hay evaluador automático) | Igual que Proflores. Costo: ninguno; documenta intención de routing. |

## Correcciones a lo afirmado antes

- F2 dejó "Próximo paso" como texto estático que el script pisaba; ahora se muestra vía `data-done`
  (verificado en `results.json`: `board.next` = "Cerrado el 2026-09-16 — siguiente en
  docs/04-roadmap-bounty.md" en los 4 overviews).
- El plan de F3 decía "≤ 14 KB" para `retomar`; el fix round 1 obligó a recortar prosa para caber
  (13 991 B). El revisor final comprobó que las reglas de `cancelled` y de squash/PR siguen presentes;
  ninguna regla cambió de sentido.
- El revisor final encontró dos errores de hecho en `pickler-retomar` (una rama `feat/mobile-fase1`
  que no existe; "6 entradas" ya desactualizado) y un defecto heredado del index de Proflores
  (`findIndex` asume fases desde 0 → "F2 en progreso" cuando es F3). Corregidos en la ola de cierre.
- El plan pedía `agents:check` con `manifest: 6`; tras el dogfood son **7** entradas y **5**
  comparables.

## Evidencia

- `npm run agents:check` → exit 0, `errors: []`, `skills: 3`, `manifest: 7`, `comparable: 5`.
  Contra el defecto: symlink de `pickler-dev-new` apuntando a un directorio inexistente →
  `missing skill discovery entry` + `broken skill discovery link`, exit 1; restaurado → 0.
- `npm run agents:test` → 11/11. `npm run docs:check` → limpio.
- **E2E `pickler-retomar`** (agente Sonnet sin contexto, sólo el SKILL.md): reporte con tabla git
  (`chore/docs-manifest` `unknown_review` 16 commits sin push; 4 `feat/mobile-*` integradas),
  4 proyectos 1/1, 2 trackers (build 4 pending, build 3 shipped), "faltan 25 días", cuentas
  (#620, #619/KAT) con la advertencia de re-medir, residual del audit de F2, pregunta final.
- **E2E `pickler-overview-new`** (agente Sonnet sin contexto): `docs/overview/2026-09-18-docs-manifest.html`
  con 3 phase-cards (F1/F2 completed, F3 in_progress), decisiones D1–D9, 10 rulings de los audits,
  entrada al principio del manifest; render 1440/390 sin overflow; captura mirada.
- Render de las 8 páginas: sin overflow; `board.next` correcto en todas.
- Tamaños: `pickler-retomar` 13 991 B, `pickler-overview-new` 9 956 B, `pickler-dev-new` 8 927 B.

## Residuales

1. `pickler-dev-new` no tuvo E2E en sesión limpia (sólo revisión); el primer build real (build 4) será
   su prueba.
2. `behavior-cases.json` se revisa a mano; no hay evaluador.
3. `render-check` sin argumento renderiza 8 páginas × 2 anchos (~1 min con red; 30 s de timeout por
   página sin red).
4. Residuales heredados de F1/F2 que siguen abiertos: paleta clara sin referencia de diseño; backticks
   en el TOC del conversor; `npm audit` transitivo; planes históricos con rutas viejas de handoffs.

## Rollback

No se escribió en producción ni fuera del worktree. Deshacer F3 = `git revert` de `d92f74a..HEAD`
(plan, template/CSS, skills, symlinks, overview docs-manifest, audit).

## Revisión final de rama

Revisor independiente (Opus) sobre `c071066..3d9fac0`: **APPROVE WITH FIXES** — 0 Critical,
3 Important (index `findIndex` 0-based heredado; ejemplo falso de ramas en `retomar`; cifra "6
entradas" desactualizada en `retomar` y `behavior-cases.json`), 7 Minor. Verificó: las tres skills
contra `docs/CLAUDE.md`/`agent-reference.md` (sin contradicciones salvo las 3 anteriores); los 4
snippets de `retomar` corriendo desde el worktree sin `xargs`/`sed`; gates de `check.mjs`; templates
retrocompatibles (`data-done` ausente → "— todo completo"; `_styles.css` vs origen = `--on-brand` +
reglas nuevas); render de 8 páginas; `behavior-cases.json` respaldado línea a línea por las skills;
fidelidad del overview docs-manifest; merge readiness (78 archivos, nada de `apps/mobile`,
`node_modules`, `.superpowers` ni `.env`; enlaces del README OK).

Ola de cierre: Important 1–3 y Minor 4–6 corregidos; F3 → `completed` en overview y manifest,
`data-done` con el texto de cierre, Task 6 marcada. Minors diferidos: `assets/<fecha>-<slug>` vs
`assets/<slug>` (alinear cuando exista el primer asset); `[[DONE_TEXT]]` literal en el template si un
clon no lo sustituye (`check.mjs` no detecta placeholders); regla opcional `.section-sub + p + ol`.

# Sistema de documentación con manifest (modelo Proflores) — design spec

**Fecha**: 2026-09-18. **Estado**: aprobado en brainstorming; pendiente el plan de F1.
**Origen**: `proflores-monorepo` (`docs/overview/`, `docs/superpowers/`, `scripts/agent-infra/`,
`.agents/skills/proflores-{retomar,overview-new,dev-new}`), estado medido el 2026-09-18.

## 1. Visión

Hoy el estado de Pickler vive repartido en cinco sitios que no se leen entre sí: la tabla del
roadmap (`docs/04-roadmap-bounty.md`), el "Estado" del README (desactualizado: dice fase 1
cuando fase 2 ya está en TestFlight), cuatro handoffs (`docs/05..08`), la memoria de Claude y
git. Ninguno es máquina-legible; retomar una sesión exige leerlos todos.

Se adopta **completo** el modelo de Proflores: un manifest (`docs/overview/data/manifest.js`)
como registro de proyectos con fases, un dashboard (`index.html`) que lo consume, **un overview
HTML por sub-proyecto**, dev trackers para cambios de un PR, spec + plan en Markdown con HTML
vecino autogenerado, **un audit por fase ejecutada**, tooling que valida que todo eso coincida,
y tres skills (`retomar`, `overview-new`, `dev-new`) que lo operan.

## 2. Decisiones

| # | Decisión | Alternativa descartada | Por qué |
|---|---|---|---|
| D1 | **Copia completa** del sistema, incluidos sub-catálogos (`dev/`, `explorations/`, `prs/`, `playgrounds/`, `reports/`), conversor MD→HTML y `render-check`. | Núcleo (manifest + overview + audits + check ligero); sólo manifest sin HTML. | Decisión de Jesús: más control del desarrollo y de la documentación desde el inicio, aunque hoy sean 6 entradas. |
| D2 | **Mover a la estructura de Proflores** con `git mv`: `docs/specs` → `docs/superpowers/specs`, `docs/plans` → `docs/superpowers/plans`; nuevo `docs/superpowers/audits`. | Dejar rutas actuales y parchear `check.mjs` y `docs-md-to-html.mjs`. | El tooling se copia literal y las mejoras futuras de Proflores se traen sin adaptar. Git conserva el historial por rename. |
| D3 | **Una entrada por spec.** Retro: 4 overviews (fase1, ui-port, wallet, perpl), 2 dev trackers (build 3 `shipped`, build 4 `pending`). Fase 3 y fase 4 **no entran** hasta tener brainstorm. | Entradas `pending` para fase 3/4 "para verlas en el dashboard". | Regla de Proflores: `types`, fases y estados describen artefactos realmente escritos; no se inventan fases. |
| D4 | Los **4 handoffs se mueven tal cual** a `docs/superpowers/audits/<fecha>-<topic>-f1-rulings.md`, sin reescribirlos. | Reescribirlos al formato rulings/correcciones/evidencia/residuales/rollback; dejarlos en `docs/0N`. | Ya contienen rulings, aprendido y residuales; reescribir historia sin evidencia nueva es riesgo sin beneficio. El formato canónico aplica a los audits nuevos. |
| D5 | **npm** en la raíz (nuevo `package.json` con `agents:check`, `agents:test`, `agents:inventory`; devDeps `yaml`, `puppeteer-core`). `render-check` usa el **Chrome ya instalado** vía `executablePath` (override con `PICKLER_CHROME`), no descarga Chromium. | pnpm como Proflores; `puppeteer` completo (~300 MB de Chromium). | `apps/mobile` ya usa npm (`package-lock.json`); no se introduce un segundo gestor. Sin workspaces: `apps/mobile` sigue independiente. Decisión de Jesús: usar el Chrome local. |
| D6 | **Marca Pickler, dark por defecto.** Tokens desde `apps/mobile/src/ui/theme.ts` (lime `#C8F03A`, violeta `#7A5CFF`, up `#7BE38A`, down `#F2777A`, warn `#F5C35B`, fondo `#08080A`), Manrope + JetBrains Mono. Esquema claro como `prefers-color-scheme: light`. Strings "Proflores" → "Pickler"; localStorage `pickler-docs:` / `pickler-md:`. | Conservar verde Proflores; light por defecto. | Pickler es dark-first en la app y la landing. Se cambian tokens y strings; la estructura de `_styles.css` no se toca. |
| D7 | **Se excluye** de la copia: `scripts/agent-infra/personal/`, `codex-kit/`, `install-personal.mjs` (+ tests), `personal.test.mjs`, `codex-kit.test.mjs`, `workflow-contract-provenance.json`, `docs/superpowers/deployment/`, `docs/superpowers/PROMPT-*.md`, `apps/render-service`. | Copiar todo el directorio. | Son el paquete de skills personales de home (ya instalado) o contenido de Proflores, no parte del modelo. Puppeteer va como devDependency de raíz. |
| D8 | Contratos: nuevos `CLAUDE.md` + `AGENTS.md` en raíz (cortos: Pickler, npm, `apps/mobile`, puntero a `docs/`), y `docs/CLAUDE.md` + `docs/AGENTS.md` + `docs/agent-reference.md` adaptados (rutas, npm, marca; sin la historia F2–F6 de HTML Maximalism). | Sólo `docs/`. | `check.mjs` exige el gemelo `AGENTS.md` por cada `CLAUDE.md` y una cadena de instrucciones ≤ 24 KiB; la raíz hoy no tiene ninguno. |
| D9 | Skills en `.agents/skills/pickler-{retomar,overview-new,dev-new}/SKILL.md` con symlinks en `.claude/skills/`. | Sólo `.claude/skills/`. | Mismo patrón que Proflores y que el home de Jesús; `check.mjs` valida los symlinks. |

## 3. Estructura resultante

```
predict/
├── CLAUDE.md · AGENTS.md · package.json
├── .agents/skills/pickler-{retomar,overview-new,dev-new}/SKILL.md
├── .claude/skills/pickler-* → ../../.agents/skills/pickler-*
├── docs/
│   ├── 00-historia … 04-roadmap-bounty  (sin mover; enlaces actualizados)
│   ├── CLAUDE.md · AGENTS.md · agent-reference.md
│   ├── overview/
│   │   ├── index.html · _project-template.html · _styles.css · _syntax.js
│   │   ├── data/manifest.js  (6 entradas)
│   │   ├── 2026-09-15-mobile-fase1.html · 2026-09-16-mobile-ui-port.html
│   │   ├── 2026-09-16-mobile-wallet.html · 2026-09-16-mobile-perpl.html
│   │   ├── dev/_template.html · dev/2026-09-16-testflight-build3.html · dev/2026-09-17-testflight-build4.html
│   │   ├── explorations/_template.html · prs/_template.html · playgrounds/_template.html · reports/_template.html
│   │   └── assets/<slug>/  (vacías)
│   └── superpowers/
│       ├── specs/   4 specs movidos + este + HTML vecino de cada uno
│       ├── plans/   4 planes movidos + HTML vecino
│       └── audits/  2026-09-16-mobile-fase1-f1-rulings.md · …-ui-port-f1-rulings.md
│                    · …-wallet-f1-rulings.md · …-perpl-f1-rulings.md
└── scripts/
    ├── docs-md-to-html.mjs · test-lock.sh
    └── agent-infra/ check.mjs · check.test.mjs · branches.mjs · branches.test.mjs
                     · build-state.mjs · build-state.test.mjs · check-changed-docs.mjs
                     · generator.test.mjs · html-facts.py · render-check.mjs
                     · behavior-cases.json · README.md
```

Las fechas de los audits son las del handoff original (`docs/05` → fecha de su cierre), no la
de hoy; el `<topic>` es el slug del spec al que cierran.

## 4. Retro-relleno (contenido de las 6 entradas)

| Entrada | `file` | `types` | `status` | `phases` | Fuente |
|---|---|---|---|---|---|
| Pickler móvil · fase 1 (passkey + tesorería) | `2026-09-15-mobile-fase1.html` | `spec, plan` | `completed` | F1 `completed` | spec/plan del 09-15; audit = handoff 05 |
| Port de la UI de pickler-mobile | `2026-09-16-mobile-ui-port.html` | `spec, plan` | `completed` | F1 `completed` | 09-16 ui-port; handoff 06 |
| Wallet real (withdraw + movements) | `2026-09-16-mobile-wallet.html` | `spec, plan` | `completed` | F1 `completed` | 09-16 wallet; handoff 07 |
| Trading manual en Perpl (pestaña Trade) | `2026-09-16-mobile-perpl.html` | `spec, plan` | `completed` | F1 `completed` | 09-16 perpl; handoff 08 |
| TestFlight build 3 | `dev/2026-09-16-testflight-build3.html` | `feature` | `shipped` | — | commits `f2b4ff7`, `a78b36c`; merge `35649b6`; handoff 08 §Cierre |
| TestFlight build 4 | `dev/2026-09-17-testflight-build4.html` | `feature` | `pending` | — | handoff 08 §"Lista propuesta para el build 4" (5 puntos) |

Cada overview: una `phase-card` F1 `completed` con las tasks del plan marcadas, la sección de
decisiones con las D-numeradas del spec, glosario sólo si el spec lo tiene, footer con paths a
spec, plan y audit. Nada que el spec/plan/handoff no diga.

`docs/04-roadmap-bounty.md` se queda como vista de producto (fases del bounty F1–F4) y enlaza
a los overviews. El README corrige su "Estado" y sus enlaces a handoffs.

## 5. Skills

Las tres se adaptan de las de Proflores conservando estructura, comandos y anti-patterns;
cambian rutas, marca y ejemplos. Específico de **`pickler-retomar`**, además de manifest,
git (`branches.mjs`) y audits:

1. **Deadline del bounty** (13 oct 2026 21:59 CST) y días restantes, calculados con `date`.
2. **Estado del build de TestFlight**: del dev tracker `testflight-*` más reciente del manifest.
3. **Cuentas de testnet** (simulador, KAT, cuentas Perpl): sección "Estado de las cuentas" del
   audit más reciente que la tenga.

Son las tres cosas que en Pickler se pierden entre sesiones y no están en git.

## 6. Verificación

| Comprobación | Resultado esperado |
|---|---|
| `npm run agents:check` | exit 0; `manifest: 6`, `comparable: 4`, `mdCount` = todos los `.md` de specs y plans (4 + 4 movidos, más el spec y los planes de este proyecto) |
| **Contra el defecto**: una fase del manifest a `pending` sin tocar el HTML | falla con `phase IDs/status differ from manifest`; se revierte |
| `npm run agents:test` | verde (usa `scripts/test-lock.sh`) |
| `npm run agents:inventory` | las 4 ramas `feat/*` como `integrated_ancestry` contra `origin/main` |
| `node scripts/docs-md-to-html.mjs --all --check` | sin diferencias |
| `node scripts/agent-infra/render-check.mjs <scratch>` | capturas 1440/390 del index y de un overview, **abiertas y miradas** antes de afirmar calidad visual |

## 7. Fases

Una por sesión, con checkpoint entre ellas (contrato de trabajo de Jesús).

- **F1 · Infraestructura**: `git mv` (D2), copia del tooling (D7), `package.json` (D5), marca
  (D6), contratos (D8), manifest vacío, HTML vecino de los 8 MD movidos + este spec.
  Cierre: `agents:check`, `agents:test`, `docs-md-to-html --all --check` verdes.
- **F2 · Retro-relleno**: 4 overviews, 2 dev trackers, 6 entradas, audits (D4), README y
  roadmap. Cierre: check verde + prueba contra el defecto + render mirado.
- **F3 · Skills**: las tres (D9) + symlinks + actualizar la memoria de este proyecto.
  Cierre: check verde (skills contadas) y `/pickler-retomar` ejecutada en una sesión limpia
  reportando las 6 entradas, git, deadline, build y cuentas.

## 8. Fuera de scope

- Reescribir los handoffs al formato canónico de audit (D4).
- Entradas para fase 3 (agentes) y fase 4 (harness) antes de su brainstorm (D3).
- CI (`test.yml`, `build-images.yml`) de Proflores: `predict` no tiene workflows; se evalúa
  cuando exista uno.
- Instalador de skills personales y `codex-kit` (D7).
- Cualquier cambio en `apps/mobile`.

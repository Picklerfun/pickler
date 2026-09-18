---
name: pickler-overview-new
description: "Use when the user wants to create a new project overview HTML in docs/overview/. Triggers on phrases like 'nuevo overview', 'crea overview para X', 'abre dashboard para X', 'necesito un overview de Y'. Clones _project-template.html, fills placeholders from the approved spec, adds manifest entry, renders and looks at it."
---

## Contrato local de alcance

Reutiliza alcance, fases y decisiones ya aprobados — no los reinventes. Completa contenido conocido; elimina bloques de ejemplo sin utilidad (Decisiones, Modelo, Glosario, Rulings si todavía no aportan nada real). No inventes fases, assets ni enlaces a archivos ausentes: `types`, `phases` y estados describen artefactos realmente escritos. Si todavía no hay un spec o alcance aprobado para este proyecto, no fabriques uno: propón `superpowers:brainstorming` (o explora y presenta el diseño para revisión) antes de crear el overview. Reconciliar manifest y HTML al terminar; renderizar y **mirar** la captura no es opcional — correr el script no prueba haberla inspeccionado.

# Crear nuevo project overview · Pickler

El usuario quiere arrancar un proyecto nuevo y necesita su dashboard HTML interactivo bajo `docs/overview/`. Tu trabajo: clonar el template canónico, llenar los placeholders con el alcance ya aprobado, agregar la entrada al manifest, generar el HTML del spec y renderizar + mirar el resultado.

## Inputs a detectar del mensaje del usuario

Deriva los campos editoriales del alcance aprobado. Pregunta solo decisiones materiales que falten; no repitas aprobaciones.

- **Topic / slug** (required): kebab-case corto. Ej. `mobile-wallet`, `trade-limits`. Si el usuario da un título largo, propón un slug y confírmalo.
- **Título completo** (required): el `<h1>` del overview (parte principal + acento).
- **Lede** (required): 1-2 oraciones de qué resuelve el proyecto y para quién. Si falta, derívalo del alcance aprobado.
- **Fases** (según plan aprobado): si el brainstorm definió F1, F2… úsalas tal cual. Si el proyecto es de una sola fase, es **F1** — Pickler numera fases desde 1, no desde 0 (revisa `phases` en `docs/overview/data/manifest.js` para confirmar el patrón vigente). Si no hay fases acordadas, no inventes: registra "por definir" y detente a preguntar.
- **Tags** (optional, default `[]`): strings en minúsculas para el manifest.

## Proceso

1. **Verifica que hay alcance aprobado.** Si no existe spec/diseño aprobado para este proyecto todavía, no crees el overview: propón brainstorming, o explora y presenta el diseño para revisión primero.
2. **Resuelve los inputs.** Pregunta solo lo que falta.
3. **Calcula la fecha**: `date +%F` (formato `YYYY-MM-DD`). El filename final es `<YYYY-MM-DD>-<slug>.html`.
4. **Lee el template**: `docs/overview/_project-template.html` — fuente canónica, carga `_styles.css` y `_syntax.js` compartidos.
5. **Genera el HTML del overview**: copia el template a `docs/overview/<YYYY-MM-DD>-<slug>.html` y:
   - `<body data-slug="[[SLUG]]">` → el slug real, sin fecha.
   - `<title>[[PROJECT_TITLE]] · Pickler</title>` → el **h1 completo** (parte principal + acento), no solo la mitad.
   - Hero: `[[PROJECT_TITLE]] <span class="accent">[[ACCENT_TITLE]]</span>` → divide el título en parte principal + acento.
   - `[[LEDE]]` y `[[TLDR_BODY]]` → el lede aprobado.
   - `[data-sb="next"]` trae `data-done="[[DONE_TEXT]]"`: en la creación déjalo **vacío** (`data-done=""`). El runtime solo lo usa cuando todas las fases quedan `completed`; no lo rellenes antes de ese momento.
   - El template trae dos `<article class="phase-card">` de ejemplo (F0 y F1). Bórralas o duplícalas hasta tener exactamente **una `phase-card` por fase del spec** (no una por plan escrito ni una por commit), `data-phase` numérico consecutivo empezando en **1** (no en 0) e igual al de `manifest.js`. El `data-status` de cada card refleja el estado **real** de esa fase, no `pending` por default: `completed` solo si hay audit que lo acredite; `in_progress` si hay plan y commits en ejecución sin cerrar; `plan_ready` si hay plan escrito sin ejecutar; `pending` si todavía no hay plan. Las tasks del `<details class="tasks">` salen de los `### Task N:` de cada plan (una `<li>` por task), marcadas (`checked`) solo si el audit o los commits acreditan que se completaron — no las marques por default. Verifica el resultado contando `<article class="phase-card"` en el HTML final — no busques el string "phase-card" en general, también aparece en CSS y en el script.
   - `<h3 class="phase-title">` lleva solo el nombre de la fase, **sin** prefijo `F1 ·` / `F2 ·` — el `<span class="phase-num">` de al lado ya lo muestra (así lo hacen los 4 overviews de F2 y el de docs-manifest).
   - Sección Decisiones: rellena con decisiones reales del spec; omite la tabla completa si todavía no hay ninguna.
   - Bloque "Rulings en ejecución" (`<h3 class="section-sub">` + lista con `[[RULING_1]]`/`[[RULING_2]]`): en un overview recién creado **no hubo ejecución todavía** — elimina el bloque entero. Se agrega después, al cerrar la fase, con los rulings reales tomados del audit (regla 5 de `docs/agent-reference.md`).
   - Sección Modelo: incluye solo diagramas/snippets/assets reales y existentes; si no hay nada concreto todavía, recorta la sección completa (varios overviews existentes la omiten).
   - Glosario: define solo términos que el spec realmente usa; omítelo si no aporta.
   - Path del asset: `assets/[[SLUG]]/01-screenshot.png` → `assets/<YYYY-MM-DD>-<slug>/01-screenshot.png`.
   - Footer: paths reales a `docs/superpowers/specs/<YYYY-MM-DD>-<slug>-design.md` y `docs/superpowers/plans/<YYYY-MM-DD>-<slug>-f*.md`.
6. **Agrega la entrada al manifest**: edita `docs/overview/data/manifest.js`, inserta el nuevo objeto **al principio** del array `window.DOCS` (justo después de `window.DOCS = [`) — se lee más reciente primero. No borres ni reordenes entradas existentes. Shape:

   ```js
   {
     date: 'YYYY-MM-DD',
     title: '...',
     summary: '...',   // ≈ lede, 1-2 líneas
     file: 'YYYY-MM-DD-<slug>.html',
     types: ['spec', 'plan'],
     status: 'active',
     tags: [...],       // minúsculas
     phases: [
       { num: 1, status: 'pending' },
       // ...todas en pending al crear; numeración igual a los data-phase del HTML
     ],
   }
   ```

7. **Carpeta de assets, solo si hace falta**: crea `docs/overview/assets/<YYYY-MM-DD>-<slug>/` únicamente cuando exista una captura real que vas a referenciar desde el overview — ningún overview actual la tiene. No crees carpetas vacías "por si acaso".
8. **Spec**: si `docs/superpowers/specs/<YYYY-MM-DD>-<slug>-design.md` **no existe todavía**, créalo con el alcance aprobado (Visión, Por qué ahora, Roadmap, Decisiones clave, Fuera de scope) — usa `superpowers:brainstorming` si alguna sección no está resuelta, no la rellenes con relleno. Si el spec **ya existe** (lo normal cuando el overview se crea después del brainstorming), no lo toques: solo comprueba que tiene su HTML vecino con `npm run docs:check`.
9. **Corre el converter** (solo si el spec es nuevo): `node scripts/docs-md-to-html.mjs docs/superpowers/specs/<YYYY-MM-DD>-<slug>-design.md`. Sin este paso, `npm run docs:check` falla por HTML vecino faltante.
10. **Renderiza y mira el resultado**: `node scripts/agent-infra/render-check.mjs <directorio-scratch> <YYYY-MM-DD>-<slug>` genera capturas a 1440 y 390 px. El scratch se comparte entre sesiones — `results.json` puede traer entradas de corridas anteriores de otros slugs; lee solo las del slug que acabas de renderizar. Antes de decir "listo", **abre la captura de 390 px con la herramienta de lectura de imágenes** — correr el script no cuenta como haberla mirado.
11. **Corre `npm run agents:check`** y confirma que manifest, HTML y symlinks quedan en verde.

## Validación final

Después de crear todo, reporta al usuario un bloque conciso:

```
Overview creado:
   docs/overview/<YYYY-MM-DD>-<slug>.html

Spec stub:
   docs/superpowers/specs/<YYYY-MM-DD>-<slug>-design.md

Manifest actualizado:
   docs/overview/data/manifest.js (entry agregada al principio del array)

Carpeta assets/: creada sólo si hay captura (hoy: no).

npm run agents:check: <resultado>
Captura 390 px mirada: sí/no

Siguiente paso:
  Si el diseño aún no está aprobado del todo, sigue con superpowers:brainstorming;
  si ya hay alcance de F1, escribe el plan con superpowers:writing-plans y luego
  actualiza la phase-card correspondiente a plan_ready.
```

## Reglas críticas

- **NO** crees un HTML por fase. UNO por proyecto.
- **NO** edites el manifest borrando ni reordenando entries existentes — solo agrega la nueva, al principio.
- **NO** uses `innerHTML` ni patterns inseguros; el template ya está limpio.
- **NO** olvides correr `node scripts/docs-md-to-html.mjs` después de crear el spec MD.
- **NO** inventes fases, decisiones ni rulings que no vengan de un spec o un audit real.
- **NO** commitees nada de lo que produzca este skill salvo que te lo pidan explícitamente.
- **SÍ** preserva la paleta Pickler del template (lima `#C8F03A` + violeta `#7A5CFF`, dark por defecto) — no cambies tokens CSS.
- `completed` exige evidencia (comando corrido, build probado, captura mirada) — eso ocurre cuando la fase avanza, no al crear el overview; esta skill solo deja los placeholders (`pending`, `data-done` vacío) listos para cuando llegue ese momento.

## Cuándo NO usar este skill

- Fix de bug, mejora puntual, feature de un solo PR, build de TestFlight → usa `pickler-dev-new` (one-pager dev).
- Exploración de varios enfoques side-by-side → clona `docs/overview/explorations/_template.html` a mano.
- HTML explainer de un PR → clona `docs/overview/prs/_template.html` a mano.
- Snapshot fechado / weekly report → clona `docs/overview/reports/_template.html` a mano.

Convenciones completas en `docs/agent-reference.md`.

---
name: pickler-dev-new
description: "Use when the user wants to register a fix, feature, refactor, or a TestFlight build that ships in a single PR or upload. Triggers on phrases like \"nuevo dev tracker\", \"registra este fix\", \"documenta este feature\", \"trackea este refactor\", \"one-pager de este cambio\", \"registra el build N de TestFlight\", \"documenta el build\". Clones dev/_template.html, adds manifest entry with types: ['fix'|'feature'|'refactor'], fills Validación with real evidence, renders and looks at it."
---

## Contrato local de alcance

Completa qué cambió, por qué, archivos y validación con evidencia real: diff, `git show --stat`, audit o log de subida a TestFlight. Deja el campo con su `contenteditable`/`data-placeholder` cuando el dato no está disponible — no inventes cifras ni resultados. `shipped` requiere evidencia de merge o de build `VALID` con testers asignados; crear el tracker no lo demuestra. No pidas al usuario rellenar datos que ya puedes derivar del repo.

# Crear nuevo dev one-pager · Pickler

El usuario terminó (o está terminando) un cambio chico — fix, feature, refactor de un solo PR, o un build subido a TestFlight — y quiere dejar registro visual en el catálogo. Tu trabajo: clonar el template dev (editable con `contenteditable`), agregar entry al manifest, completarlo con evidencia verificable y revisarlo renderizado; el usuario puede seguir editando después en el browser.

## Inputs a detectar del mensaje del usuario

Deriva slug, título, lede y tipo del cambio aprobado/diff/build. Pregunta solo si falta una decisión material; no le devuelvas al usuario campos que ya puedes completar tú mismo con el repo.

- **Tipo** (required): `fix`, `feature` o `refactor`. "Arreglé X" → `fix`. "Agregué X" → `feature`. "Limpié / extraje X" → `refactor`. **Build de TestFlight** (p. ej. "registra el build 4 de TestFlight", "documenta el build N") → siempre `types: ['feature']`.
- **Slug** (required): kebab-case corto. Para un build de TestFlight es fijo: `testflight-buildN` (con N el número real del build, p. ej. `testflight-build4`). Para fix/feature/refactor: deriva del cambio, ej. `reconnect-trading-signout`, `fees-4-decimales`.
- **Título** (required): el `<h1>` del one-pager. 5-10 palabras. Para builds: `"TestFlight build N"` + acento opcional con lo más notable (ej. "reconnect trading, fees a 4 decimales").
- **Lede** (required): 1-2 líneas de qué cambia.
- **PR / Commit / Fecha** (optional al crear, el usuario los llena en el browser después): si los tienes (del diff aprobado, del audit, de `git log`), úsalos; si no, deja los placeholders `contenteditable`.
- **Tags** (optional): array para el manifest. Para builds de TestFlight, incluye siempre `'mobile'`, `'testflight'`, `'ios'`.

## Proceso

1. **Resuelve los inputs**. Pregunta solo lo que falta.
2. **Calcula la fecha**: `date +%F` (formato `YYYY-MM-DD`). Filename: `<YYYY-MM-DD>-<slug>.html`. Para un build de TestFlight: `<YYYY-MM-DD>-testflight-buildN.html`.
3. **Lee el template**: `docs/overview/dev/_template.html`. Carga `../_styles.css`, tiene `<body data-slug="[[SLUG]]">`, campos `contenteditable="true"` y botón "⬇ Descargar HTML".
4. **Decide qué llenar**: el template está pensado para que el usuario edite **en el browser** los campos punteados. Pero **este skill rellena lo que ya puede derivar de evidencia real**, para que el usuario no tenga que tocarlo:
   - `[[SLUG]]` en `<body data-slug="[[SLUG]]">` → reemplaza por `<YYYY-MM-DD>-<slug>` real (con fecha, no solo el slug).
   - `<title>` → `"<Título completo> · Pickler"`.
   - El breadcrumb `dev/<contenteditable>YYYY-MM-DD-mi-slug</contenteditable>` → reemplaza el textContent con el slug real (mantén `contenteditable="true"` si el usuario podría querer ajustarlo; quítalo si el slug ya es definitivo).
   - `<span class="dev-eyebrow feature">` → ajusta la clase: `dev-eyebrow fix`, `dev-eyebrow feature`, o `dev-eyebrow refactor`. Y el textContent del span interno: `"Fix"` / `"Feature"` / `"Refactor"`.
   - El `<h1>` → reemplaza el primer `<span>` con el título real (el `<span class="accent">` con el acento si aplica, o vacío).
   - El `<p class="lede">` → reemplaza con el lede real.
   - **Estado**, **PR**, **Commit**, **Fecha** del status board → llena con datos verificados; deja `contenteditable` en lo que aún no se sabe.
   - **"Qué cambió"** → bullets sacados del diff aprobado o de un audit real (`docs/superpowers/audits/*.md`), nunca redactados de memoria.
   - **"Archivos tocados"** → corre `git show --stat <sha>` (o `git diff --stat` si el cambio aún no tiene commit) y pega la lista real de paths, sin enlaces.
   - **"Validación"** (sección nueva del template, después de "Archivos tocados") → completa solo con evidencia citable y su fuente:
     - Para un build de TestFlight: nombre y versión del `.ipa`, resultado de la subida (`UPLOAD SUCCEEDED` o el error real), estado en App Store Connect (`VALID` no es suficiente por sí solo — dilo explícito si aún no hay testers asignados; distínguelo de `IN_BETA_TESTING` con grupo asignado), y si hubo prueba en dispositivo real (quién, qué encontró).
     - Cita siempre la fuente entre paréntesis: audit (`docs/superpowers/audits/<archivo>.md`) o commit (`sha`). Si un dato no está verificado, dilo así — "no verificado" — en vez de omitirlo o inventarlo.
5. **Copia el template al destino**: `docs/overview/dev/<YYYY-MM-DD>-<slug>.html` con las modificaciones del paso 4.
6. **Agrega entry al manifest**: edita `docs/overview/data/manifest.js`, inserta **al principio del array** `window.DOCS` (antes de la primera entry existente, no al final ni junto al comentario de cierre):

   ```js
   {
     date: 'YYYY-MM-DD',
     title: '<título>',
     summary: '<lede como summary>',
     file: 'dev/YYYY-MM-DD-<slug>.html',
     types: ['fix'],        // o ['feature'] (incluye builds de TestFlight) o ['refactor']
     status: 'in_progress', // 'pending' / 'in_progress' / 'shipped' — ver regla abajo
     tags: [...],
     // omite `phases` — los devs no tienen fases
   }
   ```

   **Regla de `status`**: usa `shipped` únicamente si tienes evidencia de merge (commit en la rama por defecto) o, para un build de TestFlight, evidencia de que el build quedó `VALID` **y** con testers asignados/notificados. Sin esa evidencia, usa `in_progress` (ya en curso) o `pending` (propuesto, sin empezar) — nunca asumas `shipped` por default.
7. **Renderiza y mira la captura**: `node scripts/agent-infra/render-check.mjs <scratch> dev/<YYYY-MM-DD>-<slug>` (sin `.html`; usa un directorio de scratch, no un path del repo). El script guarda capturas en 1440 y 390px; el nombre de archivo reemplaza `/` por `_` (ej. `dev_2026-09-16-testflight-build3-390.png`). Abre y mira la captura de **390px** antes de decir que quedó listo — confirma que no haya overflow ni texto cortado en móvil.
8. **Corre `npm run agents:check`** antes de cerrar — valida frontmatter, manifest y cadena de instrucciones.

## Validación final

Reporta al usuario:

```
Dev one-pager creado: docs/overview/dev/<YYYY-MM-DD>-<slug>.html
Manifest actualizado (types: ['<tipo>'], status: '<estado verificado>', entry al principio del array).
Contenido completado con la evidencia disponible (fuente: <audit/commit/subida>); campos sin verificar
quedan marcados y siguen editables en el browser.
Render revisado en 1440 y 390px (node scripts/agent-infra/render-check.mjs ...); sin overflow.
npm run agents:check: <resultado>.
```

Si algo no se pudo renderizar o verificar, decláralo explícitamente en vez de omitirlo.

## Cuándo NO usar este skill

- Proyecto multi-fase, cambio de contrato, o trabajo que toma >1 día → usa `pickler-overview-new` (overview completo con spec + plan).
- Typo, rename de variable interna, log adjustment, commits "wip" / "clean tests" → no necesita doc. El registro vive en git log.

## Reglas críticas

- **NO** generes contenido especulativo en "Qué cambió" ni en "Validación". Toda cifra o resultado ("UPLOAD SUCCEEDED", "VALID", "168/168 tests") necesita una fuente citada (audit o commit); si no la tienes, marca el campo como no verificado y déjalo editable.
- **NO** marques `status: 'shipped'` sin evidencia de merge o de build `VALID` con testers asignados. `VALID` solo no demuestra distribución.
- **NO** olvides el `data-slug` con fecha en el `<body>` — reemplaza `[[SLUG]]` completo, no solo el slug sin fecha.
- **SÍ** preserva `contenteditable="true"` y `data-placeholder` en los campos que queden por rellenar; quítalos únicamente en los campos que ya dejaste con dato definitivo y verificado.
- **SÍ** preserva el path relativo `../_styles.css` (el template está en `dev/`, el CSS en `overview/`).
- **NO** commitees sin que el usuario lo pida explícitamente.

Convenciones completas en `docs/CLAUDE.md`.

# Ask — F4: sincronización de Git y TestFlight build 10 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `executing-plans` task by task. Stop at the checkpoints; do not broaden this release into APNs provisioning or unrelated cleanup.

**Goal:** Dejar una base única y auditable antes del siguiente desarrollo: el `aasa-worker` ya desplegado queda versionado, `origin/main` contiene exactamente la app con Ask F3, y TestFlight distribuye `0.1.0 (10)` al grupo interno «Equipo». El build 10 registra la ausencia conocida de secretos APNs; no promete una entrega push real.

**Architecture:** Es una fase de release, no una nueva feature. La fuente de verdad empieza en `origin/main` (`df657c3` al escribir este plan). El Worker no se vuelve a desplegar: se recuperan exactamente los tres archivos sin seguimiento del checkout principal y se contrasta su respuesta con `pickler.fun` y el CDN de Apple. La app sólo cambia `ios.buildNumber` de `9` a `10`. Tras tests y revisión independiente, se integra y pushea; el `.ipa` se archiva desde el commit integrado, se sube y se valida por la API de App Store Connect. El cierre actualiza el overview vivo de Ask, crea el tracker dev del build 10 y deja audit de F4.

**Tech Stack:** Git worktrees; Cloudflare Worker/TypeScript (`wrangler` sólo en `--dry-run`); Expo SDK 57 / React Native 0.86; Jest + TypeScript; Xcode 26.2; `xcrun altool`; App Store Connect API; documentación Pickler (`docs-md-to-html.mjs`, `render-check.mjs`, manifest).

**Spec:** `docs/superpowers/specs/2026-09-19-mobile-ask-design.md`, F4 del overview `docs/overview/2026-09-19-mobile-ask.html`. Estado previo: F1–F3 `completed`, F4 `pending`; TestFlight más reciente = build 9 `VALID` y en «Equipo»; Ask F3 ya está en `origin/main` pero no en TestFlight.

## Global Constraints

- Worktree: `.claude/worktrees/testflight-build10-sync`; rama `release/testflight-build10-sync`; base verificada `origin/main` `df657c3`. Todo cambio se hace aquí hasta la integración. Nunca `git add -A`; agregar archivos por nombre.
- La aprobación de Jesús cubre **commit, push a `main` y subida del build 10**, pero no borra checkpoints: parar si cambia `origin/main`, si el material AASA difiere de los hashes aprobados, si una prueba falla, si el archive no contiene build 10/entitlements esperados o si Apple no asigna el build a «Equipo».
- El checkout principal contiene la única copia sin seguimiento de `infra/aasa-worker/`. Preservarla antes de integrar: moverla a un backup explícito bajo `/private/tmp`, mergear, comparar hashes y conservar el backup hasta el cierre. No borrar ni sobrescribir a ciegas.
- Hashes de la copia aprobada (2026-09-28): `README.md` `8e50b8625cda716821ae25c879c9db852f7a85c09f44480f9c56c133633cdca9`; `src/index.ts` `f56ebbf686e1bf2c2ded5a97da67caac244766653b97c985be91943fdf734b71`; `wrangler.jsonc` `bf00c2adfa3e4ce1e4acda84d94283981227d4bda1c0afb9a80959d1e4498269`.
- **No desplegar Cloudflare**: hoy tanto `https://pickler.fun/.well-known/apple-app-site-association` como el CDN de Apple responden `200 application/json` con `2PBQJ37Q8W.fun.pickler.app`. Sólo dry-run local y verificación HTTP de lectura.
- APNs real queda fuera de F4 por decisión aprobada. Los secretos siguen ausentes y los recordatorios pueden procesarse con `pushSent: 0`; se documenta como residual. No crear keys, cambiar capabilities ni desplegar backend en esta fase.
- Credenciales ASC: leer `apps/mobile/.env.asc` del checkout principal y el `.p8` existente en `/Users/josedejesusacevedoflores/.appstoreconnect/private_keys/`; nunca copiarlos al repo, imprimirlos ni incluirlos en evidencia.
- Tests con el lock global: desde `apps/mobile`, `bash ../../scripts/test-lock.sh npm test`. `npx tsc --noEmit` después. Registrar conteos reales; no copiar los históricos.
- Antes de integrar, revisión independiente obligatoria de requisitos, diff y evidencia. El revisor no escribe. Después de integrar, el `.ipa` debe corresponder al SHA de código/infra que entró a `main`; commits posteriores pueden ser sólo documentación de la subida.
- La prueba en iPhone no abre operaciones ni mueve fondos: instalar build 10, arranque/sign-in por passkey, abrir BTC, comprobar Ask/Agents y el book L2 de Trade. La entrega push real se marca no verificada por APNs, no se fuerza una orden.

## Decisiones del plan

| # | Decisión | Razón |
|---|---|---|
| P1 | El Worker desplegado se versiona sin redeploy. | Producción y el CDN de Apple ya sirven el cuerpo correcto; desplegar otra vez añadiría riesgo sin cambiar el resultado. |
| P2 | Build 10 contiene el `main` actual con Ask F3 y el único cambio de app es `buildNumber: "10"`. | Apple exige un número nuevo; cualquier cambio funcional adicional rompería la idea de baseline sincronizada. |
| P3 | APNs no bloquea `VALID` + grupo «Equipo» ni el cierre de sincronización, pero queda visible en tracker, audit y overview. | Jesús aprobó separar la deuda de notificaciones de esta liberación. |
| P4 | F4 sólo pasa a `completed` después de distribución y humo real en el iPhone. | `VALID` prueba procesamiento, no que el binario arranque ni que los passkeys sigan resolviendo con el AASA vivo. |
| P5 | El tracker build 10 se crea después de la respuesta real de Apple. | `shipped` exige evidencia de `VALID` y testers asignados; no se anticipan UUID, tamaños ni estados. |

## Mapa de archivos

| Archivo | Task | Cambio |
|---|---|---|
| `infra/aasa-worker/README.md` | 1 | Versionar operación y verificación del Worker ya desplegado. |
| `infra/aasa-worker/src/index.ts` | 1 | Versionar handler exacto del AASA. |
| `infra/aasa-worker/wrangler.jsonc` | 1 | Versionar ruta exacta de zona. |
| `apps/mobile/app.config.ts` | 2 | `ios.buildNumber` 9 → 10; ningún otro cambio funcional. |
| `docs/superpowers/specs/2026-09-19-mobile-ask-design.md` + HTML | plan / 5 | Corregir F4 con build 10 y APNs como residual aprobado. |
| `docs/superpowers/plans/2026-09-19-mobile-ask-f4.md` + HTML | plan | Este plan y su HTML generado. |
| `docs/overview/2026-09-19-mobile-ask.html`, `docs/overview/data/manifest.js` | plan / 5 | F4 `plan_ready` ahora; `completed` sólo con evidencia final. |
| `docs/overview/dev/2026-09-28-testflight-build10.html` | 5 | Tracker con evidencia real de archive/upload/ASC/iPhone. |
| `docs/superpowers/audits/2026-09-28-mobile-ask-f4-rulings.md` | 5 | Rulings, correcciones, evidencia, residuales y rollback de F4. |

---

### Task 1: Recuperar y verificar `infra/aasa-worker`

**Files:** Create `infra/aasa-worker/README.md`, `infra/aasa-worker/src/index.ts`, `infra/aasa-worker/wrangler.jsonc` con el contenido exacto de la copia aprobada del checkout principal.

- [ ] **Step 1: Revalidar base y propiedad**

```bash
cd /Users/josedejesusacevedoflores/Documents/predict/.claude/worktrees/testflight-build10-sync
git fetch origin main --prune
git rev-list --left-right --count HEAD...origin/main
git status --short --branch
```

Expected: `0 0`, árbol limpio salvo los docs de este plan. Si `origin/main` avanzó, parar y revisar el diff antes de rebasear.

- [ ] **Step 2: Revalidar la fuente antes de copiar**

```bash
cd /Users/josedejesusacevedoflores/Documents/predict
shasum -a 256 infra/aasa-worker/README.md infra/aasa-worker/src/index.ts infra/aasa-worker/wrangler.jsonc
```

Expected: los tres hashes de Global Constraints. Si alguno cambió, parar: puede pertenecer a otra sesión.

- [ ] **Step 3: Añadir los tres archivos exactos al worktree**

Usar `apply_patch` para reproducir el contenido aprobado; no modificar copy, ruta, account id ni cache headers. Después:

```bash
cd /Users/josedejesusacevedoflores/Documents/predict/.claude/worktrees/testflight-build10-sync
shasum -a 256 infra/aasa-worker/README.md infra/aasa-worker/src/index.ts infra/aasa-worker/wrangler.jsonc
git diff --check
git status --short
```

Expected: hashes idénticos; sólo tres archivos AASA más los docs del plan.

- [ ] **Step 4: Probar el artefacto y el estado vivo sin desplegar**

```bash
cd infra/aasa-worker
npx wrangler@latest deploy --dry-run --outdir /private/tmp/pickler-aasa-worker-dry-run
curl -sS -D /private/tmp/pickler-aasa-origin.headers https://pickler.fun/.well-known/apple-app-site-association -o /private/tmp/pickler-aasa-origin.json
curl -sS -D /private/tmp/pickler-aasa-apple.headers https://app-site-association.cdn-apple.com/a/v1/pickler.fun -o /private/tmp/pickler-aasa-apple.json
```

Expected: dry-run compila; ambos endpoints `200`, `content-type: application/json`, sin redirect, y ambos cuerpos son exactamente `{"webcredentials":{"apps":["2PBQJ37Q8W.fun.pickler.app"]}}`. Un fallo HTTP bloquea la release; no improvisar un deploy.

---

### Task 2: Preparar y probar la app como build 10

**Files:** Modify `apps/mobile/app.config.ts` sólo en `ios.buildNumber`.

- [ ] **Step 1: Instalar y medir baseline**

```bash
cd /Users/josedejesusacevedoflores/Documents/predict/.claude/worktrees/testflight-build10-sync/apps/mobile
npm ci
bash ../../scripts/test-lock.sh npm test
npx tsc --noEmit && echo TSC-OK
```

Expected: suites/tests reales en verde y `TSC-OK`. Cualquier rojo se investiga; no se atribuye a “preexistente” sin demostrarlo contra `origin/main`.

- [ ] **Step 2: Demostrar el número viejo antes del cambio**

```bash
rg -n 'buildNumber: "9"' app.config.ts
```

Expected: una coincidencia. Cambiar únicamente `buildNumber: "9"` por `buildNumber: "10"` con `apply_patch`.

- [ ] **Step 3: Validar configuración y regresión completa**

```bash
npx expo config --type public --json | jq '{name,version,ios:{bundleIdentifier:.ios.bundleIdentifier,buildNumber:.ios.buildNumber,associatedDomains:.ios.associatedDomains}}'
bash ../../scripts/test-lock.sh npm test
npx tsc --noEmit && echo TSC-OK
cd ../..
git diff --check
git add -N infra/aasa-worker/README.md infra/aasa-worker/src/index.ts infra/aasa-worker/wrangler.jsonc docs/superpowers/plans/2026-09-19-mobile-ask-f4.md docs/superpowers/plans/2026-09-19-mobile-ask-f4.html
git diff --stat origin/main
git diff origin/main -- apps/mobile/app.config.ts infra/aasa-worker
```

Expected: `Pickler`, versión `0.1.0`, bundle `fun.pickler.app`, build `10`, associated domain `webcredentials:pickler.fun`; tests y tsc verdes; `git diff origin/main` incluye también los archivos nuevos (intent-to-add) y el diff funcional queda limitado al bump y a los tres archivos del Worker.

---

### Task 3: Revisión independiente, integración y push

- [ ] **Step 1: Revisión independiente**

Entregar al revisor: spec F4, este plan, `git status --short` y el **diff completo de trabajo** `git diff origin/main` (los archivos nuevos deben aparecer gracias al `git add -N` de Task 2), hashes AASA, salida de dry-run/HTTP, tests/tsc y config Expo. Debe comprobar lógica del Worker, exactitud de ruta/body/headers, ausencia de secretos, que no haya cambio funcional extra y que build 10 sea único. Registrar veredicto y fixes en el audit; re-ejecutar evidencia si hay correcciones. Si el diff no muestra `infra/aasa-worker/*` y los dos archivos del plan, la revisión es inválida y no se integra.

- [ ] **Step 2: Commit de release con archivos explícitos**

```bash
git add infra/aasa-worker/README.md infra/aasa-worker/src/index.ts infra/aasa-worker/wrangler.jsonc apps/mobile/app.config.ts docs/superpowers/specs/2026-09-19-mobile-ask-design.md docs/superpowers/specs/2026-09-19-mobile-ask-design.html docs/superpowers/plans/2026-09-19-mobile-ask-f4.md docs/superpowers/plans/2026-09-19-mobile-ask-f4.html docs/overview/2026-09-19-mobile-ask.html docs/overview/data/manifest.js
git diff --cached --check
git commit -m "chore(release): preparar TestFlight build 10 y versionar AASA"
```

Antes del commit, los HTML/docs deben haber pasado los checks de la etapa de plan y sólo contener F4 `plan_ready`, no resultados futuros.

- [ ] **Step 3: Preservar la copia sin seguimiento e integrar en `main`**

En el checkout principal, verificar nuevamente que `main == origin/main` y que el único cambio sea `infra/aasa-worker/`. Mover esa carpeta a `/private/tmp/pickler-aasa-worker-pre-sync-2026-09-28` (abortar si el destino ya existe), hacer merge no interactivo de `release/testflight-build10-sync`, comparar los tres hashes entre el backup y los archivos ya trackeados, y conservar el backup hasta el cierre.

```bash
set -euo pipefail
cd /Users/josedejesusacevedoflores/Documents/predict
git fetch origin main --prune
git rev-list --left-right --count main...origin/main
git status --short --branch
test ! -e /private/tmp/pickler-aasa-worker-pre-sync-2026-09-28
mv infra/aasa-worker /private/tmp/pickler-aasa-worker-pre-sync-2026-09-28
(cd /private/tmp/pickler-aasa-worker-pre-sync-2026-09-28 && shasum -a 256 README.md src/index.ts wrangler.jsonc) > /private/tmp/pickler-aasa-before.sha256
git merge --no-ff release/testflight-build10-sync -m "Merge release/testflight-build10-sync: AASA versionado y build 10 preparado"
(cd infra/aasa-worker && shasum -a 256 README.md src/index.ts wrangler.jsonc) > /private/tmp/pickler-aasa-after.sha256
diff -u /private/tmp/pickler-aasa-before.sha256 /private/tmp/pickler-aasa-after.sha256
git push origin main
git fetch origin main
git rev-list --left-right --count main...origin/main
git status --short --branch
```

Expected: `0 0`, checkout principal limpio, Worker trackeado. Si el merge o push falla, no archivar todavía.

---

### Task 4: Archivar, subir y verificar TestFlight build 10

- [ ] **Step 1: Archivar desde el `main` integrado**

Registrar `git rev-parse HEAD` como `RELEASE_SHA`. Desde `apps/mobile` del checkout principal, cargar en el entorno `ASC_KEY_ID`/`ASC_ISSUER_ID` desde su `.env.asc` sin imprimirlos y ejecutar:

```bash
npm ci
npm run ios:archive
```

Expected: `ARCHIVE SUCCEEDED`, `EXPORT SUCCEEDED`, `build/export/Pickler.ipa`. Verificar con herramientas de Apple/plist: versión `0.1.0`, build `10`, bundle `fun.pickler.app`, MinimumOSVersion `18.0`, `application-identifier` del team correcto y entitlement `aps-environment`. Registrar tamaño y SHA-256 del `.ipa`.

- [ ] **Step 2: Subir una sola vez**

```bash
npm run ios:upload
```

Expected: `UPLOAD SUCCEEDED` sin `UPLOAD FAILED`, `ERROR ITMS` ni `Validation failed`; capturar Delivery UUID y log completo en scratch fuera del repo. Si el comando es ambiguo o falla, no reintentar hasta resolver si Apple aceptó el binario.

- [ ] **Step 3: Verificar App Store Connect por API**

Consultar `GET /v1/builds?filter[app]=6812631756&filter[version]=10&include=preReleaseVersion` hasta estado terminal, con espera acotada y actualizaciones al usuario. Luego listar `/v1/betaGroups?filter[app]=6812631756` y `/v1/betaGroups/<Equipo>/builds`.

Expected: build `0.1.0 (10)`, `processingState: VALID`, `expired: false`, y build 10 presente en el grupo «Equipo» (`hasAccessToAllBuilds: true`). `VALID` sin grupo no se declara distribuido.

---

### Task 5: Humo en iPhone, tracker y cierre de F4

- [ ] **Step 1: Prueba acotada en el iPhone de Jesús**

Jesús instala build 10 desde TestFlight y confirma: arranque; crear/abrir cuenta con passkey (prueba el AASA); Markets → BTC; pills Ask y Agents cargan; Trade muestra order book L2 vivo. No crear orden ni mover fondos. Registrar dispositivo/iOS y resultado real. Push real queda “no verificado — APNs pendiente”, no se simula como éxito.

- [ ] **Step 2: Audit y estado del proyecto**

Continuar **en el worktree de la release**, nunca editando docs directamente en `main`. Primero llevar la rama al merge ya pusheado:

```bash
cd /Users/josedejesusacevedoflores/Documents/predict/.claude/worktrees/testflight-build10-sync
git fetch origin main --prune
git merge --ff-only origin/main
git status --short --branch
```

Expected: fast-forward al merge de release y árbol limpio. Crear `docs/superpowers/audits/2026-09-28-mobile-ask-f4-rulings.md` con: rulings, correcciones, `RELEASE_SHA`, hashes AASA/HTTP, tests/tsc, archive/export/IPA, Delivery UUID, respuesta ASC/grupo, resultado del iPhone, residual APNs, ubicación del backup y rollback. Actualizar el estado F4 en el spec, overview y manifest. Cambiar F4 a `completed`, marcar sus cinco tasks y actualizar el status global a `completed` sólo si Step 1 pasó; si falta el iPhone, mantener F4 `in_progress` y explicar el único bloqueo.

- [ ] **Step 3: Tracker del build 10**

Usar `.agents/skills/pickler-dev-new/` para crear `docs/overview/dev/2026-09-28-testflight-build10.html` y entrada al principio del manifest, `types: ['feature']`, tags `mobile/testflight/ios/ask/perpl`. `status: shipped` sólo con `VALID` + grupo «Equipo». Completar “Qué cambió”, archivos y validación desde el diff/audit/log real; marcar explícitamente el estado del iPhone y APNs.

- [ ] **Step 4: Generar, renderizar y mirar**

```bash
npm run docs:html
npm run docs:check
npm run agents:check
node scripts/agent-infra/render-check.mjs /private/tmp/pickler-build10-docs/overview 2026-09-19-mobile-ask
node scripts/agent-infra/render-check.mjs /private/tmp/pickler-build10-docs/tracker dev/2026-09-28-testflight-build10
```

Abrir y mirar las capturas de 390 px y 1440 px de ambos documentos; corregir overflow, texto cortado o estados discordantes. Repetir checks tras cada corrección.

- [ ] **Step 5: Revisión final, commit documental y prueba de sincronía**

Solicitar revisión independiente final sobre tracker, audit, spec, overview/manifest y evidencia Apple/iPhone. En el worktree de la release, agregar únicamente los archivos de docs por nombre y commitear con conventional commit. Después, en el checkout principal, integrar ese commit por fast-forward y pushear `main`:

```bash
cd /Users/josedejesusacevedoflores/Documents/predict/.claude/worktrees/testflight-build10-sync
git add docs/superpowers/specs/2026-09-19-mobile-ask-design.md docs/superpowers/specs/2026-09-19-mobile-ask-design.html docs/superpowers/plans/2026-09-19-mobile-ask-f4.md docs/superpowers/plans/2026-09-19-mobile-ask-f4.html docs/superpowers/audits/2026-09-28-mobile-ask-f4-rulings.md docs/overview/2026-09-19-mobile-ask.html docs/overview/dev/2026-09-28-testflight-build10.html docs/overview/data/manifest.js
git diff --cached --check
git commit -m "docs(mobile-ask): cerrar F4 con TestFlight build 10"
cd /Users/josedejesusacevedoflores/Documents/predict
git merge --ff-only release/testflight-build10-sync
git push origin main
git fetch origin main --prune
git rev-list --left-right --count main...origin/main
git status --short --branch
node scripts/agent-infra/branches.mjs origin/main
```

Expected: `0 0`, árbol limpio, sin stash, rama de release integrada, build 10 `VALID` + «Equipo», F4 cerrada si hubo humo en iPhone. El backup de `/private/tmp` se conserva y se reporta; su eliminación requiere un cierre explícito posterior.

## Evidencia mínima para declarar la sincronización terminada

1. `main == origin/main` antes del archive y después del commit documental.
2. AASA origin + CDN Apple `200 application/json`, cuerpo exacto, Worker versionado con hashes aprobados.
3. Tests y TypeScript verdes contra el defecto: `buildNumber` era 9 y la config resuelta ahora es 10.
4. `.ipa` inspeccionado: `0.1.0 (10)`, bundle/entitlements correctos, hash y tamaño registrados.
5. `UPLOAD SUCCEEDED`; ASC build 10 `VALID`, no expirado y listado en «Equipo».
6. Humo real en el iPhone o, si falta, F4 permanece `in_progress` y no se afirma cierre total.
7. Tracker renderizado y mirado; `docs:check` y `agents:check` verdes; audit con APNs como residual.

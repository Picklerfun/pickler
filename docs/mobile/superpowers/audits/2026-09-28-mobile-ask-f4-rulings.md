# Audit — Ask F4: sincronización Git + TestFlight build 10 (2026-09-28)

**Estado al cerrar:** build 0.1.0 (10) distribuido; F4 `completed` tras el humo aprobado por Jesús en un iPhone físico.
**Plan:** `docs/superpowers/plans/2026-09-19-mobile-ask-f4.md`
**Release SHA:** `609c531f1039a2acc1884efaf57408fe7bdef54d`

## 1. Rulings

| # | Decisión tomada | Por qué | Coste si está mal |
|---|---|---|---|
| F4-R1 | Versionar `infra/aasa-worker/` sin redesplegar Cloudflare. | El origen y el CDN de Apple ya respondían el AASA correcto; un deploy no cambiaba el entregable y añadía riesgo. | Revertir los tres archivos de Git; producción no cambió. |
| F4-R2 | Ejecutar instalación, tests, Expo config y archive con Node 24.11.1 explícito. | El shell global era Node 23.5.0; React Native 0.86 admite 24.3+ y `@category-labs/mera` exige Node ≥24. | Repetir la evidencia/archive con otro runtime soportado y, si cambia el binario, subir un build nuevo; el 10 no se puede reemplazar. |
| F4-R3 | APNs real no bloquea el build 10 ni la sincronización; queda como residual visible. | Aprobado por Jesús antes del plan. La capability está habilitada, pero faltan key/secrets del servidor. | Reabrir F4 o crear un build posterior tras provisionar APNs; no afirmar push real en el tracker. |
| F4-R4 | Preservar la copia sin seguimiento del Worker en `/private/tmp/pickler-aasa-worker-pre-sync-2026-09-28` y comparar hashes antes del push. | Era material de otra sesión sin commit; moverlo evitó que el merge lo sobrescribiera. | Restaurar desde el backup; no borrarlo durante esta fase. |
| F4-R5 | Tracker build 10 = `shipped`; proyecto Ask F4 = `completed` tras la confirmación del humo en iPhone. | `VALID` + «Equipo» demostró distribución; la confirmación de Jesús aporta la evidencia de arranque/passkey/UI en hardware real. | Reabrir F4 si aparece una regresión reproducible del build 10; el estado del tracker no depende del humo. |

## 2. Correcciones a afirmaciones previas

| Dónde | Decía | Queda | Detectado por |
|---|---|---|---|
| Plan F4, revisión inicial | La revisión usaba `git diff origin/main...HEAD`, que omitía cambios sin commit y archivos nuevos. | `git add -N` por nombre + `git diff origin/main`; el revisor confirmó los 10 archivos completos. | Revisor independiente del plan. |
| Plan F4, integración | Los guards de backup/hash podían continuar hasta el push tras un fallo. | Bloque con `set -euo pipefail`; cualquier gate aborta antes del push. | Revisor independiente del plan. |
| Overview F2/F3 | Capability Push Notifications y key APNs figuraban ambas pendientes. | Capability resuelta desde build 6; sólo key/secrets APNs permanecen pendientes. | Revisor independiente del plan contra tracker build 6. |
| Toolchain histórico | Audits anteriores registraban Node 22.22. | F4 usa Node 24.11.1: satisface simultáneamente RN 0.86 y Mera 0.2.0. | `npm ci` mostró los rangos de engine. |

## 3. Evidencia

### Git e infraestructura AASA

- Base inicial: `main == origin/main == df657c3`; release commit `5aeb483`; merge/push `609c531`.
- Tras el push: `git rev-list --left-right --count main...origin/main` → `0 0`; checkout principal limpio.
- Hashes recuperados y ya trackeados: README `8e50b862…ca9`; handler `f56ebbf…b71`; config `bf00c2ad…269`.
- Wrangler 4.143.0 `deploy --dry-run`: 0.64 KiB, sin bindings, exit 0; **no hubo deploy**.
- `pickler.fun/.well-known/apple-app-site-association` y CDN Apple: 200, `application/json`, 59 bytes, cuerpo idéntico `{"webcredentials":{"apps":["2PBQJ37Q8W.fun.pickler.app"]}}`.
- Revisión independiente pre-integración: 0 críticos, 0 importantes; Worker/ruta/headers, diff completo y ausencia de secretos aprobados.

### App y regresión

- Antes del cambio: `app.config.ts` contenía `buildNumber: "9"`.
- Después: `expo config --type public --json` → Pickler `0.1.0`, `buildNumber: "10"`, bundle `fun.pickler.app`, associated domain `webcredentials:pickler.fun`.
- Node 24.11.1: `npm ci`; baseline y post-cambio → 35/35 suites, 271/271 tests; `npx tsc --noEmit` limpio.
- `npm ci` reportó 11 vulnerabilidades moderadas ya presentes en el lock; no se ejecutó `npm audit fix` ni se cambió una dependencia durante la release.

### Archive, upload y App Store Connect

- Source exacto del archive: `609c531f1039a2acc1884efaf57408fe7bdef54d`.
- `ARCHIVE SUCCEEDED` y `EXPORT SUCCEEDED`; `.ipa` 19,105,810 bytes; SHA-256 `f3ee769d397082c549f2f28c756250792b926666b9c8e4f5eef322e7f88a4e92`.
- Inspección del bundle: `CFBundleIdentifier = fun.pickler.app`, versión `0.1.0`, build `10`, MinimumOSVersion `18.0`, `application-identifier = 2PBQJ37Q8W.fun.pickler.app`, `aps-environment = production`, associated domains presente.
- `UPLOAD SUCCEEDED with no errors`; Delivery UUID `9cf4ec2e-be92-412c-a71c-e082f74d56dd`; 19,105,810 bytes transferidos.
- App Store Connect API: build id `9cf4ec2e-be92-412c-a71c-e082f74d56dd`, `0.1.0 (10)`, `processingState = VALID`, `expired = false`, uploaded `2026-09-28T09:39:15-07:00`.
- Grupo interno «Equipo» id `39d7ad5c-ceba-4141-862d-4562cac9d06f`, `hasAccessToAllBuilds = true`, lista builds 10…1.

### iPhone

- Jesús confirmó el 2026-09-28 que pasó el recorrido completo en un iPhone físico: arranque/passkey, Markets → BTC, Ask, Agents y order book L2 de Trade. Sin orden ni movimiento de fondos.
- Modelo de iPhone y versión de iOS: no reportados; se deja explícito para no inventar metadatos de la prueba.
- Push real: no se prueba en F4; faltan key/secrets APNs.

## 4. Residuales abiertos

1. **APNs:** crear/provisionar key y secretos del servidor; luego probar una entrega real. No bloquea build 10.
2. **Dependencias:** `npm ci` reporta 11 vulnerabilidades moderadas. Auditar aparte; no correr `npm audit fix --force` dentro de una release.
3. **Backup recuperable:** `/private/tmp/pickler-aasa-worker-pre-sync-2026-09-28`; conservar y eliminar sólo con autorización explícita.

## 5. Rollback

- Git: el merge de release es `609c531`; si se necesitara revertir, revisar primero el trabajo posterior y usar un revert del merge (`git revert -m 1 609c531`), nunca reset destructivo.
- TestFlight: el build 10 es inmutable. Puede dejarse de distribuir desde App Store Connect, pero no reemplazarse; cualquier corrección requiere build 11.
- Cloudflare: F4 no desplegó ni modificó producción; no hay rollback remoto del Worker.
- Cuentas/backend: sin órdenes, fondos, migraciones, secrets ni funciones desplegadas durante F4.

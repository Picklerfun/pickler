# App móvil Pickler — La misma cuenta que en la web: entrar con la wallet y username obligatorio

**Fecha**: 2026-10-02
**Estado**: aprobado por Juvenal en conversación el 2026-10-02; implementado en un PR
**Slug**: `mobile-account`
**Rama**: `codex/app-account`, apilada sobre `codex/mera-web` (PR #74), worktree `pickler-app-account`
**Contexto**: la web ya entra con la wallet (passkey de Mera o wallet del navegador), pide username y
permite vincular una wallet nueva a la cuenta que la persona ya tiene
([spec de la web](../../../specs/mera-web-v1.md), §3 y §9). La app tiene el mismo passkey y deriva la
misma dirección, pero no habla con la API del producto: no tiene sesión ni username. Juvenal pidió que
la app use **la misma cuenta** y que **el username sea obligatorio, con el mismo flujo que la web**.
Quedan 11 días para el bounty (13 oct 2026, 21:59 CST).

---

## TL;DR

1. Con la wallet desbloqueada, la app **entra sola** a la API del producto firmando el mensaje del
   servidor (SIWE, `kind: "mera"`). No hay prompt nuevo: la llave ya está abierta.
2. Si la cuenta **no tiene username**, una pantalla lo pide y **no se puede saltar**: se elige uno o se
   cierra sesión. Es el mismo paso final de la web, con las mismas palabras.
3. Quien **ya tiene cuenta bajo su wallet de navegador** vincula este passkey **en pickler.fun** (un
   navegador es donde firma esa wallet); la app lo explica y vuelve a comprobar.
4. El `@username` se muestra en la pestaña Wallet.
5. **Apagado por defecto**: sin `PICKLER_API_URL` la app no cambia en nada. Hoy producción responde 404
   en `/api/v1/auth/wallet/nonce` (falta `SIWE_DOMAIN` en la API), así que encenderlo es una decisión de
   despliegue, no de este PR.
6. Sin dependencias nuevas, sin tocar navegación, reads ni Perpl.

---

## 1. Decisiones

| # | Decisión | Valor | Por qué |
|---|---|---|---|
| D1 | Cuándo entra | Al desbloquearse la wallet (alta, sign in o cualquier acción que pida Face ID), en segundo plano. Con la wallet bloqueada no se pregunta nada. | Firmar el mensaje no cuesta un prompt con la llave abierta; preguntar con la wallet bloqueada sería un Face ID al arrancar. |
| D2 | Sesión | El token de acceso vive **en memoria**. Cuando vence, se vuelve a firmar. No se guarda token ni refresh token, y no se añade `@supabase/supabase-js`. | La app puede firmar gratis; así no hay credencial de la API en el dispositivo ni dependencia nueva que mueva el árbol de la app. |
| D3 | Qué se guarda | `pickler.identity.v1` = `{ address, handle, api }` en SecureStore, sin gate biométrico. `api` es la base de la API que lo dijo. | El username es público. Con él guardado, el siguiente arranque no pregunta a nadie ni desbloquea nada; y una cuenta de staging no pasa por la de producción al cambiar de build. |
| D4 | Username obligatorio | Si el servidor dice «esta cuenta no tiene perfil» (404 con sesión), la pantalla de username tapa la app. Salidas: elegirlo, o **Sign out**. | Regla del owner, igual que en la web (M6): no hay cuenta sin username. |
| D5 | Sólo lo sabido retiene, y sólo mientras haya salida | API sin configurar, caída, lenta o con error → estado `unreachable` / `off`: **nadie queda fuera**. Con la pantalla ya abierta, si reclamar o volver a comprobar falla por algo que no es el username (sin red, 401, 5xx), la pantalla **se suelta por esa sesión** y se vuelve a preguntar en el siguiente desbloqueo. Un 404 de «ruta inexistente» no cuenta como «sin username». | La app opera fondos y reads; la cuenta no puede impedir cerrar una posición. Una pantalla obligatoria cuya única salida depende de un servidor caído sería exactamente eso. |
| D5b | Antes de decir que falló, se vuelve a mirar | Ante cualquier fallo al reclamar, la app entra de nuevo y lee la cuenta: si ya tiene username —la respuesta se perdió, o la wallet se vinculó en la web— eso es lo que vale. | El «sí» perdido dejaba el handle como «taken» sin forma de reintentar; el token viejo de una cuenta ya vinculada fallaba con 5xx hasta vencer. |
| D5c | No encima de una operación | La pantalla no se abre mientras hay un retiro/depósito en curso (`treasury.busy`) o una read pedida (`reads.request` pendiente); una vez abierta, se queda. Una orden de Perpl no tiene bandera global y no se espera. | Quien ya usaba la app arranca con la wallet bloqueada, así que su primer desbloqueo es una operación: primero ve cómo termina. |
| D6 | Vincular | La pantalla ofrece «Already have a Pickler account? Link this wallet to it», que explica que se hace en pickler.fun con este mismo passkey, abre la web y tiene **«I linked it — check again»**. | En la app sólo existe el passkey: la wallet del navegador no puede firmar aquí. El servidor ya mueve la wallet (`POST /v1/auth/wallet/join`); la app sólo tiene que volver a entrar para ver la cuenta nueva. |
| D7 | Dónde vive la pantalla | Fuera del árbol de navegación: una vista a pantalla completa sobre el `Navigator`, montada en `App.tsx` mientras `identity.status === "none"`. | No es una pantalla a la que se llega o de la que se vuelve, y así no se tocan rutas, store ni sus tests a días del bounty. |
| D8 | Configuración | `PICKLER_API_URL` → `extra.apiUrl` → `src/config/api.ts`. Es la base tras el host web, p. ej. `https://pickler.fun/api/v1`. Vacía = función apagada. | La API de staging no es pública por sí sola; se llega por el host web. |
| D9 | Reglas del handle | Copia local de `HANDLE_RULES` y `RESERVED_HANDLES` de `@pickler/api-schema`, atada por un test que importa la fuente. El servidor valida igual y manda. | Importar el paquete movería el árbol de dependencias de la app. |
| D10 | Al cerrar sesión | Se borra el username guardado junto con la cuenta y la sesión de reads. | Es de esa cuenta; la siguiente pregunta por el suyo. |

## 2. Flujo

```
wallet desbloqueada ──► entra sola (nonce → firma → verify) ──► GET /profile
        │                                                         ├─ tiene ─► se guarda, @username en Wallet
        │                                                         ├─ 404  ─► PANTALLA DE USERNAME (obligatoria)
        │                                                         └─ error ─► nadie retenido; se reintenta al desbloquear
        └─ con username guardado para esta dirección: no se pregunta nada
```

Pantalla de username (copy en inglés, como el resto de la app y la web):

- **PICK YOUR USERNAME.** — campo `@`, nota bajo el campo con las palabras de la web
  (`PICK ONE · 3–15`, `TOO SHORT · 3 MIN`, `@X IS TAKEN`, `AVAILABLE`, `COULD NOT CHECK · YOU CAN STILL
  CLAIM IT`), botón **Claim it →**, enlace a vincular, pie `CONNECTED · 0x… · PASSKEY WALLET`, y
  **Sign out** arriba a la derecha.
- **LINK TO YOUR ACCOUNT.** — explicación, **Open pickler.fun**, **I linked it — check again**,
  **← Back**.

## 3. Módulos

| Archivo | Qué es |
|---|---|
| `src/config/api.ts` | `API_URL`, o `null` si no hay configuración |
| `src/identity/handle.ts` | Reglas, estado del campo y la nota (puro) |
| `src/identity/api.ts` | Cliente: `fetchChallenge`, `presentSignature`, `fetchProfile`, `createProfile`, `handleAvailable`, `IdentityError` |
| `src/identity/session.ts` | `signInWithWallet`, `sessionFor`, `tokenExpiry` (puro) |
| `src/identity/state.ts` | `Identity`, `gateOpen`, y lo guardado (`parseIdentity`, `identityFor`) |
| `src/storage/identity.ts` | SecureStore de `{ address, handle }` |
| `src/hooks/useIdentity.ts` | El hook: resuelve, reclama, vuelve a comprobar |
| `src/screens/username.tsx` | `UsernameGate`, la pantalla obligatoria |
| `App.tsx`, `src/ctx.ts`, `src/hooks/useAccount.ts`, `src/screens/wallet.tsx`, `src/screens/signin.tsx`, `app.config.ts` | Cableado: hook, gate, `@username` en Wallet, texto de sign in, borrar al cerrar sesión, `apiUrl` |

## 4. Fuera de alcance

- Mover reads o Perpl detrás de `workers/api`: reads sigue con su firma `pickler-reads:` por dirección.
- Vincular dentro de la app (haría falta WalletConnect) y desvincular.
- Guardar la sesión de la API o refrescarla sin firmar.
- Encender la función en producción: requiere `SIWE_DOMAIN` y `WALLET_EMAIL_DOMAIN` en la API, y
  `PICKLER_API_URL` en el build. Ningún build ni subida a TestFlight se hace sin autorización.

## 5. Verificación

- Jest: reglas del handle atadas a `@pickler/api-schema`; cliente con `fetch` de mentira; entrar firmando
  con una llave real y recuperando la dirección; el hook entero contra API y SecureStore de mentira
  (cuándo pregunta, cuándo retiene, cuándo suelta, la respuesta perdida, el token por vencer, la respuesta
  que llega tras cerrar sesión); **el camino apagado** (sin `PICKLER_API_URL`: ni una petición, ni una
  firma, ni una lectura del almacenamiento); la pantalla montada con `react-test-renderer`.
- `npm run typecheck --workspace=@pickler/mobile`, `npm test --workspace=@pickler/mobile`,
  `npm run app:tree --prefix scripts/mobile` (el árbol no se mueve), y `expo export` (Metro empaqueta).
- **No verificado**: la pantalla en un dispositivo o simulador, ni contra la API real (hoy apagada en
  producción). Se dice así en el PR.

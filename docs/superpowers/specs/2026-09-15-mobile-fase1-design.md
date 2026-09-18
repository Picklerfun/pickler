# App móvil Pickler — Fase 1: passkey + tesorería AUSD

**Fecha**: 2026-09-15
**Estado**: aprobado por Jesús (diseño en chat), pendiente de plan
**Slug**: `mobile-fase1`
**Contexto**: bounty *Best Mobile Trading App on Monad (Agora)* del hackathon
Monad Metropolis — $10,000, deadline **13 oct 2026 21:59 CST**.

---

## TL;DR

Se construye la app móvil de Pickler en **React Native / Expo** (no Swift: ver
§1). La fase 1 entrega **login con passkey vía Mera → cuenta EVM en Monad
Testnet → pantalla con balance de AUSD y MON → botón de faucet de AUSD**, con
build firmado listo para **TestFlight**. Sin backend, sin VPS.

Lo que el bounty exige y esta fase **no** cubre (Perpl, trade) queda en §9 como
fases siguientes.

---

## 1. Decisiones que fija este spec

| Decisión | Valor | Por qué |
|---|---|---|
| Stack móvil | **Expo SDK 57 / RN 0.86, TypeScript** | Mera solo tiene SDK TS (web, extensión, React Native). En Swift habría que reimplementar la derivación PRF→EVM y el cliente de Perpl a mano en 4 semanas, con riesgo de que "auth via Mera" se cuestione. Jesús aceptó RN el 2026-09-15. |
| Auth | **`@category-labs/mera` + `react-native-passkey`** | Es lo que pide el bounty. No hay servidor de auth: el passkey deriva la llave en el dispositivo. Privy/Turnkey/Clerk descartados. |
| Red | **Monad Testnet (chain 10143)** | AUSD existe en testnet con faucet. Mainnet queda para después del demo. |
| Relying party (rpId) | **`pickler.fun`** | Zona en la cuenta Cloudflare "Pickler" (`1e08efc05d1cf361b372ba3009ed4985`), Jesús es Super Admin. Cambiar el rpId después obliga a todos a registrar passkey de nuevo, por eso se fija ya. |
| Bundle ID | `fun.pickler.app` | Team Apple `2PBQJ37Q8W` (el de Proflores). |
| Idioma de la app | Inglés | Hackathon internacional. |
| Dispositivo | Solo iPhone, portrait | Como Proflores v1. |

**Lo que este spec NO decide:** si Pickler cambia su venue de Polymarket a
Perpl (afecta D-01/D-02/D-12 en `02-decisiones-abiertas.md`). Esa es decisión
del equipo. La fase 1 es compatible con cualquier salida.

---

## 2. Alcance

### Entra

1. Crear cuenta con passkey (Face ID) o iniciar sesión con una existente.
2. Derivar la cuenta EVM con Mera; mostrar la dirección.
3. Leer y mostrar balance de **AUSD** y de **MON** en Monad Testnet.
4. Botón **Get test AUSD**: tx al faucet de Agora firmada con la llave derivada.
5. **Lock** (cierra sesión de firma, conserva cuenta) y **Sign out** (borra cuenta
   del dispositivo; no borra el passkey del llavero).
6. Sitio estático en `pickler.fun` con `/.well-known/apple-app-site-association`.
7. Build firmado y subido a TestFlight.

### No entra

Agentes, launchpad/token, Perpl, harness, backend, mainnet, Android, onramp
real de AUSD, recuperación de cuenta (export de seed).

---

## 3. Verificado en fuentes (2026-09-15)

- **Mera** (`@category-labs/mera` 0.2.0, [repo](https://github.com/category-labs/mera)):
  plataformas web, extensión Chrome y React Native iOS 18+ / Android 9+.
  Deriva 32 bytes del passkey vía extensión **PRF** de WebAuthn → HKDF-SHA-256 →
  llave secp256k1. Exporta `./viem` (cuenta compatible con viem) y
  `./react-native-webauthn-client` (usa `react-native-passkey`). El demo
  `demos/mobile` es Expo 57 + viem 2.55 + expo-secure-store; es la referencia.
- **AUSD en Monad Testnet**: `0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC`.
  **Faucet**: `0xd236c18D274E54FAccC3dd9DDA4b27965a73ee6C`, función
  `requestFunds(address)`. Fuente: docs.agora.finance/developer/contract-deployments.
  AUSD mainnet Monad: `0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a`.
- **Perpl** ([api-docs](https://github.com/PerplFoundation/api-docs)): colateral
  en mainnet es AUSD; órdenes por WebSocket firmado; testnet chain 10143. No se
  usa en fase 1; se registra porque valida que el camino testnet→mainnet es
  coherente.
- **Cloudflare**: zona `pickler.fun` activa, plan Free, sin registros DNS ni
  Workers/Pages. Token `Edit zone DNS` en `.env` (gitignored); wrangler OAuth ve
  la cuenta Pickler para Pages/Workers.

Los decimales de AUSD (se asume 6) y el comportamiento del faucet (rate-limit,
requisito de gas) **se verifican en el primer paso del plan**, no se asumen.

---

## 4. Estructura del repo

```
predict/
  apps/mobile/                 app Expo. ios/ y android/ se GENERAN (expo prebuild), gitignored.
    app.config.ts              bundle id, rpId, associatedDomains, plugins
    src/
      config/chain.ts          chain 10143, RPC, direcciones AUSD/faucet   (puro, testeable)
      auth/                    mera: create / sign-in / lock / sign-out
      storage/                 SecureStore: address (sin gate) + prf output (con gate)
      wallet/                  viem: cliente público + cuenta derivada, balances, faucet tx
      screens/Welcome.tsx
      screens/Home.tsx
      ui/                      botones, tipografía, colores (sin lógica)
    __tests__/                 Jest sobre config, formateo, mapeo de errores
  infra/passkey-domain/
    public/.well-known/apple-app-site-association
    wrangler.jsonc             proyecto Pages `pickler-passkeys`, custom domain pickler.fun
  docs/superpowers/specs/2026-09-15-mobile-fase1-design.md   este archivo
  docs/04-roadmap-bounty.md                       fases 2-4 (se escribe en el plan)
```

**Fronteras** (mismo espíritu que Proflores iOS): `config/`, `wallet/` y
`storage/` no importan React; `ui/` no importa viem ni mera; las pantallas
componen. Un script de boundaries no vale la pena en fase 1; se revisa a ojo en
la revisión independiente.

---

## 5. Flujo y estado

```
Arranque
  └─ leer address (sin gate)
       ├─ no hay  → Welcome
       └─ hay     → Home (balances cargan sin pedir Face ID)

Welcome
  ├─ Create account → mera.createPasskey(rpId) → PRF → cuenta
  └─ Sign in        → mera.signIn(rpId)        → PRF → cuenta
       └─ guardar address (sin gate) + prfOutput (gate biométrico) → Home

Home
  ├─ address (copiar)
  ├─ AUSD balance  ← balanceOf(address) en 0xa9012a…22dC
  ├─ MON balance   ← getBalance(address)
  ├─ Get test AUSD → leer prfOutput (Face ID) → derivar cuenta → requestFunds(address)
  │                  → mostrar hash + link explorer → refrescar balances
  ├─ Lock          → olvidar prfOutput en memoria
  └─ Sign out      → borrar address + prfOutput de SecureStore → Welcome
```

Estado en memoria: `{ address, signer? }`. `signer` existe solo entre desbloqueo
y Lock. No hay estado global más allá de un contexto de React.

---

## 6. Errores (visibles, con acción)

| Situación | Qué ve el usuario |
|---|---|
| Dispositivo/simulador sin PRF | "This device can't create a passkey with PRF. Use an iPhone with iOS 18+." |
| Usuario cancela Face ID | Vuelve al estado anterior, sin error rojo |
| Sin MON para gas | "You need test MON for gas" + link al faucet de Monad testnet + address copiable |
| Faucet rechaza (rate-limit / revert) | Mensaje con la razón del revert si viene, y "try again later" |
| RPC caído / timeout | Balances en "—" con botón Retry |
| AASA no resuelve | El SO falla el passkey; se documenta en README cómo verificar con `curl` |

---

## 7. Infra y Apple

**Cloudflare (cuenta Pickler):** proyecto Pages `pickler-passkeys` con
`public/.well-known/apple-app-site-association`:

```json
{ "webcredentials": { "apps": ["2PBQJ37Q8W.fun.pickler.app"] } }
```

Custom domain `pickler.fun` → Pages crea el registro DNS y el certificado.
Requisito de Apple: `Content-Type: application/json`, HTTPS, **sin redirect**.
Cuando exista la landing real se sirve desde el mismo proyecto; el archivo no
cambia.

**Apple:** App ID `fun.pickler.app` con capability *Associated Domains*
(`webcredentials:pickler.fun`), registrado por el build de device con
`-allowProvisioningUpdates`. App en App Store Connect creada a mano por Jesús
(pasos en el plan). Archive → upload → TestFlight, con el flujo de
`proflores-ios-release` como referencia.

---

## 8. Verificación (evidencia antes de "listo")

1. `npm test` en `apps/mobile`: config de chain, formateo de 6 decimales, mapeo
   de errores. **Corridos también contra el defecto** (un test que falla si la
   dirección de AUSD cambia, etc.).
2. `curl -sI https://pickler.fun/.well-known/apple-app-site-association` →
   200, `application/json`, sin `Location`.
3. Simulador iOS 18: crear passkey, ver dirección y balances. Captura.
4. Device real: mismo flujo + tx del faucet con hash visible en
   `testnet.monadexplorer.com`. Captura.
5. Build de TestFlight procesado y visible para el grupo de testers.

Si (3) no funciona por PRF en simulador, se pasa a device desde el inicio y se
documenta.

---

## 9. Fases siguientes (fuera de este spec)

| Fase | Contenido | Cubre del bounty |
|---|---|---|
| 2 | Perpl testnet: `createAccount` + `allowOrderForwarding`, cliente WS, colocar una orden desde la app | "executes trades through Perpl" — **obligatorio** para elegibilidad |
| 3 | Agentes con historial público de posiciones; launchpad (token opcional) | Ángulo creativo |
| 4 | Harness: límites por orden/exposición, orden rechazada con comprobante | Ángulo creativo, tesis de Pickler |
| — | Backend/VPS, mainnet, Android | Post-hackathon |

Cada fase pasa por su propio brainstorm → spec → plan.

---

## 10. Riesgos

- **PRF en simulador.** Mera dice que funciona en iOS 18 simulador; no está
  medido aquí. Plan B: device.
- **Faucet de MON testnet** puede pedir wallet conectada o tener rate-limit.
  Plan B: Jesús manda MON desde su wallet a la dirección de la app.
- **Expo 57 vs Xcode instalado.** Se verifica en el primer paso del plan.
- **Un solo premio** en el bounty: la fase 1 sola no es elegible; la fase 2 es
  obligatoria antes del 13 de octubre.

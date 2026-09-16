# Handoff — fase 1 móvil (2026-09-16)

Cierre de la sesión que construyó la app móvil de Pickler para el bounty de Agora
en el hackathon Monad Metropolis. Qué quedó, qué se aprendió, qué falta y cuál es
el siguiente punto de decisión.

## Qué quedó hecho y verificado

| Pieza | Evidencia |
|---|---|
| App Expo/iOS con login por passkey (Mera), balances AUSD/MON en Monad Testnet, faucet de AUSD, Lock/Sign out | `apps/mobile/`; `npx tsc --noEmit` limpio; `npm test` 19/19 |
| Passkey + PRF funcionando | Simulador (Face ID inscrito) y iPhone real; el faucet pide Face ID en device |
| Faucet real | tx [`0x74582c…04cf`](https://testnet.monadexplorer.com/tx/0x74582c86d5793492853e062d1edb4d39211c384a19d50ae97f3891d1384204cf), 10,000 AUSD |
| Dominio de passkeys | `https://pickler.fun/.well-known/apple-app-site-association` → 200 `application/json` |
| Apple | App ID `fun.pickler.app` con Associated Domains; app **"Pickler Agents"** (id 6812631756) en App Store Connect |
| TestFlight | build **0.1.0 (1)** "Lista para las pruebas", grupo interno *Equipo* |
| Ícono | `apps/mobile/assets/icon.png` (logo del equipo) |
| Docs | `apps/mobile/README.md`, `infra/passkey-domain/README.md`, `docs/04-roadmap-bounty.md` |

Proceso: 10 tareas del plan, cada una con revisión independiente; revisión final de
la rama completa con 0 críticos, 2 *Important* corregidos y re-revisados.

## Lo aprendido (para no repetirlo)

1. **Expo SDK 57 exige Xcode ≥ 26.4.** Con Xcode 26.2 `expo-modules-jsi` no compila
   ([expo/expo#50067](https://github.com/expo/expo/issues/50067),
   [#46242](https://github.com/expo/expo/issues/46242)). No se parchea: se instala Xcode
   26.6 (`xcodes install 26.6`, convive con 26.2) **y** el runtime de simulador iOS 26.5
   (`xcodebuild -downloadPlatform iOS`). Sin ese runtime, Xcode 26.6 no encuentra destino.
2. **Mera no tiene SDK Swift.** Web, extensión y React Native. Por eso la app es RN y no
   Swift nativo. La derivación PRF → BIP-39 → BIP-32 (`m/44'/60'/0'/0/0`) es la del demo
   oficial, así que el mismo passkey da la misma dirección en web y en la app.
3. **Passkeys en simulador** funcionan si se inscribe Face ID:
   `xcrun simctl spawn <udid> notifyutil -s com.apple.BiometricKit.enrollmentChanged 1 && … -p com.apple.BiometricKit.enrollmentChanged`,
   y se "presenta la cara" con `notifyutil -p com.apple.BiometricKit_Sim.fingerTouch.match`.
4. **`expo run:ios --device`** quiere el `udid` de hardware (`00008140-…`), no el
   identificador de `devicectl` (`52D965A0-…`).
5. **Cloudflare Pages no creó el CNAME** del custom domain aunque la zona esté en la misma
   cuenta; hay que crearlo a mano (`pickler.fun → pickler-passkeys.pages.dev`, proxied).
   `wrangler.jsonc` de Pages **no acepta** `account_id`; va por `CLOUDFLARE_ACCOUNT_ID`.
6. **App Store Connect API**: la key de Proflores (team `2PBQJ37Q8W`) sirve para cualquier
   app del team. Registrar App ID y crear la app en ASC se hizo a mano (el asistente no tiene
   permiso de escritura ahí). `GET /v1/builds?filter[app]` tarda minutos en ver un build
   recién subido; `GET /v1/apps/{id}/builds` lo ve antes. Un tester interno puede quedar en
   `NOT_INVITED`; `POST /v1/betaTesterInvitations` manda la invitación.
7. **AUSD testnet** = 6 decimales; el faucet `requestFunds(address)` (selector `0x544c7cf9`)
   da 10,000 AUSD y necesita MON para gas (faucet.monad.xyz).
8. El nombre "Pickler" ya estaba tomado en App Store Connect; el registro se llama
   **Pickler Agents**. El `CFBundleDisplayName` sigue siendo "Pickler".

## Pendientes conocidos

- **Build 2 a TestFlight.** El build 1 no incluye el fix de `Home` (refresca balances antes
  del faucet + botón *Refresh balances*, commit `ad24f2d`). Subir: `ios.buildNumber: "2"` en
  `app.config.ts` → `npm run ios:archive && npm run ios:upload`.
- Menores diferidos de la revisión final: regex `/cancel/i` sin anclar en `describeError`;
  sin tests unitarios de `wallet.ts` (zeroing, describeError) — requiere hacer `rp.ts`
  perezoso; KAT de derivación sugerido (`fill(7)` → `0x29458C602E3DB4fC3b54EC2bbEE26Dbe64C7779f`);
  PRF huérfano si falla `saveStoredAccount`; "Copy address" sin confirmación; sin auto-lock
  en background.
- `@category-labs/mera` declara `engines.node >= 24`; la máquina usa Node 22 (solo warning).

## Siguiente punto de decisión

**Fase 2 = Perpl**, obligatoria para ser elegibles (el bounty exige "executes trades through
Perpl"). Abre la decisión de venue (Perpl vs Polymarket) y con ella D-01/D-02/D-12 de
`02-decisiones-abiertas.md`. Es decisión del equipo, no de ingeniería. Ver
`docs/04-roadmap-bounty.md`.

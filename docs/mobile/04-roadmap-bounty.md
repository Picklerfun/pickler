# Roadmap del bounty (Best Mobile Trading App on Monad)

**Fecha**: 2026-09-16
**Contexto**: hackathon Monad Metropolis, track *Agora Onchain Trading Bounty*.

---

## 1. El bounty en 5 líneas

- **Premio**: $10,000 USD, un solo ganador. **Track**: Onchain Finance & Trading.
  **Deadline**: 13 oct 2026, 21:59 CST.
- **Elegibilidad**: app móvil que (1) autentica vía **Mera**, (2) tiene/muestra
  balance de **AUSD**, (3) ejecuta trades a través de **Perpl**.
- **Jueces evalúan**: calidad de implementación, experiencia de usuario, uso
  creativo de las tres integraciones juntas.
- **Deliverable**: demo funcionando con login por passkey, fondeo/visualización
  de balance de AUSD, y al menos un trade en Perpl.
- Las tres integraciones (Mera, AUSD/Agora, Perpl) tienen que verse trabajando
  juntas, no cada una por separado.

---

## 2. Fases

| Fase | Contenido | Estado | Cubre del bounty |
|---|---|---|---|
| **1** | Passkey vía Mera → cuenta EVM en Monad Testnet → balances de AUSD/MON → tx al faucet de Agora. Build 0.1.0 (1) subido a TestFlight. | **Hecha** (2026-09-16) | Auth vía Mera, balance de AUSD |
| **2** | Perpl testnet: `createAccount(uint256 amountCNS)` en el Exchange contract, `allowOrderForwarding(true)` desde la wallet de la cuenta, cliente WebSocket sobre `/ws/v1/trading`, colocar una orden desde la app. | **Hecha** (2026-09-16): pestaña Trade con enable/orden de mercado/cierre/fondos, en `main` y en TestFlight **build 3**; trades reales verificados (`docs/superpowers/audits/2026-09-16-mobile-perpl-f1-rulings.md`) — **obligatoria** para elegibilidad | "executes trades through Perpl" |
| **3** | Agentes con historial público de posiciones; launchpad (token opcional). | Pendiente | Ángulo creativo / uso conjunto |
| **4** | Harness: límites por orden/exposición, orden rechazada con comprobante visible. | Pendiente | Ángulo creativo, tesis de Pickler |

Estado vivo de cada sub-proyecto y build en el catálogo `docs/overview/index.html` (abrir en el
navegador): overviews de [fase 1](overview/2026-09-15-mobile-fase1.html), [UI
port](overview/2026-09-16-mobile-ui-port.html), [wallet](overview/2026-09-16-mobile-wallet.html) y
[Perpl](overview/2026-09-16-mobile-perpl.html), y trackers de TestFlight en `docs/overview/dev/`.

Cada fase pasa por su propio brainstorm → spec → plan (ver `docs/00-historia.md`
§Flujo de trabajo en el README raíz).

**Detalle de fase 1**: `apps/mobile/README.md` (cómo correr, tests, TestFlight)
y `docs/superpowers/specs/2026-09-15-mobile-fase1-design.md` (diseño completo, §3 fuentes
verificadas, §9 estas mismas fases siguientes). Evidencia de cierre: 19/19
tests, `curl` del AASA en `https://pickler.fun/.well-known/apple-app-site-association`
en 200, tx del faucet confirmada
(`0x74582c86d5793492853e062d1edb4d39211c384a19d50ae97f3891d1384204cf`), build
visible en TestFlight (App Store Connect app "Pickler Agents", bundle
`fun.pickler.app`).

**Aprendido**: Expo SDK 57 exige Xcode ≥ 26.4 — con 26.2 se pega con
[expo/expo#50067](https://github.com/expo/expo/issues/50067) y
[#46242](https://github.com/expo/expo/issues/46242); se resolvió instalando
Xcode 26.6 + el runtime de simulador iOS 26.5.

---

## 3. Decisiones que la fase 2 reabrió (resueltas el 2026-09-16: venue = Perpl, Polymarket fuera; ver `02-decisiones-abiertas.md`)

La fase 2 (Perpl) obliga a resolver, o al menos confrontar, decisiones que
`docs/02-decisiones-abiertas.md` dejó abiertas para el producto en general:

- **Venue: Perpl vs Polymarket.** El spec de fase 1 (§1) ya lo advierte: "si
  Pickler cambia su venue de Polymarket a Perpl" es decisión del equipo, no de
  este spec. Construir fase 2 sobre Perpl es, de facto, avanzar en esa
  dirección — hay que confirmarlo explícitamente con el equipo antes de
  empezar.
- **D-01 · ¿En qué cadena vive el token?** Perpl y AUSD ya fijan Monad como
  cadena de trading para el bounty. Si D-01 se resuelve distinto (p. ej.
  Solana/pump.fun) para el token de Pickler, fase 2 deja el trading en una
  cadena y el token en otra.
- **D-02 · ¿Los caps son policy o tienen respaldo on-chain?** Perpl introduce
  su propio mecanismo de cuenta (`createAccount` + `allowOrderForwarding`),
  distinto al problema de Safe/Polymarket que originó D-02. Vale revisar si
  el harness (fase 4) puede apoyarse en límites nativos de Perpl o si sigue
  siendo policy pura.
- **D-12 · Cross-chain (ganancias en Polygon, buybacks en Monad).** Si el
  trading vive en Monad vía Perpl, el tramo Polygon→Monad de D-12 puede
  simplificarse o desaparecer, pero eso depende de cómo se resuelva D-01.

Ninguna de estas se decide en este documento; quedan registradas para que el
equipo las resuelva antes o durante la fase 2.

---

## 4. Enlaces

- Bounty: https://hackathon.monad.xyz/tracks/best-mobile-trading-app-on-monad-agora-onchain-trading-bount
- Perpl API docs: https://github.com/PerplFoundation/api-docs
- Perpl docs: https://docs.perpl.xyz/
- Agora (contratos, incluido AUSD): https://docs.agora.finance/developer/contract-deployments
- Mera: https://github.com/category-labs/mera
- Monad docs: https://docs.monad.xyz

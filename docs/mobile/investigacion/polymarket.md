# Polymarket como venue — hallazgos verificados

Investigado el **2026-09-10**. Las APIs cambian; revalidar antes de implementar.
Fuentes al final.

## Resumen

| Pregunta | Respuesta | Impacto |
|---|---|---|
| ¿Hay testnet? | **Sí** — Amoy | ✅ Demo sin dinero real |
| ¿Acepta una Safe propia? | **No** | 🔴 Caps no exigibles on-chain |
| ¿Superficie de API? | Tres APIs separadas | Diseño del adaptador |
| ¿Bots permitidos? | **Sí** | ✅ Sin bloqueo de producto |

---

## 1. Testnet: Amoy

- **Chain ID:** `80002`
- Expuesto en los clientes oficiales como `Chain.AMOY`
- Contratos propios de testnet:
  - `ctf_exchange`: `0xdFE02Eb6733538f8Ea35D585af8DE5958AD99E40`
  - conditional tokens: `0x69308FB512518e39F9b16112fA8d994F4e2Bf8bB`
- Requiere USDC de prueba en Amoy

**Por qué importa:** permite demostrar el ciclo completo sin dinero real, con
etiqueta honesta de testnet — justo lo que exige el documento 4, §13.

---

## 2. Wallets y firmas — la limitación importante

Tipos de firma del CLOB:

| `signature_type` | Tipo | Nota |
|---|---|---|
| 0 | EOA | Wallet propia |
| 1 | `POLY_PROXY` | Magic Link / email |
| 2 | `POLY_GNOSIS_SAFE` | Safe **modificada**, 1-of-1. Marcada **legacy** |
| 3 | `DEPOSIT_WALLET` | Default actual |

**La Safe de tipo 2 no es una Safe cualquiera:** su dirección se deriva por
`CREATE2` desde el EOA firmante y la despliega la factory de Polymarket. La
documentación es explícita en que **no se pueden usar Safes arbitrarias**.

### Consecuencia de diseño

**No hay forma de imponer caps como restricción on-chain dentro de Polymarket.**
Un `safe-allowance-module` propio no es aplicable aquí.

Los límites del agente son **política del backend**: el servidor firma o no firma
antes de enviar la orden al CLOB. Ver decisión **D-02**.

---

## 3. Superficie de API — son tres

| API | Endpoint | Para qué | Auth |
|---|---|---|---|
| **Gamma** | `gamma-api.polymarket.com` | Mercados, eventos, metadata, reglas, precios | **Ninguna** |
| **CLOB** | `clob.polymarket.com` | Orderbook, crear y enviar órdenes | Credenciales L2 derivadas de firma L1 + HMAC-SHA256 |
| **Data API** | — | Posiciones e historial | Sí |

**SDK recomendado para proyectos nuevos:** `Polymarket/ts-sdk` (unificado, incluye
REST y WebSockets). Los `clob-client-v2` / `py-clob-client-v2` siguen existiendo,
pero su propio repo redirige al nuevo.

Arquitectura: **matching off-chain, settlement on-chain en Polygon.** Las órdenes
se firman con EIP-712 y se envían a la API; no son transacciones directas.

### Resolución vía UMA

1. Termina el evento
2. Un proposer envía el resultado al **UMA Optimistic Oracle**
3. Se abre una **ventana de disputa de ~2 horas**
4. Si nadie disputa, la condición resuelve on-chain
5. Se cobra con `redeemPositions()` — $1 por token ganador

**Impacto en el diseño:** entre "terminó el evento" y "cobré" hay horas y un estado
intermedio real. Encaja con el estado `INCONCLUSIVE` del documento 3, pero hay que
modelarlo explícitamente — no asumir resolución instantánea.

---

## 4. Términos de uso

**Automatización: permitida.** No hay cláusula que prohíba trading automatizado.
Lo que hace que se marquen cuentas es **wash trading y spoofing**.

**Geoblocking: activo y móvil.**
- Bloqueo total: Irán, Siria, Cuba, Corea del Norte
- Modo "close-only" (solo cerrar posiciones): ~30 jurisdicciones
- Detección por IP, reputación de IP y fingerprinting; los ToS prohíben evadirlo

⚠️ **Sobre EE.UU. las fuentes de 2026 se contradicen** — unas dicen bloqueado desde
el settlement con la CFTC, otras que ya opera con licencia tras adquirir QCX LLC.

**No tomar esto como verdad.** Son fuentes secundarias y es la parte con
consecuencias legales. Leer el ToS oficial antes del piloto → decisión **D-10**.

---

## Lo que falta verificar

- [ ] ToS oficial: jurisdicciones y automatización, en fuente primaria
- [ ] `ts-sdk`: cobertura real de Amoy
- [ ] Liquidez disponible en mercados de Amoy (¿hay órdenes reales contra las que operar?)
- [ ] Latencia y límites de rate del CLOB
- [ ] Flujo de `redeemPositions()` desde una wallet controlada por el harness

---

## Fuentes

- [Polymarket — Wallets and Authentication](https://docs.polymarket.com/trading/wallets-auth)
- [Polymarket/clob-client-v2](https://github.com/Polymarket/clob-client-v2)
- [Polymarket/py-clob-client-v2](https://github.com/Polymarket/py-clob-client-v2)
- [Polymarket API for developers: Gamma API, Data, and Polygon RPC — Chainstack](https://chainstack.com/polymarket-api-for-developers/)
- [How Are Prediction Markets Resolved? — Polymarket Help Center](https://docs.polymarket.com/polymarket-learn/markets/how-are-markets-resolved)
- [Polymarket Trading Bots in 2026: The Developer's Guide — Assymetrix](https://www.assymetrix.com/learn/polymarket-trading-bot)
- [Polymarket Supported and Restricted Countries (2026) — Datawallet](https://www.datawallet.com/crypto/polymarket-restricted-countries)

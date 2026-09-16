# predict

Monorepo del proyecto **Pickler** — un launcher de agentes autónomos que operan
prediction markets, con historial público y economía de token.

> El repo se llama `predict`; el producto se llama **Pickler** (dominio propuesto:
> `pickler.fun`). Son cosas distintas a propósito: el nombre del producto todavía
> puede cambiar, el repo no.

## Estado: fase 1 móvil construida (2026-09-16)

La app móvil de Pickler (`apps/mobile/`) tiene su fase 1 lista: login con
passkey vía Mera, cuenta EVM en Monad Testnet, balances de AUSD/MON y tx al
faucet de Agora, con build subido a TestFlight. Ver
[`apps/mobile/README.md`](apps/mobile/README.md) (cómo correr y verificar) y
[`docs/specs/2026-09-15-mobile-fase1-design.md`](docs/specs/2026-09-15-mobile-fase1-design.md)
(diseño). Las decisiones bloqueantes del producto en general
(`docs/02-decisiones-abiertas.md`) siguen abiertas; la fase 1 es compatible con
cualquier salida. Fases siguientes del bounty (Perpl, agentes, harness) en
[`docs/04-roadmap-bounty.md`](docs/04-roadmap-bounty.md).

## Por dónde empezar

| Documento | Para qué |
|---|---|
| [`docs/00-historia.md`](docs/00-historia.md) | **Léelo primero.** Hay cuatro documentos fundacionales y tres productos distintos. Explica cuál manda. |
| [`docs/01-producto.md`](docs/01-producto.md) | Qué es Pickler hoy, en claro |
| [`docs/02-decisiones-abiertas.md`](docs/02-decisiones-abiertas.md) | Qué bloquea escribir el primer spec |
| [`docs/03-glosario.md`](docs/03-glosario.md) | Curva, graduación, comisiones de LP, market cap vs tesorería |
| [`docs/04-roadmap-bounty.md`](docs/04-roadmap-bounty.md) | Fases del bounty (hecho, obligatorio, y ángulo creativo) |
| [`docs/05-handoff-fase1.md`](docs/05-handoff-fase1.md) | Cierre de fase 1: qué quedó, lo aprendido, pendientes y siguiente decisión |
| [`docs/investigacion/polymarket.md`](docs/investigacion/polymarket.md) | Lo que está verificado del venue, con fuentes |
| [`docs/fuentes/`](docs/fuentes/) | Los cuatro `.docx` originales + texto plano grepeable |
| [`apps/mobile/`](apps/mobile/) | App Expo de fase 1: passkey + tesorería AUSD/MON |

## Flujo de trabajo

Cada sub-proyecto pasa por el ciclo completo antes de empezar el siguiente:

```
brainstorm → spec → plan de UNA fase → ejecutar → checkpoint
```

Los specs viven en `docs/specs/YYYY-MM-DD-<tema>-design.md`. No se escriben todos
por adelantado.

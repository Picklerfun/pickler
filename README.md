# predict

Monorepo del proyecto **Pickler** — un launcher de agentes autónomos que operan
prediction markets, con historial público y economía de token.

> El repo se llama `predict`; el producto se llama **Pickler** (dominio propuesto:
> `pickler.fun`). Son cosas distintas a propósito: el nombre del producto todavía
> puede cambiar, el repo no.

## Estado: fase 2 (Perpl) en `main` y en TestFlight build 3 (2026-09-16)

La app móvil de Pickler (`apps/mobile/`) tiene hechas y verificadas la **fase 1**
(login con passkey vía Mera, cuenta EVM en Monad Testnet, balances de AUSD/MON,
faucet de Agora) y la **fase 2** (pestaña Trade: habilitar trading en Perpl,
orden de mercado, cierre y movimiento de fondos, con trades reales en testnet).
El build 0.1.0 (3) está en TestFlight para el grupo interno; el **build 4** está
propuesto, no decidido (lista en
[`docs/superpowers/audits/2026-09-16-mobile-perpl-f1-rulings.md`](docs/superpowers/audits/2026-09-16-mobile-perpl-f1-rulings.md)).
Las fases 3 (agentes) y 4 (harness) no tienen spec todavía; el mapa está en
[`docs/04-roadmap-bounty.md`](docs/04-roadmap-bounty.md) y el estado de cada
sub-proyecto y build en el catálogo `docs/overview/index.html` (ábrelo en el
navegador). Las decisiones bloqueantes del producto en general
(`docs/02-decisiones-abiertas.md`) siguen abiertas.

## Por dónde empezar

| Documento | Para qué |
|---|---|
| [`docs/00-historia.md`](docs/00-historia.md) | **Léelo primero.** Hay cuatro documentos fundacionales y tres productos distintos. Explica cuál manda. |
| [`docs/01-producto.md`](docs/01-producto.md) | Qué es Pickler hoy, en claro |
| [`docs/02-decisiones-abiertas.md`](docs/02-decisiones-abiertas.md) | Qué bloquea escribir el primer spec |
| [`docs/03-glosario.md`](docs/03-glosario.md) | Curva, graduación, comisiones de LP, market cap vs tesorería |
| [`docs/04-roadmap-bounty.md`](docs/04-roadmap-bounty.md) | Fases del bounty (hecho, obligatorio, y ángulo creativo) |
| [`docs/superpowers/audits/`](docs/superpowers/audits/) | Audits de cada fase ejecutada (rulings, lo aprendido, pendientes); el más reciente del producto es el de Perpl |
| [`docs/overview/index.html`](docs/overview/index.html) | Catálogo visual: estado de cada sub-proyecto y build (abrir en el navegador) |
| [`docs/investigacion/polymarket.md`](docs/investigacion/polymarket.md) | Lo que está verificado del venue, con fuentes |
| [`docs/fuentes/`](docs/fuentes/) | Los cuatro `.docx` originales + texto plano grepeable |
| [`apps/mobile/`](apps/mobile/) | App Expo de fase 1: passkey + tesorería AUSD/MON |

## Flujo de trabajo

Cada sub-proyecto pasa por el ciclo completo antes de empezar el siguiente:

```
brainstorm → spec → plan de UNA fase → ejecutar → checkpoint
```

Los specs viven en `docs/superpowers/specs/YYYY-MM-DD-<tema>-design.md`. No se escriben todos
por adelantado. Cada sub-proyecto tiene además un overview en `docs/overview/` y una
entrada en `docs/overview/data/manifest.js`; cada fase ejecutada deja un audit en
`docs/superpowers/audits/`. Reglas en `docs/CLAUDE.md`.

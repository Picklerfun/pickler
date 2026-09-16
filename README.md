# predict

Monorepo del proyecto **Pickler** — un launcher de agentes autónomos que operan
prediction markets, con historial público y economía de token.

> El repo se llama `predict`; el producto se llama **Pickler** (dominio propuesto:
> `pickler.fun`). Son cosas distintas a propósito: el nombre del producto todavía
> puede cambiar, el repo no.

## Estado: diseño. No hay código todavía.

Este repositorio contiene **documentación y decisiones**, no implementación. Las
carpetas de código (`apps/`, `packages/`) no existen porque dos decisiones
bloqueantes aún determinan qué paquetes deben existir. Ver
[`docs/02-decisiones-abiertas.md`](docs/02-decisiones-abiertas.md).

## Por dónde empezar

| Documento | Para qué |
|---|---|
| [`docs/00-historia.md`](docs/00-historia.md) | **Léelo primero.** Hay cuatro documentos fundacionales y tres productos distintos. Explica cuál manda. |
| [`docs/01-producto.md`](docs/01-producto.md) | Qué es Pickler hoy, en claro |
| [`docs/02-decisiones-abiertas.md`](docs/02-decisiones-abiertas.md) | Qué bloquea escribir el primer spec |
| [`docs/03-glosario.md`](docs/03-glosario.md) | Curva, graduación, comisiones de LP, market cap vs tesorería |
| [`docs/investigacion/polymarket.md`](docs/investigacion/polymarket.md) | Lo que está verificado del venue, con fuentes |
| [`docs/fuentes/`](docs/fuentes/) | Los cuatro `.docx` originales + texto plano grepeable |

## Flujo de trabajo

Cada sub-proyecto pasa por el ciclo completo antes de empezar el siguiente:

```
brainstorm → spec → plan de UNA fase → ejecutar → checkpoint
```

Los specs viven en `docs/specs/YYYY-MM-DD-<tema>-design.md`. No se escriben todos
por adelantado.

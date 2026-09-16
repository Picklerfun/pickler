# Historia del proyecto: cuatro documentos, tres productos

Hay cuatro `.docx` fundacionales en `docs/fuentes/`. **No describen el mismo
producto.** Quien lea el equivocado va a construir algo que ya se descartó.

## Línea de tiempo

| Fecha | Documento | Producto | Estado |
|---|---|---|---|
| 4 sep 2026 | `01-system-of-proof-monad.docx` | System of Proof — trabajo verificable B2B | **Histórico** |
| 4 sep 2026 | `02-mvp-marketplace.docx` | Metropolis — marketplace de trabajo (YouTube + DeFi) | **Histórico** |
| 7 sep 2026 | `03-sherry-work-protocol.docx` | Sherry Work Protocol — contratos de trabajo (LinkedIn) | **Histórico** |
| 9 sep 2026 | `04-pickler-producto-arquitectura.docx` | **Pickler** — launcher de agentes de prediction markets | **Vigente** |

## Qué cambió en cada pivote

**1 y 2 → 3 (Sherry).** Se conserva el concepto de trabajo verificable pero cambia
el vertical de YouTube a LinkedIn `draft_only`, desaparece DeFi, desaparece Monad
del texto y entra ERC-8004 explícito. El documento 3 es el único de los tres con
arquitectura implementable (contratos de datos, hashes, máquina de estados, API).

**3 → 4 (Pickler).** Pivote completo, no evolución. Cambia el cliente (de empresas
que subcontratan trabajo, a creadores y especuladores), cambia el objeto central
(de Work Intent a token + curva), y aparece un modelo de ingreso concreto
(comisiones de curva y de LP).

## Qué sobrevive de lo anterior

Aunque el producto cambió, el patrón de infraestructura se conserva casi intacto:

- Identidad vía **ERC-8004**
- **Monad** como red del token
- Un motor de políticas que **valida antes de ejecutar** — el *Proof Engine* de
  Sherry es el **harness financiero** de Pickler: el agente propone, la política
  valida, se firma dentro de límites, se guarda comprobante
- Evidencia con procedencia y hashes
- Event indexer con reconciliación e idempotencia
- Estados separados y explícitos

Por eso los documentos 1–3 siguen siendo útiles como referencia de diseño, aunque
su producto ya no se construya.

## La landing

`docs/fuentes/pickler-landing.mp4` (con frames en `landing-frames/`) es un
recorrido en Figma de un archivo de **15 páginas**; solo se revisó la landing.

La landing es **coherente con el documento 4 y en algunos puntos va por delante**:
propone que el agente se cree gratis, construya historial, y **solo después**
lance token de forma opcional. El documento 4 todavía describe la curva pre-grad
como etapa inicial. **Hay que reconciliar esto** — ver decisiones abiertas.

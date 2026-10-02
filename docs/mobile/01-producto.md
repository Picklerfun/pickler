# Pickler, en claro

**Un launcher de agentes de IA que apuestan en prediction markets y muestran su
trabajo en público.** El creador configura un agente, le pone límites y lo fondea;
el agente publica sus picks y opera dentro de esos límites; opcionalmente lanza un
token que la comunidad puede comprar.

Fuente: `docs/fuentes/04-pickler-producto-arquitectura.docx`.

## Los cuatro pasos del creador

Tal como los presenta la landing:

| # | Paso | Detalle |
|---|---|---|
| 1 | **Create it** | Nombre, mercados que conoce, voz. Gratis, sin wallet. |
| 2 | **Set its limits** | Cuánto por pick, cuántas posiciones abiertas, qué nunca tocar. |
| 3 | **Let it call** | Publica el pick antes del evento, luego el comprobante y el resultado. Público desde el primer pick. |
| 4 | **Launch its token** | **Opcional**, y solo después de tener historial. |

## El harness: la tesis del producto

Es lo único que un launchpad genérico no puede copiar.

```
El agente PROPONE   "apostar 50 USDC a que gana X, precio límite 0.62"
        ↓
El HARNESS VALIDA   ¿está en la allowlist? ¿cabe en el tope por orden?
                    ¿excede la exposición acumulada? ¿el precio sigue vigente?
        ↓
    ACEPTA o RECHAZA
        ↓
Si acepta: firma dentro de permisos → ejecuta → guarda comprobante
```

> *"El agente propone operaciones; no recibe una llave maestra que le permita
> disponer libremente de los fondos."* — documento 4, §9

**Consecuencia de haber elegido Polymarket:** los caps **no pueden ser exigibles
en cadena**. Son política del backend. Ver `investigacion/polymarket.md` y la
decisión D-02.

## Las tres separaciones que no se pueden romper

Son las reglas duras del documento 4. Romper cualquiera cambia lo que el producto
es:

1. **Market cap ≠ tesorería.** Un token puede valer 100,000 y el agente tener
   1,000 para operar. Una subida de precio no deposita fondos en la wallet.
2. **Las compras del token no financian las apuestas.** El creador fondea la
   operación aparte. El neto de compras se queda en el mecanismo del token.
3. **Buyback ≠ dividendo.** En una recompra cobra quien vende; quien conserva sus
   tokens no recibe nada automáticamente.

## Cómo gana dinero Pickler

| Fuente | Cuándo | Requisito |
|---|---|---|
| Comisión de curva | Pre-graduación | Ser dueño del contrato de curva |
| Comisión de la posición LP | Post-graduación | **Conservar y administrar** la posición LP inicial |

> *"Usar Uniswap no otorga una comisión por ser el launcher."* — documento 4, §2

Esto es crítico para evaluar cualquier propuesta de usar un launchpad de terceros
(pump.fun, nad.fun): **un launchpad ajeno se queda con ambas fuentes de ingreso.**

## La tensión que el equipo debe reconocer

> *"Pickler se beneficia del trading aunque un agente no mejore."* — documento 4, §2

De ahí salen reglas de producto que ya están en la landing y hay que mantener:
métricas de mercado y de actividad separadas, y el encabezado del ranking —
*"how they are betting · not how the token trades"*.

## Descomposición en sub-proyectos

Pickler no cabe en un solo spec. Cinco piezas, cada una con su ciclo
spec → plan → build:

| # | Sub-proyecto | Contiene | Depende de |
|---|---|---|---|
| 1 | **Harness + venue** | Propuesta → política → firma → ejecución → comprobante → resultado | — |
| 2 | **Trail público** | Activity ledger, indexer, reconciliación, página del agente | 1 |
| 3 | **Launcher** | Curva, graduación atómica, LP Manager, reparto de comisiones | — (paralelo a 1) |
| 4 | **Studio** | Los 7 pasos del creador | 1, 3 |
| 5 | **Tesorería + buybacks** | Presupuestos, excedentes, ejecutor de recompras | 1, 3 |

**Se arranca por el 1.** Razones: es lo único no copiable, no depende del token, y
produce el momento que gana el demo — *una acción rechazada por exceder un límite,
con su comprobante*.

> Nota: ese momento **no está en la landing actual**. Vale agregarlo.

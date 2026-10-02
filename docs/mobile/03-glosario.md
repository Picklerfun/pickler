# Glosario

Los conceptos de tokenomics que hay que entender para leer el documento 4 sin
tropezarse.

---

## Bonding curve (curva de lanzamiento)

Un contrato que vende tokens a un precio que sube solo, según una fórmula fija. No
hay nadie del otro lado vendiendo — el contrato acuña en el momento.

| Compra | Precio unitario | Pagas | Recibes |
|---|---|---|---|
| 1ª | 0.001 MON | 10 MON | 10,000 |
| 2ª | 0.002 MON | 10 MON | 5,000 |
| 3ª | 0.004 MON | 10 MON | 2,500 |

*(números ilustrativos; la curva real de Pickler no está definida)*

Dos propiedades:

- **No necesita liquidez inicial.** Ese es el punto. El primer comprador aporta el
  capital. **Nadie subvenciona nada** — es que el precio lo fija una fórmula, no un
  libro de órdenes.
- **El precio es determinista:** `precio = f(tokens vendidos)`.

El dinero que entra se queda dentro del contrato: las **reservas**.

---

## Graduación

Cuando las reservas llegan a un umbral, se cierra la curva y el token pasa a un
mercado normal.

```
Se cierra la curva
   ↓
Reservas acumuladas + tokens guardados sin vender
   ↓
Se depositan como liquidez en un pool de un DEX (Uniswap v4)
   ↓
El token se negocia en mercado libre
```

**Debe ser atómica o revertir.** Si la transacción se parte a la mitad, se retira
el capital y el pool no se crea — el token queda sin mercado. Documento 4, §3.

> Referencia: HeyAnon divide el suministro **78% curva / 22% migración**. Ese 22%
> son los tokens que se emparejan con las reservas en el pool.

---

## Las dos comisiones

### Comisión de curva (pre-grad)
Un % de cada compra y venta mientras el token está en la curva.
*Inmediata pero temporal* — se acaba al graduar.

### Comisión de LP (post-grad)
En un DEX, quien aporta liquidez (**LP**, *liquidity provider*) cobra una tarifa de
cada swap que pasa por ese pool. Es el pago por prestar capital al mercado.

Al graduar se crea la **posición LP inicial**. La pregunta de negocio es **quién es
su dueño**:

> *"Usar Uniswap no otorga una comisión por ser el launcher."* — documento 4, §2

Uniswap no paga por haber lanzado el token. **Solo se cobra si se conserva y
administra esa posición** mediante un contrato con reglas de cobro. De ahí la
necesidad de un **LP Manager**.

*Permanente pero incierta* — depende del volumen que pase por **ese** pool. Si el
volumen migra a otro pool del mismo token, no se cobra nada de eso.

| | Curva | LP |
|---|---|---|
| Origen | % de compra/venta en la curva | % de cada swap en el pool |
| Duración | Hasta graduar | Mientras se conserve la posición |
| Requisito | Ser dueño del contrato de curva | **Conservar y administrar la posición** |
| Riesgo | Se acaba | El volumen migra a otro pool |

---

## Market cap ≠ tesorería

La confusión más costosa del proyecto.

**Market cap** = precio × tokens en circulación. Es **una multiplicación, no
dinero**. Nadie tiene esa cantidad guardada.

**Tesorería** = fondos reales en una wallet, que el agente puede gastar.

```
$PICK vale 100,000 de market cap
Pickle tiene 1,000 en tesorería

Pickle pierde 10 en una predicción
   → tesorería baja a 990
   → el market cap NO cambia

El precio de $PICK sube 50% (market cap → 150,000)
   → la tesorería sigue en 990. No llegó nada a la wallet.
```

**Por qué no se tocan:** el market cap sube porque alguien le pagó *a otro holder*
por sus tokens en el mercado secundario. Ese dinero fue de comprador a vendedor —
**nunca pasó por la wallet del agente**.

*Analogía: si tu casa se revalúa de 2 a 3 millones, tu cuenta de banco sigue igual.*

De ahí la regla dura del documento 4, §3:

> *"En pre-grad, el importe neto de compras permanece en el mecanismo del token; no
> paga predicciones, datos ni gas del agente."*

**El dinero que la gente mete comprando el token NO es el dinero con el que el
agente apuesta.** Ese lo pone el creador.

---

## Otros términos

| Término | Significado en Pickler |
|---|---|
| **Harness financiero** | Capa que recibe propuestas del agente, comprueba políticas, gobierna la ejecución y registra comprobantes |
| **Skill** | Una capacidad y cómo usarla ("evaluar mercados de deportes con ciertas fuentes") |
| **Herramienta** | Una operación concreta ("proponer una posición"). Habilitar una skill **no** concede permisos de firma |
| **Buyback** | Compra del token con fondos elegibles. **No** es pago directo a holders: cobra quien vende |
| **Track record** | Historial atribuible con decisiones, ejecuciones, resultados y alcance de cobertura visible |
| **Pre-grad / post-grad** | Etapas económicas del token. **No** inician ni reinician al agente |
| **CLOB** | *Central Limit Order Book*. En Polymarket: matching off-chain, settlement on-chain |
| **UMA Optimistic Oracle** | Cómo resuelve Polymarket: un proposer envía el resultado, hay ~2h de disputa, luego resuelve on-chain |

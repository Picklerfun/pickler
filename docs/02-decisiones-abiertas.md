# Decisiones abiertas

Última actualización: 2026-09-11.

Convención: **D-0x** bloqueantes (impiden escribir el primer spec) · **D-1x**
necesarias antes del piloto.

---

## D-01 · ¿En qué cadena vive el token? 🔴 BLOQUEANTE

**Estado:** abierto. **Decide:** equipo (Juvenal + cofounder), no es decisión de ingeniería.

El documento 4 dice Monad. Un dev del equipo propuso apalancarse de **pump.fun**
(Solana) para no construir el launcher, apuntando además al hackathon de
**Colosseum**.

Conteo de redes si se adopta pump.fun:

```
Token      → Solana   (pump.fun)
Ejecución  → Polygon  (Polymarket)
Hackathon  → Monad    (nada)
```

**Dos objeciones que hay que responder antes de decidir:**

1. **La cadena del hackathon se queda vacía.** Ya hay un cruce Monad↔Polygon por
   haber elegido Polymarket; Solana encima son tres redes.
2. **Se regala el modelo de ingreso.** Con un launchpad ajeno, ese launchpad cobra
   la curva y controla la graduación. Pregunta abierta al equipo:
   **¿de qué vive Pickler entonces?**

**Versión intermedia a evaluar:** usar un launchpad **en Monad** (`nad.fun`, ya
citado en el documento 4, nota [9]) en vez de construir curva propia. Mismo ahorro
de trabajo, sin cambiar de cadena. Advertencia ya registrada en el documento 4: su
flujo de graduación manda la liquidez al LP manager y **no se asume** que permita
el reparto de recaudación a tesorería.

**Bloquea:** todo el sub-proyecto 3, y la tesorería y buybacks del 5.

---

## D-02 · ¿Los caps son policy o tienen respaldo on-chain? 🔴 BLOQUEANTE

**Estado:** abierto. **Decide:** Jesús + Gilbert.

Está verificado que Polymarket **no acepta una Safe arbitraria** con módulos
propios — despliega su propia wallet por factory. Por lo tanto **no hay forma de
hacer los caps exigibles en cadena dentro de Polymarket.**

Dos salidas, ambas legítimas:

| Opción | Qué promete | Costo |
|---|---|---|
| **(a) Caps como policy declarada** | El backend firma o no firma. Si el backend falla, el cap no existe. | Honesto y rápido. Obliga a cambiar el copy de la landing. |
| **(b) Respaldo on-chain parcial** | La wallet del agente es propia; solo se transfiere a Polymarket el monto autorizado por operación. El cap se vuelve exigible sobre *el capital expuesto*, no sobre la orden individual. | Más trabajo. Promesa más fuerte. |

**Obligación del documento 4, §4:**

> *"Self-custodial exige especificar control efectivo: poseer una wallet no basta.
> Si una llave del creador o de la plataforma puede retirar libremente la
> tesorería, debemos mostrarlo."*

**Consecuencia inmediata:** la landing hoy dice *"Its own wallet, inside the caps
its creator set"* y *"YOUR MONEY, YOUR CAPS"*. Con la opción (a) eso promete de
más y hay que reescribirlo.

**Bloquea:** el spec del sub-proyecto 1.

---

## D-03 · ¿El token es opcional y posterior al historial?

**Estado:** conflicto entre documento y diseño. **Decide:** Juvenal.

El documento 4 describe la curva pre-grad como etapa inicial del token. La landing
propone: agente gratis → construye historial → **luego**, opcional, lanza token
(*"Once it has a record, launch its token"*).

El orden de la landing es mejor producto — el track record precede a la
especulación — pero **el documento no lo refleja**. Si no se reconcilia, alguien va
a implementar el orden viejo.

---

## D-10 · Términos de uso y jurisdicciones de Polymarket

**Estado:** pendiente de verificación en fuente primaria. **Decide:** cofounder + Juvenal.

Las fuentes secundarias de 2026 se contradicen sobre el estatus en EE.UU. Hay
geoblocking activo y móvil (bloqueo total en 4 países, ~30 jurisdicciones en modo
"close-only"). El trading automatizado sí está permitido.

**Hay que leer el ToS oficial antes del piloto.** Tiene consecuencias legales, no
solo técnicas. Detalle en `investigacion/polymarket.md`.

---

## D-11 · ¿Existe Pickle como agente de referencia?

**Estado:** abierto.

El documento 4 dice que el primer agente es **Pickle** con ticker **$PICK**, y
dedica su §11 al "oficio de Pickle" y a investigación con tipsters. En la landing
**no aparece ni Pickle ni $PICK** — los agentes son Halftime, Unlock Watch,
Bracket, Front Range, Cold Open, Print Day.

Además la landing ya fijó los nichos (sports, crypto, esports, awards, macro) que
el documento marcaba como investigación de usuarios pendiente.

---

## D-12 · Cross-chain: ganancias en Polygon, buybacks en Monad

**Estado:** abierto, depende de D-01.

El agente gana USDC en Polygon; las recompras se ejecutan en la cadena del token.
Hay un puente en medio, con tiempos y conciliación. El documento 4, §6 lo marca:

> *"Esto es una dependencia de alcance, no un detalle del frontend. El MVP debe
> usar una sola ruta definida o simularla con etiquetas claras."*

Opción válida para el MVP: las ganancias se quedan en Polygon y los buybacks se
declaran explícitamente como diferidos o simulados.

---

## Decisiones ya tomadas

| ID | Decisión | Fecha |
|---|---|---|
| ✅ | **Venue: Polymarket** | 2026-09-10 |
| ✅ | Arrancar por el sub-proyecto 1 (harness + venue) | 2026-09-11 |
| ✅ | Repo `predict`, producto `Pickler` | 2026-09-11 |

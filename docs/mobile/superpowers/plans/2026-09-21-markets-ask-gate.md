# Markets sin gate para Ask y trading key que sobrevive al sign out — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que un usuario sin trading key de Perpl (wallet nueva, reinstalación, o —hasta hoy— cualquiera que cerró sesión) pueda abrir cualquier mercado desde **Markets** y usar **Ask** y **Agents**; que el gate de Perpl («Enable / Reconnect trading») viva sólo en la pestaña **Trade**; y que **cerrar sesión ya no borre la trading key**, para que sign out + sign in con la misma wallet no cueste una tx de gas ni registre otra key en Perpl (Perpl limita las keys por cuenta: `423 Too many trading keys`). Además, cerrar F1 de Ask con la evidencia del push real de APNs que llegó hoy.

**Architecture:** Tres cambios mínimos sobre lo que ya existe: (1) `useAccount.signOut` deja de llamar `clearTradingKey()` (la key sigue atada a su `address`; `usePerpl` ya la ignora si la wallet activa es otra; «Reset trading key» sigue siendo la forma explícita de tirarla); (2) `MarketsList` siempre navega: con key a `marketTab: "trade"`, sin key a `"ask"` (`marketEntryTab(hasKey)` puro en `store.ts`); (3) `TradeTab` muestra `TradeGate` (una `StatusCard` con «Reconnect trading» / «Enable trading» que vuelve a Markets) cuando `perpl.state.status !== "ready"`. Ask, Agents, `useReads`, `usePerpl`, el flujo de Enable/Reconnect y el servidor no cambian.

**Tech Stack:** Expo SDK 57 / RN 0.86, jest-expo (`__tests__/*.test.ts`), TypeScript (`npx tsc --noEmit`). Simulador iPhone 17 Pro `2B2A0BAD-7B14-4DAE-8652-C7E9472505E0`, Maestro (`taplabel.sh`).

**Spec:** No hay spec nuevo: es una corrección de tres decisiones existentes, que Task 4 marca **(gate)** en su sitio: `docs/superpowers/specs/2026-09-16-mobile-perpl-design.md` («Sign out: `clearTradingKey()`…», l. ~241, y «`clearTradingKey` (se llama desde `signOut`…)», l. ~140), `docs/superpowers/specs/2026-09-18-mobile-hifi-design.md` D13 («Lista de mercados en gate `readOnly` (opacidad .7)») y `docs/superpowers/specs/2026-09-19-mobile-ask-design.md` D13 (`marketTab` por default). Contexto: audit F2 `docs/superpowers/audits/2026-09-19-mobile-ask-f2-rulings.md` §5 pendiente 3 y §7; diseño aprobado por Jesús el 2026-09-20 (opción **B**: conservar la key; A = key derivada de una firma de la wallet, patrón dYdX v4, queda como follow-up post-bounty).

## Global Constraints

- Worktree `.claude/worktrees/markets-ask-gate`, rama `fix/markets-ask-gate` desde `main` = `3a0c490`. Primer comando en el worktree: `cd apps/mobile && npm ci` (npm, no pnpm; el `package-lock` ya trae `expo-notifications`). Nunca `cd` al checkout principal para editar. Nunca `git add -A`; archivos por nombre. **Commits autorizados** en la sesión de ejecución (Jesús aprobó el diseño y pidió el plan; confirmar la autorización de commits al arrancar si el mensaje de arranque no la trae): `fix(mobile): …` / `docs(mobile-ask): …` con trailer `Co-Authored-By: <modelo que escribe> <noreply@anthropic.com>` y `Claude-Session: <URL de la sesión que ejecuta>`. **Sin push, sin merge, sin TestFlight.**
- Sin dependencias nuevas ni cambios nativos: no hace falta `prebuild` ni `run:ios` si el dev build sigue instalado en el simulador (hoy lo está: `xcrun simctl listapps <UDID> | grep fun.pickler.app`). Metro **no está corriendo** (se detuvo al borrar el worktree anterior): arrancarlo con `nohup npx expo start --port 8081 > "$SC/metro.log" 2>&1 &` desde `apps/mobile` del worktree y esperar `Waiting on http://localhost:8081`; luego `xcrun simctl launch <UDID> fun.pickler.app`.
- Simulador **siempre por UDID `2B2A0BAD-7B14-4DAE-8652-C7E9472505E0`**, nunca `booted`. Capturas con `xcrun simctl io <UDID> screenshot …` y **mirar cada una** antes de afirmar nada. Cuenta #620 del simulador: **no mover AUSD ni MON, ninguna orden, y —en esta verificación— ningún «Reconnect»/«Enable» real** (Task 3 comprueba que la card aparece, no ejecuta el flujo). Face ID: `xcrun simctl spawn <UDID> notifyutil -p com.apple.BiometricKit_Sim.fingerTouch.match`. **Otra sesión (Proflores iOS) usa el mismo simulador**: si aparece un sign out inesperado o el simulador apagado, anotarlo y recuperar (passkey «pickler» de Apple Passwords).
- Backend sin cambios; consultas sólo `--read-only` con `node scripts/query.mjs` desde `services/reads`; nunca `db push/reset`, nunca el MCP de Supabase de la sesión. **No imprimir secretos ni tokens** (`.env.pickler`, `mobile.devices.token`).
- `npm test` (hoy 31 suites / 236 tests) y `npx tsc --noEmit` en verde al cierre de cada task que toca código. Ninguna prueba de UI (P12 del plan F2): pantallas por `tsc` + simulador. Copy en inglés; código y comentarios en español donde el archivo vecino los tenga; tests en inglés.
- Docs: contrato de `docs/CLAUDE.md`; `npm run docs:html`; dev tracker con la skill `.claude/skills/pickler-dev-new/SKILL.md` (types `fix`); `docs:check` `errors=0`, `agents:check` `"errors": []`.

## Decisiones del plan (no están en el spec)

| # | Decisión | Por qué |
|---|---|---|
| P1 | `signOut` conserva la trading key; **sólo** borra `pickler.account.v1` (cuenta local) y `pickler.reads.v1` (sesión de reads). El comentario del código cita esta corrección **(gate)**. Sin test unitario nuevo: `useAccount` es un hook sin tests (P12) y la garantía «la key de otra wallet se ignora» ya la da `usePerpl` (`same(key.address, address)`, línea del efecto de arranque); se verifica en el simulador (Task 3). | Opción B aprobada. Un test de `signOut` exigiría mockear SecureStore por una línea. |
| P2 | `marketEntryTab(hasKey: boolean): MarketTab` = `hasKey ? "trade" : "ask"`, puro en `store.ts`, con test en `store.test.ts`. `MarketsList` recibe `hasKey` (antes `readOnly`) y **siempre** es tocable; se quita la opacidad .7. | Un solo sitio decide a qué pill entra un mercado; el test fija el contrato. |
| P3 | `TradeGate` vive en `market.tsx` (junto a `TradeTab`), no en `markets.tsx`: `StatusCard` tono lima (`TRADE_GATE = { bd: C.limeBd, bg: C.limeBg06, fg: C.lime }`), tag `TRADE`, título «Trading isn't set up on this phone», cuerpo según `perpl.existingAccountId` (> 0 → «This wallet already has Perpl account #N. Reconnect registers a trading key on this phone; no AUSD moves.», si no → «Enable trading moves AUSD from your wallet into a Perpl trading account. One Face ID, four steps.»), `Btn lime` «Reconnect trading» / «Enable trading» que hace **`back()`** (Market siempre se abre desde Markets, donde vive el flujo real de Enable/Reconnect; no se duplica), y una línea `faint` «Ask and Agents work without a trading key.». Con `status === "loading"`, spinner. | Reusar el Gate de Markets tal cual: cero lógica nueva de onboarding. `back()` en vez de `nav("markets")` para no apilar pantallas. |
| P4 | El `return` temprano de `TradeGate` va **después de los tres `useState`** de `TradeTab` (`amount`, `lv`, `st`) y antes de `leverages`: no hay hooks condicionales. | Regla de hooks. |
| P5 | El Gate de Markets gana una línea `faint` encima de la lista: «Ask an agent on any market below — no trading key needed.». La card Enable/Reconnect no cambia. | Que el jurado sepa que puede tocar la lista aunque el gate esté arriba. |
| P6 | **Reconnect real sigue reenviando `enableForwarding`** (no hay lectura on-chain del flag y el socket que lo reporta necesita la key). Con P1 eso ocurre una vez por dispositivo, no por sign out; queda como residual documentado, no se toca. | Corrección a lo dicho en la sesión de diseño («lo arreglo leyendo el estado»): no es barato ni necesario ya. |
| P7 | Verificación del «sin Reconnect» en Task 3: sign out → sign in con la misma wallet → pill Trade en `ready` (ticket visible, sin card) y **`mobile.devices`/`agent_records` intactos**; `select count(*)` de keys no existe en nuestro lado, así que la evidencia de «cero keys nuevas» es que **no se ejecutó ningún Enable/Reconnect** (capturas + ausencia de tx: MON igual antes/después). | Es lo que se puede medir sin la API de keys de Perpl. |
| P8 | **F1 de Ask pasa a `completed`** en overview y manifest, con addendum §8 al audit F1: el 2026-09-20 (23:1x CST) se cargaron `APNS_KEY_ID`/`APNS_TEAM_ID`/`APNS_KEY_P8_B64` (key **`N585YVNSFA`** del team `2PBQJ37Q8W`, la misma de Proflores: las keys APNs son del team), el smoke `apnsSmoke` con token falso devolvió `{"apns":{"status":400,"reason":"BadDeviceToken"}}` y el push al token real del simulador devolvió `status 200` y **se vio el banner «Pickler · APNs smoke»** (captura `apns-real-push2.png`). `PUSH_MODE` se queda en `"apns"`. La capability Push Notifications en el App ID sigue siendo insumo de Jesús para F4. | Es lo que cierra el pendiente 1 de F1 y F2; se documenta en este plan porque es la misma sesión de docs. |
| P9 | Los PNG de evidencia versionados: `docs/superpowers/audits/img/2026-09-20-apns-real-push.png` (banner) y `2026-09-21-markets-ask-gate-{gate,trade-gate}.png` (Task 3). | Precedente F2-matrix (P12 de ese plan). |

## Mapa de archivos

| Archivo | Task | Responsabilidad |
|---|---|---|
| `apps/mobile/src/hooks/useAccount.ts` | 1 | `signOut` sin `clearTradingKey` (P1) |
| `apps/mobile/src/store.ts`, `__tests__/store.test.ts` | 1 | `marketEntryTab` (P2) |
| `apps/mobile/src/screens/markets.tsx` | 2 | `MarketsList` siempre tocable con `hasKey`; línea del Gate (P2, P5) |
| `apps/mobile/src/screens/market.tsx` | 2 | `TradeGate` + retorno temprano en `TradeTab` (P3, P4) |
| Simulador | 3 | Recorrido con capturas (P7) |
| `docs/superpowers/specs/{2026-09-16-mobile-perpl,2026-09-18-mobile-hifi,2026-09-19-mobile-ask}-design.md`, `docs/overview/2026-09-19-mobile-ask.html`, `docs/overview/data/manifest.js`, `docs/overview/dev/2026-09-21-markets-ask-gate.html`, `docs/superpowers/audits/2026-09-19-mobile-ask-f1-rulings.md`, `docs/superpowers/audits/2026-09-19-mobile-ask-f2-rulings.md`, `docs/superpowers/audits/img/*.png`, `apps/mobile/README.md` | 4 | Correcciones **(gate)**, dev tracker, F1 `completed` + addendum APNs (P8), F2 followups, revisión independiente, checks |

---

### Task 1: `signOut` conserva la trading key; `marketEntryTab` en el store

**Files:**
- Modify: `apps/mobile/src/hooks/useAccount.ts` (import y `signOut`)
- Modify: `apps/mobile/src/store.ts` (junto a `MARKET_SUBTITLES`)
- Test: `apps/mobile/__tests__/store.test.ts`

**Interfaces:**
- Produces: `marketEntryTab(hasKey: boolean): MarketTab` (export de `src/store.ts`). Lo usa Task 2.

- [ ] **Step 1: Línea base**

```bash
cd /Users/josedejesusacevedoflores/Documents/predict/.claude/worktrees/markets-ask-gate/apps/mobile
git status --short && git log --oneline -1
npm test 2>&1 | tail -4
npx tsc --noEmit && echo TSC-OK
```
Expected: árbol limpio salvo el plan (`docs/superpowers/plans/2026-09-21-markets-ask-gate.{md,html}` sin commit), HEAD `3a0c490`; `Tests: 236 passed` / `31 passed`; `TSC-OK`. Si falta `node_modules`, `npm ci` primero.

- [ ] **Step 2: Test de `marketEntryTab` (RED)** — añadir `marketEntryTab` al import de `../src/store` en `__tests__/store.test.ts` y al final del archivo:

```ts
test("a market opens on Trade with a trading key and on Ask without one (gate)", () => {
  expect(marketEntryTab(true)).toBe("trade");
  expect(marketEntryTab(false)).toBe("ask");
});
```

```bash
npx jest __tests__/store.test.ts 2>&1 | tail -8
```
Expected: FAIL — `marketEntryTab is not a function`.

- [ ] **Step 3: Implementar `marketEntryTab`** — en `src/store.ts`, justo antes de `const MARKET_SUBTITLES`:

```ts
/** Pill con el que se abre un mercado desde Markets: Trade con trading key, Ask sin ella (Ask y Agents no la necesitan; fix gate). */
export const marketEntryTab = (hasKey: boolean): MarketTab => (hasKey ? "trade" : "ask");
```

- [ ] **Step 4: `signOut` conserva la key** — en `src/hooks/useAccount.ts`:

Quitar la línea `import { clearTradingKey } from "../storage/perpl";` y sustituir el cuerpo de `signOut` por:

```ts
  const signOut = useCallback(async () => {
    // D6: la sesión de reads muere con la cuenta. La trading key de Perpl se conserva (fix gate, opción B): está atada a su
    // address y usePerpl la ignora si la wallet activa es otra; borrarla obligaba a un Reconnect (tx + key nueva) en cada sign in.
    // «Reset trading key» sigue siendo la forma explícita de tirarla.
    await Promise.all([clearStoredAccount(), clearReadsSession()]);
    replace({ status: "none" });
  }, [replace]);
```

- [ ] **Step 5: Verde y commit**

```bash
npx jest __tests__/store.test.ts 2>&1 | tail -6
npm test 2>&1 | tail -4 && npx tsc --noEmit && echo TSC-OK
grep -n 'clearTradingKey' src/hooks/useAccount.ts || echo "sin clearTradingKey en useAccount"
git add src/hooks/useAccount.ts src/store.ts __tests__/store.test.ts
git commit -m "fix(mobile): sign out conserva la trading key de Perpl y marketEntryTab decide el pill de entrada" -m "Co-Authored-By: <modelo> <noreply@anthropic.com>" -m "Claude-Session: <url>"
```
Expected: 31 suites / 237 tests; `TSC-OK`; `sin clearTradingKey en useAccount` (`clearTradingKey` sigue exportado en `storage/perpl.ts` para `resetKey`).

---

### Task 2: Markets siempre abre el mercado; `TradeGate` en la pestaña Trade

**Files:**
- Modify: `apps/mobile/src/screens/markets.tsx` (`MarketsList`, `Gate`, `MarketsScreen`)
- Modify: `apps/mobile/src/screens/market.tsx` (`TradeGate`, `TradeTab`)

**Interfaces:**
- Consumes: `marketEntryTab` (Task 1); `perpl.state.status`, `perpl.existingAccountId` (ya en `Perpl`); `back` de `AppCtx`.

- [ ] **Step 1: `markets.tsx` — `MarketsList` con `hasKey`**

Import: añadir `marketEntryTab` → `import { marketEntryTab } from "../store";` (junto a los demás imports de `../`).

Sustituir la firma y las dos líneas de `onPress`/`style` de `MarketsList`:

```tsx
/** Lista de mercados: siempre tocable. Con trading key entra a Trade; sin ella a Ask (fix gate, P2). */
function MarketsList({ perpl, nav, hasKey }: Pick<AppCtx, "perpl" | "nav"> & { hasKey: boolean }) {
```
y en la `TouchCard`:
```tsx
            onPress={() => nav("market", { perpsMarketId: m.id, perpsSide: "long", marketTab: marketEntryTab(hasKey) })}
            style={{ flexDirection: "row", alignItems: "center", gap: 11 }}
```

En `Gate` (final del `return`), sustituir `<MarketsList perpl={perpl} nav={nav} readOnly />` por:

```tsx
      <T w={400} s={11.5} lh={1.4} color={C.faint}>Ask an agent on any market below — no trading key needed.</T>
      <MarketsList perpl={perpl} nav={nav} hasKey={false} />
```

En `MarketsScreen` (estado `ready`), sustituir `<MarketsList perpl={perpl} nav={nav} readOnly={false} />` por `<MarketsList perpl={perpl} nav={nav} hasKey />`.

- [ ] **Step 2: `market.tsx` — `TradeGate`**

Import: `Btn, Card, Chip, KVList, type KVRow, Page, PillTabs, Segmented, StatusCard, T, Tag, type Tone` ya están; no cambia.

Añadir antes de `function TradeTab`:

```tsx
const TRADE_GATE: Tone = { bd: C.limeBd, bg: C.limeBg06, fg: C.lime };

/** Sin trading key en este teléfono: el gate de Perpl vive aquí, no en Markets (fix gate, P3). El flujo real de Enable/Reconnect sigue en Markets. */
function TradeGate({ perpl, back }: Pick<AppCtx, "perpl" | "back">) {
  if (perpl.state.status === "loading") return <Page top={13}><ActivityIndicator color={C.lime} /></Page>;
  const existing = perpl.existingAccountId;
  const reconnect = existing !== null && existing > 0n;
  return (
    <Page top={13} gap={11}>
      <StatusCard tag="TRADE" title="Trading isn't set up on this phone" tone={TRADE_GATE}
        body={reconnect
          ? `This wallet already has Perpl account #${String(existing)}. Reconnect registers a trading key on this phone; no AUSD moves.`
          : "Enable trading moves AUSD from your wallet into a Perpl trading account. One Face ID, four steps."}>
        <Btn label={reconnect ? "Reconnect trading" : "Enable trading"} onPress={back} variant="lime" py={14} accessibilityLabel="trade-gate" />
      </StatusCard>
      <T w={400} s={11} lh={1.45} color={C.faint}>Ask and Agents work without a trading key.</T>
    </Page>
  );
}
```

En `TradeTab`: cambiar la firma a `function TradeTab({ S, set, perpl, nav, back }: AppCtx)` y, **inmediatamente después** de `const [st, setSt] = useState<Step>({ step: "edit" });` (P4):

```tsx
  if (perpl.state.status !== "ready") return <TradeGate perpl={perpl} back={back} />;
```
(Si `nav` queda sin usar en `TradeTab` tras el cambio, `tsc` no protesta —no hay `noUnusedParameters`—; dejarlo si lo usa el ticket, quitarlo si no.)

- [ ] **Step 3: Verificar y commit**

```bash
npx tsc --noEmit && echo TSC-OK && npm test 2>&1 | tail -4
grep -n 'readOnly' src/screens/markets.tsx || echo "sin readOnly"
git add src/screens/markets.tsx src/screens/market.tsx
git commit -m "fix(mobile): Markets abre cualquier mercado (Ask sin trading key) y el gate de Perpl vive en la pestaña Trade" -m "Co-Authored-By: <modelo> <noreply@anthropic.com>" -m "Claude-Session: <url>"
```
Expected: `TSC-OK`, 31 / 237, `sin readOnly`.

---

### Task 3: Recorrido en el simulador (capturas)

**Files:** ninguno del repo. Workspace: `SC=<repo>/.claude/worktrees/markets-ask-gate/.superpowers/sdd/2026-09-21-markets-ask-gate` (lo crea `scripts/sdd-workspace`); copiar ahí `taplabel.sh`, `tap-point.yaml` y `flows/` desde `<repo>/.superpowers/sdd/2026-09-20-mobile-ask-matrix/` del checkout principal y ajustar la variable `SC` de `taplabel.sh` a este workspace. Capturas en `$SC/shots/`.

**Interfaces:**
- Labels: `market-BTC`, `pill-ask`, `pill-trade`, `pill-agents`, `trade-gate`, `reset-trading-key`, `ask-unlock`, `cell-100-240`, `segment-mine`; Dev controls (⚙ arriba a la derecha) → «Sign out», «Lock», «Market · ticket».
- Produces: `$SC/task-3-report.md` con la tabla de capturas y los saldos antes/después; dos PNG copiados a `docs/superpowers/audits/img/2026-09-21-markets-ask-gate-{gate,trade-gate}.png` (P9).

- [ ] **Step 0: Metro, simulador, saldos**

```bash
U=2B2A0BAD-7B14-4DAE-8652-C7E9472505E0
cd /Users/josedejesusacevedoflores/Documents/predict/.claude/worktrees/markets-ask-gate/apps/mobile
xcrun simctl list devices | grep "$U"; xcrun simctl boot "$U" 2>/dev/null; sleep 8
xcrun simctl listapps "$U" | grep -c fun.pickler.app          # ≥ 1 = instalada; si 0 → nohup npx expo run:ios --device "$U" > "$SC/run.log" 2>&1 & y esperar «Installing on» (borra la cuenta local)
lsof -tiTCP:8081 -sTCP:LISTEN || (nohup npx expo start --port 8081 > "$SC/metro.log" 2>&1 & sleep 15; grep -c 'Waiting on' "$SC/metro.log")
xcrun simctl terminate "$U" fun.pickler.app; xcrun simctl launch "$U" fun.pickler.app; sleep 6
xcrun simctl io "$U" screenshot "$SC/shots/00-boot.png"
```
Mirar `00-boot.png`: la app carga por Metro (sin pantalla de «dev server»). Si pide sign in (sesión ajena la cerró): passkey «pickler» + Face ID. Ir a **Wallet** y anotar **AUSD y MON** (captura `01-wallet-before.png`).

- [ ] **Step 1: Estado con key — Trade listo, Ask accesible** — Markets: si muestra la card `TRADING · AUSD` (estado `ready`) → `taplabel.sh market-BTC` → abre en **Trade** (ticket); captura `02-market-trade.png`. `pill-ask` → matriz; `pill-agents` → lista. Captura `03-ask-with-key.png`. Si Markets muestra el Gate («Reconnect trading»: la key ya se perdió por un sign out anterior a este fix), **no** tocar Reconnect: anotarlo y saltar a Step 3 (el Step 2 no aplica hasta tener key; explicar en el reporte).

- [ ] **Step 2: Sign out → sign in NO pide Reconnect (P1, P7)** — ⚙ → «Sign out» → captura `04-signed-out.png` → Sign in con el passkey (`flows/usar-llave.yaml` + Face ID) → Markets debe mostrar **`TRADING · AUSD`** (estado `ready`), **no** el Gate; captura `05-after-signin-ready.png`. `market-BTC` → `pill-trade` → ticket (sin `TradeGate`); captura `06-trade-ready.png`. Wallet → AUSD/MON **iguales** que en Step 0 (ninguna tx); captura `07-wallet-after.png`.

- [ ] **Step 3: Sin key — Markets abre en Ask, Trade muestra el gate** — Markets → «Reset trading key» (`taplabel.sh reset-trading-key`; puede pedir Face ID → `notifyutil … match`) → Markets muestra el **Gate** («Reconnect trading», porque la wallet tiene la cuenta #620) **con la línea «Ask an agent on any market below…»** y la lista **sin opacidad**; captura `08-gate-list.png` → copiar a `docs/superpowers/audits/img/2026-09-21-markets-ask-gate-gate.png`. `taplabel.sh market-BTC` → abre en **Ask** (matriz, créditos 18, hoja al tocar `cell-100-240`); captura `09-ask-without-key.png`. `pill-agents` → lista con récords; captura `10-agents-without-key.png`. `pill-trade` → **`TradeGate`**: «Trading isn't set up on this phone», cuerpo «…account #620. Reconnect registers a trading key…», botón «Reconnect trading», línea «Ask and Agents work without a trading key.»; captura `11-trade-gate.png` → copiar a `…-trade-gate.png`. `taplabel.sh trade-gate` → vuelve a **Markets** (Gate). **No tocar «Reconnect»**. Captura `12-back-to-markets.png`.

- [ ] **Step 4: Sesión de reads sí muere con el sign out (D6 intacto)** — desde el estado de Step 3: ⚙ → «Sign out» → sign in → Markets (Gate) → `market-BTC` → Ask: si la wallet quedó `unlocked`, la firma es silenciosa (P3 del plan F2) y se ve la matriz; si está `locked`, `SessionGate` «Unlock to ask». Cualquiera de las dos es correcta; captura `13-ask-after-signout.png` y anotar cuál se vio. `segment-mine` → las dos reads (`9f386c32…` right, `17eb2ef8…` open o ya resuelta); captura `14-my-reads.png`.

- [ ] **Step 5: Dejar el simulador con key** — para no dejar a Jesús con el Gate: **no** ejecutar Reconnect (tx). Anotar en el reporte que el simulador queda **sin trading key** hasta que Jesús decida hacer Reconnect (una tx de MON + una key en Perpl) — o, si prefiere, que el iPhone será el dispositivo de F4. Saldos por SQL/RPC no cambian: comprobar con la captura de Wallet (`15-wallet-final.png`) que AUSD/MON son los de Step 0.

- [ ] **Step 6: Reporte** — `$SC/task-3-report.md`: tabla captura → qué muestra (mirada ✓), saldos antes/después, qué rama tomó Step 1 y Step 4, incidentes (simulador apagado/sign out ajeno), defectos (si hay, **parar** antes de Task 4).

---

### Task 4: Docs — correcciones (gate), dev tracker, F1 `completed` + addendum APNs, followups F2, revisión independiente, checks

**Files:**
- Modify: `docs/superpowers/specs/2026-09-16-mobile-perpl-design.md`, `docs/superpowers/specs/2026-09-18-mobile-hifi-design.md`, `docs/superpowers/specs/2026-09-19-mobile-ask-design.md`, `docs/overview/2026-09-19-mobile-ask.html`, `docs/overview/data/manifest.js`, `docs/superpowers/audits/2026-09-19-mobile-ask-f1-rulings.md`, `docs/superpowers/audits/2026-09-19-mobile-ask-f2-rulings.md`, `apps/mobile/README.md`
- Create: `docs/overview/dev/2026-09-21-markets-ask-gate.html`, `docs/superpowers/audits/img/2026-09-20-apns-real-push.png` (copia de `<repo>/.superpowers/sdd/2026-09-20-mobile-ask-matrix/matrix-shots/apns-real-push2.png` del checkout principal), `docs/superpowers/audits/img/2026-09-21-markets-ask-gate-{gate,trade-gate}.png` (Task 3)

- [ ] **Step 1: Specs (marcar, no reescribir)**

- Perpl (`2026-09-16-mobile-perpl-design.md`): en la línea «`saveTradingKey`, `clearTradingKey` (se llama desde `signOut` junto a `clearStoredAccount`).» añadir «**(gate, 2026-09-21)** `signOut` ya **no** la llama: la key sobrevive al sign out (opción B; `usePerpl` la ignora si la `address` no coincide); sólo «Reset trading key» la borra. Motivo: cada Reconnect cuesta una tx de gas y registra otra key en Perpl (límite `423`); follow-up post-bounty: key derivada de una firma determinista de la wallet (patrón dYdX v4), sin nada en disco.» Y en el bullet «Sign out: `clearTradingKey()`, socket cerrado, `state = none`.» añadir «**(gate)** sin `clearTradingKey()`: socket cerrado por el cambio de `address`; con la misma wallet el estado vuelve a `ready` sin Reconnect. Residual: un Reconnect real (reinstalación) sigue reenviando `enableForwarding` porque no hay getter on-chain.»
- Hifi (`2026-09-18-mobile-hifi-design.md`) D13: tras «Lista de mercados en gate `readOnly` (opacidad .7).» añadir «**(gate, 2026-09-21)** La lista es **siempre tocable**: con key abre el mercado en Trade, sin key en Ask (`marketEntryTab`); el Gate gana la línea «Ask an agent on any market below — no trading key needed.»; el gate de Perpl vive en la pestaña Trade (`TradeGate`), cuyo botón vuelve a Markets. Plan `2026-09-21-markets-ask-gate.md`.»
- Ask (`2026-09-19-mobile-ask-design.md`) D13: tras «`marketTab` conserva default `trade`.» añadir «**(gate)** Desde Markets, sin trading key el mercado se abre con `marketTab: "ask"` (`marketEntryTab(hasKey)`); Ask y Agents no dependen de Perpl.» Y en la cabecera **Estado**: «F1 `completed` (push real de APNs visto el 2026-09-20, addendum §8 del audit F1); fix gate ejecutado (plan `2026-09-21-markets-ask-gate.md`).»

```bash
cd /Users/josedejesusacevedoflores/Documents/predict/.claude/worktrees/markets-ask-gate && npm run docs:html 2>&1 | grep -c '\[ok\]'
```

- [ ] **Step 2: Audit F1 — addendum §8 (P8)** — añadir al final de `docs/superpowers/audits/2026-09-19-mobile-ask-f1-rulings.md`:

```markdown
## 8. Addendum APNs (2026-09-20, 23:1x CST): el push real llegó

- **Key**: `N585YVNSFA` del team `2PBQJ37Q8W` (la key APNs de Proflores; las keys APNs de tipo token son del team, no de la app). El `.p8` se
  recuperó de `/opt/proflores/.env` de la VPS de Proflores a `~/.private_keys/AuthKey_N585YVNSFA.p8` (600) por Jesús con un comando `!`
  (el clasificador de auto mode bloquea mover credenciales); `openssl pkey` lo validó. `.env.pickler` ganó `APNS_KEY_ID`, `APNS_TEAM_ID`,
  `APNS_KEY_P8_B64` (respaldo `.env.pickler.bak-2026-09-20`); `npx supabase secrets set` → `{"count":3}`; `secrets list` muestra los tres nombres.
- **Smoke** (`resolve-reads` con `{ apnsSmoke: { token: "0"×64, env: "sandbox" } }`, header `x-cron-secret`): `http 200 {"apns":{"status":400,"reason":"BadDeviceToken"}}` — APNs aceptó TLS, HTTP/2 y el JWT (P6 del plan F1).
- **Push real** al token del simulador (`mobile.devices`, `env sandbox`, 160 hex; leído dentro del script, no impreso): `{"apns":{"status":200,"reason":null}}`
  y banner «Pickler · APNs smoke» en el simulador `2B2A…` (arrancado desde apagado; el primer envío no se vio porque el banner caducó antes de la captura; el segundo sí):

![Banner del push real de APNs en el simulador](img/2026-09-20-apns-real-push.png)

- **Decisión**: `PUSH_MODE = "apns"` se queda (el fallback local de D10 sigue implementado y probado por test). **F1 → `completed`**.
- **Sigue pendiente (F4)**: capability Push Notifications en el App ID `fun.pickler.app` (developer.apple.com → Identifiers), insumo de Jesús;
  el simulador no la necesita, el iPhone/TestFlight sí. Rotación de `SUPABASE_ACCESS_TOKEN`/`CRON_SECRET` (incidente 1) sigue abierta.
```

- [ ] **Step 3: Audit F2 — nota en §5/§7** — en `2026-09-19-mobile-ask-f2-rulings.md`, al final de §7 «Pendientes / residuales» añadir: «- **(2026-09-21)** Pendiente 3 de §5 (Markets `readOnly` bloquea Ask) **resuelto** por el plan `2026-09-21-markets-ask-gate.md` (tracker `dev/2026-09-21-markets-ask-gate.html`): la lista siempre abre el mercado, el gate vive en Trade y el sign out conserva la trading key. Pendiente 1 de §5 (push real) **resuelto** el 2026-09-20 (audit F1 §8).»

- [ ] **Step 4: Overview y manifest** — `docs/overview/2026-09-19-mobile-ask.html`: phase-card `data-phase="1"` → `data-status="completed"` y `<option value="completed" selected>`; en el `<details class="followups">` de F2, marcar los ítems 1 (push real), 3 (`PUSH_MODE`) y 4 (Markets `readOnly`) como resueltos (prefijo `<b>Resuelto (2026-09-2x):</b>` y una frase con dónde), dejar el 2 (capability) abierto. `docs/overview/data/manifest.js`: `phases[0].status` de mobile-ask → `'completed'`. Mirar el overview renderizado (abrir el HTML) antes de afirmar.

- [ ] **Step 5: Dev tracker** — seguir `.claude/skills/pickler-dev-new/SKILL.md`: `types: ['fix']`, slug `markets-ask-gate`, fecha `date +%F`, título «Markets abre Ask sin trading key; sign out conserva la key», lede «El gate de Perpl vive en Trade; Ask y Agents funcionan sin key; cerrar sesión ya no obliga a Reconnect (tx + key nueva).», `status: 'in_progress'` (rama sin merge), tags `['mobile', 'perpl', 'ask', 'fix']`; «Qué cambió» de `git log --oneline 3a0c490..HEAD`; «Archivos tocados» de `git diff --stat 3a0c490..HEAD`; «Validación» con las capturas de Task 3 (`<img>` a `../../superpowers/audits/img/2026-09-21-markets-ask-gate-{gate,trade-gate}.png`), saldos iguales antes/después, tests/tsc; render-check y **mirar la captura de 390 px**.

- [ ] **Step 6: README** — `apps/mobile/README.md`: en la sección de Perpl, una línea: «Sign out conserva la trading key (atada a la wallet; «Reset trading key» la borra); sin key, Markets abre el mercado en Ask y la pestaña Trade muestra el gate.» Conteo de tests real.

- [ ] **Step 7: Revisión independiente** — subagente revisor con: este plan, las tres correcciones de spec, `git diff 3a0c490..HEAD -- apps/mobile docs`, el reporte de Task 3 y las capturas. Verificar: (a) `signOut` sigue borrando cuenta local y sesión de reads, y sólo eso; `usePerpl` ignora una key de otra `address` (cita de línea); (b) `MarketsList` navega siempre y el pill de entrada sale de `marketEntryTab`; ningún `readOnly` residual; (c) `TradeGate` sólo cuando `status !== "ready"`, sin hooks condicionales, botón = `back`; el ticket no cambia en `ready`; (d) Ask/Agents/`useReads`/`usePerpl`/servidor sin cambios (stat); (e) sin dependencias nuevas; (f) el test de `marketEntryTab` falla si se invierte; (g) docs: F1 `completed` con evidencia citada, followups F2 actualizados, correcciones **(gate)** en los tres specs. Aplicar lo que proceda y anotar la revisión en el tracker («Validación») y en el audit F2 §7.

- [ ] **Step 8: Checks finales y commit**

```bash
cd /Users/josedejesusacevedoflores/Documents/predict/.claude/worktrees/markets-ask-gate
npm run docs:html && npm run docs:check && npm run agents:check
cd apps/mobile && npm test 2>&1 | tail -4 && npx tsc --noEmit && echo TSC-OK && cd ../..
git status --short
git add docs/superpowers/specs/2026-09-16-mobile-perpl-design.md docs/superpowers/specs/2026-09-16-mobile-perpl-design.html docs/superpowers/specs/2026-09-18-mobile-hifi-design.md docs/superpowers/specs/2026-09-18-mobile-hifi-design.html docs/superpowers/specs/2026-09-19-mobile-ask-design.md docs/superpowers/specs/2026-09-19-mobile-ask-design.html docs/superpowers/plans/2026-09-21-markets-ask-gate.md docs/superpowers/plans/2026-09-21-markets-ask-gate.html docs/overview/2026-09-19-mobile-ask.html docs/overview/data/manifest.js docs/overview/dev/2026-09-21-markets-ask-gate.html docs/superpowers/audits/2026-09-19-mobile-ask-f1-rulings.md docs/superpowers/audits/2026-09-19-mobile-ask-f2-rulings.md docs/superpowers/audits/img/2026-09-20-apns-real-push.png docs/superpowers/audits/img/2026-09-21-markets-ask-gate-gate.png docs/superpowers/audits/img/2026-09-21-markets-ask-gate-trade-gate.png apps/mobile/README.md
git commit -m "docs(mobile-ask): fix gate — specs corregidos (gate), tracker, F1 completed con el push real de APNs, followups F2" -m "Co-Authored-By: <modelo> <noreply@anthropic.com>" -m "Claude-Session: <url>"
```
Expected: `docs:check` `errors=0`; `agents:check` `"errors": []`; 31 / 237; `TSC-OK`; árbol limpio tras el commit. Handoff: la rama queda lista para merge local (decisión de Jesús), el simulador queda **sin trading key** (Step 5 de Task 3), y el siguiente punto es el **plan F3**; siguen abiertos: push de `main` a `origin`, capability Push en el App ID, revocar keys huérfanas en `testnet.perpl.xyz/apikeys`, rotación de secretos.

---

## Self-review del plan (hecho al escribirlo)

- **Cobertura del diseño aprobado (1–5)**: (1) key sobrevive al sign out → Task 1 Step 4 (P1); (2) Markets siempre abre, Ask sin key → Task 1 Steps 2–3 + Task 2 Step 1 (P2, P5); (3) gate en Trade → Task 2 Step 2 (P3, P4); (4) docs: specs **(gate)**, tracker `fix`, F1 `completed` + addendum APNs, followups F2 → Task 4 (P8, P9); (5) verificación: sign out → sign in sin Reconnect, Reset key → Ask/Agents sin key, TradeGate, saldos iguales → Task 3 (P7). Corrección explícita sobre `enableForwarding` → P6 y spec Perpl.
- **Placeholders**: `<modelo>`, `<url>`, `<repo>` y `23:1x` son huecos que el ejecutor rellena con datos reales (hora exacta en el ledger de esta sesión: secrets set 2026-09-21 05:22 UTC = 23:22 CST del 20). No hay «TBD».
- **Consistencia**: `marketEntryTab` (Task 1) ↔ `MarketsList.hasKey` (Task 2); `TradeGate` usa `perpl.existingAccountId: bigint | null` y `back: () => void` de `AppCtx` (`store.ts:147`); `StatusCard` acepta `children` y `tone: Tone` (primitives); `Page` acepta `top`/`gap`; labels de Task 3 existen (`market-BTC`, `pill-*`, `reset-trading-key`, `trade-gate` nuevo, `cell-100-240`, `segment-mine`).

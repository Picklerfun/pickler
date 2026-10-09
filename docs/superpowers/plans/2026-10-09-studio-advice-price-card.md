# Studio advice price card (phase 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A creator sets, changes or clears the AUSD price of one fresh analysis from the live
Studio's Limits section, and sees the current price there.

**Architecture:** The API already has `PUT /v1/studio/agents/:id/advice-price` (phase 1, PR #125).
This phase adds the current price to the Studio agent DTO (`advicePrice`, the same shape the public
DTOs use), a pure web model that validates the input and builds the view, a `saveAdvicePrice`
action on the studio hook, and an "ANALYSES IN THE APP" card in `live/limits.tsx`. The browser
calls the API through the existing `studioApi` transport; the API stays authoritative.

**Tech Stack:** Hono API Worker, PostgreSQL (infrastructure), zod (`@pickler/api-schema`), Next.js
client components, `@pickler/ui`, `node:test`.

**Spec:** `docs/specs/agent-advice-x402-v1.md` (§3.1, D2, D4, D8; rollout §10 step 2).

**Base:** branch `codex/studio-advice-price`, stacked on `codex/agent-advice-x402` (PR #125). Its PR
targets `codex/agent-advice-x402` until #125 merges, then `main`.

## Global Constraints

- Price bounds: 0.10 – 100 AUSD, at most 6 decimals; the wire body is `{ priceAusd: string | null }`
  matching `^\d{1,3}(\.\d{1,6})?$`; `null` clears the price (not for sale) (spec D2, phase 1 schema).
- The response and the new DTO field have the shape
  `{ amount: string, asset: "AUSD", decimals: 6 } | null` (`packages/api-schema/src/studio.ts`
  `advicePriceResponseSchema`).
- The route id is the product agent id: the web passes `agent.productId ?? agent.id`, as every other
  studio mutation does (`shell/use-agent-studio.ts:127`).
- API errors the card must word: 400 `INVALID_INPUT`, 403 (not the owner), 404, 409
  `AGENT_WALLET_REQUIRED` (spec §3.1: "Without a linked agent wallet the card is disabled and says why").
- The card says where the money goes (the agent's wallet, shortened address) and that a failed
  analysis is not refunded automatically (spec §3.1, D8).
- `apps/web` never imports `@pickler/core` or `@pickler/infrastructure` (ESLint `WEB_LAYERS`); client
  validation only improves feedback.
- Colours, fonts, radii and shadows in `apps/web` come from `--pk-*` tokens; `npm run design:source`
  must pass (no literals, no unused CSS classes).
- Repository rules: one statement per line, Prettier 100 columns, named predicates over nested
  ternaries; update each touched project's `AGENTS.md` in the same change; conventional commits
  adding files by name (never `git add -A`); every new test is seen failing against its defect
  before it is trusted (owner's rule).
- Ruling P2-1: the card lives only in the live studio (`live/limits.tsx`). A draft is private and
  cannot be bought; the creator prices it right after Go Public. Cost if wrong: one more import in
  `draft/limits.tsx`.

## Review Focus

1. **A price with a comma or spaces** ("1,5", " 2 ") — the creator expects either a clear message or
   the obvious value; the card trims spaces and refuses a comma with "Use a dot for decimals". Test
   in Task 2.
2. **Saving while the agent has no wallet** — the card is disabled with its reason and never sends
   the PUT; if the API still answers 409 `AGENT_WALLET_REQUIRED` (wallet unlinked meanwhile), the
   card says so instead of a generic error. Test in Task 2.
3. **Turning the toggle off** — sends `{ priceAusd: null }` and the tag reads NOT FOR SALE after the
   reload, without asking for a price. Test in Task 2.
4. **The fixture/preview studio** — saving answers the existing preview note and changes nothing;
   the design harness renders the card on `perpl-limits`. Test in Task 3 (design route).
5. **A price saved elsewhere** (another tab) — after `reloadAfterWrite` the form follows the server
   value unless the creator is editing. Test in Task 2 (view follows saved when clean).

---

### Task 1: The Studio agent DTO carries `advicePrice`

**Files:**

- Modify: `packages/api-schema/src/studio.ts` (`studioAgentSchema` gains `advicePrice`)
- Modify: `packages/infrastructure/src/studio/directory.ts:288-318` (`list()` selects
  `a.advice_price_micro_ausd` and returns `advicePriceMicro: bigint | null`)
- Modify: `workers/api/src/routes/studio.ts:615-645, 665, 830-845` (`studioAgent()` identity gains
  `advicePriceMicro`; the fallback identity uses `null`; serialise with core's `advicePrice()`)
- Modify fixtures: `apps/web/src/features/studio/live/fixture.ts`,
  `apps/web/src/features/studio/draft/fixture.ts`, `scripts/design/fixture-api.mjs`, and every
  studio agent literal in `apps/web/test/*.test.ts` that typecheck reports
- Modify: `packages/api-schema/AGENTS.md`, `workers/api/AGENTS.md` (one line each: the Studio agent
  DTO carries `advicePrice`; this supersedes phase 1's Ruling 4)
- Test: `packages/infrastructure/test/studio-advice-price.test.ts` (extend),
  `workers/api/test/studio-advice-price-route.test.ts` (extend)

**Interfaces:**

- Consumes: phase 1's `advicePriceResponseSchema`, `advicePrice(micro: bigint | null)` from
  `@pickler/core`, `PostgresStudioDirectory.setAdvicePrice`.
- Produces: `StudioAgentDto.advicePrice: { amount: string; asset: "AUSD"; decimals: 6 } | null`
  (the web `Agent` type follows it).

- [ ] **Step 1: Failing tests**
  - Infrastructure (real PostgreSQL, existing seed of that file): after `setAdvicePrice(owner, id,
1500000n)`, `list(access)` returns that agent with `advicePriceMicro === 1500000n`; an agent never
    priced returns `null`.
  - Route: `GET /v1/studio/agents` after the PUT of `"1.5"` lists the agent with
    `advicePrice: { amount: "1.5", asset: "AUSD", decimals: 6 }`; after the PUT of `null`, `null`.
  - Against the defect: drop the column from `list()` → both fail.

- [ ] **Step 2: Run, expect failure** —
      `npm run build:shared && node --import tsx --test packages/infrastructure/test/studio-advice-price.test.ts workers/api/test/studio-advice-price-route.test.ts`
      (export `TEST_DATABASE_URL=postgresql://pickler:pickler_local_only@127.0.0.1:55432/pickler`).

- [ ] **Step 3: Implement**

```ts
// packages/api-schema/src/studio.ts — next to the other studioAgentSchema fields
  /** The AUSD price of one fresh advice analysis, or null when not for sale (x402 spec D2). */
  advicePrice: advicePriceResponseSchema.shape.advicePrice,
```

(move `advicePriceResponseSchema` above `studioAgentSchema` if it is declared after it.)

```sql
-- directory.list(): add to the SELECT list
a.advice_price_micro_ausd
```

```ts
// directory.list() row mapping
      advicePriceMicro:
        row.advice_price_micro_ausd === null ? null : BigInt(row.advice_price_micro_ausd as string),
```

```ts
// routes/studio.ts studioAgent(): identity type gains `advicePriceMicro: bigint | null`;
// the returned object adds
      advicePrice: advicePrice(identity.advicePriceMicro),
// and the spread `...identity` must not leak advicePriceMicro into the parse input:
// destructure `const { advicePriceMicro, ...shown } = identity;` and spread `shown`.
```

Both identity builders (`:665` list path and `:830-845` single-agent path) pass
`advicePriceMicro: listedAgent.advicePriceMicro` or `null` in the fallback.

- [ ] **Step 4: Run** — the two files PASS; then `npm run typecheck` and fix every fixture/test literal
      it names by adding `advicePrice: null` (the live fixture's published Perpl agent gets
      `{ amount: "1.5", asset: "AUSD", decimals: 6 }` so the design harness shows the priced state);
      `npm run typecheck:design`; `npm run lint`; `npm run format:check`.

- [ ] **Step 5: Commit** — `feat(studio): the studio agent carries its advice price`.

---

### Task 2: Web price model, client call and hook action

**Files:**

- Create: `apps/web/src/features/studio/live/advice-price-model.ts`
- Modify: `apps/web/src/features/studio/api.ts` (`saveAdvicePrice`)
- Modify: `apps/web/src/features/studio/shell/use-agent-studio.ts` (`saveAdvicePrice` on
  `UseAgentStudio`, same shape as `saveIdentity`)
- Test: `apps/web/test/studio-advice-price-model.test.ts`

**Interfaces:**

- Consumes: `Agent` (`api.ts`, now with `advicePrice`), `shortAddress` (`new-agent/model.ts`),
  `AdvicePriceUpdateDto` type from `@pickler/api-schema` (export the inferred type from
  `studio.ts` if it is not exported yet).
- Produces:
  - `type PriceForm = { forSale: boolean; text: string }`
  - `savedPriceForm(agent: Agent): PriceForm` — `{ forSale: advicePrice !== null, text: advicePrice?.amount ?? "" }`
  - `parsePriceText(text: string): { ok: true; priceAusd: string } | { ok: false; reason: string }`
  - `advicePriceView(agent: Agent, form: PriceForm, canManage: boolean): AdvicePriceView` with
    `{ tag: string; tone: "good" | "quiet" | "caution"; note: string; walletLine: string | null;
disabledReason: string | null; inputError: string | null; dirty: boolean; canSave: boolean;
body: { priceAusd: string | null } | null }`
  - `advicePriceError(code: string): string` — the line shown for an API error code
  - `saveAdvicePrice(agentId: string, body: AdvicePriceUpdateDto): Promise<AdvicePriceResponseDto>`
  - `UseAgentStudio.saveAdvicePrice(body: AdvicePriceUpdateDto): Promise<void>` (guard → PUT →
    `reloadAfterWrite`)

- [ ] **Step 1: Failing tests** (`node:test`, `node:assert/strict`, a minimal `Agent` literal per
      case):
  - `parsePriceText`: `"1.5"` → ok `"1.5"`; `" 2 "` → ok `"2"`; `"0.10"` and `"100"` → ok;
    `"0.09"`, `"100.01"`, `"1.1234567"`, `"abc"`, `""` → not ok with
    `"Between 0.10 and 100 AUSD, up to 6 decimals."`; `"1,5"` → not ok with
    `"Use a dot for decimals."` (Review Focus 1).
  - `savedPriceForm`: priced agent → `{ forSale: true, text: "1.5" }`; unpriced → `{ forSale: false, text: "" }`.
  - `advicePriceView`:
    - no wallet → `disabledReason: "This agent needs its own wallet before it can sell analyses."`,
      `canSave: false`, `body: null` (Review Focus 2);
    - not the owner (`canManage: false`) → `canSave: false` and `disabledReason` = the existing
      `VIEW_ONLY_REASON`;
    - priced and untouched → `tag: "FOR SALE · 1.5 AUSD"`, `tone: "good"`, `dirty: false`;
    - unpriced → `tag: "NOT FOR SALE"`, `tone: "quiet"`;
    - toggle off on a priced agent → `dirty: true`, `body: { priceAusd: null }`, `canSave: true`,
      no input error (Review Focus 3);
    - toggle on with `"2"` → `body: { priceAusd: "2" }`; with `"0.01"` → `inputError` set,
      `canSave: false`, `body: null`;
    - `walletLine` = `"Paid to this agent's wallet, 0x1234…abcd."` using `shortAddress`;
    - `note` contains `"A failed analysis is not refunded automatically."`.
  - `advicePriceError`: `"AGENT_WALLET_REQUIRED"` → the no-wallet line; `"INVALID_INPUT"` → the
    bounds line; `"FORBIDDEN"` → `VIEW_ONLY_REASON`; anything else → `"The price was not saved. Try again."`.
  - Against the defect: make `parsePriceText` accept `"0.09"` → its test fails; make the toggle-off
    body omit `null` → its test fails.

- [ ] **Step 2: Run, expect failure** —
      `node --import tsx --test apps/web/test/studio-advice-price-model.test.ts`.

- [ ] **Step 3: Implement**

```ts
// apps/web/src/features/studio/live/advice-price-model.ts
import type { Agent } from "../api";
import { shortAddress } from "../new-agent/model";
import { VIEW_ONLY_REASON } from "./build-model";

export type PriceForm = { forSale: boolean; text: string };

const PRICE = /^\d{1,3}(\.\d{1,6})?$/;
const MIN_MICRO = 100_000n;
const MAX_MICRO = 100_000_000n;
export const PRICE_BOUNDS = "Between 0.10 and 100 AUSD, up to 6 decimals.";
export const NO_WALLET = "This agent needs its own wallet before it can sell analyses.";
const NOT_SAVED = "The price was not saved. Try again.";

function toMicro(text: string): bigint {
  const [whole, fraction = ""] = text.split(".");
  return BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, "0"));
}

export function parsePriceText(
  text: string,
): { ok: true; priceAusd: string } | { ok: false; reason: string } {
  const trimmed = text.trim();
  if (trimmed.includes(",")) {
    return { ok: false, reason: "Use a dot for decimals." };
  }
  if (!PRICE.test(trimmed)) {
    return { ok: false, reason: PRICE_BOUNDS };
  }
  const micro = toMicro(trimmed);
  const inBounds = micro >= MIN_MICRO && micro <= MAX_MICRO;
  if (!inBounds) {
    return { ok: false, reason: PRICE_BOUNDS };
  }
  return { ok: true, priceAusd: trimmed };
}
```

`savedPriceForm`, `advicePriceView` and `advicePriceError` follow the interface above, one
statement per line, with named predicates (`const turnedOff = saved.forSale && !form.forSale;`).
`dirty` compares `form` with `savedPriceForm(agent)` after trimming; the body is `null` unless the
form is dirty and valid; `canSave = canManage && wallet !== null && dirty && body !== null`.

```ts
// api.ts, next to saveIdentity
/** `PUT /agents/:id/advice-price`: one analysis's AUSD price, or null. 400, 403, 404, 409. */
export const saveAdvicePrice = (agentId: string, body: AdvicePriceUpdateDto) =>
  studioApi<AdvicePriceResponseDto>(`/agents/${agentId}/advice-price`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
```

```ts
// use-agent-studio.ts, next to saveIdentity
const saveAdvicePrice = useCallback(
  async (body: AdvicePriceUpdateDto) => {
    guard();
    await putAdvicePrice(agentId, body);
    await reloadAfterWrite();
  },
  [guard, agentId, reloadAfterWrite],
);
```

(add it to the `UseAgentStudio` type and the returned object; import `saveAdvicePrice as putAdvicePrice`.)

- [ ] **Step 4: Run** — the test file PASS; `npm run typecheck`, `npm run lint`, `npm run format:check`.

- [ ] **Step 5: Commit** — `feat(studio): price model and save action for advice analyses`.

---

### Task 3: The "ANALYSES IN THE APP" card

**Files:**

- Modify: `apps/web/src/features/studio/live/limits.tsx` (third card `AdvicePriceCard`, id
  `live-limits-advice`)
- Modify: `apps/web/src/features/studio/live/build.module.css` only if an existing class does not
  fit (reuse `card`, `cardHead`, `cardLabel`, `headTag`, `cardNote`, `saveRow`, `saveButton`,
  `discardButton`, `alert`, `hint`)
- Modify: `scripts/design/routes.mjs` (a route entry for `/studio?stage=perpl-limits` proving
  `#live-limits-advice`)
- Modify: `apps/web/AGENTS.md` (Studio section: the card, its endpoint, live only), and
  `docs/agent-advice.md` (one line in "Payment (x402)": creators set the price in Studio → Limits)

**Interfaces:**

- Consumes: Task 2's `savedPriceForm`, `advicePriceView`, `advicePriceError`,
  `UseAgentStudio.saveAdvicePrice`; `useSavedForm` and `SaveOutcome`/`SaveState`
  (`shell/setup-save.tsx`); `Chip`, `Input`, `Field`, `Icon` from `@pickler/ui`; `PREVIEW_NOTE`.
- Produces: the card.

- [ ] **Step 1: Card** — inside the grid after the CAPS card:

```tsx
<AdvicePriceCard agent={agent} live={live} canManage={canManage} />
```

`AdvicePriceCard` keeps its form with
`useSavedForm<PriceForm>(agent.version, savedPriceForm(agent), \`${agent.productId ?? agent.id}:advice:form\`)`and its own`SaveState`in`useState`(the`PUT /setup` hook does not fit: no version). Render:

- head: `<h3 className={styles.cardLabel}>ANALYSES IN THE APP</h3>` and the `headTag` with
  `view.tag` / `data-tone={view.tone}`;
- `<p className={styles.cardNote}>{view.note}</p>` and, when `view.walletLine`, a `hint` line;
- a `Chip` toggle `selected={form.forSale}` labelled "For sale" (disabled with
  `aria-disabled` + `title={view.disabledReason}` when `disabledReason`);
- when `form.forSale`: `<Field label="PRICE PER ANALYSIS" htmlFor="live-advice-price">` with
  `<Input id="live-advice-price" inputMode="decimal" mono prefix="AUSD" invalid={!!view.inputError} …/>`
  and the `inputError` under it (`role="alert"`);
- save row (shown when `view.dirty` or the state is not idle): "Save price" button
  (`aria-disabled={!view.canSave || saving}`), "Discard", and `<Reason id="live-advice-reason" text={view.disabledReason} />`;
- outcome: saving → "Saving…"; saved → "Saved"; preview (`errorCode(caught) === "PREVIEW"`) →
  `PREVIEW_NOTE`; error → `advicePriceError(errorCode(caught))`.

Save handler: `if (view.canSave && view.body) { setState(saving); try { await live.saveAdvicePrice(view.body); setState(saved) } catch … }`.

- [ ] **Step 2: Design route** — add to `scripts/design/routes.mjs`:

```js
  {
    path: "/studio?stage=perpl-limits",
    name: "studio-live-limits-advice",
    product: "studio",
    surface: "dark",
    task: "Live studio",
    proves: "#live-limits-advice",
  },
```

- [ ] **Step 3: Run** — `npm run design:source` (exit 0); `npm run typecheck`, `npm run lint`,
      `npm run format:check`; `npm run design:check` when Playwright is installed globally (the
      rendered token/contrast checks over the new route); otherwise state that it was not run.
      Against the defect for the design check: give the card a colour literal → `design:source`
      exits 1; restore.

- [ ] **Step 4: Look at it rendered** — start the fixture API and web as `design:check` does (ports
      8799/3001), open `/studio?stage=perpl-limits`, screenshot the card in the priced state and with
      the toggle off and an invalid price; attach the paths in the report (owner's rule: never claim
      a screen looks right without seeing it).

- [ ] **Step 5: Commit** — `feat(studio): creators price advice analyses from Limits`.

---

### Task 4: Review and PR

- [ ] **Step 1:** Final whole-branch review (subagent, most capable model) over
      `codex/agent-advice-x402..HEAD` with the spec §3.1, this plan and the verification output;
      fix Critical/Important findings with tests seen failing first.
- [ ] **Step 2:** Full verification: `npm run build:shared`, `npm run typecheck`, `npm run lint`,
      `npm run format:check`, `npm run check:architecture`, `npm run design:source`, `npm test`,
      `npm run build:workers`.
- [ ] **Step 3:** Push `codex/studio-advice-price` and open the PR in English against
      `codex/agent-advice-x402` (stacked on #125), with screenshots, verified checks and what is not
      verified. Do not merge. Checkpoint with the owner before phase 3 (mobile, build 13).

# Agent advice x402 — Phase 1 (API) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The API exposes each public agent's uuid and price, lets the creator set the price, and charges each fresh advice request with x402 (EIP-3009 on AUSD) before enqueueing it.

**Architecture:** Pure x402 rules live in `@pickler/core` (`features/advice/x402.ts`) behind two ports: a payment store (Postgres, `@pickler/infrastructure`) and a payment gateway (viem on Monad testnet, `@pickler/infrastructure/chain`). The advice route calls a new `createPaidAdvice` service when `ADVICE_X402_ENABLED=true`; off means today's behaviour. Marketplace DTOs gain `id` and `advicePrice`; a Studio route writes the price.

**Tech Stack:** TypeScript (strict, ESM), Hono, zod, PostgreSQL + Drizzle migrations, viem, `node --test` via tsx.

**Spec:** `docs/specs/agent-advice-x402-v1.md` (read §2 D1–D10 and §4 before any task).

Phases after this plan (separate plans, not here): Phase 2 Studio price card (web); Phase 3 mobile section and build 13.

## Global Constraints

- Network `monad-testnet`, chain id `10143`; asset AUSD `0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC`, 6 decimals; EIP-712 domain `{ name: "Agora Dollar", version: "1", chainId: 10143, verifyingContract: AUSD }` (spec D3, measured 2026-10-07).
- Price bounds: 100000–100000000 micro-AUSD (0.10–100 AUSD), at most 6 decimals (spec D2).
- `validBefore − now ≤ 300 s`, `maxTimeoutSeconds: 300`; settlement receipt wait ≤ 30 s (spec §4.3).
- x402 version `1`, scheme `exact`; headers `X-PAYMENT` (request) and `X-PAYMENT-RESPONSE` (response), both base64 JSON (spec §4.3).
- Payment error codes exactly: `invalid_payment`, `invalid_signature`, `wrong_amount`, `wrong_recipient`, `expired`, `nonce_used`, `insufficient_funds`, `payer_not_linked`, `settlement_failed` (spec §4.3).
- `ADVICE_X402_ENABLED` defaults off; off = no behaviour change and no new requirement on clients.
- Relayer key `X402_RELAYER_PRIVATE_KEY` is a Worker secret only; never logged, never in a response.
- Repository rules: one statement per line, Prettier 100 columns, code dependencies point to core (`docs/trading-architecture.md`), `npm run check:architecture` must pass; update each touched project's `AGENTS.md` in the same change; commits are conventional and add files by name (never `git add -A`).
- Every new test is seen failing against its defect before it is trusted (owner's rule).

## Review Focus

1. **Replay after settlement with the same key and a new signature** — must return the original job and never settle twice (two AUSD transfers for one analysis). Test in Task 4.
2. **Price changed between the 402 and the paid retry** — `value` no longer equals the price; must be `wrong_amount` with nothing settled, not a charge at the old price. Test in Task 4.
3. **Payer address case** — `from` arrives checksummed, `wallet_links.address` is stored normalized; the link check must compare lowercase or a linked buyer is refused. Test in Task 5.
4. **Relayer RPC failure or revert** — settlement throws or the receipt has no matching `Transfer` log; must end `failed` / `settlement_failed`, not enqueue. Test in Task 4 (gateway fake) and Task 6 (log check).
5. **Advice disabled while x402 is on** — must answer the existing 503 before any 402, so nobody signs for a service that is off. Test in Task 7.

---

### Task 1: Migration 0038 — price column and payments table

**Files:**

- Modify: `packages/infrastructure/src/persistence/product/agents.ts` (the `agents.agents` table definition)
- Modify: `packages/infrastructure/src/persistence/product/advice.ts` (add `advicePayments`)
- Create (generated): `packages/infrastructure/drizzle/0038_advice_x402.sql`, `drizzle/meta/0038_snapshot.json`, `_journal.json` entry
- Test: `packages/infrastructure/test/advice-payments-schema.test.ts`

**Interfaces:**

- Produces: column `agents.agents.advice_price_micro_ausd bigint NULL` (check 100000–100000000); table `pickler.advice_payments` with unique `nonce`, unique `tx_hash`, unique `(user_id, public_agent_id, request_key)`.

- [ ] **Step 1: Add the Drizzle definitions**

In `product/agents.ts`, inside the `agents.agents` columns, add:

```ts
    /** Micro-AUSD per fresh advice analysis; null = not for sale (agent-advice-x402-v1 D2). */
    advicePriceMicroAusd: bigint("advice_price_micro_ausd", { mode: "bigint" }),
```

and in the table's constraint array:

```ts
      check(
        "agents_advice_price_bounds",
        sql`${t.advicePriceMicroAusd} IS NULL OR ${t.advicePriceMicroAusd} BETWEEN 100000 AND 100000000`,
      ),
```

In `product/advice.ts`, after `adviceJobs`, add:

```ts
/** One x402 payment per (user, agent, idempotency key); settled before its job exists. */
export const advicePayments = pickler
  .table(
    "advice_payments",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      jobId: uuid("job_id").references(() => adviceJobs.id),
      userId: uuid("user_id").notNull(),
      publicAgentId: uuid("public_agent_id")
        .notNull()
        .references(() => productAgents.productAgentId),
      requestKey: text("request_key").notNull(),
      payer: text("payer").notNull(),
      payTo: text("pay_to").notNull(),
      amountMicroAusd: bigint("amount_micro_ausd", { mode: "bigint" }).notNull(),
      nonce: text("nonce").notNull(),
      validBefore: timestamp("valid_before", { withTimezone: true }).notNull(),
      status: text("status").notNull(),
      txHash: text("tx_hash"),
      blockNumber: bigint("block_number", { mode: "bigint" }),
      error: text("error"),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
      updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
      uniqueIndex("advice_payments_nonce_key").on(t.nonce),
      uniqueIndex("advice_payments_tx_key").on(t.txHash),
      uniqueIndex("advice_payments_request_key").on(t.userId, t.publicAgentId, t.requestKey),
      check(
        "advice_payments_status",
        sql`${t.status} IN ('pending','settled','failed','refund_owed')`,
      ),
    ],
  )
  .enableRLS();
```

Use the imports already present in each file (`pickler`, `uuid`, `text`, `bigint`, `timestamp`, `uniqueIndex`, `check`, `sql`); add any that are missing from `drizzle-orm/pg-core` / `drizzle-orm`.

- [ ] **Step 2: Generate and rename the migration**

Run: `npm run db:generate -- --name advice_x402`
Expected: `packages/infrastructure/drizzle/0038_advice_x402.sql` plus snapshot and journal entry. Open the SQL and confirm it contains only the `ALTER TABLE "agents"."agents" ADD COLUMN`, the check, `CREATE TABLE "pickler"."advice_payments"`, its three unique indexes, its check, FKs and `ENABLE ROW LEVEL SECURITY`. Nothing else may change.

- [ ] **Step 3: Write the failing schema test (real PostgreSQL)**

Create `packages/infrastructure/test/advice-payments-schema.test.ts` following the throwaway-database pattern of `advice-store.test.ts` (same helper it uses to create and migrate a database from `TEST_DATABASE_URL`). Tests:

```ts
test("a price outside 0.10–100 AUSD is refused by the database", async () => {
  await assert.rejects(
    pool.query("UPDATE agents.agents SET advice_price_micro_ausd = 99999 WHERE id = $1", [agentId]),
    /agents_advice_price_bounds/,
  );
  await pool.query("UPDATE agents.agents SET advice_price_micro_ausd = 1500000 WHERE id = $1", [
    agentId,
  ]);
});

test("one nonce pays once, and one key buys once", async () => {
  const row = (nonce: string, key: string) =>
    pool.query(
      `INSERT INTO pickler.advice_payments
         (user_id, public_agent_id, request_key, payer, pay_to, amount_micro_ausd, nonce, valid_before, status)
       VALUES ($1,$2,$3,'0xa','0xb',1500000,$4, now() + interval '5 minutes','pending')`,
      [userId, agentId, key, nonce],
    );
  await row("0x01", "key-1");
  await assert.rejects(row("0x01", "key-2"), /advice_payments_nonce_key/);
  await assert.rejects(row("0x02", "key-1"), /advice_payments_request_key/);
});
```

`agentId` must be a `product_agents.product_agent_id` seeded the same way `advice-store.test.ts` seeds its published agent.

- [ ] **Step 4: Run the test against the migration, then against its defect**

Run: `npm run db:up && TEST_DATABASE_URL=postgresql://pickler:pickler_local_only@127.0.0.1:55432/pickler node --import tsx --test packages/infrastructure/test/advice-payments-schema.test.ts`
Expected: PASS. Then temporarily delete the `advice_payments_nonce_key` line from the SQL, rerun: the second test FAILS. Restore the line.

- [ ] **Step 5: Commit**

```bash
git add packages/infrastructure/src/persistence/product/agents.ts packages/infrastructure/src/persistence/product/advice.ts packages/infrastructure/drizzle/0038_advice_x402.sql packages/infrastructure/drizzle/meta/0038_snapshot.json packages/infrastructure/drizzle/meta/_journal.json packages/infrastructure/test/advice-payments-schema.test.ts
git commit -m "feat(infrastructure): advice price column and x402 payments table"
```

---

### Task 2: Marketplace DTOs expose `id` and `advicePrice` (D1)

**Files:**

- Modify: `packages/core/src/features/agents/domain/agents.ts` (`AgentSummary`)
- Modify: `packages/core/src/features/agents/domain/reads.ts` (`DirectoryAgent`)
- Modify: `packages/core/src/features/agents/domain/public-views.ts` (`AgentPersona`)
- Modify: `packages/api-schema/src/agents.ts` (`AgentSummaryDto`, `DirectoryAgentDto`, `AgentPersonaDto`) and `packages/api-schema/src/public-schemas.ts` (zod)
- Modify: `packages/infrastructure/src/persistence/agent-directory.ts` (`AGENT_SELECT` :54-79, `AgentRow` :30-52, `summary` :112, `getPersona` :212-255, `listDirectory` :258-275)
- Modify: any sample/fixture board that builds these types (`grep -rn "askPrice" packages apps/web/src` lists them)
- Test: `packages/infrastructure/test/postgres-product-data.test.ts` (extend), `packages/api-schema/test/*` if a schema test exists

**Interfaces:**

- Produces: `AdvicePrice = { amount: string; asset: "AUSD"; decimals: 6 }`; `AgentSummary.id: string`, `AgentSummary.advicePrice: AdvicePrice | null`; same two fields on `DirectoryAgent.agent` and `AgentPersona`. Exported helper `formatMicroAusd(micro: bigint): string` from `@pickler/core` (e.g. `1500000n → "1.5"`, `1000000n → "1"`).

- [ ] **Step 1: Failing test**

In `postgres-product-data.test.ts`, in the test that reads the public board, set a price on the seeded public agent and assert:

```ts
await pool.query("UPDATE agents.agents SET advice_price_micro_ausd = 1500000 WHERE id = $1", [
  agentId,
]);
const [summary] = await directory.listAgents();
assert.equal(summary.id, agentId);
assert.deepEqual(summary.advicePrice, { amount: "1.5", asset: "AUSD", decimals: 6 });
const persona = await directory.getPersona(summary.handle);
assert.equal(persona?.id, agentId);
assert.deepEqual(persona?.advicePrice, summary.advicePrice);
const [entry] = await directory.listDirectory();
assert.equal(entry.agent.id, agentId);
```

Add a core unit test `packages/core/test/advice-price.test.ts`:

```ts
test("micro-AUSD is written without trailing zeros", () => {
  assert.equal(formatMicroAusd(1500000n), "1.5");
  assert.equal(formatMicroAusd(1000000n), "1");
  assert.equal(formatMicroAusd(100000n), "0.1");
  assert.equal(formatMicroAusd(123456n), "0.123456");
});
```

- [ ] **Step 2: Run, expect failure** — `npm run build:shared && node --import tsx --test packages/core/test/advice-price.test.ts` → FAIL (`formatMicroAusd` not exported).

- [ ] **Step 3: Implement**

Core, new `packages/core/src/features/advice/price.ts` (export from the advice index and `@pickler/core`):

```ts
export interface AdvicePrice {
  amount: string;
  asset: "AUSD";
  decimals: 6;
}

export function formatMicroAusd(micro: bigint): string {
  const whole = micro / 1_000_000n;
  const fraction = (micro % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : `${whole}`;
}

export function advicePrice(micro: bigint | null): AdvicePrice | null {
  return micro === null ? null : { amount: formatMicroAusd(micro), asset: "AUSD", decimals: 6 };
}
```

Add `id: string` and `advicePrice: AdvicePrice | null` to the three core types and the three DTOs; in zod (`public-schemas.ts`) add `id: z.string().uuid()` and
`advicePrice: z.object({ amount: z.string(), asset: z.literal("AUSD"), decimals: z.literal(6) }).nullable()`.
In `agent-directory.ts`: select `a.id AS "id"` and `a.advice_price_micro_ausd AS "advicePriceMicroAusd"` in `AGENT_SELECT`; add both to `AgentRow` (`advicePriceMicroAusd: string | null`, as pg returns bigint as string); map with `advicePrice(row.advicePriceMicroAusd === null ? null : BigInt(row.advicePriceMicroAusd))`. Fix every fixture the compiler reports (sample boards use `id: "00000000-0000-0000-0000-00000000000N"` and `advicePrice: null`).

- [ ] **Step 4: Run** — the two tests PASS; `npm run typecheck` clean. Then revert the `a.id` select only: the persistence test FAILS; restore.

- [ ] **Step 5: Commit** — files of this task by name; `feat(marketplace): expose the agent uuid and its advice price`.

---

### Task 3: Studio route to set the price

**Files:**

- Modify: `packages/api-schema/src/` studio DTOs (add `advicePriceUpdateSchema`; add `advicePrice` to the studio agent DTO)
- Modify: the Studio directory in `packages/infrastructure/src/studio/directory.ts` (add `setAdvicePrice`)
- Modify: `workers/api/src/routes/studio.ts` (new handler next to `/agents/:id/limits`, :1147-1163)
- Test: `workers/api/test/studio-advice-price-route.test.ts`, `packages/infrastructure/test/` (directory method, real PostgreSQL)

**Interfaces:**

- Consumes: Task 1 column; `formatMicroAusd`, `advicePrice` from Task 2.
- Produces: `PUT /v1/studio/agents/:id/advice-price` body `{ priceAusd: string | null }` → `{ advicePrice: AdvicePrice | null }`; `parseAusdToMicro(value: string): bigint` exported from core (throws `PilotError("INVALID_INPUT")` beyond 6 decimals or outside bounds).

- [ ] **Step 1: Failing tests**

Core (`packages/core/test/advice-price.test.ts`, append):

```ts
test("a price is parsed to micro-AUSD inside 0.10–100", () => {
  assert.equal(parseAusdToMicro("1.5"), 1500000n);
  assert.equal(parseAusdToMicro("0.1"), 100000n);
  assert.equal(parseAusdToMicro("100"), 100000000n);
  for (const bad of ["0.09", "100.000001", "1.0000001", "-1", "abc", ""]) {
    assert.throws(() => parseAusdToMicro(bad), /INVALID_INPUT|price/i);
  }
});
```

Route test: with the studio fixture services used by `studio-route.test.ts`, assert `PUT …/advice-price` with `{ priceAusd: "1.5" }` returns 200 `{ advicePrice: { amount: "1.5", … } }` and calls the directory with `1500000n`; `{ priceAusd: "0.05" }` → 400; a non-owner → 403/404 as `/limits` answers; the directory throwing `PilotError("CONFLICT", "AGENT_WALLET_REQUIRED")` → 409 with `error: "AGENT_WALLET_REQUIRED"`.

Infrastructure test (real PostgreSQL): `setAdvicePrice` on an agent **without** a row in `wallets.agent_wallets` rejects with `AGENT_WALLET_REQUIRED`; with one, it writes the column; `null` clears it even without a wallet.

- [ ] **Step 2: Run, expect failure.**

- [ ] **Step 3: Implement**

Core `price.ts`:

```ts
export const ADVICE_PRICE_MIN_MICRO = 100_000n;
export const ADVICE_PRICE_MAX_MICRO = 100_000_000n;

export function parseAusdToMicro(value: string): bigint {
  const match = /^(\d{1,3})(?:\.(\d{1,6}))?$/.exec(value);
  if (!match) {
    throw new PilotError("INVALID_INPUT", "The price must be AUSD with at most 6 decimals");
  }
  const micro = BigInt(match[1]!) * 1_000_000n + BigInt((match[2] ?? "").padEnd(6, "0"));
  if (micro < ADVICE_PRICE_MIN_MICRO || micro > ADVICE_PRICE_MAX_MICRO) {
    throw new PilotError("INVALID_INPUT", "The price must be between 0.10 and 100 AUSD");
  }
  return micro;
}
```

Directory method (owner check mirrors `advice-store.ts:56-64`; wallet check mirrors `studio/directory.ts:45-53`):

```ts
  async setAdvicePrice(userId: string, productAgentId: string, micro: bigint | null): Promise<bigint | null> {
    const { rows } = await this.pool.query<{ wallet: string | null }>(
      `SELECT l.wallet_id AS wallet
         FROM pickler.product_agents p
         JOIN identity.workspaces w ON w.id = p.workspace_id
         LEFT JOIN wallets.agent_wallets l ON l.agent_id = p.product_agent_id
        WHERE p.product_agent_id = $1 AND w.owner_user_id = $2`,
      [productAgentId, userId],
    );
    if (!rows.length) {
      throw new PilotError("NOT_FOUND", "Agent not found");
    }
    if (micro !== null && rows[0]!.wallet === null) {
      throw new PilotError("CONFLICT", "AGENT_WALLET_REQUIRED");
    }
    await this.pool.query("UPDATE agents.agents SET advice_price_micro_ausd = $2 WHERE id = $1", [
      productAgentId,
      micro === null ? null : micro.toString(),
    ]);
    return micro;
  }
```

Route (next to `/limits`, same `access.authorize(…, true)` call; the `:id` here is the product agent id the Studio already uses — confirm by reading how `agentScope` resolves `c.req.param("id")` and use the same id):

```ts
api.put(
  "/agents/:id/advice-price",
  describeOperation("studioAdvicePrice", {
    security: "user",
    errors: dto.studioErrorSchema,
    errorStatuses: [400, 401, 403, 404, 409, 500],
    description: "Owner only. Sets or clears the AUSD price of one fresh advice analysis.",
    response: dto.advicePriceResponseSchema,
    body: dto.advicePriceUpdateSchema,
  }),
  async (c) => {
    const current = await access.authorize(c.get("principal"), true);
    const body = dto.advicePriceUpdateSchema.parse(await c.req.json());
    const micro = body.priceAusd === null ? null : parseAusdToMicro(body.priceAusd);
    const saved = await services.directory.setAdvicePrice(current.userId, c.req.param("id"), micro);
    return c.json(dto.advicePriceResponseSchema.parse({ advicePrice: advicePrice(saved) }));
  },
);
```

Map `PilotError("CONFLICT", "AGENT_WALLET_REQUIRED")` to `409 { error: "AGENT_WALLET_REQUIRED" }` in the studio error mapper (follow how the file maps other `CONFLICT` messages). `current.userId` is whatever field `access.authorize` returns for the user — use the existing name.

- [ ] **Step 4: Run** — PASS; then remove the wallet check in `setAdvicePrice`: the infrastructure test FAILS; restore. `npm run typecheck`, OpenAPI coverage test (`workers/api/test/*openapi*`) PASS.

- [ ] **Step 5: Commit** — `feat(studio): creators set the AUSD price of an advice analysis`.

---

### Task 4: Core x402 rules and the paid advice service

**Files:**

- Create: `packages/core/src/features/advice/x402.ts`
- Modify: `packages/core/src/features/advice/index.ts` (export; add `admit`)
- Test: `packages/core/test/advice-x402.test.ts`

**Interfaces:**

- Consumes: `createAdviceService` (existing), `assertAdviceAgent`, `AdviceRepository.resolve`, `formatMicroAusd`.
- Produces (exact names used by Tasks 5–7):

```ts
export const X402_NETWORK = "monad-testnet";
export const AUSD_TESTNET = "0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC";
export interface Authorization { from: string; to: string; value: string; validAfter: string; validBefore: string; nonce: string }
export interface PaymentPayload { x402Version: 1; scheme: "exact"; network: string; payload: { signature: string; authorization: Authorization } }
export interface PaymentRequirements { scheme: "exact"; network: string; maxAmountRequired: string; resource: string; description: string; mimeType: "application/json"; payTo: string; maxTimeoutSeconds: 300; asset: string; extra: { name: "Agora Dollar"; version: "1"; chainId: 10143 } }
export type PaymentError = "invalid_payment" | "invalid_signature" | "wrong_amount" | "wrong_recipient" | "expired" | "nonce_used" | "insufficient_funds" | "payer_not_linked" | "settlement_failed";
export interface SaleTerms { priceMicro: bigint; payTo: string; handle: string }
export interface AdvicePaymentRecord { id: string; jobId: string | null; status: "pending" | "settled" | "failed" | "refund_owed"; txHash: string | null }
export interface AdvicePaymentStore {
  saleTerms(publicAgentId: string): Promise<SaleTerms | null>;
  payerLinked(userId: string, address: string): Promise<boolean>;
  byKey(userId: string, publicAgentId: string, key: string): Promise<AdvicePaymentRecord | null>;
  insertPending(input: { userId: string; publicAgentId: string; key: string; authorization: Authorization }): Promise<AdvicePaymentRecord>;
  settled(id: string, txHash: string, blockNumber: bigint): Promise<void>;
  failed(id: string, error: string): Promise<void>;
  attachJob(id: string, jobId: string): Promise<void>;
  refundOwed(id: string, error: string): Promise<void>;
}
export interface AdvicePaymentGateway {
  signatureValid(authorization: Authorization, signature: string): Promise<boolean>;
  nonceUsed(from: string, nonce: string): Promise<boolean>;
  balance(address: string): Promise<bigint>;
  settle(authorization: Authorization, signature: string): Promise<{ txHash: string; blockNumber: bigint }>;
}
export function decodePaymentHeader(header: string): PaymentPayload; // throws X402Refusal("invalid_payment")
export function encodeSettlement(input: { transaction: string; payer: string }): string; // base64 JSON with success:true, network
export class X402Refusal extends Error { constructor(public readonly reason: PaymentError, public readonly requirements: PaymentRequirements | null) }
export type PaidAdviceResult =
  | { kind: "payment_required"; requirements: PaymentRequirements; error: PaymentError | null }
  | { kind: "accepted"; job: AdviceJob; settlement: string | null };
export function createPaidAdvice(deps: {
  advice: ReturnType<typeof createAdviceService>;
  repository: AdviceRepository;
  store: AdvicePaymentStore;
  gateway: AdvicePaymentGateway;
  now: () => number; // ms
  resourceBase: string; // "https://pickler.fun/api"
}): { request(principal: Principal, publicAgentId: string, symbol: AdviceSymbol, key: string, header: string | undefined): Promise<PaidAdviceResult> };
```

`createAdviceService` gains `admit(principal, id, symbol): Promise<void>` = the checks `request` already does without enqueueing: user principal; `enabled && policy` else `ADVICE_UNAVAILABLE`; `resolve` + `assertAdviceAgent(agent, symbol)`.

- [ ] **Step 1: Failing tests** — `packages/core/test/advice-x402.test.ts`, with in-memory fakes of the store and gateway and the advice fixture of `workers/api/test/advice-route.test.ts:20-80` (copy its `policy`, `config`, `AdviceAgent` and `AdviceJob` literals). Cases, one `test` each:

1. No header → `payment_required`, `error: null`, requirements with `maxAmountRequired: "1500000"`, `payTo` = sale terms address, `asset` = AUSD, `resource` = `${resourceBase}/v1/agent-advice/agents/${id}/recommendations`, `description` contains the symbol and `@handle`; `enqueue` not called.
2. Not for sale (`saleTerms` null) → throws `PilotError("NOT_FOUND")` with message `ADVICE_NOT_FOR_SALE`.
3. Advice disabled → `admit` throws `ADVICE_UNAVAILABLE` before `saleTerms` is read (Review Focus 5).
4. Valid header → gateway `settle` called once, store `settled`, `enqueue` called, `attachJob` called, result `accepted` with a settlement string decoding to `{ success: true, transaction, network: "monad-testnet", payer }`.
5. Each refusal returns `payment_required` with its `error` and **never** calls `settle`: value ≠ price → `wrong_amount` (also the "price changed" case of Review Focus 2: build the 402 at 1.5, change `saleTerms` to 2.0, send the 1.5 authorization); `to` ≠ payTo (compare lowercase) → `wrong_recipient`; `validBefore ≤ now/1000` or `validBefore − now/1000 > 300` or `validAfter > now/1000` → `expired`; `signatureValid` false → `invalid_signature`; `payerLinked` false → `payer_not_linked`; `nonceUsed` true → `nonce_used`; `balance < value` → `insufficient_funds`; malformed base64/JSON/version/scheme/network → `invalid_payment`.
6. `settle` throws → store `failed(id, "settlement_failed")`, result `payment_required` with `settlement_failed`, `enqueue` not called (Review Focus 4).
7. Replay: `requestReplay` returns a job → `accepted` with that job, `settlement: null`; `settle` not called — even with a fresh valid header (Review Focus 1).
8. Settled payment without job (`byKey` → `{ status: "settled", jobId: null }`) → no new settle; `enqueue` called; `attachJob` called.
9. `enqueue` throws `PilotError("ADVICE_BUSY")` after settlement → store `refundOwed(id, "ADVICE_BUSY")` and the error is rethrown.

- [ ] **Step 2: Run, expect failure** — `npm run build:shared && node --import tsx --test packages/core/test/advice-x402.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement `x402.ts`** — order of `request` exactly: `admit` → `repository.requestReplay` (return accepted, no settle) → `store.byKey` (settled & no job → enqueue+attach; pending/failed → treat as new attempt only if the header carries a different nonce, else `payment_required` with the stored error) → `saleTerms` (null → `NOT_FOUND`/`ADVICE_NOT_FOR_SALE`) → build requirements → no header → `payment_required` → `decodePaymentHeader` → static checks (scheme, network, asset in requirements, `to`, `value === priceMicro.toString()`, time window) → `payerLinked` → `signatureValid` → `nonceUsed` → `balance` → `insertPending` → `settle` (catch → `failed` + `settlement_failed`) → `settled` → `advice.request(...)` (catch → `refundOwed(id, code)` + rethrow) → `attachJob` → `accepted` with `encodeSettlement`. Base64 via `btoa`/`atob` on JSON (both exist in Workers and Node ≥ 22). All address comparisons lowercase. One statement per line.

- [ ] **Step 4: Run** — PASS. Against the defect: swap the `replay` and `settle` order → test 7 FAILS; remove the `value` check → test 5 FAILS; restore both.

- [ ] **Step 5: Commit** — `feat(core): x402 rules and paid advice service`.

---

### Task 5: Postgres payment store

**Files:**

- Create: `packages/infrastructure/src/persistence/advice-payments.ts` (`PostgresAdvicePayments implements AdvicePaymentStore`), export from `packages/infrastructure/src/index.ts`
- Test: `packages/infrastructure/test/advice-payments.test.ts` (real PostgreSQL)

**Interfaces:**

- Consumes: Task 1 tables; `AdvicePaymentStore`, `SaleTerms`, `Authorization` from Task 4.
- Produces: `new PostgresAdvicePayments(pool)`.

- [ ] **Step 1: Failing tests** — seed a published product agent with price 1500000 and a linked agent wallet (`wallets.agent_wallets` + `wallets.wallet_accounts`, as `studio/directory` tests seed them) and a `identity.wallet_links` row for the buyer with a **lowercase** address. Assert: `saleTerms` → `{ priceMicro: 1500000n, payTo: <wallet address>, handle }`; agent with null price → `null`; agent without wallet → `null`; `payerLinked(user, CHECKSUMMED address)` → `true` (Review Focus 3); another user → `false`; `insertPending` twice with the same nonce rejects; `settled` then `byKey` → `{ status: "settled", txHash }`; `attachJob` sets `job_id`; `refundOwed` sets status and error.

- [ ] **Step 2: Run, expect failure.**

- [ ] **Step 3: Implement** — SQL:

```sql
-- saleTerms
SELECT a.advice_price_micro_ausd AS price, a.handle,
       (SELECT address FROM wallets.wallet_accounts WHERE wallet_id = l.wallet_id ORDER BY created_at LIMIT 1) AS pay_to
  FROM agents.agents a
  JOIN wallets.agent_wallets l ON l.agent_id = a.id
 WHERE a.id = $1 AND a.visibility = 'public' AND a.killed_at IS NULL AND a.advice_price_micro_ausd IS NOT NULL
-- payerLinked
SELECT 1 FROM identity.wallet_links WHERE user_id = $1 AND lower(address) = lower($2) LIMIT 1
```

`insertPending` inserts `status='pending'`, `valid_before = to_timestamp($n)`; `settled`/`failed`/`refundOwed`/`attachJob` update `status`, `tx_hash`, `block_number`, `error`, `job_id`, `updated_at = clock_timestamp()`. bigint parameters as strings.

- [ ] **Step 4: Run** — PASS. Against the defect: drop `lower()` in `payerLinked` → the checksummed case FAILS; restore.

- [ ] **Step 5: Commit** — `feat(infrastructure): Postgres store for advice x402 payments`.

---

### Task 6: EIP-3009 gateway on Monad testnet (viem)

**Files:**

- Create: `packages/infrastructure/src/chain/ausd-authorization.ts` (`createAusdAuthorizationGateway`), export from the infrastructure index
- Test: `packages/infrastructure/test/ausd-authorization.test.ts`

**Interfaces:**

- Consumes: `AdvicePaymentGateway`, `Authorization` (Task 4).
- Produces: `createAusdAuthorizationGateway(input: { rpcUrl: string; relayerPrivateKey: \`0x${string}\`; asset?: string; chainId?: number; receiptTimeoutMs?: number; client?: PublicClientLike; wallet?: WalletClientLike }): AdvicePaymentGateway`, and the pure helpers `authorizationTypedData(authorization)`and`transferMatches(logs, authorization, asset): boolean`.

- [ ] **Step 1: Failing tests** (no network):
  - `authorizationTypedData` returns domain `{ name: "Agora Dollar", version: "1", chainId: 10143, verifyingContract: AUSD }`, `primaryType: "TransferWithAuthorization"`, the standard six fields.
  - Signing that typed data with `privateKeyToAccount(0x…01)` and passing it to `signatureValid` → `true`; flipping `value` → `false`.
  - `transferMatches` is `true` only for a `Transfer(from, to, value)` log emitted by the AUSD address; a log from another contract or with another value → `false` (Review Focus 4).
  - `settle` with an injected `wallet.writeContract` and `client.waitForTransactionReceipt` returning a receipt without a matching log → rejects `settlement_failed`; with `status: "reverted"` → rejects.

- [ ] **Step 2: Run, expect failure.**

- [ ] **Step 3: Implement** with viem (already a dependency of infrastructure: `viem-chain-reader.ts`): `verifyTypedData` for `signatureValid`; `readContract` `authorizationState(address,bytes32)` and `balanceOf(address)` with a minimal ABI; `settle` = `parseSignature(signature)` → `writeContract({ functionName: "transferWithAuthorization", args: [from, to, value, validAfter, validBefore, nonce, v, r, s] })` from `privateKeyToAccount(relayerPrivateKey)` on `defineChain`/`monadTestnet`, then `waitForTransactionReceipt({ hash, timeout: receiptTimeoutMs ?? 30_000 })`, require `status === "success"` and `transferMatches(parseEventLogs(...))`. Never include the key in an error message.

- [ ] **Step 4: Run** — PASS; against the defect: make `transferMatches` ignore the log address → its test FAILS; restore.

- [ ] **Step 5: Commit** — `feat(infrastructure): EIP-3009 settlement gateway for AUSD on Monad testnet`.

---

### Task 7: Route, composition, OpenAPI and docs

**Files:**

- Modify: `workers/api/src/routes/advice.ts` (POST handler; `AdviceRouteServices` gains `paid?: ReturnType<typeof createPaidAdvice>`)
- Modify: `workers/api/src/container.ts` (:457-469 compose `paid` when `ADVICE_X402_ENABLED === "true"` and `X402_RELAYER_PRIVATE_KEY` and `MONAD_RPC_URL` are set; otherwise omit)
- Modify: `workers/api/src/env.ts` (`ADVICE_X402_ENABLED?: string; X402_RELAYER_PRIVATE_KEY?: string`)
- Modify: `workers/api/wrangler.jsonc`, `workers/api/wrangler.staging.jsonc` (`"ADVICE_X402_ENABLED": "false"`)
- Modify: `packages/api-schema/src/advice.ts` (`paymentRequiredSchema`), OpenAPI description of the POST (402 + both headers)
- Modify docs: `docs/agent-advice.md` (new "Payment (x402)" section), `workers/api/AGENTS.md`, `packages/core/AGENTS.md`, `packages/infrastructure/AGENTS.md`, `.dev.vars.example` (new names, no values)
- Test: `workers/api/test/advice-route.test.ts` (extend)

**Interfaces:**

- Consumes: everything above.
- Produces: the wire contract of spec §4.3.

- [ ] **Step 1: Failing route tests** (extend the existing fixture with `paid: createPaidAdvice({...fakes})`):
  - POST without `X-PAYMENT` → 402; body `{ x402Version: 1, error: "X-PAYMENT header is required", accepts: [requirements] }`; header `Cache-Control: private, no-store`.
  - POST with a valid fake payment → 202, same body as today, header `X-PAYMENT-RESPONSE` decodes to `{ success: true, transaction, network: "monad-testnet", payer }`.
  - Refusal → 402 with `error: "wrong_amount"` and `accepts`.
  - Advice disabled (`enabled: false`) with x402 on → 503 `ADVICE_UNAVAILABLE`, no 402 (Review Focus 5).
  - `paid` absent (flag off) → today's behaviour: 202 without any header (regression).
  - Not for sale → 404 `{ error: "ADVICE_NOT_FOR_SALE" }`.
  - OpenAPI coverage test still passes and the document lists 402 for `adviceRequest`.

- [ ] **Step 2: Run, expect failure** — `npm run build:shared && node --import tsx --test workers/api/test/advice-route.test.ts`.

- [ ] **Step 3: Implement** — in the POST handler, after parsing id/body/key:

```ts
if (services.paid) {
  const result = await services.paid.request(
    c.get("principal"),
    id,
    body.symbol,
    key,
    c.req.header("X-PAYMENT") ?? undefined,
  );
  if (result.kind === "payment_required") {
    return c.json(
      {
        x402Version: 1,
        error: result.error ?? "X-PAYMENT header is required",
        accepts: [result.requirements],
      },
      402,
    );
  }
  if (result.settlement) {
    c.header("X-PAYMENT-RESPONSE", result.settlement);
  }
  return accepted(c, result.job);
}
```

where `accepted(c, job)` is the existing notify + 202 envelope code moved into a local function (both paths share it). Add `ADVICE_NOT_FOR_SALE` handling: the core throws `PilotError("NOT_FOUND", "ADVICE_NOT_FOR_SALE")`; map it to `404 { error: "ADVICE_NOT_FOR_SALE" }` before the generic mapper. In `container.ts`:

```ts
      ...(env.ADVICE_X402_ENABLED === "true" && env.X402_RELAYER_PRIVATE_KEY && env.MONAD_RPC_URL
        ? {
            paid: createPaidAdvice({
              advice: adviceService,
              repository: adviceStore,
              store: new PostgresAdvicePayments(repository.pool),
              gateway: createAusdAuthorizationGateway({
                rpcUrl: env.MONAD_RPC_URL,
                relayerPrivateKey: env.X402_RELAYER_PRIVATE_KEY as `0x${string}`,
              }),
              now: () => Date.now(),
              resourceBase: "https://pickler.fun/api",
            }),
          }
        : {}),
```

(hoist `adviceStore = new PostgresAdviceStore(repository.pool)` and `adviceService = createAdviceService(adviceStore, …)` so both `service` and `paid` share them). If the flag is `"true"` but a secret is missing, log once `x402 is on but its relayer or RPC is missing; paid advice is off` — the same pattern the custody guard uses.

- [ ] **Step 4: Run the whole verification**

```bash
npm run build:shared
node --import tsx --test workers/api/test/advice-route.test.ts
npm test
npm run typecheck && npm run lint && npm run format:check && npm run check:architecture
npm run build:workers
```

Expected: all pass; `npm test` count = previous + the new tests, 0 failures. Against the defect: return 402 before `admit` in core → the "disabled → 503" route test FAILS; restore.

- [ ] **Step 5: Commit** — `feat(api): charge fresh advice with x402 behind ADVICE_X402_ENABLED` (route, container, env, wrangler, schema, docs and AGENTS files by name).

---

### Task 8: Independent review and PR

- [ ] **Step 1:** Request an independent review (subagent) with the spec, this plan, `git diff origin/main...HEAD` and the verification output; fix Critical/Important findings with tests seen failing first.
- [ ] **Step 2:** Push `codex/agent-advice-x402` and open the PR to `main` (English, as the repository's PRs), listing verified checks, what is not verified (live settlement on testnet needs §7 operations), and that `ADVICE_X402_ENABLED` stays `false` until acceptance. Do not merge.
- [ ] **Step 3:** Checkpoint with the owner: Phase 2 (Studio price card) and Phase 3 (mobile, build 13) get their own plans.

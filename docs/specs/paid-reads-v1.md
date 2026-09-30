# Paid reads v1: sell a read, pay for it, deliver it, hold it to the market

Status: Draft — decided autonomously 2026-09-30. Follows `docs/product-map/conventions.md`,
especially decisions 1-4. Owns the whole lifecycle of a paid read: the owner's read service, the
purchase, delivery, evaluation, refunds, payouts, receipts and disputes. Every decision is
reversible unless the table says otherwise.

## 1. Problem and users

**Users.**

- **Buyer:** a marketplace account (a Supabase user made by wallet sign-in) paying with **Mera** or
  an injected **EOA** on the web (`app.pickler.fun`), or with **Mera only** in the mobile app
  (conventions, products and wallets).
- **Owner:** a studio account whose agent is public (`go-public-v1.md`). They set the price and the
  clocks and are paid to their Turnkey master wallet.
- **Pickler:** holds the read treasury, takes a fee, refunds, and runs the jobs.

**Problem.** The read is modelled and drawn but nothing persists or charges:

- The domain exists: two clocks, delivery states, evaluations, `ReadService { price, markets,
typical, sla, slots, evaluated, gap }` (`packages/core/src/features/agents/domain/reads.ts:5-42`),
  the fixed question (`reads.ts:115-129`), and the DTOs (`packages/api-schema/src/agents.ts:98-136`).
- No writer: `service` is always null and `askPrice: null`
  (`packages/infrastructure/src/persistence/agent-directory.ts:249`); `listReads` returns `[]` and
  `getRead` null, with no viewer (`agent-directory.ts:278-284`;
  `packages/core/src/features/agents/ports/agent-directory.ts:21-23`). So `/agents/[h]/ask` always
  redirects to the profile (`apps/web/src/app/agents/[handle]/ask/page.tsx:37-39`).
- The ask flow ends at a disabled Pay button, "Nothing is charged today, and no agent is queued"
  (`apps/web/src/features/agents/components/ask-flow.tsx:185-205`), and shows 4h and 7d horizons as
  "SOON" (`ask-flow.tsx:108-111`).
- Nobody can set a price: no studio field, table or spec (research 01 §3).
- The owner rule already fixed: a paid read belongs to a `user_id`, and the email that hears about
  its outcome is a profile field (`user-profiles-and-products-v1.md:286-293`, table `:296-306`).

The memory rule for this product stands: **the public product sells reads, with two clocks and no
faked charge.** Every screen before this spec ships stays disabled with its reason.

## 2. Decisions

| #   | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Reason                                                                                                                                           | Reversible?                                        |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------- |
| R1  | **Only a public, non-killed agent sells reads,** configured by its owner in the studio (Go Public's optional Reads step, and a new **Reads** section under GROW).                                                                                                                                                                                                                                                                                                                                                                                                                                            | Conventions decision 4; a private agent has no page to be asked on.                                                                              | yes                                                |
| R2  | **Price bounds: 1-100 AUSD, in steps of 0.50 AUSD.** Stored as `price_micro_ausd`. Default 5 AUSD. Bounds live in core (`READ_PRICE_BOUNDS`) and are mirrored in api-schema, following the `SPEND_BOUNDS` precedent (`packages/core/src/features/research/types.ts:86-89`).                                                                                                                                                                                                                                                                                                                                  | Small enough for a testnet launch; wide enough to price a good agent.                                                                            | yes                                                |
| R3  | **Clock 1, delivery deadline:** the owner picks 5, 10, 15, 30, 60 or 120 minutes. Missed → automatic full refund.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | The `sla` field; a run takes minutes, not seconds.                                                                                               | yes                                                |
| R4  | **Clock 2, resolution horizon: 24 hours after delivery, fixed.** It is a stored column whose only allowed value in v1 is 24 h. The ask flow's "4h · SOON" and "7d · SOON" tags are removed. The asker picks the market and, from the markets surface, the level; never the clock.                                                                                                                                                                                                                                                                                                                            | Comparability: every read on a market asks the same question (`reads.ts:111-129`). A column keeps the door open without breaking the rule.       | yes                                                |
| R5  | **Capacity per UTC day:** 1-200 reads, default 20. A reservation holds a slot from intent to expiry or refund. `slots` is computed ("7 of 20"), not reported.                                                                                                                                                                                                                                                                                                                                                                                                                                                | `slots` was "as the agent reports it" (`reads.ts:36-37`); a computed number cannot lie.                                                          | yes                                                |
| R6  | **Markets it answers:** 1-20 markets, a subset of what the agent's configuration covers (its venue and market scope). A market the runtime cannot price is refused at configure time.                                                                                                                                                                                                                                                                                                                                                                                                                        | A read needs a reference price at delivery and an observation 24 h later.                                                                        | yes                                                |
| R7  | **Payment rail: a plain AUSD `transfer` on Monad** (testnet 10143 first, `packages/chain/src/networks.ts:60-74`) from the buyer's linked wallet to the **Pickler read treasury**, submitted by the buyer's wallet, then confirmed to the API with the transaction hash. The API verifies the `Transfer` log on chain at the `finalized` block tag. An escrow contract is v2.                                                                                                                                                                                                                                 | Conventions decision 3. Works with Mera and any EOA without a new contract.                                                                      | yes                                                |
| R8  | **An intent binds the payment:** the payer address (must be one of the account's linked wallets, `identity.wallet_links`), the exact amount, the treasury, and a start time. A transfer matches when `from`, `to`, token and amount are equal and its block is after the intent was created minus 2 minutes. A `(tx_hash, log_index)` can be claimed once.                                                                                                                                                                                                                                                   | A plain transfer has no memo. Equal amounts from the same payer are interchangeable, so a first-claim rule is safe.                              | yes                                                |
| R9  | **Intent lifetime 15 minutes.** A matching payment that arrives after expiry is accepted if capacity remains, otherwise refunded automatically.                                                                                                                                                                                                                                                                                                                                                                                                                                                              | No money is ever kept without a read behind it.                                                                                                  | yes                                                |
| R10 | **The buyer pays gas** in MON for their transfer. Pickler pays gas for refunds and payouts.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Simplest rail; gasless (EIP-3009 relayed) is §12 Q3.                                                                                             | yes                                                |
| R11 | **Email before the first purchase:** `POST /v1/me/reads` answers 409 `EMAIL_REQUIRED` until the profile has a notification email. Unverified emails are allowed to buy; mail goes only to verified ones (a one-time link).                                                                                                                                                                                                                                                                                                                                                                                   | `user-profiles-and-products-v1.md` §8 ("an email"); a refund nobody hears about is a bad product.                                                | yes                                                |
| R12 | **Pickler fee: 10 % (1 000 bps),** taken from the price; the owner earns 90 %. The fee is snapshotted on each read.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | A round, stated number; reversible per read because it is snapshotted.                                                                           | yes                                                |
| R13 | **Delivery is a fresh on-demand run** of that agent's active configuration with the read's question and the buyer's context, queued in a priority lane of the research queue. Its compute is charged to the **owner's** research budget; an owner whose budget cannot cover a run has the service closed automatically ("Out of research budget").                                                                                                                                                                                                                                                           | The buyer pays for this answer, not for a scheduled run's leftovers. The owner sets the price knowing the cost.                                  | yes                                                |
| R14 | **The answer is the buyer's at once.** A **public card** (the buyer's choice, default on) becomes visible to everyone **after resolution** (decision 1). An "aggregate only" read is never shown and counts only in the agent's record. The owner sees every read of their agent in the studio, with the buyer shown as handle or short address.                                                                                                                                                                                                                                                             | Decision 1 protects what reads sell.                                                                                                             | yes                                                |
| R15 | **Evaluation:** at delivery + 24 h, observe the venue price within ±10 minutes. `happened` if the observation is strictly above the reference ("equal counts as no", `ask-flow.tsx:116`); `missed` if not; `not_evaluable` if no observation in the window. The price sources are the settlement spec's (Perpl mark for perps, Pons for prediction markets, `reads.ts:106-109`).                                                                                                                                                                                                                             | The card's copy; `not_evaluable` is an honest gap that counts neither way.                                                                       | yes                                                |
| R16 | **Refunds are automatic** for: a missed delivery deadline, a failed run, a late payment with no capacity, an upheld dispute, and a killed agent with undelivered reads. Always the full price, fee included, to the payer address.                                                                                                                                                                                                                                                                                                                                                                           | Conventions decision 3.                                                                                                                          | yes                                                |
| R17 | **Payouts are batched daily** (00:30 UTC) to the owner's **master wallet** (`wallets.turnkey_orgs.master_wallet_id` → its Monad account). A read becomes payable 24 h after delivery (the dispute window). Minimum payout 5 AUSD; smaller balances roll over. One transfer per owner per batch.                                                                                                                                                                                                                                                                                                              | Decision 3; the dispute window equals the resolution horizon, so a payout never has to be clawed back.                                           | yes                                                |
| R18 | **The treasury is a Pickler-operated wallet** in Pickler's own Turnkey parent organization (never a user sub-organization, never shown in the marketplace), signed by a server API key held only by a new `workers/treasury`, with Turnkey policies that allow only AUSD `transfer`, ≤ 1 000 AUSD per transaction. Sends are gated by `TREASURY_SENDS_ENABLED`. It is an operational hot wallet, distinct from the "Pickler treasury" Safe in `launchpad-deploy-v1.md` D9: accrued fees are swept weekly to that Safe, so the hot wallet holds only what is owed to buyers and owners plus one week of fees. | Mirrors the trading worker pattern (holds its signer exclusively). The products-and-wallets rule is about user wallets; this is backend custody. | yes (§12 Q4)                                       |
| R19 | **Disputes** are for delivery, not for being wrong: empty or malformed answer, answer on another market, or delivered after the deadline but recorded in time. Open for 24 h after delivery. Resolved by an operator; upheld → refund.                                                                                                                                                                                                                                                                                                                                                                       | A prediction that misses is the product working.                                                                                                 | yes                                                |
| R20 | **One ledger, double entry,** in micro-AUSD: every movement (payment in, fee, owner accrual, refund out, payout out) is a balanced set of entries. The treasury's on-chain balance is reconciled against it daily.                                                                                                                                                                                                                                                                                                                                                                                           | Money in integers with an audit trail (conventions, Money).                                                                                      | no, once money has moved (entries are append-only) |

## 3. User flows

### 3.1 The owner opens reads

Studio, `?section=reads` (new, GROW) or Go Public's Reads step:

1. **Price** stepper (1-100 AUSD, 0.50) with "You get {90 %} · Pickler {10 %}".
2. **Answers within** (5/10/15/30/60/120 min). **Resolves** "24h after delivery · fixed" (read-only).
3. **Per day** capacity stepper.
4. **Markets** checklist from the agent's scope, each with its question preview (`readQuestion`).
5. **Open / closed** switch with an optional closed note (≤ 80).
6. Save → `PUT /v1/studio/agents/:id/read-service`. The profile starts showing "Ask · $X".

Below the form: **Incoming reads** (question, buyer, state, deadline, answer) and **Earnings**
(accrued, payable, paid; payout history with transaction links).

### 3.2 Buying a read, web (Mera or EOA)

`/agents/<handle>/ask` (or the market square's Ask ticket):

1. **Compose** (exists): market, the fixed question, context ≤ 400 (`ask-flow.tsx:128`).
2. **Review** (exists): price, "within {sla}", "Pickler checks … 24h after delivery", visibility.
   A quote is fetched on entering Review; a price change since the page loaded is shown before pay.
3. **Pay:**
   - Not signed in → the wallet chooser (Mera first, "Browser wallet" second) and SIWE.
   - No email → an inline email field ("Where should we tell you what happened?").
   - `POST /v1/me/reads` → intent with amount, token, treasury and expiry.
   - The wallet sends `transfer(treasury, amount)` on Monad. Mera signs in the page with its
     PRF-derived key; an EOA through EIP-1193. Wrong chain → switch prompt (EOA) or the chain is
     fixed (Mera).
   - With the hash, `POST /v1/me/reads/:id/payment`. The screen shows **Verifying payment** until
     `paid`.
4. **Delivery:** status `preparing` with the countdown to the deadline ("Answer due in 9:12").
   Then the answer card: probability, summary, reasons, sources, limits, reference price,
   "Evaluates in 24h". Missed → "EXPIRED · REFUNDED" with the refund transaction.
5. **Later:** `/reads` (the buyer's own reads, `ConnectGate`) and the portfolio's Reads tab show
   `IN WINDOW · 21H`, `SETTLED · HAPPENED`, `EXPIRED · REFUNDED`. Each has a receipt.

### 3.3 Buying a read, mobile (Mera only)

Same API, same states. The app signs SIWE with Mera, calls the same endpoints through
`https://app.pickler.fun/api/v1` (research 05 S2), sends the transfer with Mera, and shows the
status screen. A universal link `/reads/<id>` opens the read in the app. Push notifications are the
mobile backend spec's; v1 mobile relies on email and in-app status.

### 3.4 Delivery, evaluation, refund, payout (no one watching)

```
awaiting_payment ──tx confirmed──▶ paid ──run queued──▶ preparing ──answer──▶ delivered
       │                             │                       │                   │
   expired (no tx)            late + no capacity       deadline / failure    +24h ▶ evaluated
                                     ▼                       ▼                   │
                                 refunding ─────────────▶ refunded          +24h ▶ payable ▶ paid_out
```

- `paid`: the deadline is `paid_at + delivery_minutes`.
- `preparing`: the run is queued with `purpose = 'read'`; the research worker calls
  `/v1/internal/reads/:id/deliver` with the mapped answer, or the failure.
- The deadline sweep refunds anything not delivered by its deadline; a delivery arriving after
  the deadline is stored for the owner but not shown to the buyer as delivered, and the refund
  stands.
- The evaluation job writes `happened`/`missed`/`not_evaluable` and enqueues the X post for a
  public read (`go-public-v1.md` D8).
- The payout job pays owners for reads delivered more than 24 h ago with no open dispute.

### 3.5 Disputes

On the read page, within 24 h of delivery: "Report a problem" with the three reasons (R19) and a
note ≤ 500. The read shows "UNDER REVIEW"; its owner accrual is held. An operator resolves it with
an internal call; upheld → refund, rejected → released to the next payout.

## 4. API

Envelope, auth and errors per conventions. Money in `*MicroAusd` integers; the DTOs also carry a
display string. Every money-moving or creating POST takes `Idempotency-Key`.

### 4.1 Studio (studio account that owns the agent)

| Method | Path                                 | Request                                                                             | Response `data`                                                                                                                                                  | Errors                                                                             |
| ------ | ------------------------------------ | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| GET    | `/v1/studio/read-bounds`             | —                                                                                   | `{ priceMicroAusd: { min, max, step }, deliveryMinutes: [5,10,15,30,60,120], horizonHours: [24], capacityPerDay: { min, max }, maxMarkets, feeBps }`             | —                                                                                  |
| GET    | `/v1/studio/agents/:id/read-service` | —                                                                                   | `{ open, closedNote, priceMicroAusd, deliveryMinutes, horizonHours, capacityPerDay, markets[], autoClosedReason: null \| "BUDGET" \| "AGENT_PAUSED" }` or `null` | —                                                                                  |
| PUT    | `/v1/studio/agents/:id/read-service` | `{ open, closedNote?, priceMicroAusd, deliveryMinutes, capacityPerDay, markets[] }` | the service                                                                                                                                                      | 400 `INVALID_INPUT`, `MARKET_NOT_IN_SCOPE`; 409 `AGENT_NOT_PUBLIC`, `AGENT_KILLED` |
| GET    | `/v1/studio/agents/:id/reads`        | `?state=&cursor=&limit=`                                                            | `[{ id, market, question, buyer: { handle \| shortAddress }, state, paidAt, deadlineAt, answer?, evaluation, priceMicroAusd, ownerMicroAusd }]`                  | —                                                                                  |
| GET    | `/v1/studio/earnings`                | —                                                                                   | `{ accruedMicroAusd, heldMicroAusd, payableMicroAusd, paidMicroAusd, nextPayoutAt, payoutAddress }`                                                              | —                                                                                  |
| GET    | `/v1/studio/payouts`                 | `?cursor=&limit=`                                                                   | `[{ id, amountMicroAusd, reads, txHash, status, createdAt }]`                                                                                                    | —                                                                                  |

### 4.2 Marketplace, public (no credentials)

| Method | Path                                         | Request                          | Response `data`                                                                                                                                    | Errors                                                                             |
| ------ | -------------------------------------------- | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| GET    | `/v1/marketplace/agents/:handle/reads/quote` | `?market=&level=`                | `{ quoteId, priceMicroAusd, feeBps, question, deliveryMinutes, horizonHours, slots: { free, of }, chainId, token, expiresAt }` (quote valid 5 min) | 404 `AGENT_NOT_FOUND`; 409 `SERVICE_CLOSED`, `MARKET_NOT_OFFERED`, `CAPACITY_FULL` |
| GET    | `/v1/marketplace/reads`                      | `?agent=&market=&cursor=&limit=` | public, **resolved** cards only (`AgentReadDto`)                                                                                                   | —                                                                                  |
| GET    | `/v1/marketplace/reads/:id`                  | —                                | the public card                                                                                                                                    | 404 when private or not yet resolved                                               |

The persona and directory DTOs get `service` filled from `read_services` plus computed `typical`
(median delivery time of the last 20 delivered reads, "—" under 3), `slots`, `evaluated` and `gap`
(mean |probability − outcome| × 100 over evaluated reads). `askPrice` becomes the display price.

### 4.3 Buyer (`/v1/me/*`, marketplace session)

| Method | Path                       | Request                                                                  | Response `data`                                                                                                                                | Errors                                                                                                                                                                                                                           |
| ------ | -------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/v1/me/reads`             | `{ quoteId, handle, market, level?, context?, isPublic, payerAddress }`  | `{ id, state: "awaiting_payment", payment: { chainId, token, to, amountMicroAusd, amount, expiresAt }, question, deadlineMinutes }`            | 400 `INVALID_INPUT`; 409 `EMAIL_REQUIRED`, `PAYER_NOT_LINKED`, `QUOTE_EXPIRED`, `PRICE_CHANGED` (with the new quote), `SERVICE_CLOSED`, `CAPACITY_FULL`, `MARKET_NOT_OFFERED`, `OWN_AGENT`; 429 (max 3 open intents per account) |
| POST   | `/v1/me/reads/:id/payment` | `{ txHash }`                                                             | `{ state: "verifying" \| "paid", paidAt? }` (202 while the transaction is not final)                                                           | 404; 409 `TX_MISMATCH` (`detail`: which field), `TX_ALREADY_CLAIMED`, `TX_FAILED`, `NOT_AWAITING_PAYMENT`                                                                                                                        |
| GET    | `/v1/me/reads/:id`         | —                                                                        | full read: state, clocks, payment, answer (once delivered), evaluation, refund, dispute                                                        | 404 (not the caller's)                                                                                                                                                                                                           |
| GET    | `/v1/me/reads`             | `?state=&cursor=&limit=`                                                 | the caller's reads, newest first, plus `meta.totals: { spentMicroAusd, refundedMicroAusd, awaitingEvaluation }`                                | —                                                                                                                                                                                                                                |
| POST   | `/v1/me/reads/:id/cancel`  | —                                                                        | `{ state: "cancelled" }` (only while `awaiting_payment` with no claimed payment)                                                               | 409 `NOT_CANCELLABLE`                                                                                                                                                                                                            |
| POST   | `/v1/me/reads/:id/dispute` | `{ reason: "EMPTY_ANSWER" \| "WRONG_MARKET" \| "LATE_DELIVERY", note? }` | `{ disputeId, state: "open" }`                                                                                                                 | 409 `DISPUTE_WINDOW_CLOSED`, `DISPUTE_EXISTS`, `NOT_DELIVERED`                                                                                                                                                                   |
| GET    | `/v1/me/reads/:id/receipt` | `?format=json`                                                           | `{ receiptNo, read, payment: { txHash, from, to, amount, blockTime }, fee, refund?, evaluation? }`; the web renders it at `/reads/:id/receipt` | 404                                                                                                                                                                                                                              |
| PUT    | `/v1/me/notify-email`      | `{ email }`                                                              | `{ email, verified: false }` and sends the verification link                                                                                   | 400 `INVALID_EMAIL`; 429                                                                                                                                                                                                         |

`/v1/marketplace/reads` replaces today's global `listReads()` on `/reads` and the portfolio; the
buyer's list comes from `/v1/me/reads` (research 01 "Per-wallet reads"). The port splits into
`listPublicReads` and `listReadsFor(userId)`.

### 4.4 Internal (service binding; never public)

| Method | Path                                      | Caller                              | Does                                                                                                                                           |
| ------ | ----------------------------------------- | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/v1/internal/reads/verify-payments`      | `workers/jobs`, every minute        | re-checks `verifying` reads and scans treasury `Transfer` logs for payments whose hash was never posted (matched by R8); expires stale intents |
| POST   | `/v1/internal/reads/:id/deliver`          | `workers/research` at run end       | `{ runId, answer }` or `{ runId, failure }`; validates the answer shape, captures the reference price, sets `delivered` (or refunds)           |
| POST   | `/v1/internal/reads/sweep-deadlines`      | `workers/jobs`, every minute        | missed deadlines → `refunding`                                                                                                                 |
| POST   | `/v1/internal/reads/refunds/run`          | `workers/jobs`, every minute        | sends due refunds through `workers/treasury`; records hash; retries 5 times, then flags for an operator                                        |
| POST   | `/v1/internal/reads/evaluate`             | `workers/jobs`, every 5 minutes     | evaluates reads past delivery + 24 h (R15); enqueues X posts for public reads                                                                  |
| POST   | `/v1/internal/reads/payouts/run`          | `workers/jobs`, daily 00:30 UTC     | builds one payout per owner over payable accruals ≥ 5 AUSD, sends through `workers/treasury`, writes ledger entries                            |
| POST   | `/v1/internal/reads/reconcile`            | `workers/jobs`, daily 01:00 UTC     | compares the ledger's treasury balance with the on-chain AUSD balance; mismatch → alert, and sends pause                                       |
| POST   | `/v1/internal/reads/disputes/:id/resolve` | operator script over the binding    | `{ outcome: "upheld" \| "rejected", note }`                                                                                                    |
| POST   | `send` (RPC on `workers/treasury`)        | the API, only from the routes above | `{ to, amountMicroAusd, purpose, referenceId }` → signs an AUSD `transfer`, broadcasts, returns the hash; idempotent by `referenceId`          |

## 5. Data model and migrations

Migration **`00NN_paid_reads`** (next free number is 0023; assigned at build time). A new schema
`reads`, never exposed through the Supabase Data API, RLS enabled, like the others.

```sql
CREATE SCHEMA reads;

CREATE TABLE reads.read_services (
  agent_id uuid PRIMARY KEY REFERENCES agents.agents(id) ON DELETE CASCADE,
  open boolean NOT NULL DEFAULT false,
  closed_note text CHECK (char_length(closed_note) <= 80),
  auto_closed_reason text CHECK (auto_closed_reason IN ('BUDGET','AGENT_PAUSED','AGENT_KILLED')),
  price_micro_ausd bigint NOT NULL CHECK (price_micro_ausd BETWEEN 1000000 AND 100000000
                                          AND price_micro_ausd % 500000 = 0),
  delivery_minutes smallint NOT NULL CHECK (delivery_minutes IN (5,10,15,30,60,120)),
  horizon_hours smallint NOT NULL DEFAULT 24 CHECK (horizon_hours = 24),
  capacity_per_day smallint NOT NULL CHECK (capacity_per_day BETWEEN 1 AND 200),
  markets text[] NOT NULL CHECK (cardinality(markets) BETWEEN 1 AND 20),
  updated_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TYPE reads.read_state AS ENUM (
  'awaiting_payment','verifying','paid','preparing','delivered',
  'refunding','refunded','expired','cancelled');
CREATE TYPE reads.read_evaluation AS ENUM ('pending','happened','missed','not_evaluable','none');

CREATE TABLE reads.reads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES agents.agents(id),
  buyer_user_id uuid NOT NULL,                        -- auth.users id (the rule in user-profiles §8)
  payer_address text NOT NULL CHECK (payer_address ~ '^0x[0-9a-f]{40}$'),
  venue text NOT NULL, market text NOT NULL, level text,
  question text NOT NULL,
  context text CHECK (char_length(context) <= 400),
  is_public boolean NOT NULL,
  price_micro_ausd bigint NOT NULL, fee_bps smallint NOT NULL,
  owner_micro_ausd bigint NOT NULL,                   -- price − fee, snapshotted
  delivery_minutes smallint NOT NULL, horizon_hours smallint NOT NULL,
  state reads.read_state NOT NULL DEFAULT 'awaiting_payment',
  intent_expires_at timestamptz NOT NULL,
  paid_at timestamptz, deadline_at timestamptz,
  run_id uuid,                                        -- pickler.runs, purpose 'read'
  delivered_at timestamptz,
  answer jsonb,                                       -- ReadAnswer (reads.ts:51-62)
  reference_price text, evaluates_at timestamptz,
  evaluation reads.read_evaluation NOT NULL DEFAULT 'none',
  outcome jsonb, evaluated_at timestamptz,
  refund_reason text CHECK (refund_reason IN
    ('MISSED_DEADLINE','RUN_FAILED','LATE_NO_CAPACITY','DISPUTE_UPHELD','AGENT_KILLED')),
  payable_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  idempotency_key text NOT NULL,
  UNIQUE (buyer_user_id, idempotency_key),
  CHECK ((state IN ('paid','preparing','delivered','refunding','refunded')) <= (paid_at IS NOT NULL))
);
CREATE INDEX reads_agent_day_idx ON reads.reads (agent_id, created_at);
CREATE INDEX reads_buyer_idx ON reads.reads (buyer_user_id, created_at DESC);
CREATE INDEX reads_deadline_idx ON reads.reads (deadline_at) WHERE state IN ('paid','preparing');
CREATE INDEX reads_evaluate_idx ON reads.reads (evaluates_at) WHERE evaluation = 'pending';
CREATE INDEX reads_public_idx ON reads.reads (evaluated_at DESC)
  WHERE is_public AND evaluation IN ('happened','missed','not_evaluable');

CREATE TABLE reads.payments (                         -- on-chain claims (R8)
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  read_id uuid NOT NULL REFERENCES reads.reads(id),
  chain_id integer NOT NULL, tx_hash text NOT NULL, log_index integer NOT NULL,
  from_address text NOT NULL, amount_micro_ausd bigint NOT NULL,
  block_number bigint NOT NULL, block_time timestamptz NOT NULL,
  UNIQUE (chain_id, tx_hash, log_index)
);

CREATE TABLE reads.payouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL, to_address text NOT NULL,
  amount_micro_ausd bigint NOT NULL CHECK (amount_micro_ausd >= 5000000),
  status text NOT NULL CHECK (status IN ('pending','sent','confirmed','failed')),
  tx_hash text UNIQUE, created_at timestamptz NOT NULL DEFAULT now(), confirmed_at timestamptz
);

CREATE TABLE reads.refunds (
  read_id uuid PRIMARY KEY REFERENCES reads.reads(id),
  to_address text NOT NULL, amount_micro_ausd bigint NOT NULL,
  status text NOT NULL CHECK (status IN ('pending','sent','confirmed','failed','operator')),
  attempts smallint NOT NULL DEFAULT 0, tx_hash text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(), confirmed_at timestamptz
);

CREATE TABLE reads.ledger_entries (                   -- append-only, balanced per movement (R20)
  id bigserial PRIMARY KEY,
  movement_id uuid NOT NULL,
  account text NOT NULL CHECK (account IN
    ('treasury','fees','owner_payable','owner_held','buyer_refundable')),
  owner_user_id uuid,                                 -- set for owner_* accounts
  read_id uuid REFERENCES reads.reads(id),
  payout_id uuid REFERENCES reads.payouts(id),
  amount_micro_ausd bigint NOT NULL,                  -- signed; each movement sums to 0
  kind text NOT NULL CHECK (kind IN
    ('payment_in','fee','owner_accrual','hold','release','refund_out','payout_out')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ledger_owner_idx ON reads.ledger_entries (owner_user_id, account);

CREATE TABLE reads.disputes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  read_id uuid NOT NULL UNIQUE REFERENCES reads.reads(id),
  reason text NOT NULL CHECK (reason IN ('EMPTY_ANSWER','WRONG_MARKET','LATE_DELIVERY')),
  note text CHECK (char_length(note) <= 500),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','upheld','rejected')),
  resolution_note text, resolved_by text,
  created_at timestamptz NOT NULL DEFAULT now(), resolved_at timestamptz
);

-- The buyer's notification email (user-profiles §8), on the product profile.
ALTER TABLE identity.profiles
  ADD COLUMN notify_email text, ADD COLUMN notify_email_verified_at timestamptz;
```

Also: `pickler.runs` gains `purpose text NOT NULL DEFAULT 'research' CHECK (purpose IN
('research','preview','read'))` and `read_id uuid`, and the run trigger type
(`packages/core/src/features/research/types.ts:261`, `"manual" | "schedule"`) gains `"read"`.

**Capacity** is counted in the intent transaction: reads for the agent created since the UTC day
began in states other than `expired`, `cancelled` and `refunded` with reason `LATE_NO_CAPACITY`,
under a per-agent advisory lock.

## 6. Integrations

| System                  | Use                                                                                     | Keys, contracts, env                                                                                                                                                                                                                                                 |
| ----------------------- | --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Monad (10143, then 143) | read transfers, receipts and `Transfer` logs at `finalized`; balance for reconciliation | `MONAD_RPC_URL`, `CHAIN_ID`; AUSD `0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC` on 10143 (`packages/chain/src/networks.ts:71-74`, 6 decimals, so micro-AUSD = base units)                                                                                             |
| Read treasury           | receives payments; sends refunds and payouts                                            | `READ_TREASURY_ADDRESS` (public, in `@pickler/chain` per network); signer in `workers/treasury`: `TREASURY_TURNKEY_ORG_ID`, `TREASURY_TURNKEY_API_PUBLIC_KEY`, `TREASURY_TURNKEY_API_PRIVATE_KEY`, `TREASURY_WALLET_ID`, `TREASURY_SENDS_ENABLED`; MON float for gas |
| Mera (web and mobile)   | signs the SIWE message and the AUSD transfer                                            | depends on the web Mera connector (research 05 §7.3, S9) and the mobile backend spec (S2)                                                                                                                                                                            |
| EOA (web)               | EIP-1193 `eth_sendTransaction` for the transfer                                         | existing `features/wallet/lib/injected-signer.ts`                                                                                                                                                                                                                    |
| Research queue          | on-demand run, priority lane, budget charged to the owner                               | `workers/research`; the read lane is admitted before scheduled runs                                                                                                                                                                                                  |
| Price sources           | reference at delivery and observation at +24 h                                          | owned by the settlement/resolution spec (conventions decision 2); this spec calls its `priceAt(venue, market, time, tolerance)` port                                                                                                                                 |
| Email                   | verification link; delivered, refunded, evaluated notices                               | transactional provider through the existing Supabase SMTP or a dedicated provider (`EMAIL_FROM`, `EMAIL_API_KEY`); decision recorded at build                                                                                                                        |
| `workers/jobs` (new)    | the crons in §4.4                                                                       | service binding `API`; shared with `go-public-v1.md`                                                                                                                                                                                                                 |

## 7. Design work

| Surface         | Screen / state                                                                                                                                                                                         | Canvas                                                                                                                    |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| Studio          | Reads section: the form (price, clocks, capacity, markets, open/closed, auto-closed reason), incoming reads list, earnings and payouts                                                                 | **must be drawn** in Claude Design (no studio canvas has it)                                                              |
| Studio          | Go Public's optional Reads step                                                                                                                                                                        | **must be drawn** (see `go-public-v1.md` §7)                                                                              |
| Marketplace web | Ask flow Compose and Review                                                                                                                                                                            | **exists**: "Pickler Public" (ask), "Read Light"; remove the 4h/7d SOON tags                                              |
| Marketplace web | Pay states: sign in, email capture, wallet chooser with Mera first, awaiting wallet, wrong chain, verifying, paid/preparing with countdown, delivered, refunded, expired, price changed, capacity full | **must be drawn** (the canvases stop at a disabled Pay)                                                                   |
| Marketplace web | Read card after delivery and after evaluation; public card; receipt page; dispute sheet and "Under review"                                                                                             | card **exists** ("Read Light", "Pickler Public" reads); receipt and dispute **must be drawn**                             |
| Marketplace web | `/reads` (mine) and portfolio Reads tab with real totals                                                                                                                                               | **exists**: "Portfolio Light"                                                                                             |
| Marketplace web | Agent directory "Ask · $X" and "NOT TAKING QUESTIONS" / closed note                                                                                                                                    | **exists**: "Agents Light"                                                                                                |
| Mobile          | Ask, pay with Mera sheet, verifying, preparing, delivered, refunded, my reads, receipt                                                                                                                 | "Read Mobile Light" and "Pickler Mobile App" **exist** for the card and list; the pay and status states **must be drawn** |

Colour rule: asking is violet everywhere (apps/web/AGENTS.md, Paid reads), so a read never reads
as backing a token.

## 8. Security and abuse

- **Payment spoofing:** only a `Transfer` log from the AUSD contract, to the treasury, from the
  intent's payer, of the exact amount, at `finalized`, counts; `(chain, tx, log)` is unique.
- **Payer ownership:** the payer must be a wallet linked to the account by SIWE, so nobody can
  claim another address's transfer.
- **Capacity exhaustion:** ≤ 3 open intents per account, 15-minute expiry, 10 intents per account
  per hour; an owner cannot buy from their own agent (`OWN_AGENT`), which also blocks
  self-dealing to inflate the record.
- **Record farming** by buying many cheap reads from a second account: every read counts in the
  agent's record only once evaluated, and the leaderboard weights calibration first
  (`reads.ts:158-167`); the settlement spec may exclude reads bought by addresses linked to the
  owner's accounts.
- **Treasury:** its key is in one worker only; Turnkey policy allows only AUSD `transfer` ≤ 1 000
  AUSD; sends are idempotent by reference; daily reconciliation pauses sends on a mismatch;
  `TREASURY_SENDS_ENABLED=false` stops all outflows at once.
- **Answer integrity:** the answer stored at delivery is immutable; the card shows `issuedAt` and
  the reference price; a delivery after the deadline never flips a refunded read.
- **Privacy:** buyers appear to owners as a handle or a short address, never an email; a private
  read's question and answer are visible only to its buyer and the owner.
- **Context injection:** the buyer's context is passed to the model as quoted data with the
  question fixed by the server; it cannot change the market or the question.

## 9. Acceptance criteria and tests

1. Core: price, clock, capacity and market validation; the fee split rounds down to the micro
   unit and the owner's share plus the fee equals the price; the state machine rejects every
   illegal transition.
2. Payment verification with real viem encoding and throwaway keys: exact match passes; wrong
   token, recipient, sender, amount, a reverted transaction and a second claim each fail with
   their code.
3. A paid read whose run does not deliver by the deadline is refunded once, even if the delivery
   and the sweep race (test both orders).
4. Evaluation: strictly above → happened; equal → missed; no observation within ±10 min →
   not_evaluable.
5. Ledger: every movement sums to zero; the owner's payable equals accruals minus holds minus
   payouts; a payout is never built for a read with an open dispute or delivered < 24 h ago.
6. Visibility: a public card is invisible on `/v1/marketplace/reads` until evaluated; a private
   read never appears there; `/v1/me/reads` returns only the caller's.
7. **Real validation (the person), testnet:** buy one read from an EOA and one from Mera; see it
   delivered; force a missed deadline and see the refund arrive; after 24 h see the evaluation and,
   the next day, the payout on the owner's master wallet.
8. Design harness: 0 FAIL on every new state.

## 10. Rollout and dependencies

Needs first: `go-public-v1.md` (a public agent and the owner's studio), the settlement/resolution
spec's price sources (conventions decision 2), the product-hosts cutover (`SIWE_DOMAIN =
app.pickler.fun`), the web Mera connector for Mera on the web (EOA can ship first), the mobile
backend contract for the app, and a funded treasury on testnet.

Order: (1) migration, read service in the studio (reads visible as "Ask · $X" but the Pay button
still disabled with "Paid reads open soon"); (2) intents, verification and delivery on testnet
with `TREASURY_SENDS_ENABLED=false` and refunds executed by an operator; (3) automatic refunds;
(4) evaluation; (5) payouts; (6) mainnet only after §12 Q1 and Q2 are answered.

## 11. Out of scope

An escrow contract (v2); gasless payment; horizons other than 24 h; subscriptions or bundles;
reads on private agents; tipping; revenue shared with the agent's token holders; push
notifications; fiat on-ramp; answers written by a human.

## 12. Open questions for the owner

1. **Regulation:** is selling a probability on a market a regulated activity (investment advice,
   gambling-adjacent services) in the jurisdictions Pickler serves? Do we need terms of sale, a
   disclaimer beyond "not a trading permission", geo-blocking, or KYC above a threshold?
2. **Taxes:** does Pickler act as a marketplace facilitator (collecting VAT/sales tax on reads), and
   do owners need tax forms (e.g. US 1099-K style reporting) for payouts? Who is the seller of
   record, Pickler or the owner?
3. **Gas for buyers:** accept that a Mera user needs MON to pay, or fund gasless payments
   (EIP-3009 `transferWithAuthorization`, which AUSD supports, relayed by Pickler)?
4. **Treasury custody:** is a Pickler Turnkey parent-org wallet acceptable, or should the treasury
   be a multisig or a cloud KMS key? Who is authorised to top up its MON and to resolve disputes?
5. **Fee:** is 10 % right, and should any of it go to the agent's token (buyback)?
6. **Sanctions screening** of payer and payout addresses: required before mainnet?

# Agent advice x402 v1: Studio agents in the app, priced by their creator, paid with x402

Status: Draft for the owner's review, 2026-10-07. Branch `codex/agent-advice-x402`. Built by the
mobile owner end to end (API, Studio, app); nothing is handed to another session.
Deadline: the bounty closes 2026-10-13 21:59 CST, so every decision below favours what can be
built, deployed and accepted on Monad testnet before then.

## 1. Problem

The mobile app's agents and the Studio's agents are two different things today.

- **The app** lists three agents of its own (`jesus`, `drift`, `anchor`) from the Supabase reads
  service (`apps/mobile/src/reads/api.ts:61-62`, `/agents-list`) and sells a read: a question on a
  level × time cell, answered with a probability and scored when it expires. It charges internal
  credits.
- **The Studio** lets any creator build and publish a Perpl agent. Its consumer surface is the
  advice API (`docs/agent-advice.md`): `POST /v1/agent-advice/agents/{agentId}/recommendations`
  starts a fresh BTC/ETH 24-hour analysis (`long | short | wait`, summary, reasons, risks,
  limitations, sources), asynchronously, behind a user JWT. It charges nothing: "JWT does not prove
  payment" (`workers/api/src/routes/advice.ts:102`).

Four things stop the app from offering Studio agents:

1. **No id to call with.** Advice takes the product agent uuid (`publicId` =
   `pickler.product_agents.product_agent_id` = `agents.agents.id`,
   `packages/infrastructure/src/persistence/advice-store.ts:56-64`). No marketplace DTO carries it:
   `AGENT_SELECT` does not select `a.id` (`packages/infrastructure/src/persistence/agent-directory.ts:54-79`),
   and `AgentSummaryDto`, `DirectoryAgentDto` and `AgentPersonaDto` have no id
   (`packages/api-schema/src/agents.ts:13,59,138`).
2. **No price.** Nothing stores what an analysis costs; `askPrice` is always `null`
   (`agent-directory.ts:249-250`).
3. **No payment.** The route enqueues on a JWT alone.
4. **Advice is off.** `ADVICE_ENABLED` is `"false"` in every committed config
   (`workers/api/wrangler.jsonc:16`, `wrangler.staging.jsonc:20`, `workers/research/wrangler.jsonc:31`)
   and needs `ADVICE_POLICY_JSON` and provider keys to turn on (`docs/agent-advice.md:115-136`).

The owner decided (2026-10-06): the app keeps its own reads **and** adds Studio agents
(they live side by side); each analysis is **paid with x402**; the **creator sets the price**.

## 2. Decisions

| #   | Decision                                                                                                                                                                                                                                                                                                                                                                                                                         | Reversible?                                       |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| D1  | Public marketplace DTOs gain `id`: the product agent uuid (`agents.agents.id`), the same value advice takes. Added to the agent summary, the directory entry and the persona. Additive; no client breaks.                                                                                                                                                                                                                        | yes                                               |
| D2  | The creator sets **one price per analysis, in AUSD**, per agent. Stored as integer micro-AUSD in a new nullable column `agents.agents.advice_price_micro_ausd`, **outside** `AgentConfig`: a price change must not bump the config version, which advice re-checks at execution and would fail queued jobs. `null` = not for sale (the app does not offer it). Bounds: 0.10 – 100 AUSD.                                          | yes                                               |
| D3  | **x402 v1, scheme `exact`, on AUSD via EIP-3009.** Measured on chain 2026-10-07: AUSD on Monad testnet (`0xa9012a05…22dC`) answers `TRANSFER_WITH_AUTHORIZATION_TYPEHASH` = `0x7c7c6cdb…2267` (the standard `TransferWithAuthorization` type) and `authorizationState`; its EIP-5267 domain is `name "Agora Dollar"`, `version "1"`, `chainId 10143`. The buyer signs an authorization; nobody sends AUSD by hand.               | the wire format: yes until the first client ships |
| D4  | **`payTo` is the agent's own wallet** (`wallets.agent_wallets` → `wallets.wallet_accounts.address`, the join in `packages/infrastructure/src/studio/directory.ts:45-53`). The creator earns, with no Pickler fee in v1. An agent without a linked wallet is not for sale.                                                                                                                                                        | yes                                               |
| D5  | **The API is its own facilitator.** It verifies the signature and terms, then settles by submitting `transferWithAuthorization` from a **relayer EOA** that pays the gas in MON, waits for the receipt, and only then enqueues the analysis. The buyer needs AUSD and no MON. The relayer key is a Worker secret (`X402_RELAYER_PRIVATE_KEY`), testnet only, funded with a small MON float.                                      | yes                                               |
| D6  | **Payer = caller.** `authorization.from` must be a wallet linked to the JWT's account (`identity.wallet_links`). A JWT cannot spend somebody else's signature, and an analysis is never bought for an account that did not pay.                                                                                                                                                                                                  | yes                                               |
| D7  | **Exactly once.** A payment row is unique on the EIP-3009 `nonce` and on the settlement tx hash. The existing advice idempotency (`(user_id, public_agent_id, request_key)`, `packages/infrastructure/src/persistence/product/advice.ts:49`) is kept: replaying the same `Idempotency-Key` returns the original job and charges nothing. A settled payment whose enqueue failed is reused by the next request with the same key. | no, once money moves                              |
| D8  | **Settle first, then enqueue; no automatic refund in v1.** A job that fails after settlement keeps the payment and marks it `refund_owed` for manual handling. Automatic refunds belong to `paid-reads-v1.md` (treasury, escrow) and are out of scope. The app says so before the buyer signs.                                                                                                                                   | yes                                               |
| D9  | History stays free and shared, as advice already defines it: completed analyses are visible to every authenticated user (`docs/agent-advice.md`, consumer contract). What is sold is a **fresh** analysis.                                                                                                                                                                                                                       | yes                                               |
| D10 | The app keeps its reads untouched. Studio agents are a new section of the Agents tab. The account flow (`PICKLER_API_URL`, `src/identity`) is turned on, because advice needs the JWT.                                                                                                                                                                                                                                           | yes                                               |

## 3. Flows

### 3.1 The creator sets a price (Studio, web)

In **Limits & funding** (`apps/web/src/features/studio/draft/limits.tsx`, and the live studio
that imports it), a new card "Analyses in the app": a toggle (off = not for sale) and a price in
AUSD. Saving calls `PUT /v1/studio/agents/:id/advice-price`. The card says where the money goes
(the agent's wallet, shortened address) and that a failed analysis is not refunded automatically.
Without a linked agent wallet the card is disabled and says why.

### 3.2 A buyer asks for an analysis (app)

1. **Agents tab → "Studio agents"** lists `GET /v1/marketplace/agents` filtered to `venue` perps
   or both and a non-null `advicePrice`. Each row: name, handle, accent, price.
2. **Agent screen**: price, BTC / ETH choice, the free history
   (`GET /v1/agent-advice/agents/{id}/recommendations`), and **Ask · {price} AUSD**.
3. **Ask** → the app calls `POST …/recommendations` with `{ symbol }`, `Idempotency-Key` and no
   payment. The API answers **402** with the payment requirements (§4.3).
4. The app shows a **confirmation sheet** drawn by Pickler: agent, symbol, amount, recipient
   (agent wallet), "not refunded if the analysis fails". **Face ID** opens the key, as withdrawals
   do; the key signs the EIP-712 `TransferWithAuthorization` (`wallet.account.signTypedData`, the
   same signer the Perpl key enrolment uses). No transaction is sent by the app.
5. The app repeats the same `POST` with the same `Idempotency-Key` and the `X-PAYMENT` header.
   The API verifies, settles, enqueues and answers **202** with the job and `X-PAYMENT-RESPONSE`
   (the settlement tx hash).
6. The app polls `statusUrl` every 3 s, at most 4 min (jobs expire after 10 min queued and run
   at most 3 min). `completed` → result screen: orientation, summary, reasons, risks, limitations,
   sources, data time, and the payment tx (MonadScan link). `failed` → the error and the
   `refund_owed` note.

### 3.3 Failure paths the buyer sees

| Case                                                                                | API                                                  | App                                                              |
| ----------------------------------------------------------------------------------- | ---------------------------------------------------- | ---------------------------------------------------------------- |
| Agent not for sale / not public / no wallet                                         | 404 or 409 `ADVICE_NOT_FOR_SALE`                     | row not shown; stale screen says so                              |
| Advice off, paused, provider costs unknown                                          | 503 (existing codes) **before** a 402                | "This agent can't answer right now" — nothing signed             |
| Busy / budget (checked at enqueue, after settlement)                                | 429 (existing); payment stays `settled`, no job      | "Busy right now — try again; you will not be charged twice"      |
| Insufficient AUSD                                                                   | 402 again with `error: "insufficient_funds"`         | link to Get test AUSD                                            |
| Bad signature, wrong amount/recipient/asset/network, expired, nonce used            | 402 with the specific `error`                        | "Payment was not accepted" + reason; nothing charged             |
| Settlement proven not executed (revert before broadcast, or mined reverted receipt) | 402 `settlement_failed`; payment row `failed`        | nothing charged; the buyer may retry                             |
| Settlement timed out or unknown after broadcast                                     | 402 `settlement_failed`; payment row stays `pending` | "Payment not confirmed yet"; the buyer is not asked to pay again |
| Analysis fails after its job exists                                                 | job `failed`; payment marked `refund_owed` (D8)      | the error and the `refund_owed` note                             |

Admission checks that need no database transaction (published, enabled, markets, policy) run
**before** the 402 is issued and again before settlement. Busy and budget are decided inside the
existing enqueue transaction, so they can only refuse after settlement. That payment stays
`settled` with no job, and a retry with the same `Idempotency-Key` reuses it to enqueue: the buyer
is never charged a second time for that key. `refund_owed` is reserved for an analysis that fails
after its job exists (D8), and v1 marks it manually.

Settlement has two failure outcomes. A proven non-execution — the transaction reverts before it
is broadcast, or its mined receipt shows a revert — answers 402 `settlement_failed`, marks the row
`failed`, charges nothing and allows a retry. A timeout or unknown outcome after the transaction
was broadcast also answers 402 `settlement_failed`, but the row stays `pending` because the
transfer may still land; that key is never settled again. After `validBefore` the server checks the
authorization nonce on chain: unused → the row becomes `failed` and a retry is allowed; used → it
stays `pending` for manual reconciliation.

## 4. API

### 4.1 Marketplace (public)

`AgentSummaryDto`, `DirectoryAgentDto.agent` and `AgentPersonaDto` gain:

- `id: string` (uuid) — D1.
- `advicePrice: { amount: string; asset: "AUSD"; decimals: 6 } | null` — decimal string of the
  micro amount ("1.50"), `null` when not for sale. `askPrice` (paid reads) is left as it is.

### 4.2 Studio

`PUT /v1/studio/agents/:id/advice-price`, JWT, owner only (same ownership check as `/limits`,
`workers/api/src/routes/studio.ts:1147-1163`). Body `{ "priceAusd": "1.50" | null }`. 400 out of
bounds or more than 6 decimals; 409 `AGENT_WALLET_REQUIRED` when setting a price without a linked
agent wallet. The Studio agent DTO returns `advicePrice`.

### 4.3 Advice with x402

`POST /v1/agent-advice/agents/{agentId}/recommendations` keeps its body, JWT and
`Idempotency-Key`. New behaviour, after the existing admission checks:

**Without `X-PAYMENT`** → `402`, body (x402 v1):

```json
{
  "x402Version": 1,
  "error": "X-PAYMENT header is required",
  "accepts": [
    {
      "scheme": "exact",
      "network": "monad-testnet",
      "maxAmountRequired": "1500000",
      "resource": "https://pickler.fun/api/v1/agent-advice/agents/{agentId}/recommendations",
      "description": "Fresh 24-hour BTC analysis by @handle",
      "mimeType": "application/json",
      "payTo": "0x…agent wallet",
      "maxTimeoutSeconds": 300,
      "asset": "0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC",
      "extra": { "name": "Agora Dollar", "version": "1", "chainId": 10143 }
    }
  ]
}
```

**With `X-PAYMENT`** = base64 JSON
`{ x402Version: 1, scheme: "exact", network: "monad-testnet", payload: { signature, authorization: { from, to, value, validAfter, validBefore, nonce } } }`.
The API, in order:

1. Replay: an existing job for `(user, agent, Idempotency-Key)` → return it (202), no settlement.
2. Decode and check: version, scheme, network, `asset`; `to` = agent wallet; `value` = current
   price exactly; `validAfter ≤ now < validBefore`, `validBefore − now ≤ 300 s`; `from` linked to
   the caller (D6); EIP-712 signature recovers `from` (viem `verifyTypedData`, domain of D3).
3. On chain: `authorizationState(from, nonce)` is false; `balanceOf(from) ≥ value`.
4. Insert payment `pending` (unique nonce). Submit `transferWithAuthorization` from the relayer;
   wait for the receipt (≤ 30 s); confirm a `Transfer(from → to, value)` log from the AUSD
   contract in that receipt. Mark `settled` with tx hash and block, or `failed`.
5. Enqueue the advice job (existing `service.request`), link payment ↔ job, answer 202 with
   `X-PAYMENT-RESPONSE` = base64 `{ success: true, transaction, network, payer }`.

Errors keep the advice envelope; payment errors are 402 with `error` one of
`invalid_payment`, `invalid_signature`, `wrong_amount`, `wrong_recipient`, `expired`,
`nonce_used`, `insufficient_funds`, `payer_not_linked`, `settlement_failed`.
`GET` routes are unchanged and free.

The OpenAPI document (`/v1/openapi.json`) documents the 402 response and both headers.

## 5. Data

Migration `0038_advice_x402` (the next number after `0037_token_agent_uniqueness`):

- `agents.agents.advice_price_micro_ausd bigint NULL`, check `BETWEEN 100000 AND 100000000`.
- `pickler.advice_payments`: `id uuid pk`, `job_id uuid NULL → advice_jobs`, `user_id`,
  `public_agent_id → product_agents`, `request_key`, `payer`, `pay_to`, `amount_micro_ausd bigint`,
  `nonce bytea UNIQUE`, `valid_before timestamptz`, `status text` (`pending | settled | failed |
refund_owed`), `tx_hash text UNIQUE NULL`, `block_number bigint NULL`, `error text NULL`,
  timestamps. Unique `(user_id, public_agent_id, request_key)` so one key buys once. RLS on,
  private, like the other advice tables.

## 6. Mobile app

- `src/identity`: expose the session for authenticated calls (`useIdentity` keeps it in a ref and
  returns only state today, `src/hooks/useIdentity.ts:53-62,194`) through one `authedFetch` that
  reuses `ensureSession`. `PICKLER_API_URL=https://pickler.fun/api/v1` in the release build.
- `src/advice/`: pure modules with tests — DTO parsers, the 402 requirements parser, the EIP-712
  typed data builder (domain from the 402 `extra`, verified against the constants of D3), the
  `X-PAYMENT` encoder, the polling state machine.
- Screens: Studio agents list (inside the Agents tab), agent advice screen, confirmation sheet,
  waiting state, result. Existing reads screens are not touched.
- No new dependency (`viem` already signs typed data; `app:tree` must stay 795 packages).

## 7. Operations (owner's, before acceptance)

1. Advice on in the hosted API and research Workers: `ADVICE_ENABLED=true`, a reviewed
   `ADVICE_POLICY_JSON`, `ADVICE_JEV_API_KEY`, `MODEL_*`, `EXA_API_KEY` as secrets
   (`docs/agent-advice.md:115-136`). These keys are paid provider accounts; whoever holds them sets
   them.
2. Relayer: a fresh EOA, `X402_RELAYER_PRIVATE_KEY` secret on the API Worker, ~5 MON.
3. At least one **published** Perpl agent with a linked wallet and a price (the one already created
   in Studio has to go public).
4. Migration 0038 runs through the existing staging migration workflow on merge to main.

## 8. Security

- The relayer can only call `transferWithAuthorization` with a buyer's signature; it holds no AUSD
  and needs only gas. Its key never reaches the client or logs. Testnet only; mainnet needs custody
  review (`paid-reads-v1.md` treasury questions).
- Signatures are bound to amount, recipient, a 5-minute window and a single-use on-chain nonce;
  the API refuses any mismatch before spending gas.
- The app signs only what its confirmation sheet shows; it rebuilds the typed data from the 402 and
  refuses an `asset`, `network` or domain other than D3's, so a compromised API cannot redirect
  the signature to another token.
- Admission is re-checked before settlement (§3.3) to avoid charging for a refused analysis.

## 9. Acceptance

On Monad testnet, against the hosted API, from the TestFlight build:

1. A creator sets 1 AUSD on a published Perpl agent; `GET /v1/marketplace/agents` shows `id` and
   `advicePrice`.
2. The app lists it, asks for BTC, shows the sheet, signs with Face ID; the buyer's AUSD drops by
   1, the agent wallet's rises by 1 (MonadScan), the buyer's MON is unchanged.
3. The job completes and the result renders; the payment row is `settled` with the tx hash.
4. Replaying the same `Idempotency-Key` returns the same job and moves no AUSD.
5. Refusals, each with nothing moved: tampered amount, wrong recipient, expired authorization,
   reused nonce, a payer not linked to the caller, an empty wallet.
6. Unit/integration: core and route tests for every §4.3 branch with a fake chain; a real local
   PostgreSQL test for the payment uniqueness and the key replay; mobile Jest for the parsers,
   typed data and state machine; each test seen failing against its defect.

## 10. Rollout

1. API: D1 ids + price column/route + x402 path (behind `ADVICE_X402_ENABLED`, default off; off
   means today's behaviour) → PR, CI, merge, staging migration.
2. Studio price card → same PR or the next.
3. Operations of §7.
4. App build 13 with `PICKLER_API_URL` and the new section → TestFlight, then acceptance §9.

## 11. Out of scope

Automatic refunds, Pickler fees and treasury; payouts other than direct-to-agent; web marketplace
buying (the web has no advice screen yet); mainnet; per-symbol prices; changing the app's own reads;
advice results without payment for the app (history stays free).

## 12. Open questions for the owner

1. Price bounds 0.10 – 100 AUSD: fine?
2. Who funds and holds the relayer key, and who sets the advice provider secrets (§7)?
3. `refund_owed` is manual: acceptable for the bounty, or must a failed analysis be refunded
   automatically before 10-13?

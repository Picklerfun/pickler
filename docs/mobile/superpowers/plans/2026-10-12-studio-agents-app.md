# Studio agents in the app (phase 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A person in the iOS app lists the Studio agents that sell analyses, picks BTC or ETH,
pays one fresh 24-hour analysis in AUSD with Face ID (x402, split 65/35 by the splitter), waits
for it, and reads the result. The free history stays visible.

**Architecture:**

- **Pure modules in `apps/mobile/src/advice/`**, each with Jest tests:
  - DTO parsers;
  - the 402 parser, checked against the app's own constants;
  - the `ReceiveWithAuthorization` typed-data builder and the nonce derivation;
  - the `X-PAYMENT` encoder and `X-PAYMENT-RESPONSE` decoder;
  - the job polling state machine.
- **One authenticated client** reuses `useIdentity`'s `ensureSession`.
- **Screens:** a "Studio agents" section in the Agents tab, an advice screen with an in-screen confirmation step (the withdraw pattern), a waiting state and a result.
- **Not touched:** the existing reads screens and `services/reads`.

**Tech Stack:** Expo SDK 57 (React Native), viem 2.55.13 (already a dependency), Jest (jest-expo),
react-navigation.

**Spec:**

- `docs/specs/agent-advice-x402-v1.md` §3.2 and §6 (flow, screens, polling);
- `docs/specs/agent-advice-fee-split-v1.md` §2 S2/S5/S6, §4 and §5, which override the phase 1 spec for the wire: `ReceiveWithAuthorization`, `payTo` = splitter, `salt`, 65/35 copy.

**Base:** branch `codex/mobile-studio-agents`, stacked on `codex/advice-fee-split` (PR #161,
open). Its PR targets `codex/advice-fee-split` until #161 merges, then `main`.

## Global Constraints

- **Network and asset:** chain 10143 (`CHAIN.id`). AUSD is `0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC` (`AUSD_ADDRESS`), 6 decimals.
- **EIP-712 domain:** `{ name: "Agora Dollar", version: "1", chainId: 10143, verifyingContract: AUSD }`.
- **Typed data:** primary type `ReceiveWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)`.
- **Nonce:** `nonce = keccak256(encodeAbiParameters([address, bytes32], [payee, salt]))`, where `salt` is 32 bytes from `crypto.getRandomValues` (polyfilled by `expo-crypto` in `src/polyfills.ts`). The contract's vector: payee `0x000000000000000000000000000000000000dEaD` with salt `0x00…01` gives `0xb34209a263f6c38fe55f099e9e70f9d67e93982480ff3234a5e0108028ad164d`.
- **Shares:** creator `floor(value * 6500 / 10000)`, Pickler the rest.
- **The 402 must match the app's constants before anything is signed:**
  - `x402Version 1`, scheme `exact`, network `monad-testnet`;
  - `asset` = AUSD, `extra.chainId` 10143;
  - `extra.primaryType` `ReceiveWithAuthorization`, `extra.creatorBps` 6500, `extra.protocolBps` 3500;
  - `maxAmountRequired` equal to the price the agent row showed;
  - `maxTimeoutSeconds` ≤ 300.

  Anything else is refused with no signature.
- **Validity window:** `validAfter = 0` and `validBefore = now + 240 s`, which stays under the server's 300 s.
- **`X-PAYMENT` header:** base64 JSON `{ x402Version: 1, scheme: "exact", network: "monad-testnet", payload: { signature, authorization: { from, to, value, validAfter, validBefore, nonce, salt } } }`. All numbers are decimal strings and the hex values lowercase.
- **API:**
  - `GET /v1/marketplace/agents` returns a bare JSON array, no envelope;
  - the advice routes under `/v1/agent-advice` use the `{ data }` envelope;
  - the 402 body is x402's own shape, not an envelope;
  - `X-PAYMENT-RESPONSE` is a header on the 202.
- **Polling:** every 3 s, for at most 4 min.
- **`Idempotency-Key`:** one per Ask, reused across the 402 and the paid retry.
- **No new dependency:** `npm run app:tree --prefix scripts/mobile` must not change.
- **Networking style:** no `AbortSignal.timeout` (it does not exist in RN). Use `AbortController` plus `setTimeout`, and inject `doFetch` for tests.
- **Identity:** the access token stays in memory. The feature is off when `PICKLER_API_URL` is unset.
- **Release gate:** no TestFlight archive or upload, and no `ios.buildNumber` change, without the owner's explicit authorization (`apps/mobile/AGENTS.md`).
- **Mobile repo rules:**
  - hooks stay above early returns (`__tests__/app-hooks.test.ts`);
  - commit by path;
  - documentation in English for new files;
  - `docs/mobile` contract: one live overview, a plan with its generated HTML, and an audit per executed phase.
- **Owner's rule:** every new test is seen failing against its defect before it is trusted. Never say a screen looks right without looking at it rendered (simulator screenshot).

## Review Focus

1. **A 402 that names another recipient, asset, chain, amount or primary type.** For example, a compromised API or a stale price. The app refuses before Face ID and shows "Payment terms changed — nothing was signed". Test in Task 1.
2. **The agent's price changed between the list and Ask.** The 402's amount differs from what the screen showed. The app shows the new price and asks again; it never signs the higher amount silently. Test in Task 1 (parser) and Task 4 (screen state).
3. **Face ID cancelled, or the app backgrounded mid-flow.** Nothing is sent. Coming back shows the advice screen idle, and a retry reuses the same `Idempotency-Key` only while the first 402 is still pending. Test in Task 3.
4. **A 402 `settlement_failed` or `invalid_payment` after signing.** The app shows the reason and "nothing was charged" only when the server says so. On `settlement_failed` it says the payment is being checked and does not offer an immediate re-pay with the same key (phase 1 Ruling 9). Test in Task 3.
5. **The job fails, or polling hits 4 min.** Failed shows the error and the "not refunded automatically" note. A timeout shows "still running — check back" with a refresh, and it never pays again. Test in Task 3.

---

### Task 1: Pure x402 and DTO modules

**Files:**

- Create:
  - `apps/mobile/src/advice/types.ts`
  - `apps/mobile/src/advice/parse.ts` (marketplace row, recommendation, history, accepted)
  - `apps/mobile/src/advice/x402.ts` (`parsePaymentRequired`, `checkTerms`, `buildAuthorization`, `typedData`, `nonceFor`, `encodePayment`, `decodeSettlement`, `shares`)
  - `apps/mobile/src/advice/poll.ts` (state machine)
- Tests:
  - `apps/mobile/__tests__/advice-parse.test.ts`
  - `apps/mobile/__tests__/advice-x402.test.ts`
  - `apps/mobile/__tests__/advice-poll.test.ts`

**Interfaces (produced):**

- `type StudioAgent = { id: string; name: string; handle: string; accent: string; venue: "perps" | "both"; price: { micro: bigint; text: string } }`
- `parseStudioAgents(json: unknown): StudioAgent[]` keeps rows with a non-null `advicePrice` and venue `perps` or `both`, and drops malformed rows without throwing.
- `type Terms = { payTo: `0x${string}`; payee: `0x${string}`; value: bigint; maxTimeoutSeconds: number; resource: string }`
- `parsePaymentRequired(json: unknown): { terms: Terms | null; error: PaymentError | null }`
- `checkTerms(terms: Terms, expectedMicro: bigint): "ok" | "price_changed" | "untrusted"`
- `nonceFor(payee, salt): `0x${string}``
- `buildAuthorization({ from, terms, now, salt }): Authorization` (the seven fields)
- `typedData(authorization)`, ready for `wallet.account.signTypedData`
- `encodePayment(authorization, signature): string` (base64)
- `decodeSettlement(header: string | null): { transaction: string; payer: string } | null`
- `shares(micro): { creator: bigint; protocol: bigint }`
- `type PollState = { kind: "waiting"; since: number } | { kind: "done"; recommendation } | { kind: "failed"; error } | { kind: "timeout" }`, with `nextPoll(state, response, now)`

- [ ] **Step 1: Failing tests:**
  - **Parsers:** a recorded `GET /v1/marketplace/agents` array (a fixture in `__tests__/fixtures/`) gives only the priced perps and both-venue rows. A recommendation with a result parses every field the result screen needs.
  - **`checkTerms`:**
    - a good 402 is `ok`;
    - a wrong asset, chain, `primaryType`, `creatorBps`, network or scheme, or `maxTimeoutSeconds` 301, is `untrusted`;
    - a different amount is `price_changed` (Review Focus 1 and 2).
  - **Signing helpers:**
    - `nonceFor` matches the contract vector;
    - `typedData` signed with a test key recovers `from` through viem `recoverTypedDataAddress`;
    - changing `to` breaks the recovery;
    - the `encodePayment` round trip equals the server's expected shape, matching `paymentPayloadSchema`'s field names, `salt` included;
    - `shares(1_500_000n)` is 975_000/525_000.
  - **Polling:** queued then running then completed gives `done`; failed gives `failed`; 4 min elapsed gives `timeout`; a fetch error stays `waiting` until the deadline.
- [ ] **Step 2: Run, expect failure:** `npm test --workspace=@pickler/mobile -- advice`.
- [ ] **Step 3: Implement** with viem (`keccak256`, `encodeAbiParameters`, `getAddress`) and hand-written guards in the style of `src/reads/types.ts`.
- [ ] **Step 4: Run.** The tests pass. Against the defect, drop the `primaryType` check: the `untrusted` test fails. Restore. Run `npm run typecheck --workspace=@pickler/mobile` and `npm run app:tree --prefix scripts/mobile`, which must show no change.
- [ ] **Step 5: Commit:** `feat(mobile): x402 advice parsers, typed data and polling`.

---

### Task 2: Authenticated advice client

**Files:**

- Modify: `apps/mobile/src/hooks/useIdentity.ts` to expose `authedFetch(path, init)`. It calls `ensureSession(wallet)` and adds `Authorization: Bearer`. The token is never stored. A 401 signs in again once.
- Create: `apps/mobile/src/advice/api.ts`:
  - `fetchStudioAgents(base, doFetch)`;
  - `requestAdvice(authed, agentId, symbol, key, payment?)`, which returns `{ status, json, settlementHeader }`;
  - `getRecommendation(authed, id)`;
  - `history(authed, agentId, symbol)`.

  Each call has a 15 s deadline through `AbortController`, and the deadline also covers the body.
- Tests: `apps/mobile/__tests__/advice-api.test.ts` (fake fetch), and extend `apps/mobile/__tests__/identity-hook.test.ts`.

- [ ] **Step 1: Failing tests:**
  - a 402 returns `{ status: 402, json }` and is not thrown;
  - a 202 exposes `X-PAYMENT-RESPONSE`;
  - `Idempotency-Key` and `X-PAYMENT` are sent as given;
  - the deadline aborts a hanging body;
  - `authedFetch` reuses a fresh session, signs in once on 401, and never persists the token;
  - with `PICKLER_API_URL` unset, the Studio section is hidden.
- [ ] **Step 2:** Run and expect failure. **Step 3:** Implement. **Step 4:** Run, and do a defect check: drop the body deadline and the hang test fails. **Step 5:** Commit `feat(mobile): authenticated advice client`.

---

### Task 3: The Ask flow as a hook

**Files:**

- Create: `apps/mobile/src/hooks/useAdviceAsk.ts`, built on the modules from Tasks 1–2.
- Test: `apps/mobile/__tests__/advice-ask.test.ts` (react-test-renderer in a `.ts` file, like `identity-gate.test.ts`).

**Flow:** `idle → quoting` (POST without payment, then 402) `→ confirming` (terms checked, sheet data ready: agent, symbol, total, 65/35 shares, recipient = the agent wallet, "not refunded if the analysis fails") `→ signing` (`useUnlock` opens the wallet with Face ID, then `signTypedData`) `→ paying` (POST with `X-PAYMENT`, same key) `→ waiting` (polling) `→ done | failed | timeout`. Error states: `untrusted`, `price_changed`, `refused(error)`, `settlement_pending`.

- [ ] **Step 1: Failing tests** cover each Review Focus item 3–5:
  - Face ID cancelled (an empty `describeError`) returns to `idle` with nothing sent;
  - `settlement_failed` gives `settlement_pending` and no automatic re-pay;
  - `invalid_payment` or `insufficient_funds` gives `refused` with its reason and a "Get test AUSD" link for insufficient funds;
  - a job that failed gives `failed` with the `refund_owed` note;
  - the timeout gives `timeout` with a refresh that polls the same job.
- [ ] **Steps 2–5:** run, implement, run with a defect check (re-pay on `settlement_failed` must fail a test), then commit `feat(mobile): pay and wait for a Studio agent analysis`.

---

### Task 4: Screens and navigation

**Files:**

- Modify:
  - `apps/mobile/src/screens/agents.tsx` (a "Studio agents" `Reveal` section with its own loading, error and empty states; the credit list stays untouched);
  - `src/navigation/screens.ts`, `routes.ts` and `Navigator.tsx` (new `advice` screen in the Agents stack, gated like `agent`);
  - `src/store.ts` (`S.adviceAgentId`).
- Create: `apps/mobile/src/screens/advice.tsx`. It shows:
  - the price and BTC/ETH `Segmented`;
  - the free history;
  - "Ask · {price} AUSD";
  - the in-screen confirmation step, in the `WithdrawScreen` review pattern: `Card`, `KV` rows for total, "65% to @handle · 35% to Pickler" and recipient, the not-refunded note, and `Btn lime` "Pay with Face ID";
  - the waiting state with elapsed time;
  - the result: orientation, summary, reasons, risks, limitations, sources, data time, and the payment tx with a MonadScan link via `EXPLORER_TX_URL`.
- Tests: extend `navigation.test.ts` and `routes.test.ts`. `app-hooks.test.ts` must stay green.

- [ ] **Step 1:** Failing navigation tests for the new route and its gating. **Step 2:** Implement.
- [ ] **Step 3: Look at it rendered.** Start the dev client on the simulator with `PICKLER_API_URL` pointed at a local fixture or the staging API. Capture screenshots of the list, the advice screen, the confirmation, the waiting state, the result, and a refusal. Use light theme and Dynamic Type default, and also XXXL. Read each screenshot.
- [ ] **Step 4:** Run the full mobile Jest suite and typecheck. **Step 5:** Commit `feat(mobile): Studio agents section and advice screens`.

---

### Task 5: Project docs

**Files:**

- `docs/mobile/overview/<date>-studio-agents.html`, plus its manifest entry, through the `pickler-overview-new` skill;
- this plan's generated HTML (`node scripts/mobile/docs-md-to-html.mjs <plan>`);
- an audit for the executed phase;
- `apps/mobile/AGENTS.md` (the advice module, `authedFetch`, the x402 rules);
- `docs/mobile/04-roadmap-bounty.md` if the product state line changes.

- [ ] Run `npm run docs:check --prefix scripts/mobile` and `npm run agents:check --prefix scripts/mobile`. Look at the overview rendered (desktop and mobile width). Commit `docs(mobile): Studio agents project overview and audit`.

---

### Task 6: Review, PR, and build 13 (gated)

- [ ] Final whole-branch review on the most capable model. Then the full mobile suite, typecheck, `app:tree`, and the root checks the branch touches.
- [ ] Push and open the PR in English against `codex/advice-fee-split` (stacked on #161). Do not merge without the owner.
- [ ] **Acceptance needs the operations of x402 spec §7 and fee-split spec §8:**
  - the splitter deployed;
  - the API with `ADVICE_X402_ENABLED=true`, the relayer, the splitter vars and the advice keys;
  - the agent priced.
- [ ] **Build 13** (`PICKLER_API_URL=https://pickler.fun/api/v1`, `buildNumber` 13, `ios:archive`, `ios:upload`) happens only with the owner's explicit authorization, then the `pickler-dev-new` tracker.

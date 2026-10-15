# Studio agents demo fixes (2026-10-13)

Three fixes found by the owner reviewing the recording of a real x402 payment from the simulator
(Studio agents project, build 13). Specs: `docs/specs/agent-advice-x402-v1.md` (§3.2 step 4 places
Face ID at the payment sheet) and `docs/specs/agent-advice-fee-split-v1.md`. Audit of the previous
phase: `docs/mobile/superpowers/audits/2026-10-12-studio-agents-f1-rulings.md` (Rulings A1–A7).

Tasks 1 and 2 run in worktree `.claude/worktrees/mobile-pay-faceid-activity` (branch
`codex/mobile-pay-faceid-activity`, from `origin/main` cb46367a), PR to `main`, no merge. Task 3 runs
in worktree `.claude/worktrees/advice-local-x402` (branch `codex/advice-local-x402`, local test tool,
never pushed or deployed).

## Global constraints

- Mobile: `npm run typecheck --workspace=@pickler/mobile` and `npm test --workspace=@pickler/mobile`
  from the worktree root must pass. Keep the style of the files (no root ESLint/Prettier in
  `apps/mobile`). No new dependency; `dependency-tree.txt` unchanged.
- Every new test is seen failing against the unfixed code first (TDD), and the report says so with
  the output.
- Commit by path (`git commit -- <paths>`), conventional commits, never `git add -A`. No push.
- The money path keeps every guard of Rulings A1–A7: one Idempotency-Key per Ask, never sign twice
  after a payment went out, the typed data's domain and `payTo` are the app's constants.
- Documentation in English (root rule), except the Spanish record named in the root `AGENTS.md`.
- Secrets (model key, relayer key) are never printed, logged or committed.

## Task 1: "Agent analysis" in Wallet → Activity

The buyer's payment is an AUSD transfer from the wallet to the pinned splitter (`ADVICE_SPLITTER`,
`src/config/advice.ts`). Today `classify` in `apps/mobile/src/wallet/explorer.ts` calls every outgoing
transfer `"Withdrawal"`, so the Activity list reads "Withdrawal −1.50".

- A transfer from the wallet to the splitter (case-insensitive) is a new kind `"Agent analysis"`,
  sign `"-"`. Every other rule stays (faucet → `Faucet`, other outgoing → `Withdrawal`, incoming →
  `Deposit`). With no splitter configured (`null`) nothing changes.
- Keep `explorer.ts` pure (no `expo-constants` import there): pass the splitter in from the caller
  (e.g. an optional parameter of `toMovements`), and wire the caller to `ADVICE_SPLITTER`.
- Check every consumer of `MovementKind`/`Movement.kind` (`pendingMovement`, `splitMovements`,
  `src/screens/wallet.tsx`, `useTreasury`) still compiles and behaves; the row label is the kind.
- Tests in `__tests__/explorer.test.ts` (or `movements.test.ts`): splitter → "Agent analysis" with
  `-`; mixed-case address matches; another outgoing address stays "Withdrawal"; `null` splitter
  keeps "Withdrawal". Seen failing first.
- Update `apps/mobile/AGENTS.md` where it describes Studio agents with one sentence on this.

## Task 2: Face ID at Pay, always

Owner decision 2026-10-13 (reverses the "Face ID stays at Ask" note): tapping "Pay {price} AUSD"
**always** asks for Face ID — a fresh read of the stored passkey PRF (`unlockStoredWallet()` in
`src/wallet/wallet.ts`) — before `signTypedData`, even when the wallet is already unlocked. The
unlock at Ask for the quote (locked wallet) stays as it is.

- In `useAdviceAsk.confirm` (`src/hooks/useAdviceAsk.ts`), the signing wallet comes from a fresh
  `unlockStoredWallet()` call, never from the account's already-open wallet.
- The fresh wallet's address must equal the account's address (case-insensitive); otherwise nothing
  is signed and the flow shows an error (no payment, `idle`-style "nothing charged" semantics as
  any pre-signature failure).
- No stored PRF → the same error path as today's unlock failure; Face ID cancelled → the same as
  today (back to `idle`, nothing signed, next Ask gets a new key).
- Session hygiene: if the account was locked, the fresh wallet becomes the account's (`onUnlock`, as
  today). If the account was already unlocked, do not replace the account's wallet (other hooks hold
  it); sign with the fresh one and end its signing session (`session.end()`) once the signature is
  produced or the step fails.
- The confirmation (`src/screens/advice.tsx`) always shows the Face ID icon on the Pay button and a
  hint line while not busy (e.g. "Face ID confirms this payment."), not only when locked.
- Tests in `__tests__/advice-ask.test.ts` (and the screen test if one covers the hint): with an
  unlocked account, `confirm()` calls the fresh unlock exactly once before the signature, the
  signature comes from the fresh wallet, and the fresh session is ended; address mismatch → no
  signature, no request with `X-PAYMENT`; cancel → idle, no signature; the existing A1/A3 guards
  still pass. Seen failing first against the current code.
- Docs: `apps/mobile/AGENTS.md` ("Where Face ID happens"), the audit (add Ruling A8: owner decision
  2026-10-13, Face ID also at Pay; restate A4/A7 and residuals 4–5 accordingly) and the overview
  `docs/mobile/overview/2026-10-12-studio-agents.html` (wherever it says Face ID stays at Ask).
  Read `docs/mobile/AGENTS.md` before writing there.

## Task 3: a real analysis in the local x402 server

`scripts/advice/local-x402-server.ts` (worktree `advice-local-x402`) answers every paid job with
`cannedResult` ("LOCAL TEST — not a real analysis", always `wait`). The payment is real; the
analysis must be too.

- Generate the result with an OpenAI-compatible chat model configured in `.local-x402/model.env`
  (`MODEL_BASE_URL`, `MODEL_ID`, `MODEL_API_KEY`), read like `.local-x402/env`. Never print, log or
  commit the key; the server's startup log may say the model ID and base URL host only.
- Prefer the production analysis path if it can run locally without a database or deployed
  bindings: `packages/trading/src/features/advice/runner.ts` and
  `packages/agent-runtime/src/composition/advice-model.ts` (policy, prompt, Perpl context). If it
  cannot, call the model directly with current public BTC/ETH data from Perpl via
  `@pickler/perpl-context` (or the public market price) and the same output contract.
- The result must validate against `adviceResultSchema` from `@pickler/api-schema`:
  `orientation` long|short|wait chosen by the model, summary, reasons, risks, limitations, sources
  with real public URLs of the data actually read and their `observedAt`, `dataAsOf` = time of that
  data, `network: "testnet"`.
- If the model or the data fails, or the output does not validate, the job ends `failed` with
  `ANALYSIS_FAILED` — never a fabricated or canned analysis. Remove the "LOCAL TEST" label from the
  result text.
- The agent shows as "Pickler Perps Analyst" (owner's choice); slug `pickler-perps-analyst`; beat
  without "(local test)". The file header keeps saying it is a local test tool, never deployed.
- Without `.local-x402/model.env` the server refuses to start with a clear message (no fallback).
- Tests or a check script: the parser/validator of the model output against a valid sample, an
  invalid sample (→ failed) and a model error (→ failed), runnable without network.

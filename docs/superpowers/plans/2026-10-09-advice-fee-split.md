# Advice x402 fee split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every paid advice analysis settles through `PicklerAdviceSplitter`: one buyer signature,
one transaction, `floor(65%)` to the agent wallet and the rest to Pickler's treasury.

**Architecture:**

- **Contract:** a dependency-free Solidity contract receives an EIP-3009 `ReceiveWithAuthorization` and splits it atomically. The agent wallet is bound into the nonce (`keccak256(abi.encode(payee, salt))`).
- **API:** the phase 1 x402 path keeps its order and its exactly-once guarantees. Only what is signed, verified and sent changes: the recipient is the splitter, the typed data is `ReceiveWithAuthorization`, the nonce must match its derivation, and settlement calls `splitter.settle` and checks three `Transfer` logs.
- **Studio:** the card in PR #127 states the split.

**Tech Stack:** Foundry (Solidity 0.8.30, forge-std), TypeScript core/infrastructure, viem,
PostgreSQL/Drizzle, Hono Worker, Next.js web.

**Spec:** `docs/specs/agent-advice-fee-split-v1.md` (amends `docs/specs/agent-advice-x402-v1.md` D4).

**Base:** branch `codex/advice-fee-split` from `main` 1dddf009 (phase 1 merged). Task 6 works on
`codex/studio-advice-price` (PR #127) in its own worktree.

## Global Constraints

- **Network and asset:** chain 10143. AUSD is `0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC`, 6 decimals, with EIP-712 domain `{ name: "Agora Dollar", version: "1", chainId: 10143, verifyingContract: AUSD }`.
- **Typehash:** `RECEIVE_WITH_AUTHORIZATION_TYPEHASH` = `0xd099cc98ef71107a616c4f0f941f04c322d8e254fe26b3c6668db87aae413de8`, the standard `ReceiveWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)`.
- **Shares:** `CREATOR_BPS = 6500`. The creator gets `value * 6500 / 10000` (floor) and the treasury gets `value - creator`.
- **Nonce:** `nonce = keccak256(abi.encode(address payee, bytes32 salt))`, and `salt` is 32 random bytes.
- **Splitter shape:** no owner, admin, upgrade or retained balance. `asset`, `treasury` and `CREATOR_BPS` are immutable or constant.
- **Wire:** x402 v1 `exact`. `payTo` is the splitter, and `maxAmountRequired` is the full price. `extra` adds `primaryType: "ReceiveWithAuthorization"`, `payee`, `creatorBps: 6500`, `protocolBps: 3500` and `nonceDerivation: "keccak256(abi.encode(payee,salt))"`. `payload.authorization` adds `salt`.
- **Unchanged from phase 1:**
  - payment error codes;
  - the exactly-once guarantees per (user, agent, Idempotency-Key);
  - `SettlementRejected` only for a pre-broadcast failure or a reverted receipt with the nonce unused, everything else `SettlementUnknown`;
  - the 120 s abandonment grace;
  - fail-closed composition when the flag is on but the config is missing.
- **Flag:** `ADVICE_X402_ENABLED` stays `false`.
- **License:** MIT for Pickler's Solidity sources.
- **Secrets:** no key or treasury address is committed or pasted into a chat. The deployer key and the treasury come from the owner's local env file.
- **Repository rules:**
  - one statement per line, Prettier 100 columns, `forge fmt`;
  - update each touched `AGENTS.md`;
  - conventional commits by file name;
  - every new test is seen failing against its defect first.

## Review Focus

1. **A relayer (or anyone) calls `settle` with another `payee`.** The nonce changes, the signature fails, and nothing moves. Test in Task 1.
2. **A price that doesn't split evenly (1 micro-AUSD, 0.100001).** The creator plus the treasury equals the value exactly, and the creator's share is the floor. Test in Task 1 (fuzz) and Task 3 (core shares helper).
3. **A buyer whose app signed the old `TransferWithAuthorization`, or a nonce not derived from the agent wallet.** The answer is `invalid_payment` or `invalid_signature` with nothing settled. Test in Tasks 3 and 4.
4. **A success receipt that lacks one of the three Transfer logs** (e.g. the treasury log). This is `SettlementUnknown`, the row stays pending, and nothing is enqueued. Test in Task 4.
5. **The splitter deployed with a different treasury than the API expects.** Composition fails closed (503) and the log names no value. Test in Task 5.

---

### Task 1: `PicklerAdviceSplitter` and MIT

**Files:**

- Create: `contracts/src/PicklerAdviceSplitter.sol`, `contracts/test/mocks/MockEip3009Token.sol`,
  `contracts/test/PicklerAdviceSplitter.t.sol`, `contracts/test/fork/AdviceSplitterFork.t.sol`,
  `contracts/LICENSE` (MIT, "Copyright (c) 2026 Pickler")
- Modify: every `contracts/src/**/*.sol` SPDX line `UNLICENSED` → `MIT`; `scripts/generate-abi.mjs`
  (`CONTRACTS` gains `"PicklerAdviceSplitter"`); `contracts/AGENTS.md` (the splitter, the license)
- Generated: `npm run contracts:abi` output in `packages/chain`

**Interfaces:**

- Produces:
  - `settle(address from, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 salt, address payee, uint8 v, bytes32 r, bytes32 s) returns (uint256 creatorAmount, uint256 protocolAmount)`;
  - `nonceFor(address payee, bytes32 salt) pure returns (bytes32)`;
  - `asset()`, `treasury()` and `CREATOR_BPS()`;
  - `event AdviceSettled(address indexed from, address indexed payee, bytes32 indexed nonce, uint256 value, uint256 creatorAmount, uint256 protocolAmount)`;
  - errors `ZeroAddress()`, `InvalidPayee()` and `TransferFailed()`.

- [ ] **Step 1: Init submodules** — `git submodule update --init --recursive` (the worktree has none).

- [ ] **Step 2: Failing tests** (`PicklerAdviceSplitter.t.sol`, using `MockEip3009Token`, which implements
      `receiveWithAuthorization` with the real EIP-712 digest over the spec typehash, requires
      `msg.sender == to`, and marks nonces used):
  - `test_splitsOnePointFive`: a value of 1_500_000 gives the payee 975_000 and the treasury 525_000. The event is emitted and the splitter balance ends at 0.
  - `test_edges`: values 100_000, 100_000_000, 1 and 3 each pay `value*6500/10000` to the creator and the remainder to the treasury.
  - `testFuzz_sharesSumToValue(uint256 value)`: with `value` bounded to `1..1e30`, creator plus protocol equals value, and the creator's share equals `value*6500/10000`.
  - `test_otherPayeeFailsSignature`: an authorization signed for payee A and settled with payee B reverts in the token, and no balance changes.
  - `test_replayReverts`: the same authorization twice reverts the second time.
  - `test_invalidPayee`: payee 0, the splitter itself or the treasury gives `InvalidPayee`.
  - `test_constructorZero`: a zero asset or treasury gives `ZeroAddress`.
  - `test_transferFalseReverts`: when the mock's `transfer` returns false, the call reverts with `TransferFailed` and the payer is not debited (revert of the whole call).
  - `test_nonceFor`: `nonceFor` equals `keccak256(abi.encode(payee, salt))`.
  - Run `npm run contracts:test` and expect failure (the contract is missing).

- [ ] **Step 3: Implement**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

interface IEip3009 {
    function receiveWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external;
    function transfer(address to, uint256 value) external returns (bool);
}

/// @notice Receives one EIP-3009 payment for a paid advice analysis and splits it in the same call:
/// the creator's share to the agent wallet the buyer signed for, the rest to Pickler's treasury.
contract PicklerAdviceSplitter {
    uint16 public constant CREATOR_BPS = 6500;
    IEip3009 public immutable asset;
    address public immutable treasury;

    event AdviceSettled(
        address indexed from,
        address indexed payee,
        bytes32 indexed nonce,
        uint256 value,
        uint256 creatorAmount,
        uint256 protocolAmount
    );

    error ZeroAddress();
    error InvalidPayee();
    error TransferFailed();

    constructor(address asset_, address treasury_) {
        if (asset_ == address(0) || treasury_ == address(0)) revert ZeroAddress();
        asset = IEip3009(asset_);
        treasury = treasury_;
    }

    function nonceFor(address payee, bytes32 salt) public pure returns (bytes32) {
        return keccak256(abi.encode(payee, salt));
    }

    function settle(
        address from,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 salt,
        address payee,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external returns (uint256 creatorAmount, uint256 protocolAmount) {
        if (payee == address(0) || payee == address(this) || payee == treasury) revert InvalidPayee();
        bytes32 nonce = nonceFor(payee, salt);
        asset.receiveWithAuthorization(from, address(this), value, validAfter, validBefore, nonce, v, r, s);
        creatorAmount = value * CREATOR_BPS / 10_000;
        protocolAmount = value - creatorAmount;
        if (!asset.transfer(payee, creatorAmount)) revert TransferFailed();
        if (!asset.transfer(treasury, protocolAmount)) revert TransferFailed();
        emit AdviceSettled(from, payee, nonce, value, creatorAmount, protocolAmount);
    }
}
```

- [ ] **Step 4: Fork test** (`AdviceSplitterFork.t.sol`): it is skipped unless `MONAD_TESTNET_RPC_URL` is set, like the existing fork tests. It forks Monad testnet, deploys the splitter against the real AUSD, deals AUSD to a test key, signs a `ReceiveWithAuthorization` with `vm.sign` over AUSD's real `DOMAIN_SEPARATOR()`, settles, and asserts both balances moved and the AUSD `authorizationState` is used.

- [ ] **Step 5: Run** — `npm run contracts:test` passes. Check the suite count includes the new suite (a vanished suite reports as a pass). Then run `forge fmt --root contracts --check`, `forge lint --root contracts`, `npm run contracts:abi` (commit its output) and `npm run contracts:test:fork` (only if `MONAD_TESTNET_RPC_URL` is available; otherwise say so).
      Against the defect, compute the nonce without `payee`: `test_otherPayeeFailsSignature` fails. Restore.

- [ ] **Step 6: Commit** — `feat(contracts): advice splitter pays 65% to the agent and 35% to Pickler`
      and `chore(contracts): license Pickler's contracts under MIT`.

---

### Task 2: Deploy script

**Files:**

- Create: `contracts/script/DeployAdviceSplitter.s.sol`
- Modify: `contracts/AGENTS.md` (deployment section: command, inputs, recording)

- [ ] **Step 1:** Script that reads `ADVICE_SPLITTER_TREASURY` (address) and `AUSD_ADDRESS` (default
      the testnet AUSD) from env, requires `block.chainid == 10143`, deploys with
      `vm.startBroadcast()` (the key comes from `--private-key` or `--account`, never from code),
      and logs the address, the deployment block and `treasury()`.
- [ ] **Step 2:** Dry run against an anvil fork, without `--broadcast` (`forge script ... --fork-url $MONAD_TESTNET_RPC_URL`)
      when the RPC is available. Check it refuses a different chain id.
- [ ] **Step 3: Commit** — `feat(contracts): deploy script for the advice splitter`.

---

### Task 3: Core — wire and checks for the split

**Files:**

- Modify: `packages/core/src/features/advice/x402.ts`, `packages/core/test/advice-x402.test.ts`,
  `packages/core/AGENTS.md`

**Interfaces:**

- `Authorization` gains `salt: string` (`0x` plus 64 hex characters, validated in `decodePaymentHeader`).
- `PaymentRequirements.extra` becomes `{ name: "Agora Dollar"; version: "1"; chainId: 10143; primaryType: "ReceiveWithAuthorization"; payee: string; creatorBps: 6500; protocolBps: 3500; nonceDerivation: "keccak256(abi.encode(payee,salt))" }`.
- `SaleTerms` becomes `{ priceMicro: bigint; payee: string; handle: string }`; the store's `pay_to` read becomes `payee`.
- `createPaidAdvice` deps gain `splitter: string`. `requirementsFor` sets `payTo: splitter` and `extra.payee: terms.payee`.
- `AdvicePaymentGateway` gains `nonceFor(payee: string, salt: string): string`, which hashes in infrastructure. `settle(authorization, signature, payee)` gains `payee`, and returns `{ txHash, blockNumber, creatorAmount: bigint, protocolAmount: bigint }`.
- `AdvicePaymentStore.insertPending` input gains `payee`, and `settled(id, txHash, blockNumber, creatorAmount, protocolAmount)`.
- New pure helper `adviceShares(value: bigint): { creator: bigint; protocol: bigint }` with `CREATOR_BPS = 6500n`.

- [ ] **Step 1: Failing tests** (extend the existing fakes):
  - The 402 has `payTo` = the splitter and `extra` with the exact fields above.
  - `to` ≠ the splitter gives `wrong_recipient`. (The old agent-wallet `to` is refused this way: Review Focus 3.)
  - A missing or malformed `salt` gives `invalid_payment`.
  - When `gateway.nonceFor(payee, salt)` differs from `authorization.nonce`, the answer is `invalid_payment` and neither `signatureValid` nor `settle` is called.
  - `settle` receives the payee, and `store.settled` receives both amounts from the receipt.
  - `adviceShares` gives 1_500_000 → 975_000/525_000 and 1 → 0/1, and a loop over 0..10_000 always sums to the value.
  - Every existing phase 1 test still passes, with its fakes updated.

- [ ] **Step 2: Run, expect failure** —
      `npm run build:shared && node --import tsx --test packages/core/test/advice-x402.test.ts`.
- [ ] **Step 3: Implement**:
  - the nonce check goes right after `staticRefusal` and before `payerLinked`;
  - the order is otherwise unchanged;
  - `encodeSettlement` stays.
- [ ] **Step 4: Run** — the test passes. Against the defect, skip the nonce check: its test fails. Restore.
- [ ] **Step 5: Commit** — `feat(core): advice payments go through the splitter`.

---

### Task 4: Infrastructure — migration 0039, store, gateway

**Files:**

- Modify: `packages/infrastructure/src/persistence/product/advice.ts` (columns `payee`,
  `creator_amount_micro_ausd`, `protocol_amount_micro_ausd`, all nullable for phase 1 rows)
- Generate: `0039_advice_split` with `npm run db:generate`, then format it with Prettier. Check its SQL holds only these three `ADD COLUMN`s.
- Modify: `packages/infrastructure/src/persistence/advice-payments.ts`, `packages/infrastructure/src/chain/ausd-authorization.ts`, the tests `advice-payments.test.ts` and `ausd-authorization.test.ts`, and `packages/infrastructure/AGENTS.md`

- [ ] **Step 1: Failing tests**:
  - **Store:**
    - `saleTerms` returns `payee` (the agent wallet address);
    - `insertPending` stores `payee` lowercased and `pay_to` = the authorization `to` (the splitter) lowercased;
    - `settled` stores both amounts, and `byKey` is unchanged.
  - **Gateway:**
    - `authorizationTypedData` has `primaryType: "ReceiveWithAuthorization"` with the standard six fields. A signature made with `privateKeyToAccount(0x…01)` verifies, and changing `to` breaks it.
    - `nonceFor(payee, salt)` equals viem `keccak256(encodeAbiParameters([{type:"address"},{type:"bytes32"}],[payee,salt]))` and matches the contract's `nonceFor` vector from Task 1. The vector is hard-coded from a `forge test -vv` log line.
    - `settle` simulates and writes `splitter.settle(from, value, validAfter, validBefore, salt, payee, v, r, s)`.
    - Success requires three matching AUSD Transfer logs: from→splitter for value, splitter→payee for the creator share, splitter→treasury for the rest. A receipt missing the treasury log gives `SettlementUnknown` with the hash.
    - The phase 1 classification tests (simulate revert, write error, timeout, reverted receipt with the nonce unused or used) all still pass against the splitter call.
    - The gateway reads `treasury()` from the splitter once (`splitterTreasury()`) for Task 5.
- [ ] **Step 2: Run, expect failure** (real PostgreSQL for the store:
      `TEST_DATABASE_URL=postgresql://pickler:pickler_local_only@127.0.0.1:55432/pickler`).
- [ ] **Step 3: Implement.** Use the generated splitter ABI from `packages/chain` if infrastructure already depends on it; otherwise use a minimal inline ABI, as the gateway does for AUSD.
- [ ] **Step 4: Run** — the tests pass. Against the defect, accept the receipt with only the payee log: the missing-treasury-log test fails. Restore.
- [ ] **Step 5: Commit** — `feat(infrastructure): settle advice payments through the splitter`.

---

### Task 5: API — config, OpenAPI and docs

**Files:**

- Modify: `workers/api/src/env.ts` (`ADVICE_SPLITTER_ADDRESS?: string`,
  `ADVICE_SPLITTER_TREASURY?: string`), `workers/api/src/container.ts` (`paidAdviceFrom`),
  `workers/api/wrangler.jsonc` and `wrangler.staging.jsonc` (both vars empty), `.dev.vars.example`,
  `packages/api-schema/src/advice.ts` (`paymentRequirementsSchema.extra` and the payment payload
  `salt`), `workers/api/test/advice-route.test.ts`, `workers/api/test/container-paid-advice.test.ts`,
  `docs/agent-advice.md` (Payment section: splitter, shares, nonce derivation),
  `workers/api/AGENTS.md`

- [ ] **Step 1: Failing tests**:
  - flag on with the splitter address missing or invalid gives 503 `ADVICE_UNAVAILABLE`, and the log names variables only;
  - flag on where the splitter's `treasury()` differs from `ADVICE_SPLITTER_TREASURY` gives 503 (Review Focus 5);
  - the route's 402 body passes the stricter `paymentRequirementsSchema`, with `payTo` = the splitter and `extra.payee` = the agent wallet;
  - the OpenAPI document shows the new `extra` fields.
- [ ] **Step 2: Implement.** The treasury read-back is cached per isolate. A failed read keeps fail-closed for that request.
- [ ] **Step 3: Run** the brief's files, `npm test`, `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm run check:architecture`, `npm run build:workers` and `npm run api:openapi -- --output <scratch>/openapi.json`.
- [ ] **Step 4: Commit** — `feat(api): compose paid advice with the splitter`.

---

### Task 6: Studio copy on PR #127

**Worktree:** `.claude/worktrees/studio-advice-price` (branch `codex/studio-advice-price`). First
retarget or rebase it onto `main`, since #125 is merged.

**Files:** `apps/web/src/features/studio/live/advice-price-model.ts` and its test,
`apps/web/AGENTS.md`

- [ ] **Step 1: Failing tests**:
  - `adviceShares` mirrored in the web (`value*6500/10000` floor) gives 1.5 → creator "0.975", Pickler "0.525";
  - `walletLine` is "65% to this agent's wallet, 0x1234…abcd · 35% to Pickler.";
  - a new `earnLine` is "You receive 0.975 AUSD per analysis." It is shown only when the form holds a valid price.
- [ ] **Step 2: Implement** the model and render `earnLine` under the price field. Run `npm run design:source` and look at it rendered (`/studio?stage=perpl-limits`, screenshot).
- [ ] **Step 3: Commit** — `feat(studio): the price card states the 65/35 split`. Push, wait for CI, and merge #127 (owner-authorized).

---

### Task 7: Deploy on Monad testnet and record it

**Owner inputs:**

- `~/Documents/pickler/.env.deploy` (untracked, never read into a chat), holding:
  - `DEPLOYER_PRIVATE_KEY`, funded with ~0.5 MON;
  - `ADVICE_SPLITTER_TREASURY`, the treasury EOA;
  - `MONAD_TESTNET_RPC_URL`.
- If the file is missing, stop and ask.

- [ ] **Step 1:** Run the script with `--broadcast` from that env, loading it in the shell; never echo the key.
      Record the address, tx hash, block and `cast code` hash.
- [ ] **Step 2:** Verify on chain: `cast call <splitter> "treasury()"` equals the treasury; `asset()` equals AUSD; `CREATOR_BPS()` is 6500; `cast code` is non-empty.
- [ ] **Step 3:** Add the deployment to `packages/chain/src/deployments.ts`, as a new `PICKLER_MONAD_TESTNET` export with the same `VerifiedDeployment` shape. Add a dated line to `contracts/AGENTS.md` and to the spec §3. Set `ADVICE_SPLITTER_ADDRESS` in `wrangler.staging.jsonc`. The treasury var is public, so set it too.
- [ ] **Step 4: Commit** — `chore(chain): record the advice splitter on Monad testnet`.

---

### Task 8: Review and PR

- [ ] Final whole-branch review on the most capable model. Then the full verification: `contracts:test`, `forge fmt --check`, `contracts:abi` drift, build:shared, typecheck, lint, format:check, check:architecture, `npm test` and build:workers.
- [ ] Push `codex/advice-fee-split` and open the PR to `main` in English. Do not merge without the owner's explicit authorization. `ADVICE_X402_ENABLED` stays off.
- [ ] Checkpoint with the owner, then the phase 3 (app) plan against this wire.

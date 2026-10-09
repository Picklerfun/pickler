# Agent advice x402 fee split v1

Status: proposed 2026-10-09. Amends [agent advice with x402](agent-advice-x402-v1.md) D4 ("`payTo`
is the agent's own wallet … no Pickler fee in v1"), which this document replaces.

## 1. Problem

The team decided that each paid analysis is split: **35% to Pickler, 65% to the agent's creator**.
Phase 1 (PR #125, merged) settles one EIP-3009 `transferWithAuthorization` straight to the agent
wallet, and one authorization can pay only one recipient. The split has to be atomic: the buyer
signs once, and either both parties are paid or nothing moves.

## 2. Decisions

| #   | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Reversible?                       |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| S1  | **A splitter contract receives the payment and splits it in the same transaction.** The buyer signs an EIP-3009 `ReceiveWithAuthorization` whose `to` is the contract `PicklerAdviceSplitter`. Measured on chain 2026-10-09: AUSD on Monad testnet answers `RECEIVE_WITH_AUTHORIZATION_TYPEHASH` = `0xd099cc98ef71107a616c4f0f941f04c322d8e254fe26b3c6668db87aae413de8`. `receiveWithAuthorization` only accepts a call from `to`, so nobody but the splitter can execute the authorization. | per deployment                    |
| S2  | **The agent wallet is bound by the signature.** The authorization's `nonce` is `keccak256(abi.encode(payee, salt))`, where `payee` is the agent wallet and `salt` a random 32 bytes chosen by the buyer's app. The contract recomputes the nonce from the `payee` and `salt` it is called with. A caller who changes `payee` produces a different nonce, and the signature no longer verifies. `settle` can therefore be permissionless.                                                     | yes, until the first client ships |
| S3  | **Shares: the creator receives `floor(value × 6500 / 10000)`, Pickler (the treasury) receives the rest.** Pickler's share is never more than 1 micro-AUSD above 35%. The basis points and the treasury are `immutable`. Changing either means deploying a new splitter and pointing the API at it.                                                                                                                                                                                           | per deployment                    |
| S4  | **No owner, no admin, no upgrade, no balance.** Each call pays out everything it received. The contract never holds AUSD between calls. Tokens sent to it by plain transfer are not credited to anyone, as in `PicklerFeeEscrow`.                                                                                                                                                                                                                                                            | —                                 |
| S5  | **The x402 wire stays v1 `exact`.** `payTo` is the splitter address, and `maxAmountRequired` is the full price. `extra` gains `primaryType: "ReceiveWithAuthorization"`, `payee` (the agent wallet), `salt` derivation and the shares. The payload's `authorization` gains `salt`. We are our own facilitator (x402 spec D5), so the only client that must understand this is the Pickler app.                                                                                               | yes, until the first client ships |
| S6  | **The price the creator sets stays the price the buyer pays.** Studio shows both shares ("You receive 0.975 AUSD · Pickler 0.525 AUSD" for 1.5). The app's confirmation shows the total, plus "65% to the agent, 35% to Pickler".                                                                                                                                                                                                                                                            | yes                               |

## 3. Contract

`contracts/src/PicklerAdviceSplitter.sol`, Solidity 0.8.30, with no new dependency.

```solidity
constructor(address asset_, address treasury_);            // both nonzero; immutable
uint16 public constant CREATOR_BPS = 6500;

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
) external returns (uint256 creatorAmount, uint256 protocolAmount);
// payee != 0, payee != address(this), payee != treasury
// nonce = keccak256(abi.encode(payee, salt))
// asset.receiveWithAuthorization(from, address(this), value, validAfter, validBefore, nonce, v, r, s)
// creatorAmount = value * CREATOR_BPS / 10_000; protocolAmount = value - creatorAmount
// transfer creatorAmount to payee and protocolAmount to treasury; require both return true
// emit AdviceSettled(from, payee, nonce, value, creatorAmount, protocolAmount)

function nonceFor(address payee, bytes32 salt) external pure returns (bytes32);
```

**Tests (Foundry):** use a mock EIP-3009 token with the AUSD semantics: `receiveWithAuthorization` requires
`msg.sender == to`, and a nonce is used once. Cover:

- the split for 1.5 AUSD, 0.10, 100 and an odd micro value;
- the sum is always `value` (fuzz);
- a changed `payee` fails verification;
- a replayed nonce reverts;
- a zero or self `payee` reverts;
- a token whose `transfer` returns false reverts the whole call;
- the contract balance is 0 after every call (invariant).

A fork test on Monad testnet, gated by `MONAD_TESTNET_RPC_URL` like the existing ones, settles a real AUSD `ReceiveWithAuthorization` signed by a test key.

**Deployment** is the first Pickler contract on chain. It is explicit, never a side effect of a build:

- a `contracts/script/` deploy script;
- an entry in `packages/chain` (address, block, code hash), recorded the way `deployments.ts` records verified contracts;
- the generated ABI.

The repository's contract license is still the `UNLICENSED` placeholder, and `contracts/AGENTS.md` says to choose a real license before anything is deployed (§8).

## 4. API changes (on top of phase 1)

- **Config:** `ADVICE_SPLITTER_ADDRESS` (Worker var) and the treasury it was deployed with, read back from the contract at composition and logged without values on mismatch. A missing splitter fails closed like a missing relayer (phase 1 Ruling 24).
- **Requirements (402):**
  - `payTo` = the splitter;
  - `extra = { name: "Agora Dollar", version: "1", primaryType: "ReceiveWithAuthorization", payee: <agent wallet>, creatorBps: 6500, protocolBps: 3500, nonce: "keccak256(abi.encode(payee, salt))" }`.
- **Verification**, before any gas is spent, adds to phase 1's checks:
  - `to` equals the splitter;
  - the payload's `salt` is 32-byte hex;
  - `nonce == keccak256(abi.encode(payee, salt))` with the agent's current wallet;
  - the signature recovers `from` for the `ReceiveWithAuthorization` type.

  Keccak lives in the gateway (infrastructure), not in core. A wrong derivation is `invalid_payment`.

- **Settlement:** the gateway simulates and then sends `splitter.settle(...)` instead of `asset.transferWithAuthorization(...)`. Success requires `status: success` and three matching AUSD `Transfer` logs in the receipt:
  - `from → splitter` for `value`;
  - `splitter → payee` for the creator share;
  - `splitter → treasury` for the rest.

  Phase 1's classification is unchanged. `SettlementRejected` applies only to a pre-broadcast failure or a reverted receipt whose nonce is unused. Everything else is `SettlementUnknown`.

- **Data:** migration `0039` adds `payee text`, `creator_amount_micro_ausd bigint` and `protocol_amount_micro_ausd bigint` to `pickler.advice_payments`. `pay_to` becomes the splitter. Settled rows record both amounts from the receipt.
- **A third party may relay the same signed authorization** (S2 makes `settle` permissionless). The money still goes to the right payee and treasury. Our row then sees a used nonce, stays `pending`, and is reconciled by its tx. This is the same path as phase 1's unknown outcome.

## 5. Studio and app

- **Studio card (PR #127, held for this):**
  - "65% to this agent's wallet (0x…), 35% to Pickler."
  - The tag stays "FOR SALE · 1.5 AUSD".
  - A line under the price: "You receive 0.975 AUSD per analysis."
  - The web computes the creator share with the same floor rule (display only).
- **App (phase 3):**
  - builds `ReceiveWithAuthorization` typed data from the 402;
  - generates `salt` with the platform's secure random;
  - derives the nonce with viem's `keccak256(encodeAbiParameters(...))`;
  - shows the total and the two shares before Face ID.

  No new dependency.

## 6. Order of work

1. **Contract:** source, tests, fork test, deploy script. Deployment waits for the owner (§8).
2. **API:** the phase 1 path switched to the splitter, behind the same `ADVICE_X402_ENABLED` (still off), plus migration 0039.
3. **Studio copy:** in PR #127, then merge.
4. **Phase 3 (app):** planned against this wire.

Steps 1 and 2 can be one PR. Acceptance (x402 spec §9) gains:

- the buyer's AUSD drops by the price;
- the agent wallet rises by `floor(65%)`;
- the treasury rises by the rest;
- this happens in one transaction.

## 7. Out of scope

Configurable or per-agent fees, fee changes without redeploying, refunds, a creator claim/escrow
flow (shares go straight to the wallets), and mainnet.

## 8. Owner decisions needed before deployment

1. **Treasury address** on Monad testnet: an EOA or a multisig, and who holds it.
2. **Contract license** to replace `UNLICENSED` (`contracts/AGENTS.md` requires one before anything is deployed).
3. **Who deploys**, and authorization to deploy on Monad testnet. The deployer pays a little MON; the relayer key can deploy.
4. **Bounty timing:** the deadline is 2026-10-13 21:59 CST. The contract and API need about 1.5 days, and the app about 1.5 days. Does the bounty build need the split, or can it ship 100%-to-creator with the split right after?

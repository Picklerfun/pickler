# Launchpad deploy v1: a deployable factory and an indexer that fills the catalogue

Status: Draft — decided autonomously 2026-09-30. Follows `docs/product-map/conventions.md`
(decisions 5 and 6). Every decision below is reversible until the first mainnet deployment; the
contract changes are reversible only by redeploying, which is free on testnet.

Companion specs: `token-launch-v1.md` (the studio flow that calls the factory),
`token-trading-v1.md` (buying and selling on the curve). This spec owns everything they stand on:
the contract change, the deployment, the manifest and the indexer.

## 1. Problem and users

The launchpad contracts are written and tested offline (107 tests) and on a Monad testnet fork
(11 tests), but nothing is deployable or deployed (`docs/product-map/research/03-launchpad.md` §1):

- **The factory accepts any `agentKey`.** `createLaunch` checks only that the key is non-zero and
  unused (`contracts/src/PicklerLaunchFactory.sol:153-158`) and that the _creator_ authorized the
  params (`:258-276`). Nothing binds the key to an agent Pickler knows or to the agent's owner, so
  anyone can squat an agent's key first. Conventions decision 5 requires a Pickler-signed
  authorization.
- **The metadata URI never reaches the chain's logs.** `LaunchCreated` carries only
  `metadataHash` (`PicklerLaunchFactory.sol:74-82`), so the indexer cannot recover the image.
- **The launch fee is declared and never charged** (`contracts/src/libraries/PicklerPreset.sol:31`).
- **No licence** (`SPDX-License-Identifier: UNLICENSED`, `PicklerLaunchFactory.sol:1`;
  `contracts/AGENTS.md:27`), **no review, no deploy script** (`contracts/script/` is empty),
  **no custody** for the deployer, operator, treasury and fee recipient, and **no Pickler address**
  in `packages/chain` (`packages/chain/src/deployments.ts:11`).
- **The indexer indexes only the factory and never projects.** `workers/indexer/src/index.ts:68-80`
  runs `runIndexerPass` for one address and no projector; its config has no Hyperdrive and no
  factory (`workers/indexer/wrangler.jsonc`). The projector writes `agentId: null`, derives the
  ticker from the on-chain symbol and hardcodes `quoteDecimals: 6`
  (`packages/infrastructure/src/persistence/product/launch-projector.ts:134-144`). The PR #37
  integration fixes that composed the projector, discovered curves and made projection atomic
  live only on `codex/rescue-launchpad-integration-fixes` (`fcfe750..6463181`).

Users: the Pickler operator (deploys, publishes presets, can suspend), agent owners (launch through
`token-launch-v1`), buyers and the public catalogue (`/tokens`, through `token-trading-v1`).

## 2. Decisions

| #   | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Reason                                                                                                                                                                                                      | Reversible?                                                 |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| D1  | **The factory requires a launch grant signed by Pickler's launch authority**, an EIP-712 `LaunchGrant` over `agentKey`, `creator`, `creatorFeeRecipient`, the params hash, a grant nonce and a deadline. No grant, no launch.                                                                                                                                                                                                                             | Conventions decision 5. A signed grant binds the agent key to the creator without putting Pickler's agent ids or a registry on chain, and lets the API check eligibility (public agent, once, ticker free). | Yes, by redeploying the factory with a permissionless mode. |
| D2  | **`agentKey = keccak256(abi.encode("pickler.agent.v1", chainId, agentUuid))`**, computed by the API; the chain never sees the uuid.                                                                                                                                                                                                                                                                                                                       | Deterministic, per-chain, not reversible to our identifiers without the uuid; the grant is what binds it.                                                                                                   | Yes before first launch; after it, existing keys stay.      |
| D3  | **The launch authority is a secp256k1 key held in Pickler's parent Turnkey organization** (`Pickler launch authority`), signed from `workers/api` with the parent API key. Its address is a factory storage variable the operator can rotate (`setLaunchAuthority`, event `LaunchAuthorityChanged`).                                                                                                                                                      | No raw key in a Worker secret; rotation without a redeploy if the key leaks. Rotating only gates new launches, which the operator can already stop.                                                         | Yes.                                                        |
| D4  | **The creator calls `createLaunch` directly** from the owner's studio master wallet (passkey), so the creator authorization is `msg.sender`; the creator EIP-712 path stays for third-party submitters.                                                                                                                                                                                                                                                   | One passkey prompt instead of two (signature plus relay). `token-launch-v1` §3.                                                                                                                             | Yes.                                                        |
| D5  | **`LaunchCreated` gains `string metadataURI` and `string symbol`**, and the factory enforces `symbol` matches `^[A-Z][A-Z0-9]{1,5}$`.                                                                                                                                                                                                                                                                                                                     | The indexer recovers the image and the ticker from the log; an on-chain symbol that could never be a Pickler ticker is refused at the source, not at projection (`market.ts:87`).                           | Yes (redeploy).                                             |
| D6  | **The launch fee is charged**: when `preset.launchFee > 0`, `createLaunch` pulls it in the quote token from `msg.sender` to an immutable `launchFeeRecipient` (the treasury). The testnet preset sets it to **0**.                                                                                                                                                                                                                                        | A declared field that does nothing is a trap; zero on testnet keeps the first launch one transaction.                                                                                                       | Yes (a new preset version).                                 |
| D7  | **Licence: `BUSL-1.1`** with a change date of 2030-09-30 converting to `GPL-2.0-or-later`, for every file in `contracts/src`. Tests and scripts are `MIT`.                                                                                                                                                                                                                                                                                                | The Uniswap V4 periphery the adapter builds on sets the precedent; protects the design for a period and becomes open afterwards. §12 asks the owner to confirm.                                             | Yes, before mainnet.                                        |
| D8  | **Independent review before mainnet, not before testnet.** Testnet deploys after the internal review checklist (§9) passes; mainnet requires an external audit report committed under `docs/audits/`.                                                                                                                                                                                                                                                     | Testnet holds no value; `launchpad-monad-v1.md:155` already makes review a mainnet gate.                                                                                                                    | Yes.                                                        |
| D9  | **Roles**: deployer = a fresh EOA per deployment, emptied after; operator = a Safe 2-of-3 on each chain (testnet may use a 1-of-2 Safe); treasury and launch-fee recipient = one Safe 2-of-3 "Pickler treasury"; locker fee recipient = the same treasury Safe; launch authority = D3.                                                                                                                                                                    | The operator is immutable and can suspend creation forever (`PicklerLaunchFactory.sol:91,137`), so no laptop key. A deployer that is emptied after `escrow.initialize` has no lasting power.                | Operator: no (immutable) without redeploy; the others yes.  |
| D10 | **Testnet graduation venue: the Monad-maintained Uniswap V4 on 10143**, labelled "testnet venue, maintained by Monad" everywhere it appears, fee tier 1% / spacing 200 as measured.                                                                                                                                                                                                                                                                       | Option 3 of `docs/market/uniswap-v4-spike.md:29-35`: cheapest, and the demo completes; nothing about it is described as a mainnet rehearsal.                                                                | Yes (a new adapter and factory).                            |
| D11 | **Quote asset: AUSD** on both networks (`packages/chain/src/networks.ts:62-80`).                                                                                                                                                                                                                                                                                                                                                                          | The studio already moves AUSD; the curve math is written for 6-decimal quotes.                                                                                                                              | Yes (a new preset).                                         |
| D12 | **Indexer v2 rebases the rescued PR #37 commits**, cherry-picking the ten code commits of `fcfe750..6463181` onto main and dropping `7896163` (a stale `0012_snapshot.json`) and `c8333a4` (lockfile).                                                                                                                                                                                                                                                    | Conventions decision 6: rebased, not rewritten. The work is tested (`workers/indexer/test/pipeline.test.ts`, 157 lines).                                                                                    | Yes.                                                        |
| D13 | **Attribution through a new `launch.agent_keys` table and `market.tokens.agent_key`.** The API writes `(agent_id, chain, agent_key)` when the owner's draft is validated (`token-launch-v1.md`, the same moment the ticker is reserved; cross-review C19), and the grant route requires that row; the projector joins on it to fill `agent_id`. A launch with no matching row is still projected, with `agent_id` null, and hidden from the public board. | A grant-gated factory means every legitimate launch has a row; the chain stays the source of truth for existence (`market.ts:45-52`).                                                                       | Yes.                                                        |
| D14 | **The indexer covers holders, candles and fee payouts in v2**, projected from `Transfer`, `CurveBought/Sold`, V4 `Swap` by `poolId`, and escrow `FeeAccrued/FeeClaimed`.                                                                                                                                                                                                                                                                                  | `token-trading-v1` needs them; the tables already exist (`market.ts:200,233,254`).                                                                                                                          | Yes.                                                        |
| D15 | **The outbox gets one producer and one consumer**: the projector writes `token.launched`, `token.graduated`, `trade.recorded`; a consumer in `workers/api` (Queue `launch-events`) moves the matching `launch.drafts` row to `launched` and invalidates caches.                                                                                                                                                                                           | The table exists without either (`0015_reflective_sunset_bain.sql:39-54`); the studio needs "launched" from a receipt-confirmed log, not from a hash.                                                       | Yes.                                                        |
| D16 | **Finality: `CONFIRMATIONS=3` on 10143 after measurement**, starting at 5 (the current guess, `workers/indexer/wrangler.jsonc`) until the §9 measurement records reorg depth over 72 h.                                                                                                                                                                                                                                                                   | `launchpad-monad-v1.md` §11 makes it a measured number.                                                                                                                                                     | Yes (a var).                                                |

## 3. User flows

### 3.1 Operator: testnet deployment (once)

1. The internal review checklist (§9.1) is green on a tagged commit.
2. The operator creates the deployer EOA locally (`cast wallet new`, key never committed), funds it
   with 2 MON from the testnet faucet.
3. `DeployLaunchpad.s.sol` runs against 10143 (§6.2) in dry-run, then with `--broadcast`, with
   `--verify` for Sourcify and the Monad explorer.
4. `PublishPreset.s.sol` prints the preset calldata; the operator Safe proposes and executes
   `publishPreset` for preset `1` version `1`.
5. `npm run chain:record -- --chain 10143 --broadcast contracts/broadcast/...` writes
   `packages/chain/src/deployments/pickler-10143.ts` (§5.3) and the operator commits it on a
   `codex/` branch with the explorer links.
6. The deployer's leftover MON is sent to the treasury Safe; the deployer key is destroyed.
7. The indexer vars are set (§6.4) and the indexer is deployed; `npm run check:staging` passes.

### 3.2 Operator: suspend, rotate, publish

- **Suspend new launches**: the operator Safe calls `setLaunchesEnabled(false)`. Trading continues.
  The studio reads `launchesEnabled` and shows "Launches are paused by Pickler".
- **Rotate the launch authority**: create a new Turnkey key, then the Safe calls
  `setLaunchAuthority(new)`; the API's `LAUNCH_AUTHORITY_ADDRESS` is updated in the same change.
  Grants signed by the old key and not yet submitted fail with `InvalidGrant` and the studio
  re-prepares.
- **New economics**: `publishPreset` with a new version. Launches already made keep their preset.

### 3.3 Indexer pass (every minute)

For each configured chain: advance the factory stream, discover curves from `LaunchCreated`,
fetch curve, adapter and escrow logs in the same range, fetch token `Transfer` logs for known tokens
and V4 `Swap` logs for known `poolId`s from their graduation block; write blocks, events, cursors
and outbox atomically; then project events to `market.*` inside one transaction under an advisory
lock (rescued `launch-projector.ts` shape); then publish pending outbox rows to the queue.

## 4. API

The public reads that exist stay (`workers/api/src/launches/routes.ts:18-66`). This spec adds
internal and operator routes only; the studio and marketplace routes are in the companion specs.

| Method | Path                                 | Auth                                       | Request                                         | Response                                                                                            | Errors                                                                      |
| ------ | ------------------------------------ | ------------------------------------------ | ----------------------------------------------- | --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| GET    | `/v1/marketplace/launchpad`          | none                                       | —                                               | `{ data: { chainId, factory, launchesEnabled, presets: PresetDto[], venue: VenueDto, freshness } }` | 503 `LAUNCHPAD_NOT_DEPLOYED`                                                |
| POST   | `/v1/internal/launch/grants`         | service binding (from the studio use case) | `{ agentId, ownerId, params: LaunchParamsDto }` | `{ grant: hex, grantNonce, deadline, agentKey }`                                                    | 403 `LAUNCH_NOT_ELIGIBLE`, 409 `TICKER_TAKEN`, 409 `AGENT_ALREADY_LAUNCHED` |
| POST   | `/v1/internal/launch/outbox/deliver` | service binding (Queue consumer)           | `{ ids: uuid[] }`                               | `{ delivered, failed }`                                                                             | —                                                                           |
| GET    | `/v1/internal/launch/indexer/health` | service binding                            | —                                               | per stream: cursor, head, lag blocks, last projected block, outbox backlog                          | —                                                                           |

`POST /v1/internal/launch/grants` is never public: it is called in-process by the
`prepareLaunch` use case (`token-launch-v1` §4). It is listed because it is the only place the
launch authority signs, and its preconditions are the security boundary:

1. The agent exists, `ownerId` owns it, and it is public (went through Go Public, `go-public-v1.md`).
2. The `launch.agent_keys` row written at validate exists for this agent and chain, its key equals
   `params.agentKey`, and no token on this chain carries that key.
3. The ticker is reserved for this agent in `market.tokens` (`status = 'reserved'`).
4. `params.creator` and `params.creatorFeeRecipient` equal the owner's master wallet address.
5. `params.metadataHash` equals the `launch.metadata_versions` row the draft validated.
6. `presetId/version` is published and enabled in `launch.presets`, and `expectedConfigHash` matches.

DTOs in `packages/api-schema/src/launches.ts` (decision): `PresetDto`, `VenueDto`,
`LaunchParamsDto`, `LaunchGrantDto`.

## 5. Data model and migrations

### 5.1 Migration `launchpad_attribution` (number assigned at build time; next free is 0023)

- `CREATE TABLE launch.agent_keys (agent_id uuid NOT NULL REFERENCES agents.agents(id) ON DELETE
RESTRICT, chain text NOT NULL, agent_key text NOT NULL, created_at timestamptz NOT NULL DEFAULT
now(), PRIMARY KEY (agent_id, chain), UNIQUE (chain, agent_key))`, checks on chain and
  `^0x[0-9a-f]{64}$`, RLS on, `service_role` grants like `0016_launch_grants.sql:9-18`. `chain` is
  `text` in the CAIP-2 form `eip155:<id>`, the convention every `launch.*` and `market.*` table
  already uses (`0015_reflective_sunset_bain.sql:19`), not the `chain_id integer` of newer schemas
  (cross-review D10).
- `CREATE TABLE launch.grants (grant_nonce numeric(78,0) PRIMARY KEY, agent_id uuid NOT NULL,
draft_id uuid NOT NULL REFERENCES launch.drafts(id), creator text NOT NULL, params_hash text NOT
NULL, deadline timestamptz NOT NULL, signed_at timestamptz NOT NULL DEFAULT now(), consumed_tx
text)`: the audit record of every signature the authority made.
- `ALTER TABLE market.tokens ADD COLUMN agent_key text` with the same format check, and
  `ADD COLUMN metadata_uri text`, `ADD COLUMN description text` (≤ 280 chars).
- No new pool column: `market.pools.pool_key` already holds a 32-byte V4 `PoolId` (`market.ts:123,133`),
  which is what the `v4-swaps` stream filters on.
- `market.indexer_cursors`: one row per stream name; new stream names are data, not schema
  (`launches`, `curves`, `adapter`, `escrow`, `transfers`, `v4-swaps`).

### 5.2 Projector fixes (code, `launch-projector.ts`)

| Today                                                    | v2                                                                                                                                                                                                                                                                                                                                                                                      |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agentId: null` (`:136`)                                 | Join `launch.agent_keys` on `(chain, agent_key)`; null only when no row, and such a token gets `status` as usual but `listed=false` in the read model.                                                                                                                                                                                                                                  |
| Ticker from `symbol().toUpperCase().slice(0,7)` (`:137`) | Ticker from the `symbol` in `LaunchCreated` (D5), prefixed `$`. If it collides with a reservation held by another agent, the token is projected with ticker `$X` + the first 5 hex of the address and unlisted; the collision is logged as an alert. The factory's grant rule makes this unreachable for granted launches.                                                              |
| `quoteDecimals: 6` (`:144`)                              | Read `decimals()` of the quote token once per token via the metadata reader, cached in the row.                                                                                                                                                                                                                                                                                         |
| No image                                                 | `metadata_uri` from the log; the projector does not fetch it (no network in the transaction). The read model resolves the image from `launch.metadata_versions` by `metadata_hash`.                                                                                                                                                                                                     |
| No preset mirror                                         | `PresetPublished` → `launch.presets` (`0015_reflective_sunset_bain.sql:57-77`): the projector reads the published preset with `getPreset(presetId, version)` at the event's block (before the transaction, like token metadata) and upserts the row with its config hash, quote address, allocations and `published_block`. This spec owns the mirror; `token-launch-v1` only reads it. |
| No holders, candles, fee payouts                         | `Transfer` → `market.holders` (balance deltas; the curve, adapter, locker and PoolManager are excluded from holder counts); trades → `market.candles` 5m/1h/4h/1d upserts (OHLC in quote per whole token, volume in quote base units); `FeeAccrued/FeeClaimed` → `market.fee_payouts`.                                                                                                  |
| No reorg unwinding                                       | The rescued transaction deletes and rebuilds projections for orphaned events (rescued `launch-projector.ts` diff, `delete from market.trades ... not exists`); candles and holders are recomputed for affected tokens from `market.trades` and non-orphaned `Transfer` events.                                                                                                          |

### 5.3 `packages/chain` deployments manifest

A new file per chain, `packages/chain/src/deployments/pickler-<chainId>.ts`, exporting
`PICKLER_LAUNCHPAD[chainId]: { version: "1.0.0", deployedAt, deployer, operator, treasury,
launchAuthority, contracts: { feeEscrow, graduationAdapter, liquidityLocker, curveDeployer,
launchFactory }: VerifiedDeployment, presets: [{ presetId, version, configHash }], venue:
"monad-v4-testnet" | "uniswap-v4" }`. `VerifiedDeployment` already carries address, deployment
block, code hash and size (`deployments.ts:13-18`); each entry also records `abiHash` from
`scripts/generate-abi.mjs`. A test asserts every code hash against the committed ABI build and that
`deployments.ts:11`'s comment is updated. `packages/chain/AGENTS.md` is updated in the same change.

## 6. Integrations

### 6.1 Contract changes (`contracts/src/PicklerLaunchFactory.sol`)

```solidity
struct LaunchGrant { bytes32 agentKey; address creator; address creatorFeeRecipient;
                     bytes32 paramsHash; uint256 grantNonce; uint256 deadline; }
bytes32 constant LAUNCH_GRANT_TYPEHASH = keccak256("LaunchGrant(bytes32 agentKey,address creator,address creatorFeeRecipient,bytes32 paramsHash,uint256 grantNonce,uint256 deadline)");

address public launchAuthority;                 // settable by operator
address public immutable launchFeeRecipient;    // constructor
mapping(uint256 grantNonce => bool) public grantUsed;

function createLaunch(LaunchParams calldata params, bytes calldata creatorAuthorization,
                      uint256 grantNonce, uint256 grantDeadline, bytes calldata grant)
    external returns (address token, address curve);
function setLaunchAuthority(address next) external onlyOperator;   // emits LaunchAuthorityChanged
function grantDigest(LaunchParams calldata params, uint256 grantNonce, uint256 grantDeadline)
    external view returns (bytes32);

error InvalidGrant(); error GrantExpired(); error GrantAlreadyUsed(); error InvalidSymbol();
event LaunchCreated(address indexed token, address indexed curve, bytes32 indexed agentKey,
    address creator, address quoteToken, bytes32 presetHash, bytes32 metadataHash,
    string symbol, string metadataURI);
```

Order inside `createLaunch`: suspended → zero key → already launched → symbol format → grant
(deadline, nonce unused, `SignatureChecker.isValidSignatureNow(launchAuthority, digest, grant)`,
mark used) → creator authorization (existing `_authorize`) → preset hash → launch fee
(`safeTransferFrom(msg.sender, launchFeeRecipient, fee)` when non-zero) → deploy. The grant's
`paramsHash` is the existing `_paramsHash` (`PicklerLaunchFactory.sol:288-300`), so the grant
commits to name, symbol, URI, metadata hash and preset. The EIP-712 domain stays
`("Pickler", "1")`; the version bumps to `"2"` because the struct set changed.

Tests (Foundry, `contracts/test/PicklerLaunchFactory.t.sol`): impersonation (a grant for creator A
submitted by B with B as creator fails), replay (same grant nonce twice), expiry, wrong authority,
rotated authority, symbol format table, launch fee pulled exactly and only when non-zero, a
`LaunchCreated` decode that includes URI and symbol, and the invariant "factory holds no tokens and
no quote after any call". ABI regeneration via `scripts/generate-abi.mjs`; the drift check in
`.github/workflows/contracts.yml` catches a stale ABI.

### 6.2 Deploy script (`contracts/script/DeployLaunchpad.s.sol`)

Reads `contracts/script/config/<chainId>.json` (committed, no secrets): pool manager, position
manager, state view, permit2 (each with expected code hash from `deployments.ts`), operator,
treasury, launch authority, locker fee recipient. The fixed order (`contracts/AGENTS.md:23`):

1. Assert `block.chainid` matches the config and every external address's `extcodehash` matches.
2. `FeeEscrow(treasury)`.
3. `GraduationAdapterV4(poolManager, positionManager, stateView, permit2, lockerFeeRecipient)`,
   which deploys the locker; read `locker()`.
4. `CurveDeployer(adapter, escrow)`.
5. `LaunchFactory(operator, curveDeployer, launchAuthority, launchFeeRecipient)`.
6. `escrow.initialize(factory, locker)` from the deployer.
7. Post-conditions asserted in the script: escrow initialized, factory `operator` and
   `launchAuthority` as configured, `launchesEnabled == true`, no presets yet.

`contracts/script/PublishPreset.s.sol` encodes preset `1/1` from `contracts/script/presets/<chainId>-1-1.json`
and prints Safe calldata; it never broadcasts. `contracts/script/RecordDeployment.mjs` (run by
`npm run chain:record`) turns `broadcast/*/run-latest.json` into the manifest file and re-reads
every code hash from RPC.

### 6.3 Keys and env vars

| Name                                                        | Where                                                                                                                                                      | Holds                                                                             |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `LAUNCH_AUTHORITY_TURNKEY_KEY_ID`                           | `workers/api` secret                                                                                                                                       | The Turnkey private-key id of the launch authority in the parent org              |
| `LAUNCH_AUTHORITY_ADDRESS`                                  | `workers/api` var                                                                                                                                          | Its address, checked against the factory's `launchAuthority()` at boot            |
| `LAUNCH_GRANT_TTL_SECONDS`                                  | `workers/api` var, default 1800                                                                                                                            | Grant deadline                                                                    |
| `LAUNCH_FACTORY_ADDRESS`, `LAUNCH_FACTORY_DEPLOYMENT_BLOCK` | `workers/indexer` vars (exist, `workers/indexer/src/index.ts:17-18`)                                                                                       | From the manifest; the start block is the factory's deployment block, never "now" |
| `DATABASE` Hyperdrive binding                               | `workers/indexer`                                                                                                                                          | Same trusted binding as api/research (root `AGENTS.md:107-114`)                   |
| `RPC_URLS` / `MONAD_RPC_URL`                                | `RPC_URLS` on `workers/indexer` (exists); the API uses the shared `MONAD_RPC_URL` and `CHAIN_ID` of `production-environment-v1.md` (cross-review C22, C23) | A paid Monad testnet RPC first, public RPC second                                 |
| `LAUNCH_EVENTS_QUEUE`                                       | indexer producer, api consumer                                                                                                                             | Outbox delivery                                                                   |

The deployer key, the Safe signers and Turnkey credentials are never in the repository or in CI.

### 6.4 Indexer deployment

- Rebase: cherry-pick `88c8e11 a624d32 fd39bc9 45810b1 a88057f aee7ab4 b70f1e5 542b317 7817d1b
616dcf7 a087200 a7e533c 6463181` (and `3477073` for the infrastructure `AGENTS.md`) onto main;
  resolve against the renamed persistence modules; regenerate nothing under `drizzle/meta` by hand.
  The rescued `migration-history.test.ts` change is re-derived for 0023+.
- `workers/indexer/wrangler.jsonc` gains the Hyperdrive id, factory vars and the queue producer,
  and a production twin is added by the production-environment work (conventions decision 9).
- `scripts/check-staging.mjs` gains the indexer config: `workers_dev: false`, no routes, the
  Hyperdrive binding present, factory address and block present and equal to the manifest,
  `CHAIN_ID` equal to the manifest's chain. Today it reads only api, research and trading
  (`scripts/check-staging.mjs:15-17`).
- Concurrency: the pass takes `pg_try_advisory_lock('launch-indexer:<chain>')` and exits if held,
  so an overlapping Cron invocation never runs two passes.

## 7. Design work

Mostly back-office; two surfaces need drawing.

| Surface | Screen                                                                       | States                                                      | Canvas                                                                                                           |
| ------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Web app | `/tokens` board footer "Indexed to block N"                                  | fresh, stale (> 60 s), paused launches, testnet venue label | Exists (LaunchBoard, `launch-board.tsx:21-95`); add the venue label and the paused banner to the existing canvas |
| Studio  | Token section "Launches paused" and "Launchpad not deployed on this network" | two empty states                                            | Must be drawn, on the studio Token canvas that `token-launch-v1` §7 commissions                                  |

No operator console is built; operator actions go through the Safe UI and scripts.

## 8. Security and abuse

- **Squatting**: closed by D1; test in §6.1.
- **Authority compromise**: an attacker could grant launches for arbitrary agent keys, but only
  for tickers and keys that are unused; the operator rotates (§3.2) or suspends. Every grant is
  logged in `launch.grants`; a daily check in `workers/ops` (conventions decision 15) compares consumed grants against `LaunchCreated` and
  alerts on any launch without a grant row.
- **Grant replay across chains**: the domain includes `chainId` and the factory address.
- **Front-running a granted launch**: the grant names the creator; a submitter other than the
  creator needs the creator's own EIP-712 authorization too.
- **Pre-initialized V4 pool**: already mitigated in the adapter by the pre-flight price check
  (`uniswap-v4-spike.md`, "A pre-initialized pool is detectable").
- **Indexer poisoning**: logs are accepted only from the factory, curves discovered from factory
  logs, the adapter discovered from curve logs (rescued `launch-indexer.ts` diff), and `Swap` only
  for recorded `poolId`s.
- **Operator key**: a Safe; its signers are listed in the private runbook, not in the repository.

## 9. Acceptance criteria and tests

### 9.1 Internal review checklist (testnet gate)

- Foundry suite green including the new factory tests; `forge fmt --check`, `forge lint`.
- Slither run with no high findings unaddressed; results committed in `docs/audits/internal-2026-10.md`.
- Written threat model covering the factory, curve, adapter, locker and escrow.
- The curve parity fixture still matches (`contracts/test/CurveVectors.t.sol`).

### 9.2 Deployment

- The script's post-conditions pass; all five contracts verified on Sourcify and the Monad
  explorer; the manifest test passes against RPC.
- A throwaway agent on staging launches through `token-launch-v1`, and within 3 minutes
  `/v1/launches/:id` shows the token with its agent, image and correct quote decimals.

### 9.3 Indexer

- Rescued `workers/indexer/test/pipeline.test.ts` passes on main.
- New integration tests against a scripted chain: holders after buys, sells and transfers; candles
  across a bucket boundary; a two-block reorg that orphans a trade and a transfer and leaves
  holders and candles exactly as recomputed; a graduation followed by V4 swaps.
- Finality measurement: a 72 h log of observed reorg depth on 10143 committed to
  `docs/market/monad-finality-2026-10.md`, and `CONFIRMATIONS` set from it (D16).
- `npm run check:staging` fails when the indexer's factory var differs from the manifest.

### 9.4 Mainnet gate (not in v1's delivery, listed so it is not forgotten)

External audit, approved economics, mainnet V4 addresses in `deployments.ts`, the no-admin-recovery
acceptance and the MEV posture (`launchpad-monad-v1.md:161-172`).

## 10. Rollout and dependencies

1. Contract change + tests + licence (no dependency).
2. Internal review (§9.1).
3. Indexer v2 rebase and projector fixes, tested locally against anvil (parallel with 1).
4. Migration `launchpad_attribution` applied to staging.
5. Testnet deployment, manifest commit, indexer deployment.
6. `token-launch-v1`, then `token-trading-v1`.

Depends on: `go-public-v1.md` (the public-agent state the grant checks); `production-environment-v1.md`
for the production indexer config and the launch-authority secret; `launchpad-monad-v1.md` for the contract
design it amends.

## 11. Out of scope

Mainnet deployment; a permissionless launch mode; our own V4 deployment; an operator web console;
metadata updates after launch (the `metadata_versions` table allows it, nothing writes a second
version in v1); anti-snipe and MEV protections beyond the curve's slippage and deadline.

## 12. Open questions for the owner

1. **Licence**: is `BUSL-1.1` converting to `GPL-2.0-or-later` in 2030 acceptable, or do you want
   `MIT`/`GPL` from day one, or proprietary?
2. **Preset numbers for mainnet** (supply, sale/LP split, virtual reserves, fees, protocol share,
   launch fee). Testnet uses the numbers already in the fork tests and a zero launch fee.
3. **Safe signers**: who are the three signers of the operator and treasury Safes?
4. **Audit firm and budget** for the mainnet gate.

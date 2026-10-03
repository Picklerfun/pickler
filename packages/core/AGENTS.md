# Core package instructions

Read [the root instructions](../../AGENTS.md) first. Read the local instructions of any other project you inspect or change. Keep this file aligned with actual business modules, exports, and tests.

## Responsibility

`@pickler/core` owns the business layer: domain entities and invariants, application use cases, authorization rules, and ports for external capabilities. It must remain usable without Next.js or any specific provider.

Current source includes `application/get-health.ts`, `ports/clock.ts`, `features/research/{types,policy,decision-policy,run-research,style,brief}.ts` and the public product features ported from Relayer: `features/{access,agent-registry,budget,signing,profiles,agents,landing,markets,waitlist,applications}`. Public exports include research capability/repository ports, entities, configuration and schedule policy, decimal price comparison and `createResearchRunner`.

The runner owns permission rechecks, evidence attribution, bounded capability use and final quote verification. It accepts trusted scope from persisted jobs. API, Studio and scheduling share the same queue/runner. Core never accepts a model-supplied tenant or grants permissions from external content. Research failures and valid abstentions remain separate states.

## Rules

- No Next.js, React, HTTP request/response objects, ORM clients, provider SDKs, environment reads, or concrete infrastructure imports.
- Use plain input values and verified actor data. Enforce business authorization here, not only in UI or transport code.
- Define capability-specific ports here and inject implementations into use-case factories. Do not import infrastructure to construct a dependency.
- Domain models are not HTTP DTOs. Core may use `Date` or `bigint` internally; presentation maps them to public wire formats.
- Use typed business failures without HTTP status codes. Infrastructure should translate technical failures into errors the use case can understand.
- Keep public exports intentional in `src/index.ts`; use relative imports inside the package. Current lint rules prohibit dependencies on sibling runtime packages and agent SDKs from core. Relative imports use `.js` extensions for compiled Node ESM. `npm run build --workspace=@pickler/core` emits `dist`; public types resolve to source, runtime imports to compiled output.
- Do not add business rules that have not been specified by the product requirements.

## Checks

From root, run `npm test`, `npm run typecheck` and `npm run lint`. Root tests build shared packages first and include runner integration tests under infrastructure, which inject providers and use isolated PostgreSQL databases. Core health tests remain in `test`. Add framework-independent unit tests here for standalone domain policy. Do not move persistence implementations into core.

`ResearchModel.metadata()` includes research and market-selection `PromptSnapshot` values plus an optional final-decision snapshot for backwards compatibility: ID, version, SHA-256 and exact instructions. Core only persists these trusted adapter values in the first runtime event; prompt definitions and hashing stay in the agent service. Record metadata before permission checks/provider calls so failed started runs retain provenance too. This snapshot describes the runtime that starts a job, not a prompt version pinned at enqueue time.

Market eligibility requires an active, allowed market with a valid closing date strictly after the injected clock. Apply this before selection, after loading a manual or selected market, and on the final trade refresh. Missing dates are excluded conservatively. Preserve raw `candidates` and filtered `eligible_candidates` separately. `ResearchModel.select` receives the current UTC time. `ModelFailure` carries allowlisted adapter diagnostics; the runner persists `model_failure` before marking the run failed.

The research `outputTokens` cap is 32,768 per model call, including provider reasoning tokens. Core defaults to this cap; existing persisted agent configurations retain their values until explicitly updated. The agent-service caps selection and connection probes separately at 2,000.

Decision policy lives in `features/research/decision-policy.ts` and is exported as `evaluateDecision`. The model port returns `ModelAssessment` only. The runner saves `model_assessment`, validates existing evidence/market rules, refreshes quotes for trade proposals and applies deterministic policy before writing `DecisionV2`. Preserve the model proposal unchanged. Policy version 1.0.0 records its effective config, reason codes and evaluation time. Never upgrade model abstention or turn provider/schema failures into abstentions. Legacy configs without `uncertaintyPolicy` use conservative defaults; their snapshots are not rewritten. Legacy decisions remain readable without v2 claims.

The research runner requires `agent`, `event`, `finish` and `assertOwnership` repository methods. Admission, claims and process ownership remain responsibilities of its host; narrowing this dependency does not make the runner durable or permit bypassing production authorization.

Research ownership is checked before new provider/model operations, including the model adapter's `beforeStep` callback. Lease loss propagates without attempting a final decision write. Internal repository contracts include `renew` and operator-only `setConcurrency`; lease owner tokens must never enter model context or public DTOs. Hosts own heartbeat and recovery lifecycle; infrastructure owns atomic database fencing.

Discovery policy is optional for historical configs. Version 1 `pre-event` requires a verified Polymarket game start at least 15 minutes ahead and within seven days by default; it applies to discovery, manual selection and final trade refresh. `open-market` preserves existing behavior. Persist exclusions and return `NO_ELIGIBLE_MARKETS` without a model call when empty. Core filters/ranks at most 20 candidates after the adapter's bounded scan.

`publicSourceUrl` normalizes HTTP(S) resources conservatively and rejects explicit private/local hosts, literal IPs and credentials. The reader receives only exact URLs from retrieved search results or the selected market's `resolutionUrls`. This never grants domain-wide permissions or changes enabled tools. Preserve requested URL and rule-link provenance without claiming official status. Evidence limitations flag missing publication dates, truncation and publication older than seven days; they are evidence context, not automatic conclusions.

NFL research adds provider-neutral `SportsData`, versioned plugin permissions and `nfl-winner-v1` report validation. Plugins and individual tools must both be enabled. `effectivePlugins` interprets historical permissions without enabling sports sources. Optional sports integrations can be disabled; invoked failures remain failures. Decisions v3 preserve a separate forecast and coverage, including on abstention. Do not weaken uncertainty policy to obtain trades.

`@pickler/trading/polymarket` owns the manual paper capability contracts, eligibility and integer full-budget simulation. A paper order is never a model tool. Both paper and Polymarket permissions apply; unchanged configuration and a current policy-approved trade are mandatory. Ten virtual units include estimated fees; no partial fills or real orders. Recheck time/quote eligibility at atomic finalization.

`researchReferences` produces citable market, quote and plugin-availability context, distinct from external `Source` evidence. `validateReport` accepts these only in their declared sections; context cannot substantiate injuries or sporting advantage. The runner persists these references and retains the original provider events. Top-level decision source IDs still require retrieved sources. Keep historical reports readable without requiring a context-reference backfill.

`features/research/market-scope.ts` owns the version-1 two-level sports catalog, legacy-aware scope checks and automatic NFL/general protocol selection. Match versus award/season timing is enforced before selection, manual loading and final trade refresh. New scoped runs produce decision v4; legacy configs retain their protocols. General reports have eight sections, NFL nine. Provider classification is trusted only from the injected market adapter; model text never grants scope. Paper finalization supports reviewed NFL/soccer full-game winners through `@pickler/trading/polymarket`; general reports do not authorize arbitrary market types.

Product API-key authorization is deny-by-default for every key kind. `read:agents` grants read-only
product agent access; legacy broad labels grant no implied permissions. Budget reservations record
the actual commit period and reset generation. A refund may reduce current spend only when both
match; legacy unknown-period charges cannot credit the active balance. This product ledger is not
the research quota authority.

`features/research/style.ts` names three decision styles — careful, balanced and bold — each a fixed
`minProbabilityMargin`/`maxProbabilityRangeWidth` pair layered onto `UncertaintyPolicy`;
`policyForStyle` and `styleForPolicy` convert between a style and the policy, the latter by closest
distance so a hand-edited policy still reads as a style. `AgentConfig` gained `sources` (what an
agent reads beyond market data — web mode/sites and an allowed sportsbook list, validated in
`assertConfig`; books are keys of `SPORTSBOOKS` in `features/research/books.ts`, which are The Odds
API bookmaker keys, and anything else is rejected) and `skills` (routines the person added, capped and length-checked the same way).
Skills are stored apart from the brief text; `features/research/brief.ts`'s pure `composeBrief`
appends them to the edge as numbered rules at run time.

## Unified studio access

`features/studio/access.ts` owns user-session-only research authorization and the studio directory port. Operator enablement is independent from registration. Only workspace owners administer research; permitted members read. New configurations require marketScope.

There is one way to create an agent: `StudioDirectory.createDraft`, a private draft created with
the agent wallet its owner already made, funded and approved the policies of (`walletId` only — the
policy ids are read server-side, in the infrastructure adapter, from what `confirmPolicies` in
`features/wallets` recorded on the wallet's row, never from the caller). The draft is created with
its wallet, or not at all. The model drafter, its vocabulary (`features/studio/draft.ts`) and
`createAgent` were removed with `/studio/new`.

`features/studio/create.ts` owns one-screen creation: `VOICES`, `AVATAR_PATTERNS`, `STARTER_CAPS`,
`MIN_START_MICRO_AUSD` and `MIN_START_MON_WEI`, `DEFAULT_BRIEF`, `prepareDraft` (the one path from
the screen's input to the draft's config and profile), `fundingShortfall` and
`WalletUnderfundedError`. `AgentConfig.voice` is a `VOICE_KEYS` key checked in `assertConfig`; it
lives beside `brief`, not in it, because `normalizeBrief` rebuilds the brief from its five fields.

`features/studio/locks.ts` owns the two funding locks of docs/specs/studio-create-and-fund-v1.md
§6.3 as pure functions returning a `Lock` (`{ ok: true, reason: null }` or `{ ok: false, reason }`,
reasons in `LOCK_REASONS`). `canSchedule({ ready, balanceAusd })` answers `first_run` until `ready`
and then `unfunded` below `MIN_FUNDED_AUSD` (10). `canCreateAnother(balances, drafts)` answers
`unfunded_agent` unless every balance reaches the minimum, then `draft_limit` once `drafts` reaches
`MAX_DRAFTS_PER_WORKSPACE` (3); no agents is open. The balances are those of agents with a wallet:
a private draft has none and never counts as unfunded. `ready` is
`isReadyToSchedule(agent, readiness)` in `features/research/policy.ts`, the same predicate
`assertCanSchedule` refuses with `NOT_READY`; its facts (`ScheduleReadiness`: connections checked
and a completed manual run, both for the current config version) come from the new
`ResearchRepository.readiness(scope)`. api-schema mirrors `LOCK_REASONS`; a workers/api test pins it.

`AgentConfig.spend` (`SpendLimits { perCallAusd, perDayAusd }`, absent by default) holds the
person's "max per call / max a day" in AUSD. `assertConfig` bounds it by `SPEND_BOUNDS` (1–1000 a
call, 1–10000 a day, finite) and refuses a day below a call. It is stored and shown, not enforced:
`SPEND_ENFORCED` is false. The budget ledger is not used because its categories are monthly caps
with no per-call ceiling and no daily period. The trading work enforces these limits, through a
per-call and daily ledger period or a value cap in the wallet's Turnkey policy.
`ResearchRepository.updateSpend(scope, spend)` writes only `config.spend`, checked by
`assertSpendLimits`. Unlike `updateConfig`, it keeps the version, the schedule and readiness.
`ResearchRepository.updateInterval(scope, hours, now)` does the same for `config.intervalHours`,
checked by `assertIntervalHours` (whole hours, 1–168, the bounds `assertConfig` applies): the
person picks it right before turning the schedule on. With the schedule on, the next run moves to
`nextOccurrence` of the new interval from `now`, as turning the schedule on computes it.
A retried create is recognised inside `StudioDirectory.createDraft` (by the wallet it links),
before `admit` runs; the port has no separate lookup.

Event persistence failures use `PersistenceFailure` and a sanitized `persistence_failure` event,
not `provider_failure`. The discovery report callback obeys the same distinction. Preserve lease
and configuration errors unchanged. If diagnostics cannot be persisted, do not fabricate a
terminal result; the existing lease recovery path remains authoritative.

## Local trading integration

The opt-in Polymarket pilot remains disabled by default. Read `../../apps/agent-service/LIVE-TRADING.md` for limits and acceptance gaps. No model tool or deployed signer is enabled by this change.

## Agent wallets

`features/wallets` also owns the agent wallet ceremony (docs/specs/studio-create-and-fund-v1.md
§4.1). `domain/agent-wallet-policies.ts` writes each agent wallet's Turnkey policies as plain
strings: an ALLOW for the delegated user to sign from that wallet only to `VENUE_CONTRACTS` (left
out while the list is empty, which it is until live trading — then the delegated user can sign
nothing), a DENY on ERC-20 `transfer`/`approve` calldata from the wallet, a DENY on any
`POLICY` activity, and a DENY for the delegated user on every `activity.type` in
`DELEGATED_CREDENTIAL_ACTIVITY_TYPES` (new API keys, passkeys and OAuth providers, user updates,
email recovery, and the logins that mint session keys; every version listed, since Turnkey does
not document the `activity.resource` names for keys and authenticators; deletions are not
listed, so the delegated user can still remove credentials and itself). When @turnkey/http is bumped,
review new credential/login activity types — the DENY list is explicit and the SDK pin only
catches removals. Between the delegated user's creation and the first policies' approval that user has no
credential DENY; it can still sign nothing, and the studio's retry resumes at the policies step. `delegatedSelfDeletePolicy` lets the delegated user delete itself and no one
else. Every id and address is checked against a strict alphabet before it is interpolated, and a
malformed one throws. Turnkey has no policy order: the root quorum (the passkey) bypasses policies,
and otherwise any matching DENY beats every ALLOW.

`domain/relying-party.ts` holds `MERA_RELYING_PARTY` (`pickler.fun`, the relying party of the
marketplace's Mera passkey on the web and in the app) and `turnkeyRelyingPartyProblem(rpId,
appEnv)`, the pure rule the API asks before composing custody: Turnkey is never composed on
Mera's relying party, and never on `localhost` outside `local` and `development`. Tests:
`test/relying-party.test.ts`. The decision is `docs/specs/mobile-monorepo-v1.md`, W1, W2 and W8.

Wallet sign-in (`features/identity/application/wallet-sign-in.ts`) records which of the
marketplace's two wallets signed: `Presented.kind` is `PresentedWalletKind` (`"mera" | "eoa"`,
listed in `PRESENTED_WALLET_KINDS`; absent means `eoa`), and `verify` and `link` store it in the
link as `mera` or `external`. It describes the link and decides nothing: no rule here may grant or
refuse anything by it, because the caller states it and nothing proves it. The first writer stands
— a later sign-in of the same address with another kind leaves the link as it was. The Turnkey
kinds of `wallets.wallets` are another table and another product. Decision M7 of
`docs/specs/mera-web-v1.md`; tests in `test/wallet-sign-in.test.ts`.

`join(userId, presented)` in the same service is the only place an address changes account
(decision M12, spec §9): the caller's account is folded into the account of the wallet that
signed `presented`. Both sides agree — the kept account by its wallet's signature over a fresh
nonce in a message whose sentence is `joinStatement(<the wallet let in>)`, the account given up by
its session — and the account given up must be worth nothing: no
profile and no custody account (`hasProfile` and `hasCustodyAccount`, dependencies of the
service), exactly one wallet, and `accounts.isOwnWalletAccount` true for it, so an email or Google
account that linked a wallet is never given up. It throws `NoAccountToJoinError`,
`SameAccountError` and `AccountNotJoinableError` (`has_profile`, `has_custody`,
`not_wallet_account`, `changed`), and moves nothing in any of those cases or on a bad signature.
`WalletLinkRepository.reassignSole` exists for it and for nothing else, and its adapter holds the
one-wallet and no-profile conditions in the statement that moves the row: when it answers false,
`join` throws `changed` and hands out no session. The emptied account is removed only if it still
has no profile. Any new thing an account can own must be added to these checks before it ships;
`link` still throws `AddressTakenError` for an address owned elsewhere.

What a signature is for is part of the string it covers. `issueNonce` writes the sentence —
`SIGN_IN_STATEMENT`, or `joinStatement` when `joining` is given — and hands it to `buildMessage`
in `MessageFields.statement`; `verify` and `link` accept only the first, `join` only the second
and only for the caller's own wallet. Anything else is `WrongPurposeError`, after the nonce is
spent. A new use of a wallet signature gets a sentence of its own, never one of these two.

`createCustodyService` gained `agentWalletState`, `prepare`/`confirm` `DelegatedUser`,
`AgentWallet` and `Policies`. Each confirm forwards with exactly one allowed type from
`AGENT_WALLET_ACTIVITY_TYPES` (`domain/passkey.ts`; create_users is `_V4`, the only version
@turnkey/http 6.5 lets that endpoint take) and the caller's own sub-organization, and treats any
status short of completed as a failure. Before forwarding, each confirm reads the stamped body's
`timestampMs` (digits only), rebuilds the activity its prepare built — same builder, same inputs,
that timestamp — and refuses (`InvalidSignedActivityError`, 400) unless the URL and body are
byte-identical. Bytes, not parsed JSON: a body with a key given twice parses to Pickler's value
here and may be read as the other by Turnkey. `confirmPolicies` requires exactly one id per
prepared policy, and — once Turnkey's count matches — calls `agentWallets.saveApprovedPolicies`
before returning them, so the wallet's row in `wallets.wallets` carries the ids the person's
passkey actually confirmed. This is the only writer of that column: the studio's create-agent
transaction reads it rather than trusting a client-supplied list, so a request can never claim
approval for rules nobody confirmed. `confirmDelegatedUser` refuses (`DelegatedUserExistsError`)
before forwarding when a delegated user is already recorded.
Whether a ceremony is the person's first agent (which adds the self-delete policy) is decided
from `hasLinkedAgentWallet`, never by the caller; policies prepared for a first agent stop
confirming once another wallet is linked. `prepareAgentWallet(userId)` and
`confirmAgentWallet(userId, signed)` take no handle: a new wallet is "Agent wallet N", N one more
than `countAgentWallets`, derived at prepare and again at confirm. A wallet recorded in between
moves N and the stale stamp is refused before forwarding, which is wanted (a fresh prepare resumes
the unlinked wallet instead of minting another); two confirms racing together may share a label.
`preparePolicies` refuses with studio's `WalletUnderfundedError` until the wallet's balances (the
optional `balances: WalletBalanceReader` dep; absent is `DepositsUnavailableError`) meet
`fundingShortfall`'s minimums; `confirmPolicies` does not check them again. Both refuse a wallet
already linked to an agent (`AgentWalletLinkedError`, the signing family's 409 `wallet_assigned`):
its rules were approved and linked at create, and a second set would leave them apart. `prepareAgentWallet`
answers `{ existing }` (`ExistingAgentWallet`) for the person's newest unlinked agent wallet
(`findUnlinkedWallet`), whatever its name, so a retry never mints a second one; its
`policiesApproved` is true when the store's `approvedPolicyIds` (`UnlinkedAgentWallet`) hold at least
`MIN_AGENT_WALLET_POLICIES` (3, the DENYs every wallet is written with, exported from
`domain/agent-wallet-policies.ts` and also the link floor the studio directory requires), so a retry
skips the rules prompt too. The link to an agent
(`agent_wallets`) is not written here. Ports: `AgentWalletActivityBuilders` and
`AgentWalletRepository` (which now also carries `saveApprovedPolicies`); errors:
`DelegatedKeyNotConfiguredError`, `DelegatedUserExistsError`, `DelegatedUserMissingError`,
`AgentWalletNotFoundError` (also thrown by `saveApprovedPolicies` when no row of the caller's own
`kind='agent'` wallet matched). `MONAD_ACCOUNT_PATH` is the one account path every Pickler wallet
uses.

Known limitation: two confirms of the delegated user racing past that check can both complete in
Turnkey, leaving two "Pickler" users in the person's sub-organization. The store records the first
and refuses the second (`DelegatedUserExistsError`); the confirm then calls
`reportUnrecordedDelegatedUser` with the ids (the API logs it with `console.error`) before
refusing. The second user has no policy naming it, so it can sign nothing, but nothing removes it
automatically.

## Deposits

`createCustodyService` also funds an agent (spec §6.2): `prepareDeposit(userId, agentId,
amountAusd)` and `confirmDeposit(userId, agentId, amountAusd, signed)`. The amount must be one of
`DEPOSIT_AMOUNTS_AUSD` (10, 25, 50, 100; else `InvalidDepositAmountError`). The agent's wallet
comes from `findAgentWallet` and must also be the caller's own through `findOwnedAgentWallet`
(else `AgentWalletNotFoundError`), whatever the route already checked. Prepare asks the
`DepositChain` port (optional dep `deposits`; absent is `DepositsUnavailableError`) for the
unsigned transfer from the master address and wraps it in `signTransaction` with the master as
`signWith`. It answers the activity plus `amountMicroUsd`.

Confirm cannot rebuild the transaction, because its nonce and fees move. It reads the stamped
body's `parameters.unsignedTransaction` and has the port inspect it. It refuses with
`InvalidSignedActivityError` before forwarding unless the chain id and token are the port's, the
native value is zero, the gas limit is at most `MAX_DEPOSIT_GAS` (Monad charges the limit), and
the recipient and amount are this agent's wallet and this deposit. It then asks the port for a
fresh fee quote (`quoteFees`, the one prepare builds with) and refuses with
`DepositFeeTooHighError` when the stamped `maxFeePerGas` or `maxPriorityFeePerGas` exceeds
`MAX_FEE_MULTIPLE` (2) times the quote. It refuses with `DepositNonceError` only when the stamped
nonce is above the master's `pendingNonce`, a gap that would sit queued. A nonce at or below
pending flows on. A repeated confirm of a sent deposit then meets the recorded-hash check (409). A
retry after a failed record finds the node already holding the transaction and records it.
Anything else is refused by the node. A nonce between the latest and the pending nonce could
replace a master transaction still in the pool. The checks above still hold for it: it pays only
this agent, only this amount. It then rebuilds the whole activity around that
transaction with the stamped timestamp and compares bytes. It forwards with only
`ACTIVITY_TYPE_SIGN_TRANSACTION_V2` allowed and reads `signTransactionResult.signedTransaction`.

Before broadcasting, confirm has the port's `verifySignedTransfer` check that the signed
transaction carries exactly the stamped transaction's fields and that its recovered signer is the
master address. A mismatch is `SignedTransactionMismatchError`, and nothing is sent. Confirm then
hashes the signed transaction locally (`transactionHash`). If
`depositRecorded` already holds that hash, it refuses with `DepositAlreadyRecordedError` and sends
nothing. It then broadcasts through the port, forgets the agent's cached balance, and calls
`saveDeposit`. A broadcast failure propagates and records nothing. When `saveDeposit` fails after
a broadcast for any reason other than a duplicate, confirm calls the optional
`reportUnrecordedDeposit` dep with the agent id, hash and amount, then rethrows. The API logs that
with `console.error`. `DepositNotSendableError` (a failed gas estimate) and
`DepositAlreadyRecordedError` (a hash recorded twice) also come from adapters.

The stamped-transaction checks above live in one `checkStampedTransfer` inside the service, used by
deposits and transfers alike. `prepareTransfer(userId, request)` and `confirmTransfer(userId,
request, signed)` move AUSD or MON (`TransferRequest`: `from`/`to` are `"master"` or an agent
wallet id, exactly one side the master; `amount` in base units, positive; else
`InvalidTransferError`). The master is the account's `masterWalletId` and address; the other side
must be the caller's own `kind='agent'` wallet through `findOwnedAgentWallet` (else
`AgentWalletNotFoundError`), checked before anything is built or forwarded, at prepare and again
at confirm. A chain whose token is not six decimals is `DepositsUnavailableError`. Only prepare
reads balances: the source must hold the amount (else `InsufficientFundsError`, also for an
unreadable balance), and its MON must cover the built transaction's gas limit × max fee, plus the
amount for MON (else `InsufficientGasError`). Confirm does not re-read them, so a repeat reaches its
recorded-hash check and a retry after a failed save records the row; the chain refuses an
overdraft. The source signs; for MON the port's `prepareNativeTransfer` /
`inspectNativeTransfer` replace the token pair, the stamped transaction must be a plain transfer to
the target of exactly the amount with gas at most `MAX_NATIVE_TRANSFER_GAS`, and the fee and
nonce checks are the deposit's against the source's nonce. Confirm refuses a recorded hash
(`TransferAlreadyRecordedError`), broadcasts, forgets both addresses' balances and calls
`saveTransfer`; a failed save after a broadcast, other than a duplicate, calls the optional
`reportUnrecordedTransfer`. `listWallets(userId)` answers the master and `listAgentWallets` with
each wallet's balances and `readAt`.

## Markets

`features/markets` owns the perpetuals surface: a market is a grid of price levels away from the mark
crossed with how long a position is given. `LEVEL_STEPS` and `HORIZONS` are the rows and columns,
`levelPrice` and `levelSide` read a square, and `squareProblem` refuses one the market has never
reached inside its column — `hourlyReach` is per cent, on the same scale as a level. `MarketBoard`
is the port; `createListMarkets` orders by coverage before size and `createGetMarket` normalizes the
symbol and drops calls on squares the surface cannot take.

A market says where its figures came from and what the venue demands. `source` is `sample`, or
`perpl` with the network, the time the venue's answer was received and whether it is `stale`.
`limits` carries the venue's taker fee, maintenance margin, slippage cap and smallest account for
that market. **Unknown is `null`, not zero:** `agentsReading`, `openCalls` and `hourlyReach` are
`null` when nobody has measured them; `byCoverage` ranks a `null` count as none and
`squareProblem` refuses nothing on a `null` reach. `MarketDataUnavailableError` (code
`MARKET_DATA_UNAVAILABLE`) is what a board raises when the venue cannot be read and nothing recent
is held; a board never answers a failure with an empty list.

`READ_HORIZON` is why the feature exists in two places at once: a square can be a position or a paid
read, and a read always resolves a day after delivery whatever column drew it, so two answers on one
market stay comparable. `readQuestionAtLevel` in `features/agents` writes that sentence.

The arithmetic a ticket previews — size, liquidation, fee, the phrase — is not here. Nothing is sent
today, so it lives in the web feature that draws it, against the venue's own limits carried by each
market. It belongs in trading the day an order is placed, because then it decides money.

## Cloudflare trading pilot

Trading uses operator-enabled immutable accounts and provider-neutral NFL/soccer winner eligibility. The sign port accepts a final ownership guard. Automatic attempts are durably admitted once; confirmed autonomous purchases close the pilot. See ../../docs/polymarket-worker-pilot.md.

## Optional research observation

The model port may report `DecisionInputSnapshot` for the exact tool-free finalizer evidence.
The runner clones it and publishes `ResearchObservation` through an injected `ResearchObserver`
only after a successful final decision write. Observer failure and diagnostics cannot re-enter
research failure handling, mutate the primary result or create an abstention. Missing snapshots
are diagnostic gaps, never reconstructed from later evidence. Host observers must remain bounded
capture-only operations; paid comparison is a separately admitted operation. Core owns no files,
provider credentials or observer pricing, and the observer is not a decision-policy input.

## Trading boundary

Trading rules, financial contracts, simulations and evaluation coordination are owned by
`@pickler/trading`; read [its instructions](../trading/AGENTS.md). Core retains agent configuration,
identity, research authorization and public Perpl market-data contracts. Never import trading
from core. Consumers import trading subpaths directly; no compatibility exports remain here.

Core keeps the market predicates trading reads: `nflMarketEligible` and
`isSoccerFullGameWinner(market)` in `features/research/soccer.ts`, the one soccer predicate both
trading's `assertPaperMarket` and `assertLivePreview` call.

`src/features/launch` holds the launchpad domain: `domain/curve-math.ts` previews curve pricing and is held to the Solidity library by a generated fixture, and `ports/chain-reader.ts` describes what the domain needs from a chain without naming one. No blockchain SDK is imported here.

Launch indexing validates every height and parent link before proposing any writes, including
bootstrap and overlapping ranges. Gaps refuse the entire batch. Duplicate heights or mixed
ancestry fail as invalid input without requesting a rollback of persisted history; a coherent
range contradicting the persisted cursor remains a reorg. These checks do not establish RPC
finality, cursor concurrency safety or projection rollback.

## Consumer advice

`features/advice` owns public-agent resolution, JWT-user authorization, completed-history
visibility and job/policy/repository ports. Pending/failed jobs are requester-only; completed
results are authenticated shared history while the agent is public. Keep financial analysis and
provider calculations out of core. See [Agent advice](../../docs/agent-advice.md).

Advice pricing v2 pins the reviewed OpenAI-compatible forecast base URL and model in each job. Preserve v1 policies and their direct-DeepSeek meaning; provider changes require a new policy, never a historical rewrite.

# Infrastructure package instructions

Read [the root instructions](../../AGENTS.md) and [core instructions](../core/AGENTS.md) before changing adapters or their ports. Read any other affected project's local instructions and keep this file current.

## Responsibility and current state

`@pickler/infrastructure` implements interfaces owned by core and trading. It exports `systemClock`, `ExaResearch` (`WebSearch`/`PageReader`), `PolymarketData` (`MarketData`) and `PostgresResearchStore` (scoped configuration, runs, evidence, decisions and job persistence). Constructors accept configuration; no credentials are embedded.

It also carries the adapters ported from Relayer for the public product: AES-256-GCM crypto byte-compatible with stored values, the Supabase JWT verifier (`jose`), and Turnkey stamping and activity forwarding. The Supabase data adapters that came with them (workspaces, API keys, agents, budgets, profiles, and the PostgREST client the growth functions used) were removed on 2026-09-29: the API reads those tables through the PostgreSQL classes below. supabase-js remains for auth only (`createSupabaseJwtVerifier`, and `createSupabaseAdmin` inside `createWalletAccounts`). `createSampleMarketBoard`, `createSampleLandingReadModel` and `createInMemoryApplicantStore` serve sample content for the public pages until a venue and an indexer exist. The invented agents are not here: they live in `scripts/design/fixtures/` and only the design harness's fixture API serves them; the marketplace reads its agents through `PostgresAgentDirectory` below. `createSampleMarketBoard` (`src/markets/sample-market-board.ts`) holds the six perpetual markets, the squares agents have a public call on, and a deterministic 24-hour trail derived from each mark and its change; it polls no venue and reads no chain. These adapters read the product schemas defined in `src/persistence/product/`; see [supabase/AGENTS.md](../../supabase/AGENTS.md) for the hosted project.

Actual adapters live in `src/research`, `src/polymarket` and `src/persistence`. Business policy comes from core and trading; SQL implements transactional admission, idempotency, claims and scoped access. Drizzle defines the research tables in `src/persistence/schema.ts`, the product schemas (`identity`, `agents`, `budget`, `audit`, `growth`, `market`) in `src/persistence/product/`, and versioned SQL migrations in `drizzle/`. `0006_product_functions_and_grants.sql` is a custom migration holding what Drizzle cannot express: the `internal` helper schema, triggers, deferrable foreign keys, the `auth.users` references, the security-definer functions and the grants. It skips the Supabase-only parts when those roles or tables are absent, so it also runs on the Docker PostgreSQL. Admission, configuration, claims and scheduling lock agent rows in transactions. Never retry ambiguous research automatically. New providers must pass capability contract tests. Public runtime exports use compiled `dist`; relative source imports include `.js` extensions.

## Rules

- Depend on core and trading ports; neither business package may depend on infrastructure.
- Keep provider SDK types, queries, protocol details, and technical response validation inside adapters. Return values matching business-owned interfaces.
- No Next.js, React, web app imports, HTTP response construction, or UI behavior.
- Accept validated configuration through constructors/factories. The application's protected composition root selects and instantiates adapters. Do not require Next.js-specific `server-only` inside this framework-independent package.
- Keep credentials out of public exports and logs. Consumers must protect server imports; do not expose this package through client barrels.
- Configure timeouts and normalize failures. Retry only safe or idempotent operations. Do not automatically retry ambiguous writes or transaction submissions.
- Verify provider webhook signatures at the appropriate integration boundary and support deduplication when such flows are introduced. Keep HTTP mapping in the app.
- Blockchain adapters may use public artifacts from `chain` after declaring that dependency. Business code must remain independent of the chosen blockchain SDK.
- Do not add placeholder adapters to claim that a provider is integrated.

## Checks

Run `npm test`, `npm run typecheck`, `npm run lint` and `npm run build` from root. Tests in `test/*.test.ts` cover provider normalization/errors, PostgreSQL isolation/concurrency/recovery/schedules, and core research with injected providers. No paid calls occur in tests. Shared package builds precede runtime consumption. Use the private `pickler` schema; Mastra owns the separate `mastra` schema in the same PostgreSQL database. `@pickler/infrastructure/testing` is a test-only helper that creates and removes isolated databases; never import it from runtime code. Run `npm run db:up` before integration tests. Generate schema migrations with `npm run db:generate` and apply them explicitly with `npm run db:migrate`; startup must not migrate Pickler tables.

Decision v2 and uncertainty-policy settings use the existing JSONB columns; no database migration or historical backfill is required. Preserve old decision/config documents on reads. Policy updates use the existing versioned config transaction and disable scheduling. Integration tests verify proposal/final-verdict persistence, policy version snapshots and tenant isolation.

Provider HTTP calls use `redirect: "manual"` and reject all non-success responses, including redirects. This preserves credential isolation and works in both Node.js and Cloudflare Workers, which does not support the `error` redirect mode.

Execution uses `runs.lease_owner`, `runs.lease_expires_at` and the singleton `execution_policy` (defaults: global 5, tenant 2). Claims lock that policy row only for the admission transaction and choose the oldest eligible job. The per-agent running index remains authoritative. A store instance privately retains the random token for each claim; only that instance may renew or write for its claimed run. Public run projections exclude lease columns. Reservations last 60 seconds and hosts renew every 15 seconds.

Use PostgreSQL `clock_timestamp()` for expiration, never HTTP timestamps. The optional constructor lease clock is only injected by the test helper; runtime never accepts clock configuration. Event, renewal and finish operations lock/recheck the run atomically. Renewal errors revoke local ownership. Recovery affects only expired running jobs and preserves partial evidence. Migration 0001 interrupts legacy unleased running jobs while preserving queued/history records. Migration 0002 rejects upgrades while an old session owner exists and guards valid leases against legacy global recovery. Valid finalization sets a transaction-local owner token for that trigger. Stop every old executor before applying migrations; do not roll back to old binaries on the upgraded database.

Polymarket discovery round-robins a shared budget of five pages of twenty markets across configured categories. Preserve `gameStartTime` provenance, including explicit PostgreSQL timezone offsets; absent or ambiguous start times stay null. Never substitute opening or closing dates for sporting starts. Extract exact normalized public resolution URLs from description and resolution-source metadata. Core applies eligibility after discovery and selected-market refresh. Exa validates public source URLs and rejects mismatched read results. `ExaResearch.search` takes optional `includeDomains`; `exaSearchRequest` builds the body, unchanged when domains are omitted.

`src/sports` implements BALLDONTLIE and The Odds API with validated structured evidence, bounded requests, permission-checked public caching and shared PostgreSQL quotas. Migration 0003 adds private cache/quota tables. Never put credentials in cache keys, source URLs or evidence. Preserve original retrieval/update timestamps. Atomic evidence and successful result writes also lock/check the current agent configuration.

`PostgresPaperStore` uses the existing pool, per-attempt private reservations and atomic agent-locked finalization. Migration 0004 adds `paper_orders`, one attempt per run and one pending/filled position per agent/market. Public projections exclude owner tokens and internal snapshots. `recover` also interrupts expired paper reservations. A test-only clock must never be wired from API/environment. Polymarket paper conditions require explicit per-market fee and trading metadata; do not default missing fees to zero.

`PostgresPreviewStore` (migration 0022, numbered 0017 before main was merged: `pickler.preview_runs`, `pickler.preview_events`) holds the
paper runs of a brief that is not an agent yet (docs/specs/studio-brief-v1.md §4). It is the owner's
`create`/`read` (5 per user per rolling hour under a per-user advisory lock, readable for 24 h) and
the runner's repository for a run with no `pickler.agents` row: `agent()` answers the run's config
snapshot at version 1, never paused. Claims, 60 s leases, renewal and recovery mirror the research
store; a queued preview whose owner lost research access is cancelled at claim, and recovery deletes
expired previews nobody adopted. An adopted preview loses its `preview_events` at adoption (they
were copied to `pickler.events`) and keeps its row, which a retried create replays from; recovery
deletes that row 30 days after adoption (`ADOPTED_PREVIEW_RETENTION_MS`). Its `config` and
`decision` stay: `config` is NOT NULL and both are one small document each. Its claim locks the same `execution_policy` row as research
claims, and both count running rows of `pickler.runs` and `pickler.preview_runs` against the global
and per-tenant limits; the executors claim a preview queued over two minutes
(`PREVIEW_PRIORITY_AFTER_MS`) ahead of research runs. Under that lock the claim walks the queue
oldest first in pages of 50 (`CLAIM_PAGE`) with `FOR UPDATE OF p SKIP LOCKED`, reading only ids,
tenant, expiry and the owner's research access (joined, not queried per row); the config is read
once, by the `UPDATE ... RETURNING` of the row it claims. Migration 0022 also adds
`agents.agent_status` `draft`. Never use the `draft` value inside a migration: `migrateDatabase`
applies pending migrations in one transaction, and Postgres refuses an enum value added in the
same transaction, so it would fail whenever it is applied in the same batch as 0022. Deploy order: apply 0022 before deploying the API, the research
worker or the local runner, because every research claim reads `pickler.preview_runs`.

`src/polymarket/classification.ts` maps reviewed actual provider tags and metadata to core sports classifications with versioned provenance. Never infer authorization from a query filter or ambiguous football labels. `listScope` shares the five-page budget across chosen sports; unknown classifications reach core exclusion diagnostics. Category configurations and decisions v4 use existing JSONB without DDL or historical rewrites.

`src/persistence/migrate-database.ts` applies Drizzle migrations by original hash and timestamp under
one advisory-locked transaction. This reconciles the published product/research histories without
skipping older missing migrations. Use it from both the operator command and isolated test helpers;
do not substitute the timestamp-only migrator. Unknown histories fail closed. See
[the integration guide](../../docs/frontend-integration.md) before upgrading an existing database.

## Unified studio persistence

`src/studio` implements workspace/runtime identity links and the PostgreSQL monetary budget ledger. `src/persistence/console-schema.ts` defines private Drizzle tables (the file keeps its old name; the tables it declares are not renamed). Do not initialize lab data from deployed composition. Legacy budget authority requires verified reconciliation, never automatic hydration from a potentially stale projection. The explicit `research-access` command enables or revokes operator access; it does not call providers. See ../../docs/cloudflare-unification.md.

`PostgresStudioDirectory.createAgent` links `wallets.agent_wallets (agent_id, wallet_id, policy_ids)`
inside the same transaction as the agent and profile inserts, after them and before the handle is
claimed: an agent is created with its wallet, or not at all. It locks the caller's own
`wallets.wallets` row (`kind='agent'`) with `FOR UPDATE` before linking it, so a wallet that is not
the creator's is `PilotError("NOT_FOUND", "Wallet not found")` and no agent row survives. The
`policy_ids` it writes come from that same locked row's `approved_policy_ids` column, never from
the request: `wallet` on the create input carries only `walletId`, and a wallet whose
`approved_policy_ids` is null or has fewer than core's `MIN_AGENT_WALLET_POLICIES` (three: every
wallet is written with at least its three DENYs) — nobody confirmed its rules yet — is
`PilotError("CONFLICT", "Approve the wallet's rules first")`, with no agent row surviving either. A
wallet already linked to another agent hits the `agent_wallets_wallet_key` unique index, translated
through `CONFLICTS` to `PilotError("CONFLICT", "That wallet already belongs to an agent")`. The
wallet travels inside the idempotency `request` JSON (its id only), so retrying the same key with a
different wallet is "different terms", not the same creation.

`wallets.wallets.approved_policy_ids` (migration 0014, nullable `text[]`) is written only by
`PostgresCustodyStore.saveApprovedPolicies(userId, walletId, policyIds)`, called from core's
`confirmPolicies` once Turnkey's count matches what was prepared. It `UPDATE`s only the caller's
own `kind='agent'` row and throws `AgentWalletNotFoundError` when none matched, so the ids one
confirm produced can never land on someone else's wallet. This is the only path that sets the
column — the studio's create-agent transaction only ever reads it.

`PostgresStudioDirectory.createDraft` adopts a preview as a private draft in one transaction. It
locks the workspace, then the preview row, and first looks for a replay: a preview already adopted
by this caller in this workspace, with the submitted fingerprint, whose `pickler.product_agents`
row (`request_key = 'preview:<previewRunId>'`) was created under the submitted handle, answers
that draft again without calling `admit`; the same request under a different name is `CONFLICT`. Otherwise the checks run in the spec's order
(`PREVIEW_UNUSABLE`, `RUN_STALE`, `HANDLE_TAKEN`), then `admit` (the route's funding lock and draft
limit), then the writes.

## Invocation database connections

Infrastructure exports databasePoolConfig and DatabaseConnectionOptions. Deployed hosts pass
APP_ENV and optional DATABASE_CA_CERT through composition; pools are invocation-local and limited
to two connections. Direct hosted connections require a validated Supabase pooler endpoint and verified TLS. Hosted research now uses the trusted Hyperdrive
transport described below; only explicit local mode permits plaintext loopback connections.
Historical Node callers retain their existing connection configuration. Never expose a test clock
or controlled provider adapter through deployed environment configuration.

When invocation connection options are supplied, DATABASE_URL permits only the application_name
query parameter. Reject endpoint, TLS, timeout, and other pg overrides before selecting transport;
encoded hostnames are rejected because pg can decode them as Unix socket paths.

## Hosted database transport

Both deployed backend Workers require the trusted `DATABASE` Hyperdrive binding. The origin
uses Supabase session port 5432, verify-full with its CA, and disabled query caching.
There is no hosted direct-secret fallback or plaintext staging exception. Keep pools scoped
to each invocation, limited to two connections, and close them on every outcome. Local development
uses explicit APP_ENV=local with a loopback DATABASE_URL. Migrations retain their separate
operator connection. Admission controls remain independent of transport.

The trusted research binding now selects `transport: "hyperdrive"` in databasePoolConfig.
Only Hyperdrive's `.hyperdrive.local:5432` endpoint and its exact `sslmode=disable` binding
parameter are accepted in that mode. This is the private binding hop; the Hyperdrive origin
requires verify-full and the Supabase CA with query caching disabled. Other direct URL guards
remain unchanged. Event write failures are normalized by `event-failure.ts` without retaining
raw SQL, parameters, error messages or causes; ownership/configuration errors pass through.

## Local trading integration

The opt-in Polymarket pilot remains disabled by default. Read `../../apps/agent-service/LIVE-TRADING.md` for limits and acceptance gaps. No model tool or deployed signer is enabled by this change.

## Agent directory

The product-data ports the API composes are PostgreSQL classes over the caller's pool, written
query for query from the Supabase adapters they replaced: `PostgresProfileRepository` (`profile-repository.ts`, calling
`identity.handle_available` and `identity.create_profile` exactly as the RPCs did, so their
`handle_taken` / `user_has_profile` outcomes reach core's profile errors unchanged),
`PostgresWorkspaceDirectory` and `PostgresApiKeyDirectory` (`access-directory.ts`),
`PostgresAgentRegistry`, `PostgresAgentEventLog` and `PostgresBudgetSource` (`agent-registry.ts`),
and `PostgresWaitlist` and `PostgresApplicants` (`growth-store.ts`, calling the growth functions
and parsing their results with the schemas that file defines). A failed query raises
`DataSourceUnavailableError` with a `postgres.<schema>.<table>.<operation>` source
(`data-source.ts`), as the PostgREST errors did. Enum and `cidr[]` columns are cast to text in SQL
because node-postgres returns unknown array types as a literal. `test/postgres-product-data.test.ts`
covers them against the Docker PostgreSQL, including `onboard` right after `createProfile`.

`src/persistence/agent-directory.ts` exports `PostgresAgentDirectory`, the `AgentDirectory` adapter
behind the marketplace. It reads one join: `agents.agents` left-joined to `agents.agent_profiles`
(an agent created before profiles existed is still an agent, and gets the profile's defaults), to
`identity.profiles` for the creator's handle, and to `market.tokens` restricted to `pre_graduation`
and `graduated`. A `reserved`, `launching` or `failed` token is not a token: the agent's `ticker`
and `token` are null, and its ticker has no profile page. Tickers are stored and compared with
their `$`. Killed agents are off the listing and the directory but keep a persona, so an old link
still resolves.

No table records whether a pick was right, so no record is computed anywhere here: `resolved` and
`net` are `0` because zero is the true count, `hitRate` and `calibrationGap` are null, and the
pick, leaderboard, analytics and read methods return the honest empty shape. A token's market
figures are `0` and the profile's `market` is null until the launchpad indexer (PR #37) has
written `market.candles` and `market.holders`. Nothing in the class catches: a failed read is a
failure, never an empty marketplace. See `docs/specs/marketplace-real-data-v1.md` §3 and §7 before
filling any of these in.

## Agent drafting model

`src/model/openai-compatible-drafter.ts` exports `createOpenAiCompatibleDrafter`, core's
`AgentDrafter` over the same OpenAI-compatible endpoint the research runtime uses. It posts one
JSON-mode chat completion (temperature 0.2, 20-second timeout, `redirect: "manual"`) whose system
prompt is built from core's `BEATS`, `SUGGESTED_SKILLS`, `STYLES`, `ACCENTS` and `VENUES_ON_MAP`, and
sends `enable_thinking: false` only to DashScope hosts, as the runtime does. The prompt lists the
suggested skills per beat. The base URL is parsed inside `draft`, so a malformed one is an
unavailable draft rather than a construction error. This package cannot
import api-schema, so the caller injects `validate`. Every failure — network, non-success status,
empty content, invalid JSON, a refused answer — is `DraftUnavailableError`; nothing falls back to a
guess.

## Chain balance reads

`src/chain/balances.ts` exports `createBalanceReader`, the server-side reader behind the sign-in
welcome screen, so `apps/web` needs no chain dependency. It takes network, token address and
decimals from `@pickler/chain` — never literals — and refuses unsupported chain ids through
`requireSupportedChain` rather than falling back to another network. It issues two plain JSON-RPC
calls through an injectable `fetch` with `redirect: "manual"`, rejects non-success responses, and
requires a hex-shaped `result`; `BigInt("")` is `0n`, so a looser check would publish an unread
value as a zero balance. Each balance settles independently: a failed token read never erases a
successful native read. A balance that could not be read is `null`, never `"0"`. Preserve that
distinction — the interface says "unavailable" rather than showing an empty wallet.

`src/chain/erc20.ts` is the studio's ERC-20 layer over plain JSON-RPC. `createJsonRpc(url, fetch?)`
posts `{jsonrpc:"2.0",id:1,method,params}` with `redirect: "manual"` and a 10 s timeout and throws
on a non-ok response or an `error` payload. `erc20Balance` sends `balanceOf` through `eth_call` and
throws unless the result is a hex quantity, so an empty `0x` is never a zero balance.
`transferCalldata(to, amount)` encodes `transfer`; `toDisplay(units, decimals)` floors base units
to a display number. `createTokenBalanceReader(rpc, token, decimals, ttlMs = 15_000, clock)` caches
successful reads per lowercased address, never caches a failure, lets failures propagate and has
`forget(address)` for after a deposit. (It is not named `createBalanceReader`: that name is the
sign-in reader above.) `createAusdBalanceReader({ chainId, rpcUrl?, fetch? })` builds one for AUSD
from `@pickler/chain`, defaulting to the network's first public endpoint and refusing unsupported
chains. `PostgresResearchStore.readiness(scope)` reads the facts `schedule` checks, through the same
private query `schedule` uses. `PostgresStudioDirectory.list` left-joins `agents.agent_profiles` for each agent's `accent`, reading
"lime" when there is no profile row or the stored value is outside `ACCENTS`.
`PostgresStudioDirectory.createAgent` replays an earlier create by workspace and request key inside
its transaction, before `admit`. `PostgresResearchStore.updateSpend`
sets only the `spend` key of the stored config with `jsonb_set`, under the agent row lock. Version,
schedule and next due stay unchanged, so readiness for the current version survives.
`PostgresResearchStore.updateInterval(scope, hours, now)` sets only the `intervalHours` key the same
way, under the schedule's advisory lock and the agent row lock, and keeps the version, the schedule
and readiness. When the schedule is on it also moves `next_due_at` to `now` plus the new interval,
through core's `nextOccurrence`, as `schedule()` does; when it is off `next_due_at` stays null.
`updateConfig` may still change the interval, with a new version, as before.

`src/chain/deposit-tx.ts` is the chain side of a deposit and implements core's `DepositChain`. It
uses the existing `viem` dependency only to serialize and parse transactions and to hash; the RPC
stays `createJsonRpc`, whose `error` payloads now throw `JsonRpcError` with the node's `code`.
`quoteFees` reads `eth_maxPriorityFeePerGas` and the latest block's base fee, and answers
`maxFeePerGas = 2 × base + tip`. The tip falls back to 1 gwei only when the node does not implement
the method (code -32601 or "method not found"); any other failure propagates. Prepare builds with
this quote and core's confirm caps stamped fees against it, so both go through this one function.
`pendingNonce` reads `eth_getTransactionCount(address, "pending")`. Prepare builds with it and
core's confirm refuses a stamped nonce above it.
`buildTransferTx` adds the pending nonce and a gas estimate. It builds an EIP-1559 `transfer` with
the quoted fees and the estimate padded by a fifth, rounded up. A
failed estimate is core's `DepositNotSendableError` with the RPC error as its cause, never a
guessed limit. `inspectTransfer` answers null unless the input is an unsigned EIP-1559 call with no
access list whose data is exactly `transfer(address,uint256)`, and unless viem re-serializes it to
the same bytes; a non-canonical encoding such as a nonce with a leading zero is refused. It also
answers the nonce and both fee caps. `verifySignedTransfer` parses the signed transaction, requires
its fields without the signature to re-serialize to the approved unsigned transaction, and requires
`recoverTransactionAddress` to give the expected signer. Anything else is core's
`SignedTransactionMismatchError`, whose message names fields only.
`transactionHash` is the lowercased keccak of the signed bytes, with or without `0x`.
`broadcastTransaction` adds the `0x` Turnkey omits, sends it with `eth_sendRawTransaction` and
requires the node's hash to equal the locally computed one. A refusal is not believed at once: it
looks the hash up with `eth_getTransactionByHash`. If the node holds this very transaction (a
repeated confirm answered "already known" or "nonce too low"), it answers the hash. Otherwise,
including when the lookup fails, the original refusal propagates.
`createAusdDepositChain({ chainId, rpcUrl?, fetch?, balances })` composes these for AUSD from
`@pickler/chain` and forgets through the studio's balance reader.
`PostgresCustodyStore.saveDeposit` translates the `deposits_tx_key` unique violation into
`DepositAlreadyRecordedError`. `depositRecorded(txHash)` looks a hash up, in any case.
`updateConfig` always keeps the stored `config.spend` and ignores any `spend` in its input, so
`updateSpend` is the only writer. Because saving limits does not bump the version, a config saved
at that same version would otherwise drop them.

## Wallet sign-in nonces

`PostgresWalletIdentityStore` (`src/persistence/wallet-identity-store.ts`) keeps
`identity.siwe_nonces`, which has only `nonce` and `expires_at`. The row's key is the holder's tag
— sixteen hex characters of sha256 over `namespace:address` — followed by the nonce, so an
address's open nonces are a range of the primary key and a nonce can only be consumed for the
address it was issued to. `issue(nonce, expiresAt, holder)` never refuses. In one transaction,
under `pg_advisory_xact_lock` on the holder's tag so issues for one address take turns, one
statement deletes up to `EXPIRED_NONCE_PURGE_BATCH` (100) expired rows through
`siwe_nonces_expiry_idx`, evicts the holder's oldest nonces so that it holds core's
`MAX_OPEN_NONCES_PER_ADDRESS` (5) with the new one, and inserts. Both deletes go by `ctid` with
`FOR UPDATE SKIP LOCKED`. It evicts rather than refuses because the route is public and the address
unverified: a refusing cap would let anybody lock a wallet out. Nothing else deletes expired
nonces. A cap per client IP would need a column for the IP's hash and a
migration.

## Agent wallet ceremony

`src/turnkey/turnkey-activities.ts` exports `createActivityBuilders`: the unsigned
`create_users` (one non-root user "Pickler" whose only credential is the delegated P-256 API key
`pickler-delegated`), `create_wallet` (named after the handle, `MONAD_ACCOUNT`), `create_policies`
and `sign_transaction` bodies, each typed against @turnkey/http with its `type` taken from core's
`AGENT_WALLET_ACTIVITY_TYPES`, so a version drift fails the build. Each builder takes an optional
`timestampMs` so a confirm can rebuild the prepared body byte for byte. Nothing here is stamped by
Pickler. The same test file pins core's `DELEGATED_CREDENTIAL_ACTIVITY_TYPES` to the SDK's
`v1ActivityType` union. `test/turnkey-activities.test.ts` also pins the result keys core reads, including
`signTransactionResult.signedTransaction`.

`PostgresCustodyStore` implements `AgentWalletRepository`: `saveDelegatedUser` (idempotent for the
same id; a different id, or no sub-organization, is `DelegatedUserExistsError`), `saveWallet`
(wallets + wallet_accounts in one transaction; the same wallet again for its owner is a no-op,
another person's wallet id is refused), `findOrphanWallet` (an agent wallet by name with
no `agent_wallets` row, with its `approved_policy_ids` as `approvedPolicyIds`), `findOwnedAgentWallet`, `hasLinkedAgentWallet` (any of the person's wallets in
`agent_wallets`), `findAgentWallet`, `saveApprovedPolicies` (see "Unified studio persistence" above)
and `saveDeposit` (lowercases the hash for the column check).

`src/turnkey/delegated-key.ts` generates Pickler's delegated key pair in Turnkey's API key format
(compressed P-256 public hex, raw 32-byte private hex; a test stamps with Turnkey's own stamper and
verifies). `npm run turnkey:delegated-key --workspace=@pickler/infrastructure` prints only the
public key of a fresh pair; `-- --append <file>` appends a pair to a local `.dev.vars` without
printing it, and `-- --print-private` prints both halves for an operator's `wrangler secret put`.

## Cloudflare trading pilot

Migration 0010 adds disabled-by-default trading account enablement and private automatic attempts. Trading stores may restrict claims/reconciliation to the configured wallet. `trading-access` is an explicit operator command; bindings are immutable. SDK signing rechecks ownership. See ../../docs/polymarket-worker-pilot.md.

## International Polymarket preproduction

The explicit `polymarket:preproduction` agent-service command only probes fixed public GET
routes. It loads no environment file, credentials, signer or database. The official environment
inherits chain 137; never equate its availability with Amoy or dummy-fund order acceptance.
See apps/agent-service/POLYMARKET-PREPRODUCTION.md from the repository root.

## Paper resolution

Migration 0011 adds nullable paper settlement snapshots and releases the open-position constraint after virtual resolution. PostgresPaperStore serializes settlement under agent/position locks and rechecks current plugin permissions/version. PolymarketPaperResolution reads only finalized CTF payout data via public Polygon RPC; it never loads signer credentials. Buy-time condition/outcome identity is mandatory for resolution; never infer legacy identities or winners from prices. Gamma orderMinSize is a share quantity, exposed separately from legacy minimumNotional.

## Paper study data

`PolymarketStudyData` is a public export for the local operator laboratory. Discover exact current BTC interval slugs or existing classified sports markets. Guard every provider request, including Coinbase reference candles and Exa. Preserve the distinction between Coinbase reference prices and the Chainlink resolution feed; no silent replacement or official price-to-beat claim. No paid initialization.

The study adapter reads the public crypto-price endpoint with exact window, variant and explicit 60-second TWAP parameters from Polymarket's public client. Validate opening value and timestamp before any model call. This is a frontend endpoint, not a promised stable API; fail closed on changes. Never label it as an independently verified signed Chainlink report.

## Perpl public data plugin

`src/perpl` exports `PerplMarketData`, a bounded public REST adapter for BTC/ETH on mainnet/testnet. Discover IDs/precision from context; preserve exact decimal strings, component provenance and unknowns. Fixed hosts, GET-only, no redirects/retries, 10-second/2-MiB limits, serial one-second starts and twelve requests per session. Context cache is scoped to adapter/network. Test hooks are trusted host injection, never agent configuration.

## Perpetual paper accounts

`PostgresPerpsPaperStore` owns scoped private perpetual paper accounts, append-only movements, position projections and 60-second fenced attempts. Serialize with agent/account locks, never replay expired work, and keep original session config/capital. Migration 0012 adds four RLS-enabled tables without changing existing paper or real budgets.

Perpl history adds bounded four-page funding reads and a distinct tool permission. Migration 0013 stores immutable paper observations; funding postings deduplicate by position/event block and preserve discrepancies. `observe` applies ledger/mark changes atomically and keeps replayable results.

`PostgresPerpsStudyStore` owns private study identities, dedicated agents, 90-second process leases,
three-lane atomic USD reservations, original round inputs and durable usage. Migration 0014 adds
three RLS tables. Unknown costs retain reservations; interrupted calls/executions are never replayed.
Paper observations retain compact account snapshots instead of copying all previous fill evidence
into every observation; replay reads the current ledger. Explicit closeAdmissions is irreversible
within a virtual session and does not prevent exits.

## Quantitative BTC paper pilot

`QuantData` reads explicit per-market cryptoMarketConfig and matching stream rules, opening reference, Coinbase ticker and consecutive candles. Plugins guard each request. `PolymarketPaperResolution.resolutionFor` reads immutable identities without fabricating an order. Historical proxy data is never a runtime fallback.

`comparisonTransport` is an opt-in public transport for the paired local laboratory: serial per-provider calls, 500ms minimum start spacing, 429 cooldown without retries, bounded bodies and allowlisted diagnostics. QuantData reuses raw market metadata only within one input snapshot for conditions, rechecking permission and preserving its timestamp. The transport is not a hosted fallback or global provider behavior change.

`@pickler/infrastructure/model-providers/jev` exports the shared fixed-endpoint Jev client,
choice validation and sanitized diagnostics. Callers provide prompts, limits and awaited
usage persistence hooks; the client never retries, stores credentials or selects a strategy.
BTC adapters now enforce a 1 MiB response bound; request limits and protocol-specific timeouts
remain caller-owned. Do not add independent Jev transports to active trading evaluation adapters.

## Trading package boundary

Trading rules and financial ports are owned by `@pickler/trading` public subpaths. Core retains
identity, configuration and research contracts. Infrastructure implements the trading ports;
runtime composes adapters and models. Hosts must not duplicate risk, fills or accounting.

## Launch indexer

`src/chain/viem-chain-reader.ts` implements core's `ChainReader` over viem. It verifies the chain id against the node on first use rather than trusting configuration, and it raises `ChainUnavailableError` instead of returning an empty result when no endpoint answers — an indexer that reads an unreachable node as an empty block range skips history permanently and reports nothing. viem lives here and never in core or `chain`.

`src/persistence/product/launch-index-store.ts` persists what the indexer reads — blocks, events, cursor and outbox in one transaction — and unwinds it on a reorg by orphaning rather than deleting. `src/persistence/product/launch-projector.ts` turns those stored events into the catalogue the API serves, reading only from `market.chain_events` and never from a node, which is what makes a projection disposable and rebuildable. Only canonical events are projected: an orphaned one describes a trade that did not happen.

`market.tokens.agent_id` is nullable because the chain knows an `agentKey` that nothing reverses into our agent identifier. A launch the chain has and we cannot attribute is recorded with a null link and attributed later; requiring the link would mean inventing one or dropping the launch.

Actual adapters live in `src/research`, `src/polymarket` and `src/persistence`. Business policy comes from core; SQL implements transactional admission, idempotency, claims and scoped access. Drizzle defines the research tables in `src/persistence/schema.ts`, the product schemas (`identity`, `agents`, `budget`, `audit`, `growth`, `market`, `launch`) in `src/persistence/product/`, and versioned SQL migrations in `drizzle/`. `launch` holds what only exists off chain — drafts, mirrored presets, metadata history, prepared transactions and the outbox — and is deliberately separate from `market`, which holds projections a replay can rebuild. Mixing them would make it impossible to say which tables may be truncated and rebuilt safely. `market.chain_blocks` and `market.chain_events` keep raw blocks and decoded logs keyed by full log identity, so a projection can be rebuilt and a reorg rolled back without re-reading the chain. `0016_launch_grants.sql` carries their grants, since Drizzle emits no privileges.

`0006_product_functions_and_grants.sql` is a custom migration holding what Drizzle cannot express: the `internal` helper schema, triggers, deferrable foreign keys, the `auth.users` references, the security-definer functions and the grants. It skips the Supabase-only parts when those roles or tables are absent, so it also runs on the Docker PostgreSQL. Admission, configuration, claims and scheduling lock agent rows in transactions. Never retry ambiguous research automatically. New providers must pass capability contract tests. Public runtime exports use compiled `dist`; relative source imports include `.js` extensions.

## Launch migration reconciliation

Launch SQL migrations are numbered 0015/0016 after the current research and perpetual
history. Their original SQL bytes and journal timestamps are preserved so the hash-based
migrator recognizes databases created on the earlier launch branch. Never rewrite applied
SQL or reset a database to resolve branch numbering. The combined latest snapshot includes
both launch and current trading tables. Migration tests cover both predecessor histories.

Migration histories are reconciled without changing published SQL or original timestamps. Main retains 0010–0014, launch adds 0015–0016, and custody/profile migrations follow at 0017–0021, and the Studio preview runs at 0022. The Node-only migrator is available through `@pickler/infrastructure/migrations`, never the Worker runtime barrel. Launch reads share the request pool without owning its lifecycle.

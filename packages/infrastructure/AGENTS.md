# Infrastructure package instructions

Read [the root instructions](../../AGENTS.md) and [core instructions](../core/AGENTS.md) before changing adapters or their ports. Read any other affected project's local instructions and keep this file current.

## Responsibility and current state

`PostgresPerpsRuntimeStore.finishCheck` records current-version connection validation only for
the completing, successful, complete manual Studio v2 check, under its ownership transaction.
Historical, incomplete, failed and stale checks cannot set or restore that marker. The generic
Polymarket/Exa probe is not a Perpl preparation path. Scheduling still requires explicit activation.

The test-only export `@pickler/infrastructure/testing/controlled-worker` holds the dedicated
port/UUID database fence and controlled HTTP boundary. Production composition must never import
or install it. See [controlled Studio acceptance](../../docs/studio-acceptance.md).

`@pickler/infrastructure` implements interfaces owned by core and trading. It exports `systemClock`, `ExaResearch` (`WebSearch`/`PageReader`), `PolymarketData` (`MarketData`) and `PostgresResearchStore` (scoped configuration, runs, evidence, decisions and job persistence). Constructors accept configuration; no credentials are embedded.

It also carries the adapters ported from Relayer for the public product: AES-256-GCM crypto byte-compatible with stored values, the Supabase JWT verifier (`jose`), and Turnkey stamping and activity forwarding. The Supabase data adapters that came with them (workspaces, API keys, agents, budgets, profiles, and the PostgREST client the growth functions used) were removed on 2026-09-29: the API reads those tables through the PostgreSQL classes below. supabase-js remains for auth only (`createSupabaseJwtVerifier`, and `createSupabaseAdmin` inside `createWalletAccounts`). `createSampleMarketBoard`, `createSampleLandingReadModel` and `createInMemoryApplicantStore` serve sample content for the public pages until a venue and an indexer exist. The invented agents are not here: they live in `scripts/design/fixtures/` and only the design harness's fixture API serves them; the marketplace reads its agents through `PostgresAgentDirectory` below. `createSampleMarketBoard` (`src/markets/sample-market-board.ts`) holds the six perpetual markets, the squares agents have a public call on, and a deterministic 24-hour trail derived from each mark and its change; it polls no venue and reads no chain. These adapters read the product schemas defined in `src/persistence/product/`; see [supabase/AGENTS.md](../../supabase/AGENTS.md) for the hosted project.

Actual adapters live in `src/research`, `src/polymarket` and `src/persistence`. Business policy comes from core and trading; SQL implements transactional admission, idempotency, claims and scoped access. Drizzle defines the research tables in `src/persistence/schema.ts`, the product schemas (`identity`, `agents`, `budget`, `audit`, `growth`, `market`) in `src/persistence/product/`, and versioned SQL migrations in `drizzle/`. `0006_product_functions_and_grants.sql` is a custom migration holding what Drizzle cannot express: the `internal` helper schema, triggers, deferrable foreign keys, the `auth.users` references, the security-definer functions and the grants. It skips the Supabase-only parts when those roles or tables are absent, so it also runs on the Docker PostgreSQL. Admission, configuration, claims and scheduling lock agent rows in transactions. Never retry ambiguous research automatically. New providers must pass capability contract tests. Public runtime exports use compiled `dist`; relative source imports include `.js` extensions.

## Rules

The migration CLI uses `migrationPoolConfig`: loopback stays local; hosted operator connections
require Supabase direct/session port 5432 and `DATABASE_MIGRATION_CA_CERT`, verified TLS and no
endpoint/SSL query overrides. Transaction poolers and Hyperdrive are not migration transports.
Migration credentials are operator/CI-only and must never be forwarded to Worker deployment
children. Failures report sanitized codes and stop publication; the reconciled migrator retains
its transaction, advisory locks and historical SQL identities. Run migration connection and real
PostgreSQL history tests when changing this path.

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

`wallets.wallets.approved_policy_ids` (migration 0014, nullable `text[]`) is written only by
`PostgresCustodyStore.saveApprovedPolicies(userId, walletId, policyIds)`, called from core's
`confirmPolicies` once Turnkey's count matches what was prepared. It `UPDATE`s only the caller's
own `kind='agent'` row and throws `AgentWalletNotFoundError` when none matched, so the ids one
confirm produced can never land on someone else's wallet. This is the only path that sets the
column — the studio's draft-create transaction only ever reads it.

`PostgresStudioDirectory.createDraft` creates a private draft with its agent wallet in one
transaction (studio-create-simplified-v1 §4.1). It locks the workspace and first looks for a replay:
a `pickler.product_agents` row with `request_key = 'draft:<walletId>'` answers that draft again
without calling `admit` when its request (name, handle, wallet, config, profile) matches, and is `WALLET_ASSIGNED`
when it does not. Otherwise it refuses `HANDLE_TAKEN`, locks the wallet row and refuses
`WALLET_NOT_FOUND` (not this person's `kind='agent'` wallet), `WALLET_ASSIGNED` (linked) and
`POLICIES_MISSING` (fewer than `MIN_AGENT_WALLET_POLICIES` approved ids), then runs `admit` (the
route's funding lock, draft limit and balance check), then writes the agent, its profile (accent,
avatar pattern, voice, venue `perps`), the wallet's link with its approved policy ids, the handle,
the runtime row and the product row. It is the only create: `createAgent` (an agent with a wallet,
for `/studio/new`) was removed with that screen, and so was the model drafter
(`src/model/openai-compatible-drafter.ts`).

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
still resolves. Only `visibility = 'public'` agents appear anywhere in it (migration 0024,
studio-draft-dashboard-v1 D7): `status` says whether an agent has a wallet and runs, `visibility`
whether the marketplace shows it, and `published_at` is set exactly when it is public (CHECK
`agents_published_consistent`). 0024 published every non-draft agent as of its `created_at`, and
added `agents.x_challenges` and `agents.x_accounts` for Connect X; `PostgresStudioDirectory.list`
returns `visibility`, `publishedAt` and the verified `xHandle`.

No table records whether a pick was right, so no record is computed anywhere here: `resolved` and
`net` are `0` because zero is the true count, `hitRate` and `calibrationGap` are null, and the
pick, leaderboard, analytics and read methods return the honest empty shape. A token's market
figures are `0` and the profile's `market` is null until the launchpad indexer (PR #37) has
written `market.candles` and `market.holders`. Nothing in the class catches: a failed read is a
failure, never an empty marketplace. See `docs/specs/marketplace-real-data-v1.md` §3 and §7 before
filling any of these in.

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
`PostgresResearchStore.updateSpend`
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
`buildNativeTransferTx` builds a plain MON transfer (empty calldata, `value` wei) with the same
nonce, fee and padded-estimate rules, the estimate taken over the value move; a failed estimate is
`DepositNotSendableError`. `inspectNativeTransfer` answers null unless the input is an unsigned,
canonically encoded EIP-1559 transaction with a recipient, empty calldata and no access list.
`createAusdDepositChain({ chainId, rpcUrl?, fetch?, balances })` composes these for AUSD and MON
from `@pickler/chain` and forgets through the studio's AUSD balance reader; the custody service's
MON and AUSD reader caches nothing, so there is no MON reading to forget.
`PostgresCustodyStore.saveDeposit` translates the `deposits_tx_key` unique violation into
`DepositAlreadyRecordedError`. `depositRecorded(txHash)` looks a hash up, in any case.
`updateConfig` keeps the stored `config.spend` and ignores any `spend` in its input, so
`updateSpend` is its usual writer. Because saving limits does not bump the version, a config saved
at that same version would otherwise drop them. The one exception is `{ writeSpend: true }`, which
a setup passes with new caps: the incoming `spend` (checked by `assertSpendLimits`) is
written in the same transaction as the rest of the config.

Setup versions (docs/specs/studio-live-v1.md L10, migration 0026): `agents.setup_versions` holds
one row per saved setup, `(agent_id, version)` with a summary of 1–200 characters; RLS is on and
the service role may only select and insert. `updateConfig` takes `{ perplOnly?, writeSpend?,
versionSummary? }`. `perplOnly` refuses with `NOT_A_PERPL_AGENT` when the stored config, read under
the row lock, has no `perpl`. `versionSummary(prev, next)` is called with the stored config before
and after the write, and its line is inserted with the new version number in the same transaction,
under the product agent id `pickler.product_agents` maps the scope to; a failed write records
nothing and a failed record rolls the write back. A runtime agent with no product row records
none. `PostgresStudioDirectory.versions(access, productAgentId)` lists the newest 20, and is
`NOT_FOUND` outside the workspace. Apply 0026 before deploying the API: every `PUT /setup` inserts
a version row in its transaction, so an API without the table fails every setup save, the draft
studio's included.

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
`pickler-delegated`), `create_wallet` (`walletName` is the `name` core gives, "Agent wallet N"; `MONAD_ACCOUNT`), `create_policies`
and `sign_transaction` bodies, each typed against @turnkey/http with its `type` taken from core's
`AGENT_WALLET_ACTIVITY_TYPES`, so a version drift fails the build. Each builder takes an optional
`timestampMs` so a confirm can rebuild the prepared body byte for byte. Nothing here is stamped by
Pickler. The same test file pins core's `DELEGATED_CREDENTIAL_ACTIVITY_TYPES` to the SDK's
`v1ActivityType` union. `test/turnkey-activities.test.ts` also pins the result keys core reads, including
`signTransactionResult.signedTransaction`.

`PostgresCustodyStore` implements `AgentWalletRepository`: `saveDelegatedUser` (idempotent for the
same id; a different id, or no sub-organization, is `DelegatedUserExistsError`), `saveWallet`
(wallets + wallet_accounts in one transaction; the same wallet again for its owner is a no-op,
another person's wallet id is refused), `findUnlinkedWallet` (the newest agent wallet
with no `agent_wallets` row, with its `approved_policy_ids` as `approvedPolicyIds`), `findOwnedAgentWallet` (with `linked`, at the first account's address as
the other reads use it), `hasLinkedAgentWallet` (any of the person's wallets in
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

Perpetual study admission shares the USD 5 ceiling across every session for the same tenant
and network in the same database. A transaction-scoped advisory lock serializes reservations;
historical reservations and unknown started usage cannot be bypassed with a new session ID.
Do not change tenant/network/database to reset an existing authorization.

Perpl public hosts share `PerplRequestSchedule` across sessions: serialized requests, at least one second between starts, shared Retry-After cooldown, and the existing twelve-request session limit. Transient retry support is opt-in for coherent acquisition; other consumers retain stop-on-error behavior. The perps study repository stores attempted slots and diagnostic-only records in existing JSONB. Diagnostic initialization references existing agents without creating accounts; paid admissions remain closed. Perps paper stores may be bound to a study owner, checked inside their transactions before and after mutation.

Perpl request diagnostics retain only allowlisted nested network codes, observed response phase,
header latency and total duration. Generic deadlines do not establish a DNS/TLS cause. The fixed
`checkPublicConnectivity` read is an explicit diagnostic helper, not a provider fallback: one
three-second public request, no redirects, body storage or retry, guarded before and after.

Perpl public stream reconstruction lives in `src/perpl/stream.ts`. REST and WebSocket share ticker/book normalization. Only public fixed hosts are permitted; snapshots precede deltas, o:0 removes levels, disconnects discard state, and heartbeats never refresh data. Enforce 2 MiB messages, 32 queued messages and 10,000 levels per side. Reconnect at most twice per minute within active guarded acquisition. Public captures are bounded by the local host.

## Market board

`src/markets/perpl-market-board.ts` implements core's `MarketBoard` over Perpl
(`docs/specs/perps-board-live-v1.md`). `createPerplMarketBoard({ network, memory })` lists every
open market from one request to `/v1/pub/context`, parsed by `@pickler/perpl-context` — the parser
the mobile app trades on, so the two surfaces cannot list different markets or limits — and sent
through `PerplTransport` (no redirects, a ten-second timeout, one request a second per schedule).
`PerplBoardMemory` holds the venue's last answer, each market's hourly history, the reads in
flight and two schedules (the board and the histories are paced apart, so market pages never delay
the list); the caller owns it, because the API composes services per request. A board younger than
ten seconds is served from memory. A read is shared by everyone who asks while it is in flight.
While the venue fails, the last answer is served as `stale` for five minutes, and the venue is
asked again at most every ten seconds (a 429 counts as a failure for as long as the venue said to
wait; nothing sleeps through it); past five minutes the board throws
`MarketDataUnavailableError`. Nobody waits long: a caller the board can already answer waits two
seconds for a newer answer, and a market page two and a half for its history, then is served what
is held. The detail's history is one request for thirty days of hourly candles, cached five
minutes, not retried for thirty seconds after a failure; without it the market is still served,
with no trail and a `null` reach. A read nobody has heard from in fifteen seconds is given up on
and its schedule replaced, so a request that died with its Worker invocation cannot hold the rest.
An answer for
another chain is refused. `src/markets/sample-market-board.ts` remains for the design harness and
for an API with no network configured, and labels itself `source: sample`.

This adapter and the agents' client in `src/perpl/` both read the venue's context, with different
contracts: the agents' client is two symbols with provenance on every value and raw provider
fractions. Do not route one through the other. Tests: `test/perpl-market-board.test.ts`, over the
capture in `@pickler/perpl-context` and recorded candles in `test/fixtures/`.

## Local four-way perpetual comparison

Perpetual configuration v2 persists four agents and four reserved lanes in the existing study JSONB. Historical unknown usage may be acknowledged only by exact failed call identity/hash/reservation with no active owner; full reserved cost remains accounted. Any new unknown blocks admissions. The four-way paid ceiling is 35 calls and all sessions still share the original tenant/network/database USD 5 campaign.

## Read-only Perpl audit export

exportPerpsAudit uses a scoped repeatable-read READ ONLY transaction for study, rounds, events, paper accounts, attempts and movements. Never replace it with paper.view(), which can recover attempts and write history. It exports document data, not lease owners, credentials or database connection values. It releases the client on success and failure, and never initializes missing records.

## Perpl paper runtime persistence

Migration 0027 (`docs/specs/perpl-paper-runtime-v1.md` R9, R10, R12, R14, R15) adds
`pickler.perps_checks`, `pickler.perps_proposals` and `pickler.perps_owner_actions` (declared in
`src/persistence/product/perps-checks.ts`, RLS on, the service role may select, insert and update;
the grants follow 0025, not 0012/0013 as spec §5 said, because those grant nothing)
and eight nullable columns on `pickler.perps_paper_positions` (`check_id`, `config_version`,
`leverage`, `margin`, `stop_price`, `take_profit_price`, `exit_due_at`, `close_reason`, with an
index on `exit_due_at` where open). The position document stays authoritative; the columns serve
queries. `check_id` has no FK to `perps_checks`: `schema.ts` would have to import
`product/perps-checks.ts`, which imports it, and drizzle-kit's CommonJS load cannot resolve that
cycle; trading requires a UUID and the check row always exists first. Proposal statuses include
`approving`. drizzle-kit loads schema files through CommonJS and cannot import trading's ESM exports,
so the enum lists (`PERPS_CLOSE_REASON_VALUES`, `PERPS_CHECK_TRIGGER_VALUES`,
`PERPS_CHECK_OUTCOME_VALUES`) are spelled out and pinned to trading's lists by a test. **Apply 0027
before deploying the API or the research worker**: the product paper store writes the new columns
on every position change, and the runtime store reads the new tables.

`PostgresPerpsRuntimeStore` implements trading's `PerpsRuntimeRepository`. A check is `queued`
(`startCheck`: `NOT_A_PERPL_AGENT`, `AGENT_KILLED`, `CHECK_RUNNING`, replay by request key; every
check row is inserted by the one protected `insertCheck`, which recovers the agent's lapsed checks
and refuses `CHECK_RUNNING` under the agent row lock), `running` with a 60 s
lease (`claimAgent` → `{ check, lease }`, `renewAgent`, `appendStep`, `createProposal`), then
`finished` (`finishCheck`, `releaseAgent`). A partial unique index keeps one queued or running
check per agent; starting and claiming lock the runtime agent row first, then the check. Expired
leases end as `CHECK_INTERRUPTED` and checks queued over ten minutes as `CHECK_EXPIRED`, recovered
whenever the agent is started or claimed, and across agents by `recoverChecks()` (the minute Cron's
sweep, so a paused or draft agent's crashed check never stays `running`). `recordCheck` writes finished rows at once (exits, owner
actions, system notes); `pauseAgent` sets `paused` and writes a `system` row in one transaction,
and only when the agent was not paused yet (null otherwise), so racing closers pause it once.
`listChecks` pages 50 newest first with an outcome filter. `dueAgents` answers public, unkilled,
unpaused agents with a Perpl config, scheduling enabled, validated connections and a complete
successful manual Studio v2 check for the current configuration version, whose hourly slot (`perpsCheckMinute` of the product id)
opened under ten minutes ago with no hourly check since (read through `perps_checks_feed`) and no
live check, each with its `slot`; the dispatcher's `hourly:<slot>` request key and the request index
make one check per agent and slot. Proposals expire after trading's `PROPOSAL_TTL_MS`;
`decideProposal` commits an expiry before raising `PROPOSAL_EXPIRED`, a skip is final and an
approval becomes `approving`; `settleProposal(id, opened)` makes it `approved` or back to `pending`.
`expireProposals` expires each pending row once, and approvals stuck five minutes past expiry.
Proposal leverage is within core's `LEVERAGE_BOUNDS` (1–10). Counts and cost are per UTC day and use the
store clock (the database's `clock_timestamp()` outside tests).

`perps-hourly-readiness.ts` shares the current manual preparation predicate with schedule readiness.
Hourly admission is rechecked under the runtime-agent row lock at insertion, claim, USD reservation,
call start and exposure-increasing paper writes. A revoked queued check finishes as skipped without
acquiring a lease. Settling started usage, releasing reservations, manual preparation, owner closes
and public exit supervision remain available when scheduling is disabled.

`PostgresPerpsOwnerStore` (`perps-owner-store.ts`) extends the runtime store (one check-insertion
path, `insertCheck`) and implements trading's `PerpsOwnerActionRepository` over
`pickler.perps_owner_actions`: `createAction` (the API, in the request; replay by
`(product agent, request key)`, `CONFLICT` for a key used for another action, `AGENT_KILLED` for an
approval of a killed agent; a `close` names its position and an `approve` its proposal, a CHECK
holds that), `getAction`, `claimAction` (a pending row, or a running one whose 180 s claim lapsed,
becomes `running` with a fresh claim owner and `attempts + 1`; past 30 attempts it ends `failed`
`TOO_MANY_ATTEMPTS`), `startActionCheck` (one transaction: the agent row locked, the claim
re-checked, lapsed checks recovered, and an `owner` check inserted already `running` with its 60 s
lease, keyed `action:<id>:<attempt>`; `CHECK_RUNNING` while another check is live; null when the
claim no longer holds the action), `releaseAction` (back to `pending` with the attempt's code, only
for the claim that holds it), `finishAction` (the check's lease fences one transaction that
finishes the check and sets the action `done`, `failed` or `pending`) and `pendingActions` (pending
rows untouched for 30 s and running rows whose claim lapsed, for the Cron's re-drive). Beside them:
`findPosition(id)` answers the product agent and paper scope holding a position; `counts(id)`
answers all-time hourly/manual checks and `entered` checks for the record.

`PostgresPerpsPaperStore` also serves product sessions (`sessionId = "product"`, trading's
`PRODUCT_PAPER_SESSION`): `initialize(scope, version, startingCash)` takes the wallet's AUSD
(`WALLET_UNFUNDED` under `PRODUCT_PAPER_MINIMUM`, 10) and keeps the first stake on later calls;
product accounts are not version-pinned and each position records the version it opened on.
`complete(scope, lease, fill, exits?)` stores a product position's exits with its fill.
`closePosition(scope, id, reason, frame)` closes a product position from `open` exactly once (a
closed position answers `closed: false`; operator sessions are refused). Closes, here and through
the service's leased attempts, check only the scope (tenant and agent), never the agent's current
plugins, policy, network or markets: an owner's edit never strands an open position.
`openDuePositions(marks)` reads due exits across product accounts (a mark at or beyond the
liquidation estimate or the stop, then target, then time, as trading's `exitDue`), and `newMarginSince(scope, since)` sums margin opened since (positions
and their `sizeUps`, each on the day it was added). `sizeUp(scope, id, { key, margin }, frame)`
adds margin to an open product position at its leverage through trading's `applyPaperSizeUp`
(its fee reserve is `productFeeReserve` at the frame's taker fee)
(idempotent by key, recorded as a filled attempt; `POSITION_CLOSED`, `PAUSED`,
`INSUFFICIENT_AVAILABLE`), and `openNetworks()` lists networks with open product positions for
the exits job's marks. `snapshot(scope)` is the read the studio's routes use: one repeatable-read
read-only transaction with no row locks and no writes, attempts whose lease lapsed projected
`interrupted` as `view` would rewrite them; `newMarginSince` reads through it (trading's
`marginOpenedSince`). A product close loses at most the position's margin, fees included (trading's
`applyPaperFill`), so a fill past the liquidation estimate never takes cash below zero. Operator
sessions keep the version pin, the 1x policy and the 100 cap.
`PerplTransport` takes a trusted `sessionLimit` (1–24, default 12; `PERPL_CHECK_SESSION_LIMIT` is
24 for the runtime's checks and exit frames).

## Advice persistence

`PostgresAdviceStore` implements core advice ports with private jobs/events/calls in migration
0025, serialized admission, idempotency, shared execution limits and renewable fenced leases.
Started unknown charges remain reserved and block the agent; never restart their calls. The
trusted `reconcileCall` method requires terminal failure and verified evidence, uses frozen rates
and records an audit event; it has no consumer HTTP route. Apply migration before updated
research/preview admission queries. See [Agent advice](../../docs/agent-advice.md).

Advice v2 call rows record the frozen forecast provider origin, not a misleading direct-DeepSeek label. Historical v1 rows retain their original meaning. This is a JSON policy extension and requires no schema migration.

## Studio strategy attribution and USD reservations

Migration 0028 appends private RLS evidence, call and reservation tables; never rewrite 0027.
`PostgresPerpsCheckCostStore` records calls before transport under agent/check locks, uses frozen
rates and keeps unknown/start reservations across recovery. `reconcileCall` is a trusted operator
method requiring original request hash, verified usage evidence, a failed terminal check and no
active owner; it has no HTTP endpoint or provider retry.
`PostgresPerpsPaperStore` supports a product fence checked before/after each transaction, including
configuration, lease, identity and (for paid checks) active USD reservation. Opening admission
rechecks creator caps and unknown costs under that lock. Supervision and owner actions claim
unpaid leases; closers use stored scopes even after a network/plugin edit. `claimSupervision`
skips busy agents and public observations reuse the existing funding deduplication/dispute policy.
See [Studio perpetual execution](../../docs/studio-perps-execution.md).

## AI credit persistence

`PostgresAiCreditStore` implements core credit ports over eight private RLS billing tables. Migrations 0029–0031 append schema and ledger projection/immutability fences. Lock the user account before runtime/check locks; do not nest this repository inside existing admission transactions. It links existing perps_check_calls without starting models or activating billing. Failed/incomplete analyses release customer reservations without refunding internal provider costs. Run the real PostgreSQL suite in `test/ai-credit-store.test.ts`. See [AI credits](../../docs/ai-credits.md).

## Migration completion evidence

The operator migrator audits the journal before and after applying SQL, matching both hash and
timestamp. It prints a sanitized `pickler_migration_status` JSON record with applied counts, pending
tags and unknown counts; no connection values are logged. Unknown or incomplete history after
migration fails the release. The audit uses a read-only repeatable-read transaction.

`PostgresStudioAccessRequests` persists one internal team notification per user in the private RLS
`pickler.studio_access_requests` table. Owner/access rows are revalidated under transaction locks;
concurrent submissions retain their first timestamp. The inbox excludes enabled or inactive owners.
`research-access requests` lists pending entries; enable/disable retains the existing explicit
operator workflow and now uses the verified operator connection configuration.

## Rules-only study persistence

Perpetual study v3 initializes only the rules agent/account, persists empty call maps and rejects paid guards/model lanes. Free rounds do not consume or release historical monetary reservations. Reporting uses the existing read-only audit export. No tables or migrations are added.

## Local SMA review comparison

Perpetual study v4 jointly reserves sma-review, news-review and exa in existing JSONB. A shared authorization hash fences 27 calls, nine searches and USD 0.50 new reservations including checks. Existing campaign gates and historical reservations remain unchanged. searchWindow adds temporal filters without changing legacy Exa behavior.

## Explicit SMA continuation

authorizeContinuation is a trusted explicit operator operation for interrupted SMA v4 sessions only. It rejects live ownership, partial execution, unknown consumption and reused authorization; reservations and portfolios are never reset. release records interruption only for its own owner, including an expired owner, and never alters a replacement owner.

## Local universe comparison

Private universe adapters explicitly enable bulk ticker/funding reads, a three-second guarded ticker cache and the existing trusted 24-request cap; default sessions remain twelve. Study v5 reserves only selected asset calls jointly, retains their full reservations and verifies the documentary historical campaign ceiling in existing JSONB. No migrations or public DTO changes.

The explicit `rest-universe-coherent-20s-v2` laboratory policy uses `PerplMarketData.snapshotBatch`:
every invocation makes one fresh bulk ticker GET and returns only requested states present in that
response. It preserves each state's original `at.t`/`at.b` and the shared response receipt time.
The historical per-symbol method retains its guarded three-second cache. Consumers select one
acquisition policy per session; a fresh batch does not rewrite the legacy method's cache.
`onTickerRead` is an optional safe diagnostic that distinguishes network reads from cache reuse,
records requested symbols and original component dates, and contains no response bodies or headers.
Schema, identity, cancellation and permission failures never return substituted ticker states.

Study persistence accepts coherent universe v2 only when configuration v7 explicitly selects it.
Missing legacy fields retain their previous policy interpretation; contradictory frozen metadata
is rejected. Diagnostic records inherit that explicit selection without altering source studies.
The trusted `initializeDiagnostic` method also accepts an optional fourth configuration argument
for an independent v7 coherent-v2 diagnostic sourced from a historical v1 study. It validates the
configuration, permits only that acquisition selection and the new diagnostic session ID, and
retains every other frozen field and source agent ID. It creates no agents or paper accounts.

Request diagnostics v3 add optional numeric `marketId` for recognized individual-market book and
ticker paths, including requests cancelled while queued. Bulk ticker and other paths omit the
field; diagnostics never include the full URL, query or response body. Legacy v2/absent versions
remain readable. This instrumentation does not retroactively attribute historical requests and
has only controlled-test validation until separately authorized public capture.

## SMA profiles and selective exposure laboratory

Local `perps-sma-profile-risk-v1` configuration v6 has four independent variants:
`hourly-legacy`, `hourly-selective`, `fast-legacy`, and `fast-selective`. It composes no
model, news, signer, or real order capability. Preserve v1–v5 records and monetary reservations.
The new optional account `riskManagement` is assigned from the trusted study at initialization;
absence retains historical collective exposure exits. No intent can change it.

Trading exports versioned profiles through `strategies`/`evaluation`, and the bounded selective
planner through `perps`. The profile runner serializes public observations, full ledger closes,
common final refreshes, and four portfolio executions; no host may duplicate these policies.
Selective accounts admit projected post-fill exposure at most 40% of marked equity and reduce
strictly above 50% using full closes. Global emergency exits and historical risk stay intact.

Read [the local guide](../../apps/agent-service/SMA-PROFILES-RISK.md) for frozen parameters,
commands, one-shot execution, and report limitations. Tests never make paid provider calls.

## Local SMA v7 persistence and timing

The existing study/paper JSONB supports v7 with two trusted entry policies. `perps-paper-store.ts` checks persisted initial/final gates and the common final fill under the account lock, consuming a once-hourly key only with a confirmed fill. Closes retain keys; accounts without the field retain historical semantics. No migration is required. `timeEvaluationPool` measures connections, queries and transactions without logging SQL, parameters, results or credentials; it preserves PostgreSQL fences and clock semantics. Capture qualification uses a separate study diagnostic lease and does not initialize paper accounts. See [protocol guide](../../apps/agent-service/PERPS-SMA-REENTRY.md).

## Eleven-market public stream

The existing `PerplPublicStream` also exposes guarded `latest` buffer copies for a full universe,
with generation checks and cloned metadata. Public events include connection generations and
validated allowlisted messages; never capture authentication or unfiltered errors. Keep existing
message/queue/book bounds, discard disconnected state, and reconnect only within an admitted
acquisition. Diagnostic v7 overrides may select the explicit stream policy without changing
source accounts or histories. No schemas, migrations, signing, or hosted transport changes.
Stream bound errors retain their compatibility code and now carry an allowlisted dimension plus
numeric counters. Never retain rejected message bodies or infer missing historical dimensions.

The explicit universe adapter `public-universe-stream-v2` checks live ownership once per bounded
FIFO batch and applies that batch synchronously, preserving every delta and the 32-message cap.
Legacy readers retain per-message checks. Delivery and connection still perform fresh guards;
cancellation closes without awaiting a stalled ownership query. Active acquisition may request
the same subscriptions again for provider snapshots, at most once per ten seconds; it never
advances timestamps locally. Processing counters contain only safe numeric summaries.

The universe adapter `public-universe-stream-v3` reconstructs each public message
synchronously in a private replica. It has no database-backed receive queue; all wire updates
still pass the unchanged schema, identity, ordering, message-size and book-state bounds. Fresh
permission/ownership guards remain mandatory before every request and buffer delivery, and the
periodic guard closes an idle revoked reader. Replication does not admit financial writes. No
consumer can access the live replica directly; `streams()` returns subscription names only.
The previous guarded-batch mode remains available for historical controlled comparisons.

Current universe adapter v4 retains direct reconstruction and additionally copies the last
advancing heartbeat's sequence, head block and original local receipt. Exact duplicates never
refresh receipt; reset discards continuity. This proof does not alter native price/book dates.
Study diagnostics may explicitly select `stream-universe-component-20s-v2` in v7 without changing
source accounts. Financial initialization rejects this capture-only policy before writes.

The explicit v7 `stream-universe-component-paper-20s-v1` selector initializes only new laboratory
accounts with immutable `marketDataPolicy`. Every financial mutation rechecks the trusted study
policy, membership and bound live study owner. Completion recomputes both open and close fills
from hashed component/heartbeat evidence under the account lock. Unbound reads cannot recover
expired attempts in these accounts. Existing entry-gate/once-bar atomicity remains unchanged;
product accounts and historical missing fields retain strict data rules. No migration, provider
key or new monetary reservation is introduced. See [paper policy](../../apps/agent-service/PERPL-COMPONENT-PAPER.md).

Component paper persistence injects a trusted local receipt clock separately from PostgreSQL's
financial clock. Only local heartbeat/copy checks use it; leases, native freshness, funding and
ledger dates remain database-owned. Existing injected test clocks retain their default semantics.
No intent, account edit or provider can supply that clock. Keep both clocks in safe validation
diagnostics; a proven controlled offset regression does not establish missing historical values.

Component-paper captured-frame completion performs admission, simulation, persisted gate checks,
ledger/fill and hourly-key writes in one account/study-fenced transaction. It reuses the existing
admission and completion helpers and checks original-frame freshness again immediately before
commit. Expiry or ownership failure rolls back all writes, including the attempt and entry key.
Confirmed duplicate keys remain idempotent without a new fill; conflicting intents are rejected.
No live heartbeat can extend the captured proof and no legacy/product lifecycle changes.

Component-paper `observeCommon` locks both frozen study accounts in deterministic identity order,
checks membership/immutable policies/permissions and applies the existing observation function at
one database and receipt clock. Account/position/funding writes and observation records share one
transaction. Original hashes, generation and native/heartbeat freshness are rechecked before commit.
Only confirmed rollback before a commit attempt can return `data_unavailable` for demonstrated
aging. Failed rollback, uncertain commit, lost owner, identity/schema and one-account historical
observations fail closed; duplicate complete keys add no valuation or funding. No history is repaired.

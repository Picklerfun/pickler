# Infrastructure package instructions

Read [the root instructions](../../AGENTS.md) and [core instructions](../core/AGENTS.md) before changing adapters or their ports. Read any other affected project's local instructions and keep this file current.

## Responsibility and current state

`@pickler/infrastructure` implements interfaces owned by core. It exports `systemClock`, `ExaResearch` (`WebSearch`/`PageReader`), `PolymarketData` (`MarketData`) and `PostgresResearchStore` (scoped configuration, runs, evidence, decisions and job persistence). Constructors accept configuration; no credentials are embedded.

It also carries the adapters ported from Relayer for the public product: AES-256-GCM crypto byte-compatible with stored values, the Supabase JWT verifier (`jose`), Supabase admin adapters for workspaces, API keys, agents, budgets and profiles, the PostgREST client used by the growth functions, and Turnkey stamping and activity forwarding. `createSampleMarketBoard`, `createSampleLandingReadModel` and `createInMemoryApplicantStore` serve sample content for the public pages until a venue and an indexer exist. The invented agents are not here: they live in `scripts/design/fixtures/` and only the design harness's fixture API serves them; the marketplace reads its agents through `PostgresAgentDirectory` below. `createSampleMarketBoard` (`src/markets/sample-market-board.ts`) holds the six perpetual markets, the squares agents have a public call on, and a deterministic 24-hour trail derived from each mark and its change; it polls no venue and reads no chain. These adapters read the product schemas defined in `src/persistence/product/`; see [supabase/AGENTS.md](../../supabase/AGENTS.md) for the hosted project.

Actual adapters live in `src/research`, `src/polymarket` and `src/persistence`. Business policy comes from core; SQL implements transactional admission, idempotency, claims and scoped access. Drizzle defines the research tables in `src/persistence/schema.ts`, the product schemas (`identity`, `agents`, `budget`, `audit`, `growth`, `market`) in `src/persistence/product/`, and versioned SQL migrations in `drizzle/`. `0006_product_functions_and_grants.sql` is a custom migration holding what Drizzle cannot express: the `internal` helper schema, triggers, deferrable foreign keys, the `auth.users` references, the security-definer functions and the grants. It skips the Supabase-only parts when those roles or tables are absent, so it also runs on the Docker PostgreSQL. Admission, configuration, claims and scheduling lock agent rows in transactions. Never retry ambiguous research automatically. New providers must pass capability contract tests. Public runtime exports use compiled `dist`; relative source imports include `.js` extensions.

## Rules

- Depend on `@pickler/core` ports; never make core depend on this package.
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
`approved_policy_ids` is null or has fewer than two entries — nobody confirmed its rules yet — is
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
private query `schedule` uses. `PostgresStudioDirectory.createdWithKey` is a read-only lookup on
the same workspace and request key `createAgent` replays from. `PostgresResearchStore.updateSpend`
sets only the `spend` key of the stored config with `jsonb_set`, under the agent row lock. Version,
schedule and next due stay unchanged, so readiness for the current version survives.
`updateConfig` always keeps the stored `config.spend` and ignores any `spend` in its input, so
`updateSpend` is the only writer. Because saving limits does not bump the version, a config saved
at that same version would otherwise drop them.

## Agent wallet ceremony

`src/turnkey/turnkey-activities.ts` exports `createActivityBuilders`: the unsigned
`create_users` (one non-root user "Pickler" whose only credential is the delegated P-256 API key
`pickler-delegated`), `create_wallet` (named after the handle, `MONAD_ACCOUNT`), `create_policies`
and `sign_transaction` bodies, each typed against @turnkey/http with its `type` taken from core's
`AGENT_WALLET_ACTIVITY_TYPES`, so a version drift fails the build. Each builder takes an optional
`timestampMs` so a confirm can rebuild the prepared body byte for byte. Nothing here is stamped by
Pickler. The same test file pins core's `DELEGATED_CREDENTIAL_ACTIVITY_TYPES` to the SDK's
`v1ActivityType` union. `test/turnkey-activities.test.ts` also pins the result keys core reads.

`PostgresCustodyStore` implements `AgentWalletRepository`: `saveDelegatedUser` (idempotent for the
same id; a different id, or no sub-organization, is `DelegatedUserExistsError`), `saveWallet`
(wallets + wallet_accounts in one transaction; the same wallet again for its owner is a no-op,
another person's wallet id is refused), `findOrphanWallet` (an agent wallet by name with
no `agent_wallets` row), `findOwnedAgentWallet`, `hasLinkedAgentWallet` (any of the person's wallets in
`agent_wallets`), `findAgentWallet`, `saveApprovedPolicies` (see "Unified studio persistence" above)
and `saveDeposit` (lowercases the hash for the column check).

`src/turnkey/delegated-key.ts` generates Pickler's delegated key pair in Turnkey's API key format
(compressed P-256 public hex, raw 32-byte private hex; a test stamps with Turnkey's own stamper and
verifies). `npm run turnkey:delegated-key --workspace=@pickler/infrastructure` prints only the
public key of a fresh pair; `-- --append <file>` appends a pair to a local `.dev.vars` without
printing it, and `-- --print-private` prints both halves for an operator's `wrangler secret put`.

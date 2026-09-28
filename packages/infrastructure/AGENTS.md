# Infrastructure package instructions

Read [the root instructions](../../AGENTS.md) and [core instructions](../core/AGENTS.md) before changing adapters or their ports. Read any other affected project's local instructions and keep this file current.

## Responsibility and current state

`@pickler/infrastructure` implements interfaces owned by core. It exports `systemClock`, `ExaResearch` (`WebSearch`/`PageReader`), `PolymarketData` (`MarketData`) and `PostgresResearchStore` (scoped configuration, runs, evidence, decisions and job persistence). Constructors accept configuration; no credentials are embedded.

It also carries the adapters ported from Relayer for the public product: AES-256-GCM crypto byte-compatible with stored values, the Supabase JWT verifier (`jose`), Supabase admin adapters for workspaces, API keys, agents, budgets and profiles, the PostgREST client used by the growth functions, and Turnkey stamping and activity forwarding. `createSampleAgentDirectory`, `createSampleMarketBoard`, `createSampleLandingReadModel` and `createInMemoryApplicantStore` serve labelled sample content for the public pages until an indexer exists. `createSampleMarketBoard` (`src/markets/sample-market-board.ts`) holds the six perpetual markets, the squares agents have a public call on, and a deterministic 24-hour trail derived from each mark and its change; it polls no venue and reads no chain. These adapters read the product schemas defined in `src/persistence/product/`; see [supabase/AGENTS.md](../../supabase/AGENTS.md) for the hosted project.

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

Polymarket discovery round-robins a shared budget of five pages of twenty markets across configured categories. Preserve `gameStartTime` provenance, including explicit PostgreSQL timezone offsets; absent or ambiguous start times stay null. Never substitute opening or closing dates for sporting starts. Extract exact normalized public resolution URLs from description and resolution-source metadata. Core applies eligibility after discovery and selected-market refresh. Exa validates public source URLs and rejects mismatched read results.

`src/sports` implements BALLDONTLIE and The Odds API with validated structured evidence, bounded requests, permission-checked public caching and shared PostgreSQL quotas. Migration 0003 adds private cache/quota tables. Never put credentials in cache keys, source URLs or evidence. Preserve original retrieval/update timestamps. Atomic evidence and successful result writes also lock/check the current agent configuration.

`PostgresPaperStore` uses the existing pool, per-attempt private reservations and atomic agent-locked finalization. Migration 0004 adds `paper_orders`, one attempt per run and one pending/filled position per agent/market. Public projections exclude owner tokens and internal snapshots. `recover` also interrupts expired paper reservations. A test-only clock must never be wired from API/environment. Polymarket paper conditions require explicit per-market fee and trading metadata; do not default missing fees to zero.

`src/polymarket/classification.ts` maps reviewed actual provider tags and metadata to core sports classifications with versioned provenance. Never infer authorization from a query filter or ambiguous football labels. `listScope` shares the five-page budget across chosen sports; unknown classifications reach core exclusion diagnostics. Category configurations and decisions v4 use existing JSONB without DDL or historical rewrites.

`src/persistence/migrate-database.ts` applies Drizzle migrations by original hash and timestamp under
one advisory-locked transaction. This reconciles the published product/research histories without
skipping older missing migrations. Use it from both the operator command and isolated test helpers;
do not substitute the timestamp-only migrator. Unknown histories fail closed. See
[the integration guide](../../docs/frontend-integration.md) before upgrading an existing database.

## Unified console persistence

`src/console` implements workspace/runtime identity links and the PostgreSQL monetary budget ledger. `src/persistence/console-schema.ts` defines private Drizzle tables. Do not initialize lab data from deployed composition. Legacy budget authority requires verified reconciliation, never automatic hydration from a potentially stale projection. The explicit `research-access` command enables or revokes operator access; it does not call providers. See ../../docs/cloudflare-unification.md.

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

## Quantitative BTC paper pilot

`QuantData` reads explicit per-market cryptoMarketConfig and matching stream rules, opening reference, Coinbase ticker and consecutive candles. Plugins guard each request. `PolymarketPaperResolution.resolutionFor` reads immutable identities without fabricating an order. Historical proxy data is never a runtime fallback.

`comparisonTransport` is an opt-in public transport for the paired local laboratory: serial per-provider calls, 500ms minimum start spacing, 429 cooldown without retries, bounded bodies and allowlisted diagnostics. QuantData reuses raw market metadata only within one input snapshot for conditions, rechecking permission and preserving its timestamp. The transport is not a hosted fallback or global provider behavior change.

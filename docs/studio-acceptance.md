# Controlled Studio and Perpl acceptance

This suite verifies functionality and reliability, not profitability. It exercises the compiled
web, production authenticated API, local Cloudflare Queue, existing Studio versioned strategies and
real PostgreSQL repositories. It never substitutes product endpoint responses. No deployment,
real transaction, paid provider call, remote activation is introduced. Existing migrations, including the dynamic-market proposal
constraint migration 0033, are applied only to the explicitly marked disposable database.

See [Studio execution](studio-perps-execution.md) for business rules and
[trading architecture](trading-architecture.md) for ownership. The original acceptance harness started from
`ec9716669254d97fa05d8187293315f52ddf5a6a` (main including PR #97); the dynamic-market
delivery starts from `29f4ba62ce4d554245070109c27ea33dbfbb8a07`. The exact executed source
commit is recorded in each private acceptance artifact.

## Boundaries

- A separate generated Supabase project provides real authentication and product schemas on
  API port 55521 and PostgreSQL port 55522. A private UUID marker fences every test entry.
  Ordinary 54522/55432 databases, remote hosts, endpoint override parameters and wrong markers
  are refused. Existing migrations are applied only after checking this marker.
- Turnkey responses, balance reads, Perpl wire responses and model HTTP responses are controlled
  on loopback port 8798. The API and Research keep real authorization, permission checks,
  prompts, strategy registry, reservations, leases and accounting. RPC signing and broadcasting
  are refused. Supabase JWT verification remains real; credentials are not forwarded to fixtures.
- Browser passkeys use Chromium's virtual authenticator. Real browser attestation and stamp
  requests pass through existing endpoints, but the controlled Turnkey server does not establish
  real Turnkey signature/policy enforcement. Browser requests are restricted to the local web
  and dedicated local authentication endpoints. Worker provider transports reject escapes and
  redirects, including requests made after cancellation.
- The fixture dispatcher advances only scheduling time by at most one hour to exercise the
  real hourly dispatcher and Queue. Execution, freshness, deadlines and lease renewal use the
  actual production clock. This is not evidence of natural Cron delivery or remote readiness.
- Dedicated creators, wallets and paper accounts are independent for each strategy. The suite
  explicitly grants these test users operator research access in the marked database; it does
  not test email delivery or an operator access-grant interface.

## Reproduce from the repository root

Use the repository Node/npm versions, Docker, Supabase CLI and a globally installed Playwright
with Chromium. Do not install Playwright as a workspace dependency. Ports 55521/55522, 8790 and
8798 must be free. Do not stop someone else's stack to acquire them.

Prepare a fresh directory; keep its status, generated keys, browser captures and artifacts private:

```sh
npm ci
npm run build:shared
STUDIO_STACK=$(node workers/research/test/prepare-controlled-stack.mjs prepare)
supabase start --workdir "$STUDIO_STACK" --exclude realtime,storage-api,imgproxy,postgres-meta,studio,edge-runtime,logflare,vector,supavisor > "$STUDIO_STACK/start.log" 2>&1
supabase status --workdir "$STUDIO_STACK" -o json > "$STUDIO_STACK/status.json"
node workers/research/test/prepare-controlled-stack.mjs initialize "$STUDIO_STACK"
node --import tsx scripts/studio/migrate.mjs "$STUDIO_STACK"
node workers/research/test/prepare-controlled-stack.mjs expose-api "$STUDIO_STACK"
node scripts/studio/configure.mjs "$STUDIO_STACK"
node --import tsx scripts/studio/build-web.mjs "$STUDIO_STACK"
```

Do not print `status.json`, `start.log`, `*-actor.json` or `.dev.vars`. The startup log can contain
local credentials. The migration helper uses the infrastructure migrator after its fence, not an
operator's environment connection. Configuration generates ephemeral parent/delegated keys and
test-only tariffs; these are never copied into deployed Worker settings.

In a second console, run the controlled provider server:

```sh
node scripts/studio/providers.mjs "$STUDIO_STACK"
```

In a third console, start the local compiled product:

```sh
npx wrangler dev --config "$STUDIO_STACK/web/wrangler.json" --config "$STUDIO_STACK/api/wrangler.json" --config "$STUDIO_STACK/research/wrangler.json" --ip 127.0.0.1 --port 8790 --persist-to "$STUDIO_STACK/worker-state"
```

Wait for the local Worker to be ready, then run from the first console:

```sh
npm run test:studio-local -- "$STUDIO_STACK"
```

For diagnosis, append specific strategies, for example `rules deepseek jev`. This writes
`acceptance-diagnostic.json` with `fullAcceptance: false`; it is not the four-strategy acceptance
artifact. A complete run always executes all four independent accounts.

The suite exits nonzero at the first assertion failure, preserves attempts and does not repair or
retry provider failures. Polling status is not re-execution. A deliberate rerun creates new
isolated users/accounts and preserves the previous run. Stop the local Workers before rebuilding
web output. Stop only your provider/Worker processes afterwards; retain the disposable stack and
private artifacts for investigation, or stop that explicitly named Supabase project with
`supabase stop --workdir "$STUDIO_STACK"` without resetting it.

## Evidence and scenarios

Each invocation creates a private, unique `runs/<run-id>/` directory and prints only its path.
Its `acceptance.json` records the executed source commit, timestamps, controlled configuration,
strategy versions, model order, outcomes and cash oracle. Per-strategy screenshots, request
status captures and failure diagnostics stay in the private stack directory. PostgreSQL retains
configuration history, complete evidence, checks, actions, proposals, calls and movements.
Run only after committing the reviewed source to attribute this artifact to an exact commit.

The compiled journey exercises these scenarios for four independent `2.1.0` strategies with explicitly selected BTC/SOL:

| Scenario                                | Expected evidence                                                                                                                                 |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Authentication and custody              | Real Supabase JWT, virtual passkey, master wallet, agent wallet, delegated user and approved policies                                             |
| Ceremony cancellation/resumption        | Combined creator cancels before signing and after wallet creation; step two resumes with exactly one agent wallet                                 |
| Draft creation                          | Concurrent replay of the same wallet/terms returns the same product id; changed terms refuse wallet reassignment                                  |
| Owner isolation                         | Missing/invalid JWT rejected; subsequent creators cannot read prior creators' agents or positions                                                 |
| Setup and publication                   | Current version and strategy saved; publication rejected with controlled insufficient funds; publication never enables scheduling                 |
| Preparation and scheduling              | Not-ready scheduling refused; complete current v2 check enables explicit Controls activation; real dispatcher sends a Queue check                 |
| Model routing                           | Rules makes no calls; DeepSeek uses `direct`; Jev uses `jev`; combined uses its own `fallback` then `review`                                      |
| Opening and approval                    | Actual book fills; creator's unchanged five-AUSD sizing and one-position cap; combined approvals go through owner-action Queue                    |
| Partial evidence / Console read failure | BTC valid and SOL stale fails before paid calls; aborted record read shows retry and recovers from the real endpoint                              |
| Market removal                          | Sources form removes a held market, increments version, disables scheduling, invalidates preparation; supervision and paused owner close continue |
| Maintenance and signal exit             | Position held, then signal closes it with no same-check reopening; separate later check can reopen                                                |
| Stale data                              | Check fails before model calls; later public data remains usable for exits                                                                        |
| Pause and manual exit                   | Entries paused and scheduling disabled; owner close still completes through Queue; API/UI show persisted closed positions                         |
| Accounting                              | Independent integer sizing/fee/spread oracle matches cash; call started before controlled transport and exact usage cost persists                 |
| Interface                               | Actual rail navigation and product requests, no inert preview stages; no browser page/hydration errors                                            |

The synthetic tariff is 100,000 micro-USD per million input/output tokens. Controlled usage is
100 input plus 10 output tokens, so each call costs exactly 11 micro-USD in the test ledger.
These are test prices, not a claim about provider pricing, and no USD is actually charged.
Fills use the captured market precision and taker rate (345 micros). Funding fixtures include a
known zero-rate historical anchor before the execution block, with no eligible application;
missing history is never interpreted as zero. The oracle computes quantity with integer lots,
entry/exit book prices, rounded fees and spread independently of trading helpers.

Other failure scenarios are covered by the existing business and real-PostgreSQL suites rather
than claimed as separate browser journeys:

| Scenario                                                                        | Reproducible coverage                                                                                  |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Incompatible rules brief, uncertainty, veto, invalid citations                  | `packages/trading/test/studio-perps-strategies.test.ts`, core setup tests                              |
| Caps, small entry, approvals, mandatory exits                                   | `packages/trading/test/studio-perps-execution.test.ts`, runtime action and paper-product tests         |
| Concurrent reservations, unknown USD costs, lease loss, recovery and revocation | `packages/infrastructure/test/perps-runtime-store.test.ts`, paper persistence and Studio runtime tests |
| Funding positive/negative, duplicate, future, pending and corrected             | `apps/agent-service/test/perps-simulator.test.ts` and paper persistence tests                          |
| Format/transport failures and no paid retry                                     | Runtime model/Studio runner tests; provider fixture modes are available for further diagnosis          |
| Invalid stack and cancelled/redirecting transport                               | Infrastructure controlled-worker tests and both Workers' Studio fixture isolation tests                |

Run `npm test`, `npm run typecheck`, `npm run lint`, `npm run format:check`,
`npm run check:architecture`, `npm run api:openapi -- --output /tmp/pickler-openapi.json`,
`npm run build:workers` and the affected design checks. The ordinary test suite skips its optional
generic local Worker flow unless explicitly configured; this Studio journey is a separate
explicit command and must not be described as having run merely because `npm test` passed.

## Historical baseline corrections and remaining acceptance

The original 2.0.0 controlled journeys passed for all four strategies. For current 2.1.0 coverage,
see the delivery table in [agent-selected Perpl markets](studio-perpl-markets.md). The final
`acceptance.json` is the authoritative record of the complete run against its recorded commit;
never infer a complete run from separate diagnostic artifacts. Regression coverage below uses
production policies and real isolated PostgreSQL, not a second trading implementation.

| Area                                                                        | Status                                 | Evidence                                                                      |
| --------------------------------------------------------------------------- | -------------------------------------- | ----------------------------------------------------------------------------- |
| Creation, custody resumption, ownership and duplicate draft protection      | Passed with controlled custody         | Compiled UI, existing endpoints, PostgreSQL assertions                        |
| Current-version manual preparation                                          | Corrected and passed                   | Transactional marker regression and full UI/Queue journey                     |
| Perpl scheduling eligibility and explicit Studio activation                 | Corrected and passed                   | Core readiness matrix, PostgreSQL and real local dispatcher                   |
| Four v2 strategies, approval, holding, signal exit and manual paused exit   | Passed with controlled providers       | Strategy-specific routing, actual Queue and independent cash oracle           |
| Stale data, lease loss, revocation, unknown costs and funding discrepancies | Passed in controlled regression suites | Runtime, trading and real PostgreSQL suites; stale data also crosses UI/Queue |
| Hydration and strategy accessibility                                        | Corrected and passed                   | Compiled browser has no page errors and finds the labelled strategy control   |
| Real Turnkey policies/passkeys, providers and deployed infrastructure       | Pending                                | Requires separate operational acceptance; this delivery does not activate it  |

Corrections preserve strategies, prompts, limits and existing HTTP contracts:

1. Complete current manual Studio v2 checks record connection preparation under ownership;
   failed/incomplete/legacy/stale completion cannot manufacture it or restore revoked readiness.
2. Shared schedule readiness uses authorized Perpl markets instead of sports categories.
3. Published Controls expose explicit scheduling. Presentation distinguishes available runtime
   from enabled scheduling; publication alone does not claim hourly execution.
4. The strategy selector has an explicit accessible name. Passkey device text has an identical
   server/hydration snapshot, including closed sheets.

Still pending: real Turnkey/passkey signature and policy acceptance, real balances/provider
responses, deployed Queue/Cron/Hyperdrive behavior and deployed configuration/secrets. Controlled
funding and fees do not prove exchange accounting equivalence. This suite establishes neither
profitability nor authorization to activate real execution.

The previous 2.0.0 acceptance at main commit 29f4ba62ce4d554245070109c27ea33dbfbb8a07 is historical. Current market selection coverage uses the current 2.1.0 adapters without translating old answers. To preserve an existing dedicated stack, run `node workers/research/test/prepare-controlled-stack.mjs prepare alternate`; this creates a fresh marked stack on the fixed 55531/55532 ports. All remaining commands take that generated directory as before.

See [agent-selected Perpl markets](studio-perpl-markets.md) for current catalogue, version, migration and exit-preservation rules.

# Product map: conventions and shared decisions

Status: draft, decided autonomously on 2026-09-30 for the overnight scope session. Every spec in
`docs/specs/*-v1.md` written in that session follows this file. Where a spec needs to depart from it,
it says so and why.

## Products and wallets (owner's rule, 2026-09-30)

| Product     | Surface                                                                             | Wallet                                                                                   |
| ----------- | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Studio      | web, `studio.pickler.fun`                                                           | Turnkey (passkey custody: master wallet, per-agent wallets, delegated user)              |
| Marketplace | web, `app.pickler.fun`                                                              | Mera (passkey wallet), or an injected EOA (MetaMask etc.) for people who don't want Mera |
| Marketplace | mobile app (React Native, separate repository, TestFlight bundle `fun.pickler.app`) | Mera only; no EOA                                                                        |
| Landing     | web, `pickler.fun`                                                                  | none                                                                                     |

Turnkey never appears in the marketplace; Mera never appears in the studio. A marketplace account is
a Supabase user created by wallet sign-in (SIWE), whichever wallet signed.

## Autonomous product decisions

These unblock the specs. Each is reversible and listed again in the scope map for the owner.

1. **Decisions become public when they resolve,** not when they are made. Until then only the owner
   (studio) and paying readers see them. This protects what paid reads sell.
2. **Every decision resolves.** A resolution job records, for each decision (trades and abstentions),
   what happened, and that record is the source of hit rate, calibration, P&L, the leaderboard and
   receipts.
3. **Paid reads v1 are paid in AUSD on Monad** to a Pickler read treasury address, verified on chain
   by the API, recorded in a ledger, refunded automatically when the agent misses its clock, and
   paid out to the agent owner's master wallet in batches. An escrow contract is v2.
4. **The agent owner sets the read price** in the studio (Go Public and the agent's Pricing section),
   within bounds Pickler sets.
5. **Launching a token is gated:** only the owner of a public agent (one that has gone through Go
   Public) may launch its token, once, with a launch authorization signed by Pickler's backend key
   that binds the agent key to the creator. The creator signs with the studio's Turnkey master wallet
   (passkey).
6. **The launchpad goes to Monad testnet first,** with the rescued PR #37 integration fixes
   (`codex/rescue-launchpad-integration-fixes`) rebased, not rewritten.
7. **Perpl goes testnet first, then mainnet.** The agent's Perpl trading key (Ed25519) is generated and
   held by Pickler, encrypted like the delegated key; every funding step and the key enrollment is
   signed by the owner's passkey; orders go through the trading worker, never the model.
8. **Jev and the benchmarks stay experiments.** Decision review in the product is the owner's view of
   rules, sources and resolution, not a second model.
9. **Production is its own environment:** production Worker configs, a production Supabase project
   decision recorded by the owner, a release pipeline with a deployment ledger, and a readiness
   verifier. Staging stays.

## API conventions

- One public API, `workers/api`, mounted under `/v1`. Browsers and the mobile app reach it through the
  web proxy at `https://app.pickler.fun/api/v1/...` (marketplace) and
  `https://studio.pickler.fun/api/v1/...` (studio).
- Route groups: `/v1/marketplace/*` (public reads, no credentials), `/v1/me/*` (a signed-in
  marketplace account), `/v1/studio/*` (a studio account), `/v1/signing/*` (Turnkey ceremonies),
  `/v1/auth/*` (wallet sign-in), `/v1/agents/*` (the agent HMAC API), `/v1/internal/*` (workers only,
  service binding, never public).
- Auth: a Supabase JWT as `Authorization: Bearer`. Workers call each other through service bindings.
- Envelope: success `{ data, meta }`, error `{ error: { code, message, detail? }, traceId }` with a
  stable `SCREAMING_SNAKE` code. 400 invalid input, 401 no session, 403 not allowed, 404 not found,
  409 state conflict, 429 rate limited (with `retryAt`), 503 a dependency is off.
- Money: integers in micro-units (`amount_micro_ausd bigint`); never floats. Times: ISO 8601 UTC in
  JSON, `timestamptz` in Postgres.
- Idempotency: every POST that moves money or creates something takes an `Idempotency-Key` header.
- Pagination: cursor-based, `?cursor=&limit=` (max 100), response `meta.nextCursor`.
- DTOs live in `packages/api-schema` (zod). Business rules in `packages/core` / `packages/trading`.
  Postgres in `packages/infrastructure`, migrations through Drizzle (next number: 0023).

## Spec format

Each spec file: status line ("Draft — decided autonomously 2026-09-30"), 1 Problem and users,
2 Decisions (table: decision, reason, reversible?), 3 User flows, 4 API (method, path, auth, request,
response, errors), 5 Data model and migrations, 6 Integrations (external systems, keys, contracts,
env vars), 7 Design work (screens, states, which canvas exists or must be drawn, for which surface),
8 Security and abuse, 9 Acceptance criteria and tests, 10 Rollout and dependencies (specs it needs
first), 11 Out of scope, 12 Open questions for the owner. Cite current code as file:line when it
constrains the design.

## Decisions taken after the cross-review (2026-09-30)

These resolve the blockers in `docs/product-map/cross-review.md`. Specs follow them.

10. **Paid-read answers stay private to the buyer.** A paid read is never published at delivery. After
    it resolves, only its outcome card (question, called side, result, both clocks met or not) may be
    public, never the reasoning or sources. The resolution job scores paid reads with
    `audience = buyer` and public-record only lists decisions with `audience = public`.
11. **Pickler pays for the research behind a paid read,** out of its fee, never the owner's research
    budget. `paid-reads-v1` sets the per-read compute ceiling at the lower of 10% of the price and
    2 AUSD, so a read never costs Pickler more than its 10% fee; `research-runtime-v2` enforces it as a
    separate `reads` budget scope. (Amended after review: an earlier 20% ceiling exceeded the fee.)
12. **Perps decisions get their own protocol spec,** `perpl-agent-runtime-v1.md`, which defines
    `perps-direction-v1` (instrument, direction, entry, horizon, resolution by Perpl mark price). The
    cycle between `perpl-live-v1` and `research-runtime-v2` is broken by both depending on it.
13. **Price observations are owned by `decision-resolution-v1`,** as a `PriceObservationSource` port:
    the Polymarket CLOB price at a target time (±5 min, from Polymarket's public price history),
    Perpl mark price for perps. `paid-reads-v1` uses it for the second clock. The name "Pons" is
    retired.
14. **Moving Mera's relying party gets a migration window.** For 90 days after the cutover the apex
    `pickler.fun` keeps serving `webcredentials` for the app, and the app offers "Move your funds":
    it derives the legacy (pickler.fun) address, shows its balance and sweeps it to the new
    (app.pickler.fun) address. Owned by `mobile-backend-v1` and `product-hosts-cutover-v2`.
15. **Scheduled work has two homes:** product jobs (payouts, refunds, notifications, graduation
    keeper, exit checks) run in `workers/jobs`; platform housekeeping (sweepers, retention, alerts,
    DLQ consumers) runs in `workers/ops`. Decision resolution stays in `workers/research`. The API
    has no crons.
16. **The nonce rate limit is owned by `operations-v1`** (one `RATE_LIMIT_SALT`, one table).
17. **Backups include every schema,** the `reads` ledger first among them.

## Decisions taken after the scope map (2026-09-30)

These close the disagreements listed in `docs/product-map/scope-v1.md` §9.4.

18. **`workers/jobs` is a scheduler only:** no database binding and no secrets. Each cron calls an
    internal route on the API (`/v1/internal/*`) or on trading (through the `TRADING` binding), and
    that Worker does the work, writes its own heartbeat and consumes the queues. Queues are consumed
    by the API (notifications, account jobs) or by trading (orders). Money housekeeping that needs
    product rules (deposit reconciler, refunds, payouts) is dispatched by jobs; pure housekeeping
    (sweepers, retention, the media sweeper, alerts, DLQ consumers) runs in `workers/ops`.
19. **`decision-resolution-v1` owns the shape of `pickler.decision_live_pnl`;** `perpl-live-v1` writes
    rows in that shape.
20. **`perpl-agent-runtime-v1` owns the perps decision and the paper account; `perpl-live-v1` owns live
    positions and live exits.** A live testnet agent is scored on testnet and labelled so. The
    default perps horizon is 24 h and the default schedule every 6 h, leaving runs for follow-ups.
21. **A paid read's price must fund its run:** `paid-reads-v1` refuses a price whose compute ceiling
    (decision 11) is below `research-runtime-v2`'s estimated read-run cost, and the minimum price is
    5 AUSD. The read lane allows up to 3 concurrent read runs per agent and 10 globally, and an
    agent's daily capacity is capped by what the lane can deliver within its clock.
22. **Email:** addresses for receipts and notifications live only in `identity.notify_emails`; the
    API sends through Resend (the sender and templates are owned by `operations-v1`); no route
    returns `EMAIL_REQUIRED`.
23. **Every marketplace-account table keys on `auth.users.id`,** including `media.uploads`; none has a
    foreign key to `identity.profiles`. Account deletion removes rows explicitly (`custody-v2`).
24. **The incident fix never opens anything:** Step A deploys only the API from main, with research,
    trading and indexer untouched, admissions closed and no `TURNKEY_RPID` set on staging (that
    stays `localhost`-style disabled until the host cutover, per `product-hosts-cutover-v2`). `main`
    already serves `/v1/health` through the growth routes (`workers/api/src/routes/growth.ts:31`).

## Convention amendments from the cross-review (2026-09-30)

These amend the sections above; where they disagree, this section wins.

- **Route groups.** `/v1/me/*` is any signed-in account (marketplace or studio) acting on its own
  data. `/v1/agents/*` is no longer the agent HMAC group (retired by `research-runtime-v2`); the
  studio's agent routes live under `/v1/studio/*`. The only backend route outside `/v1` is the ops
  operator endpoint (`operations-v1`).
- **Status codes.** Also allowed: 413 (payload too large), 426 (app version too old, mobile only),
  502 (an upstream venue or provider answered badly). A resource that belongs to another owner
  answers 404, never 403, so existence is not revealed.
- **`retryAt`** always lives in `error.detail.retryAt`, for every status that carries it.
- **Money.** User money is micro-AUSD (`*_micro_ausd`, `amountMicroAusd`). Provider costs (model,
  search, data) are micro-USD (`*_micro_usd`), because providers bill in USD; AUSD is taken as 1:1 with
  USD only where a spec says so.
- **Backend keys in Turnkey.** The owner's rule governs person-facing wallets. Pickler's own backend
  keys (the delegated user, the launch authority, the read treasury) may live in Turnkey; that is
  custody for Pickler, not a user wallet in the marketplace.
- **Decision 1, reworded.** Decisions become public when they resolve, except paid-read answers, which
  never become public (decision 10); only their outcome card may.
- **Naming.** The studio's read configuration section is called "Reads" (not "Pricing").
- **Known envelope exceptions.** Existing studio and marketplace routes keep their current bare bodies
  until the web and the mobile app switch together (`public-record-v1`, `mobile-backend-v1`).
- **Migrations.** No spec owns a number. Each migration is named; numbers are assigned at build time in
  the order of `scope-v1.md` §5, starting at 0023.

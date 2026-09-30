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

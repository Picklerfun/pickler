# Cloudflare Polymarket pilot

## Delivery boundary

This integrates the existing Deposit Wallet adapter with a private trading Worker and the studio.
Controlled validation is not live-order acceptance. No model receives a signer or an executable
trading tool. Launchpad contracts and agent-evaluation work are independent.

Browser → web Service Binding → Hono studio API → trading Queue → trading Worker → Polymarket.
The research Worker sends generic wakeups after completion; Cron recovers lost wakeups each minute.
PostgreSQL remains authoritative. Queue concurrency is one; a short database transaction fences
competing consumers. API and research contain no signer or CLOB credentials.

## Permissions and limits

An operator binds a runtime tenant/agent to an immutable public wallet/signer pair and explicitly
enables it. Registration and research enablement do not grant trading. The `polymarket` and
`polymarket-trading` plugins, rules/book tools, unpaused agent, current configuration and trading
mode are independently required. The web cannot supply alternate identities or keys.

The shared lifetime ceiling is 10 pUSD, with at most 5 pUSD per BUY/FOK purchase. Pending and unknown
orders reserve their full maximum. Confirmed purchases conservatively debit that maximum; it is
not an exact fee or spend measurement. Rebinding cannot reset the ledger. Deposit deployment or
approval gas is outside this trading ceiling and requires separate explicit preparation.

A confirmed manual purchase permits the owner to explicitly enable automatic mode. It never
switches that mode itself. The automatic candidate must be a current policy-approved v3/v4 TRADE.
ABSTAIN is never promoted. A durable automatic attempt is recorded before provider preparation;
a failed automatic preparation cannot start again on another wakeup or research. Successful
autonomous reconciliation closes the account atomically. No reset endpoint exists.

NFL full-game winners retain their existing protocol checks. Soccer requires reviewed match
classification, an explicit winner market type and timing language in the resolution rules;
ambiguous or other market types are rejected. Shared scope/time eligibility applies again on
refresh. This deliberately does not extend paper trading or support awards and season markets.

## Lifecycle

Prepare returns a sixty-second confirmation preview. Enqueue reserves the maximum transactionally.
The consumer owns a sixty-second lease, renewed every fifteen seconds, with a forty-five-second
execution timeout. Ownership/configuration is checked before provider operations and again inside
the SDK signing callback. A refreshed quote must be no older than thirty seconds. Losing ownership
blocks new signing and durable submission writes; it cannot undo a provider request already sent.

Persisted intent, refreshed snapshot and deterministic order hash precede submission. After that
handoff, recovery only queries the same hash. An unavailable response or 404 is not evidence that
no order was sent. Unknown orders retain their reservations. Disabling admissions, plugins or an
agent does not disable reconciliation of submitted orders.

`settled` means confirmed exchange trades and a corresponding wallet position were observed. It
is not resolution of the sports event. Persisted transaction hashes and shares remain readable.
This release has no sales, withdrawals, event settlement or continuous autonomous purchases.

## Studio and HTTP

The Limits & funding section shows the bound public wallet, reserved/debited maximums, account
check, mode controls, manual preview/confirmation and order history. Active orders use the existing
three-second polling helper, suspended while hidden. Read results are private and uncached.

Paths below are under `/api/v1/studio`; writes require user JWT, workspace owner access and an
`Idempotency-Key`. Service Bindings do not replace authentication. Reuse keys after ambiguous HTTP
responses; a new key is a new intent, not a safe submission retry.

| Endpoint                            | Purpose                                                       |
| ----------------------------------- | ------------------------------------------------------------- |
| `GET /agents/:id/trading/account`   | Public bound identity and budget                              |
| `POST /agents/:id/trading/check`    | Explicit provider access, balance and approval check          |
| `POST /agents/:id/trading/prepare`  | Preview `{marketId,outcomeId,limitPrice,budget}`              |
| `POST /trading/orders/:id/submit`   | Confirm unchanged preparation; empty body                     |
| `POST /runs/:id/live-order`         | Explicit execution of a current approved decision; empty body |
| `GET /agents/:id/trading/orders`    | Scoped history including confirmed purchases                  |
| `GET /agents/:id/trading/positions` | Persisted confirmed purchases, not current balances           |
| `GET /trading/orders/:id`           | Scoped detail                                                 |

## Provisioning and migration

First validate migration `0010_far_vengeance.sql` against an isolated database. It adds an off-by-default
account flag and private RLS-protected automatic-attempt records. Existing wallet/order history is
preserved. Stop legacy trading loops before migration; their binary does not implement current
operator fencing. Do not expose `pickler` through the Supabase Data API.

Use the existing reconciled migration command with an explicitly selected operator connection:

```sh
npm run build:shared
npm run db:migrate
npm run trading-access --workspace=@pickler/infrastructure -- TENANT_ID AGENT_ID bind
npm run trading-access --workspace=@pickler/infrastructure -- TENANT_ID AGENT_ID enable
```

`trading-access` reads exported `DATABASE_MIGRATION_URL`, `APP_ENV` and optional `DATABASE_CA_CERT`;
`bind` additionally reads the public `POLYMARKET_WALLET_ADDRESS` and `POLYMARKET_SIGNER_ADDRESS`.
It never creates wallets or calls providers. Obtain IDs from the verified product/runtime mapping,
not alpha/beta. Keep research schedules disabled. `disable` revokes new purchases and preserves
history. An already completed autonomous pilot stays blocked even if an operator enables its flag.

The local `wallet:init` command writes the signer into the existing ignored agent-service `.env`,
with mode 0600. `trading:setup` requires explicit `TRADING_TENANT_ID` and `TRADING_AGENT_ID`, Builder
credentials and a selected database. It prepares the Deposit Wallet/CLOB identity. `--approvals`
is separate. Never fund the signer address assuming it is the Deposit Wallet address.

Builder credentials are obtained through Polymarket Settings → Builders. Refer to the current
[official authentication documentation](https://docs.polymarket.com/trading/wallets-auth).
The pinned adapter uses `@polymarket/client` 0.10.0; account setup is operator-only and separate
from Worker startup. The provider's geographic restrictions must not be bypassed.

## Staging resources and secrets

- Worker `pickler-trading-staging`: private Service Binding, Queue and Cron; no public HTTP route.
- Queue `pickler-trading-queue-staging`: one message and one consumer at a time.
- Existing trusted `DATABASE` Hyperdrive binding, verified origin TLS and query caching disabled.
- Each invocation owns and closes its PostgreSQL pool, capped at two connections.
- API `TRADING_EXECUTOR` binding targets that Worker. API and research have generic Queue producers.
- Both API and trading admissions default to `TRADING_ADMISSIONS_ENABLED=false`.
  Explicit read-only connection checks remain available to an enabled owner while purchases are closed.

Only the trading Worker receives these secrets, through Wrangler's native secret commands:
`POLYMARKET_SIGNER_PRIVATE_KEY`, `POLYMARKET_SIGNER_ADDRESS`, `POLYMARKET_WALLET_ADDRESS`,
`POLYMARKET_CLOB_API_KEY`, `POLYMARKET_CLOB_API_SECRET`, `POLYMARKET_CLOB_API_PASSPHRASE`.
Never upload Builder credentials, backend secrets to web, or a test fixture entrypoint.

After tests, record the source commit and existing Worker versions. Create the dedicated Queue,
verify migration history, configure executor secrets, publish trading, API, research and web in
that order. Leave trading closed until the bound account and funding are verified. Runtime startup
does not create accounts, enable agents, grant approvals or invoke paid research. Missing executor
credentials produce explicit configuration failure, not simulated execution.

Rollback closes API/trading admissions and preserves reconciliation with compatible code and the
same wallet secrets. Do not roll back the database or remove unresolved orders. Research admissions
are independent and need not be changed for this pilot.

## Acceptance record

Run format, lint, typecheck, `test:supabase`, workspace builds and `build:workers`.
The normal suite includes the offline workerd SDK signing fixture; it uses a public unfunded test
key and no provider requests. It does not prove live CLOB reachability or a funded purchase.

Remote acceptance remains explicit: verify provider access without circumventing restrictions,
prepare Deposit Wallet and approvals, display funding requirements, then the user confirms one
manual purchase. After explicit automatic activation, at most two real researches may produce one
eligible purchase. A technical failure, unknown result or abstention does not authorize an extra
order. Record order IDs, transaction hashes, source commit, versions and remaining limitations;
never describe compilation or controlled signatures as a successful real bet.

## Staging record — 2026-09-24

Backend source: `c59d9dd76bdbf927ebf71861ad10f08e1e4241c0`.
Web source: `65397a8fabb534fd3b9dab3bbf15ac6d6d8f4771` (single-file UI follow-up).
Base: `85f33a5ead5316ab928e1649f9f13991396e2506`, verified current main before publishing.

- Full controlled Supabase suite: 304 passed, zero failed; one pre-existing dedicated
  three-Worker stack test skipped because its separate stack was not launched.
- Format, lint, all workspace types/builds and four Worker builds passed.
- Offline SDK signature/hash test passed in actual local workerd; it sends no order.
- Additional browser test exercised the real trading section and Hono routes against an isolated
  PostgreSQL database with a controlled provider and fixture identity. Preview displayed the
  outcome/maximum; confirmation persisted exactly one simulated submission, `settled`, ten shares,
  a 5,000,000-micro-unit upper-bound debit and zero reservations. Reload preserved history and
  disabled the manual form. This was a section harness, not a hosted authenticated acceptance.
  Its disposable database was cleaned up; no provider request or real wallet was involved.
- Hosted migration history advanced from ten to eleven entries through verified TLS. No live
  orders existed before migration; no historical orders were deleted or rewritten.
- Dedicated Queue created. API and executor trading admissions remain false. No account is bound
  or enabled for this release; no executor secrets are installed. API has no Polymarket secrets.
- Anonymous console trading reads return 401 and private/no-store; the executor's workers.dev
  hostname returns 404. The console itself returns 200 with private/no-store.
- The first web upload lacked public Auth build values. It was rolled back to the previous
  verified version, rebuilt with the staging project's public Auth configuration, and verified
  against Supabase Auth (200) and in the browser. The final web build uses Next.js's native ignored
  `.env.production.local`; it contains public values only, never backend/signing keys.
- The current browser has no authenticated user session. Hosted account linking and the private
  trading-screen walkthrough remain pending that login.
- A new local signer was generated in the existing ignored agent-service `.env` with mode 0600.
  Deposit Wallet setup, Builder/CLOB credentials, approvals and funding remain pending. The signer
  address is not a funding instruction. No live order or paid research ran in this delivery.

Previous compatible versions (rollback):

| Worker   | Version                                |
| -------- | -------------------------------------- |
| API      | `b4843142-7e6c-486e-ab9e-e9deb6b02d9d` |
| Research | `96a4a713-f15e-4768-871b-b59e4dd08079` |
| Web      | `163c0924-5505-4e96-b26c-943268510d80` |

Current versions:

| Worker   | Version                                |
| -------- | -------------------------------------- |
| Trading  | `950da5ec-512f-4b47-9c3e-227e5d3371a3` |
| API      | `f684f268-af73-490c-99e9-6e557aed5a1d` |
| Research | `0590242c-a467-4398-a21f-01df37919f9e` |
| Web      | `9ca558e3-6b33-4264-b240-58fb7690e5ac` |

# Local Polymarket trading pilot

## Current Cloudflare extension

Read [the Worker guide](../../docs/polymarket-worker-pilot.md) for current delivery, staging and
acceptance boundaries. The current implementation replaces the alpha-only restriction with an
operator-bound account and adds reviewed soccer match winners. Setup requires explicit tenant
and agent IDs. Accounts default disabled after migration 0010. The following original delivery
record describes the earlier local-only implementation; it is not current deployment evidence.

## Original delivery status

This delivery implements the integration software and controlled tests. No pilot wallet was generated, funded or operated during implementation. No live order, approval transaction, paid research or deployment was performed. Real-provider acceptance remains an operator-run step; passing fixtures is not evidence of a successful live bet.

The pilot is restricted to `alpha/pickle-alpha`, Polygon chain 137, and NFL full-game winner markets. The existing broader research catalog is unchanged. Both the `polymarket` and `polymarket-trading` plugins must be enabled, the market rules/book tools must be permitted, and the agent must be unpaused. There is no trading or signing tool exposed to the model.

Research and execution are separate. A manual request can test the integration without inventing a model recommendation. Agent-origin execution requires an unchanged, completed, unexpired v3/v4 NFL `TRADE` approved by core. It never promotes an abstention. Automatic execution additionally requires an explicit `automatic` configuration and a previously settled manual pilot order.

## Account and credentials

The pinned official `@polymarket/client` SDK uses a signer and a Deposit Wallet. The signer address is distinct from the Deposit Wallet address that holds collateral and positions. CLOB API credentials authenticate account requests; they do not replace the signer for order signatures. This is a mainnet integration, not a funded testnet or sandbox.

Operator-only commands, from the repository root:

```sh
npm run build:shared
npm run wallet:init --workspace=@pickler/agent-service
npm run trading:setup --workspace=@pickler/agent-service
# Explicitly request trading approvals, if required:
npm run trading:setup --workspace=@pickler/agent-service -- --approvals
```

`wallet:init` uses cryptographic randomness and writes `POLYMARKET_SIGNER_ADDRESS` and `POLYMARKET_SIGNER_PRIVATE_KEY` into `apps/agent-service/.env`. The file is ignored by Git, atomically replaced with mode 0600, and protected against duplicate/incomplete wallet fields and symlinks. An existing matching wallet is retained. Output contains only the address and whether it was created. This is plaintext local operator custody, not a production secrets manager. The command does not deploy an account, fund it or call a provider.

Before `trading:setup`, the operator supplies the builder API key/secret/passphrase. Setup may deploy the Deposit Wallet through the SDK, obtains CLOB credentials, saves them locally and binds its public wallet/signer identity in PostgreSQL. `--approvals` is a separate explicit request for on-chain trading approvals. Setup never funds an account or submits an order. The runtime never deploys wallets or grants approvals. Rebinding the database account to a different identity is rejected; it cannot reset the pilot budget.

All names are in `.env.example`. Runtime activation requires the signer private key/address, Deposit Wallet address and CLOB key/secret/passphrase. Builder credentials are for the explicit setup command, not the worker. Do not place credentials in agent configuration, prompts, requests, events, PRs or repository files.

## Migration and activation

Stop old service processes before applying migration `0005_little_umar.sql`. Validate migrations in an isolated database first. The migration creates private, RLS-enabled `pickler.trading_accounts` and `pickler.live_orders`; it preserves research and paper records. Do not expose these schemas through Supabase's Data API.

```sh
npm run db:migrate
```

The application defaults to `POLYMARKET_TRADING_RUNTIME=off`. Only the operator can opt in by selecting `node` in the local environment and restarting the Node service. The Cloudflare background composition explicitly forces trading off; this delivery does not deploy a signing executor or transport its keys to Workers.

Using the existing versioned configuration endpoint/CLI, preserve the agent's other settings and add:

```json
{
  "trading": { "version": 1, "mode": "manual" },
  "plugins": {
    "version": 1,
    "enabled": ["polymarket", "exa", "polymarket-trading"]
  }
}
```

This is a fragment, not a replacement for the full agent config. Historical configurations remain off. `manual` permits explicit submission; `automatic` additionally admits eligible completed research. Updating configuration invalidates unsent work. Pausing or disabling either required plugin blocks new purchases. Reconciliation of already submitted orders continues so revocation does not erase external financial facts.

## Requests and commands

All routes are under the existing local `/pilot` API and require the tenant token. Write requests require `Idempotency-Key`. No route accepts signer credentials, signed payloads or tenant overrides.

| Endpoint                                            | Behavior                                                              |
| --------------------------------------------------- | --------------------------------------------------------------------- |
| `GET /agents/:id/trading/account`                   | Public bound identity and persistent budget counters                  |
| `POST /agents/:id/plugins/polymarket-trading/check` | Explicit access/balance/approval check, without signing or submission |
| `POST /agents/:id/trading/prepare`                  | Validate a manual request and prepare a short-lived quote             |
| `POST /trading/orders/:id/submit`                   | Atomically reserve capacity and return `202`                          |
| `GET /trading/orders/:id`                           | Poll an order's public state                                          |
| `POST /runs/:id/live-order`                         | Explicitly request execution of an eligible completed research result |
| `GET /agents/:id/trading/orders`                    | Latest 100 persisted attempts                                         |
| `GET /agents/:id/trading/positions`                 | Persisted confirmed purchases; no sale/settlement lifecycle yet       |

A manual preparation body has exactly `marketId`, `outcomeId`, `limitPrice` and `budget`, using provider IDs and decimal strings. The outcome must belong to the selected, eligible NFL market. The order remains `prepared` until explicit submission. Submission bodies are empty objects; callers cannot change a prepared price, size or destination.

CLI equivalents:

```sh
npm run agent -- trading-account alpha
npm run agent -- trading-prepare alpha ./buy.json unique-preparation-key
npm run agent -- trading-submit alpha ORDER_ID unique-submission-key
npm run agent -- trading-result alpha ORDER_ID
npm run agent -- trading-run alpha RUN_ID unique-research-key
npm run agent -- trading-orders alpha
npm run agent -- trading-positions alpha
```

Keep an idempotency key stable when checking an ambiguous HTTP response. A different key is not a retry mechanism. Quotes expire after 60 seconds; a new preparation is a new explicit intent. An expired, failed or unknown attempt is never automatically resubmitted.

## Execution, spending and reconciliation

- One successful manual purchase and one successful agent-origin purchase, at most 5 pUSD each. The shared lifetime ceiling is 10 pUSD, persisted across processes/restarts. Limits count unresolved reservations and conservatively charge the entire authorized budget for confirmed purchases. The ceiling covers order collateral, not account deployment or approval gas. It is not a spend allowance for other software using the wallet.
- The Node executor runs a separate awaited trading loop. PostgreSQL claims use a private 60-second owner token; only that owner can move an unsent order to the durable submission state. The configured SDK creates BUY/FOK orders with a maximum spend and price. Insufficient depth/minimum-size violations prevent submission. The provider minimum size is interpreted as shares in this adapter.
- Preparation and execution check provider access restrictions, balance and approvals. The worker refreshes the book, verifies the scope, quote age (30 seconds), config and lease, and stores the refreshed preview plus deterministic exchange order hash before submission. Integer arithmetic governs persistent monetary limits. Preview quantities/fees are estimates; the SDK constructs the bounded signed order.
- After durable submission intent, crashes, transport errors and absent provider orders leave the budget reserved. Recovery queries that same hash; it never signs a replacement order. An ambiguous response or a 404 cannot safely prove an order was never accepted.
- `settled` means associated trades are `CONFIRMED` and the matching wallet/outcome position is visible. It does not mean the sporting event resolved. An accepted or matched response alone is insufficient. A definitive zero-fill canceled/unmatched order becomes `not_filled`; unresolved evidence remains `unknown`.
- `fill.costUpperBound` is the reserved maximum, **not** an invented actual charge. Exact fee accounting is not implemented. Transaction hashes and confirmed share quantity are retained. Position queries describe purchases confirmed by reconciliation, not continuously refreshed holdings or P&L.
- Disabling a plugin cannot cancel requests already sent. Read-only reconciliation remains enabled while the Node runtime is on. If the entire runtime is off, reconciliation pauses too. Do not manually release an unknown reservation without independently resolving the external order.

States: `prepared`, `queued`, `submitting`, `unknown`, `settled`, `not_filled`, `failed`, `expired`. Leases, credentials and signed payloads never enter public DTOs. Unknown orders may require operator investigation and can block the remaining pilot slot indefinitely; this is preferable to silently placing a duplicate.

## Validation and remaining acceptance

Controlled tests cover migration, tenant isolation, decimal caps, atomic admission, competing consumers, stale leases, revocation, restart after unknown submission, shared manual/agent budget, public request validation, wallet-file preservation, Deposit Wallet hash semantics, SDK BUY/FOK arguments, minimum size/depth and settlement evidence. Run:

```sh
npm run format:check
npm run lint
npm run typecheck
npm test
npm run test:supabase
npm run build
npx wrangler deploy --dry-run --config apps/agent-service/src/cloudflare/background/wrangler.jsonc
npx wrangler deploy --dry-run --config apps/agent-service/wrangler.probe.jsonc
```

Test wallet material is a public deterministic fixture created only in disposable temporary files. The SDK test transport is injected in tests; it is never a production fallback.

Real acceptance still requires an eligible account, operator-created/funded wallet, approvals, a manual confirmed purchase and an eligible policy-approved research result. It must be performed by the operator. Do not force `TRADE`, change models silently or claim that controlled tests verified live execution. There is no frontend, funding automation, withdrawal, selling, event redemption, production custody or remote deployment in this delivery.

Official references: [TypeScript SDK](https://docs.polymarket.com/getting-started/typescript), [wallets and authentication](https://docs.polymarket.com/trading/wallets-auth), [order placement](https://docs.polymarket.com/trading/place-orders). SDK compatibility is pinned to `@polymarket/client@0.10.0`; verify protocol changes before upgrading.

## Current-main integration (2026-09-22)

This port preserves the local pilot from PR #22 while using the current shared research runtime.
The migration is generated after the reconciled main history, not the old PR's migration 0005.
Only isolated local databases are migrated during validation. No hosted schema is changed.

The deployed API and research consumer still do not compose a trading service. The dedicated
alpha laboratory identity is deliberate: do not replace it with a user-supplied tenant or share
one operator wallet across product tenants. This integration is not a deployed trading release.
A Workers execution delivery requires a reviewed account-binding model, an invocation-scoped
signer, scoped authenticated admission, and controlled workerd validation before live acceptance.
No new wallets, approvals, funding or orders are created by the integration checks.

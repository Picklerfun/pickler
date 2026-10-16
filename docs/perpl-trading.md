# Studio Perpl testnet execution

Studio now has a separate real-execution path for an agent's Perpl account. Controls exposes
**Start trading**, Pause entries, Resume trading and Stop & close. Positions and Record show
the venue's positions, order identities, quantities, prices and receipt links. Monad TESTNET
remains visible. Paper accounting and the research strategy runtime retain their existing behavior.

The initial session uses an internal `controlled-sequence-v1` signal source: open long, hold,
close, and stop after the requested cycles. It does not evaluate the PTS course or call a model.
This attribution is private; it is never serialized into the product DTO. No model tool can
start sessions, change sizing or obtain a credential.

## Boundaries and authorization

- `@pickler/trading/perpl-live` owns authority checks, settings, intent transitions, ownership
  leases and the sequence. Only testnet, 1x leverage, one new session-owned position, 1–3 cycles and a 30–3600 second
  target hold are admitted. Opening size rounds down and accounts for the worst allowed slippage.
- `@pickler/infrastructure/perpl-live` implements the locked PostgreSQL aggregate, exact
  Ed25519 HTTP authentication, AES-GCM credentials and owner-passkey onboarding. The key's AAD
  binds product agent, wallet, network, public key and credential purpose.
- The private Trading Worker composes these adapters. Both it and the API verify the original
  Supabase JWT. SQL resolves the persisted owner, active workspace, mapped runtime agent,
  wallet and Turnkey organization; the caller cannot provide a signer or tenant override.
- The API uses `TRADING_EXECUTOR`. The web uses its existing same-origin Studio HTTP client
  and the owner's existing WebAuthn ceremony. Backend-generated credentials are never returned
  to Next.js or the browser; explicitly imported credentials pass only through the authenticated
  write-only connection request described below.

Owner-only operations below also have the existing `/v1/console` aliases. The web prefixes
these with `/api`. Their authoritative contract is generated at `/api/v1/openapi.json`.

| Method | Studio route                                       | Meaning                                                    |
| ------ | -------------------------------------------------- | ---------------------------------------------------------- |
| GET    | `/v1/studio/agents/{id}/perpl`                     | Persisted account, session, positions and history          |
| POST   | `/v1/studio/agents/{id}/perpl/setup/prepare`       | Prepare one exact owner activity; requires Idempotency-Key |
| POST   | `/v1/studio/agents/{id}/perpl/setup/confirm`       | Forward its exact passkey-stamped activity once            |
| POST   | `/v1/studio/agents/{id}/perpl/credentials/connect` | Verify and encrypt an existing wallet-bound Perpl key      |
| POST   | `/v1/studio/agents/{id}/perpl/start`               | Start a bounded session; requires Idempotency-Key          |
| POST   | `/v1/studio/agents/{id}/perpl/control`             | Pause, resume, stop or close                               |

Account setup has independent steps: exact AUSD allowance, account creation with collateral,
forwarding permission, and API-key enrollment. Every step needs the owner's passkey. Existing
prepared accounts can explicitly approve and deposit additional collateral. Funding is capped by
the agent's daily AUSD limit and the reviewed policy, including previously prepared funding that
day. An agent's default 20 AUSD daily cap cannot fund a new account if Perpl requires 100 AUSD;
the owner must explicitly configure sufficient limits. Setup never funds automatically at startup.

The enrolled Ed25519 key has read+trade scope (3), no builder fees and a 90-day expiry. It cannot
withdraw. Root signs the reviewed EIP-712 digest; the parent Turnkey key only reads activity status.
Perpl also requires a whitelisted enrollment Origin. This remote prerequisite is not established
by the local tests. Source contracts: [HTTP endpoints](https://github.com/PerplFoundation/api-docs/blob/main/rest-endpoints.md),
[authentication](https://github.com/PerplFoundation/api-docs/blob/main/authentication.md),
[enrollment](https://github.com/PerplFoundation/api-docs/blob/main/integrations.md).

## Existing trading keys

Controls also offers **Use an existing Perpl key**. The owner submits the Perpl token and its
32-byte Ed25519 seed. The explicit **Use this key’s wallet** switch sets `useKeyWallet=true`:
the adapter resolves the wallet from signed Perpl reads and verifies its contract account.
Without that flag, the key must match the current persisted wallet. No wallet private key or
arbitrary wallet/RPC/contract selector is accepted. `POST /v1/studio/agents/{id}/perpl/credentials/connect`
(and the Console alias) requires the original owner JWT and current creator access. It performs
signed GETs only: the reviewed contract account, authenticated wallet, positions and order reads
must agree. It never enrolls a key, changes forwarding, funds, starts or submits an order.

The driver derives the public key and binds AES-GCM storage to agent, verified wallet, public key
and credential purpose. Key-wallet connections retain the original custody address as an owner
identity fence and cannot use custody preparation/funding. PostgreSQL serializes account binding
and refuses a Perpl account already connected to another agent. Historical orders/sessions never
move to another wallet or account. Controls selects among authorized agent markets; Positions
marks existing positions as unmanaged and exposes Close only for its verified session position. The input is write-only and never returned, logged or passed to a model.
The browser clears both transient password fields on submit and agent change and does not store
them. Strings and browser/crypto copies cannot be guaranteed wiped; they remain subject to the
runtime's memory lifecycle. Backend-generated keys are still never returned to the browser.

Connection commits recheck owner authorization, configuration, existing encrypted credentials,
pending setup, active sessions/orders and executor leases. Concurrent replacement or owner changes
refuse persistence. Existing history and budgets remain intact. A connection has a conservative
24-hour Pickler access deadline; Perpl can expire or revoke it earlier. Read validation does not
prove trade scope: Perpl independently enforces trade permission on an explicitly started order.

`PERPL_ACCOUNT_SETUP_ENABLED` independently controls owner-passkey preparation/confirmation and
funding. Hosted composition defaults it closed; test fixtures retain the existing service default.
This allows sessions using already-authorized keys while enrollment preparation is unavailable.
The optional public `setupEnabled` flag disables unavailable setup controls. Closing account setup
does not close sessions or required exits. Connecting credentials does not reopen trading admissions.

## Dispatch and recovery

An intent with a monotonically increasing request ID is persisted before transmission. Dispatch
refreshes the venue's head and stores its block expiry. Duplicate starts compare fields rather
than serialized JSON order. PostgreSQL serializes starts and short mutations; provider requests
never run under row locks. Renewable 60-second leases fence concurrent consumers.

HTTP acknowledgment is only Submitted. Fill transitions require matching account, market,
request, order type, original quantity and leverage in Perpl history. Available collateral
subtracts locked balance; outstanding foreign orders block new entries. The final head refresh
also verifies the exchange instance and that no other caller advanced the request sequence.
Before the first opening, a new session records existing position identities in other markets.
Those positions remain unmanaged and visible, and are never closed by the session. The selected
market must be unoccupied; otherwise `PERPL_MARKET_OCCUPIED` refuses every order. Historical
sessions with recorded orders never adopt a baseline retrospectively. Unexplained later positions
still freeze execution. Partial fills close the actual remaining session-owned size. An order
fill that precedes its position snapshot cannot trigger another opening. Unexplained positions
freeze the session. Pause blocks new entries while timed exits continue; Stop & close requests
closure, without reporting a fill prematurely. Required exits survive disabled research access,
agent pauses and selected-network edits. Revoked forwarding, expired keys or unavailable venue
state can still prevent closure; the dashboard retains the last observation and its timestamp.

Unknown submissions are reconciled, never resent or inferred cancelled from an elapsed timeout.
A definitely refused/expired exit can be retried once by an explicit Stop & close action. A known
pending Turnkey activity is recovered by read, without another signature. Signed transaction bytes
and hash are stored before broadcast; only identical bytes may be redriven after a missing receipt.
A reverted, canonical onboarding receipt becomes Failed.

An enrollment attempt is persisted before its POST because the returned opaque token cannot be
rederived. A lost enrollment response or a lost initial Turnkey activity ID remains Unknown and
blocks another authorization. Review the existing activity/key with the owner; do not reset the
aggregate, blindly resend enrollment, or remove a reservation to make the button work.

Queue wakeups carry no account or order data. Active/stopping sessions request a 15-second delayed
wakeup; Cron provides a one-minute recovery sweep. The holding time is a target, not an execution
guarantee. UI polling is 5 seconds for active/pending work and 30 seconds when idle, and pauses
when hidden. Preview stages have no reads, signatures or writes.

## Financial evidence

Order prices and fees come from Perpl, never the paper simulator. Frozen market precision keeps
history interpretable after catalog changes; missing precision/mark/funding remains unknown.
Closed-position price P&L, fees and funding describe the latest reported reduction event, not a
fabricated aggregate across partial closes. No AUSD/USD conversion or net performance is inferred.

Transaction links are Perpl-associated hashes whose successful receipts contain the reviewed
exchange, have a canonical block and at least two subsequent blocks. This validates the receipt;
it is not an independent decoding of every economic fill event. Setup links may show a pending
already-signed transaction. Remote acceptance must compare order/position identities and receipts.

Positions (Recent orders) and Record (Transactions · Perpl) show each recorded transaction hash,
abbreviated on screen with the full value available by copying or hovering. The hash itself links
to Monad testnet's explorer. An order with no recorded hash says so; request and order IDs are not
substituted for transaction hashes. Preview references remain unlinked. Setup references use the
same display; their presence alone does not mean a receipt is confirmed.

## Configuration and migrations

See the separate [dated readiness record](perpl-operational-readiness-20261013.md) for actual
migration observations, configuration authorization, enrollment refusal and remaining acceptance.

Runtime composition defaults both product gates disabled; staging overrides must be explicitly authorized:

- API: `PERPL_STUDIO_ENABLED=false`; requires the existing `TRADING_EXECUTOR` binding.
- Trading: `PERPL_ADMISSIONS_ENABLED=false`; independently set `PERPL_ACCOUNT_SETUP_ENABLED=false`
  to retain closed enrollment/funding. `JWT_ISSUER` must match the API/Supabase issuer;
  `JWT_AUDIENCE=authenticated`.
- Trading only: `PERPL_KEY_ENCRYPTION_KEY` (32-byte hex AES key), `TURNKEY_API_PUBLIC_KEY` and
  `TURNKEY_API_PRIVATE_KEY` (read-only parent credentials). Never copy these to web/research.
- Trading: `PERPL_LIVE_POLICY_JSON`, a strict version-1 policy with chainId 10143, reviewed
  exchange address/runtime code hash, RPC URL, whitelisted enrollment Origin,
  `maxCollateralMicros`, `maxGas`, `maxFeePerGasWei` and `maxSlippageBps` (1–1000).
  ERC-1967 exchanges also require `exchangeImplementation` with reviewed address and code hash;
  proxy and implementation are checked at one block before owner signing/submission.
  Missing/invalid policy leaves mutations unavailable. There is no default address or mainnet fallback.

The public reviewed policy capture is [testnet policy](perpl-testnet-policy-20261013.json).
It records the 2026-10-13 two-RPC exchange/implementation observations, with 100 AUSD per deposit,
500,000 gas, 120 gwei maximum fee and 100 bps slippage. It contains no keys. The owner's saved
daily/trade limits remain additional authoritative bounds; nothing raises them automatically.
Controls reads the venue's current minimums and links directly to Limits when the selected
deposit exceeds the saved daily cap. A published policy capture does not establish enrollment
Origin approval or activation.

Hosted persistence uses the existing trusted DATABASE Hyperdrive binding. Local composition
requires explicit `APP_ENV=local` and a loopback DATABASE_URL. Invocation pools are closed on every
outcome. The source change copies no deployed secrets. Publication is an explicit operator step,
recorded separately in the dated readiness record.

Drizzle appends `0048_perpl_live_execution` and `0049_perpl_live_grants`, with fresh generated
snapshots. They create private `pickler.perpl_live_accounts`, enable RLS and grant only backend
service-role access. Earlier migration identities are unchanged. Drizzle's schema list is now
explicit because the product directory also contains read models that are not migration schemas.
Use `npm run db:generate --workspace=@pickler/infrastructure -- --name=<name>` for future schemas.
Never reset a shared database to reconcile history.

## Validation and acceptance

The controlled suites use injected HTTP/RPC, a public test signer and disposable loopback
PostgreSQL. They cover signatures, exact allowance, stale/tampered signatures, recovery before
broadcast, ownership, limits, duplicate starts, partial exits, lost responses, RLS, fresh
installation and upgrade from 0047 with token drafts/grants preserved. They do not use a provider
key or send an on-chain order. Run root tests with a dedicated `TEST_DATABASE_URL`.

Local visual routes: `/studio?stage=perpl-trading-ready`, `perpl-trading-active` and
`perpl-trading-closed`. These are explicitly marked fixtures and disabled in ordinary production
hosts by the existing preview host policy. Start trading is inert in these fixtures.

Hosted execution secrets are configured and read-only Turnkey, JWT, Hyperdrive and reviewed
contract checks pass. The enrollment payload endpoint still returns HTTP 400 for the owned
Origin. Self-service financial acceptance requires resolving that refusal, the owner's saved caps,
sufficient wallet AUSD/MON, owner passkey setup, and one real opening/closing with matched
receipts. The owner selects the agent and amount in Studio; no operator-selected agent is required
for the general configuration. The dated record documents the applied migrations, authorized
secret configuration and independent admission gates. The controlled suites and public probes
establish no real order or funding. The separate dated operator acceptance records a real minimum
NEAR opening/closing; owner-triggered hosted execution remains a separate acceptance requirement.

## Bounded operational storage and migration

Migration 0051 is additive. Fresh accounts use compact operational state with separate private
session, order and setup tables. Execution loads the current session, unresolved work, indexed
request ownership and original-session daily budget aggregates. Public state still returns the
latest 100 orders/setup entries. Owner-only `GET /v1/studio/agents/:id/perpl/history` accepts
`kind=orders|sessions|setup` and the previous response's `nextCursor` as `before`; each newest-first
page contains at most 100 entries. No credential, private preparation or lease crosses that DTO.

The start budget includes cancelled opening attempts; the tick budget excludes them. Both use
order creation day in UTC and the margin recorded on the original session. Unknown submissions
stay unresolved and are never resent. Position ownership uses the transactionally maintained net
filled quantity, original opening leverage and indexed request membership.

Perpl wakeups have their own message kind and durable reservation. Publication commits its token
before enqueue and acknowledges afterwards; consumption accepts a token once. A crash on either
side of enqueue leaves an expiring reservation for the existing Cron reconciliation. Duplicate
messages do not produce additional chains. Polymarket scheduling and the Cron expression are
unchanged.

Schema installation does not convert existing accounts. Use the operator-only command with
`DATABASE_MIGRATION_URL` and the usual verified migration transport. It defaults to inspection:

```sh
npm run perpl:storage --workspace=@pickler/infrastructure -- --agent <product-agent-uuid>
npm run perpl:storage --workspace=@pickler/infrastructure -- --agent <product-agent-uuid> --action begin --execute
npm run perpl:storage --workspace=@pickler/infrastructure -- --agent <product-agent-uuid> --action page --execute
npm run perpl:storage --workspace=@pickler/infrastructure -- --agent <product-agent-uuid> --action cutover --execute
```

Run one `page` per invocation until inspection reports phase `ready`; each transaction copies at
most 100 entities server-side. The original hash, revision and next cursor commit with progress,
so an interrupted process can resume. Active sessions, live leases, open positions and ambiguous
orders/setup defer conversion without blocking their existing exits. Conversion blocks writers
only after that quiescent preflight. Cutover requires complete document parity and request/session
provenance, then atomically switches the account to split mode.

Use `--action abort --execute` to release an unfinished conversion back to legacy mode. A
post-cutover rollback requires quiescence and `--action rollback --execute`; it reconstructs the
**current** state and evidence from normalized tables, including fills recorded after cutover.
Never restore the retained original document as current state. Keep this compatible runtime
installed: database writer version 2 remains fenced after abort/rollback, so old binaries cannot
resume stale document writes. No hosted migration or deployment is implied by controlled local
validation.

Controlled validation covers business invariants, injected venue transports, owner-only HTTP
contracts, 100,000 archived orders, resumable conversion, writer fencing, current-state rollback
and durable wakeup recovery. The final local PostgreSQL run used a temporary test-only 60-second
connection/statement deadline because the overloaded local VM also timed out on single-row reads.
Production deadlines remain unchanged. These checks establish behavior and bounded transferred
work, not hosted acceptance or a database latency guarantee.

# Perpl testnet dashboard

The web route `/perpl` combines the venue's current market overview with the connected wallet's
real exchange portfolio. It is read-only and independent of Studio paper accounts and agent
execution enablement. Explore’s Markets entry and the Portfolio positions tab link to it. The earlier `/markets` board
and individual market tickets remain available through their existing routes.

## Data and update policy

- Public context provides every open testnet market, mark, 24-hour move, funding interval and open
  interest. Prices and sizes retain their venue scaling. Missing interest/funding remains unknown.
- Authenticated Perpl wallet and positions snapshots supply actual balances, order locks,
  collateral and remaining position sizes. The API checks the requested wallet, account ownership,
  duplicate IDs and bounded block skew before returning a projection.
- Markets refresh every ten seconds and wallet reads every five seconds while visible. Reads are
  serial per page, bounded and abortable; failures back off. Old snapshots are marked as stale.
  These are periodic snapshots, not a claim that every exchange event is streamed.
- Price P&L and equity estimates exclude accrued funding and future closing fees. Reported realized
  P&L uses Perpl's all-time net statistic. Gross/net exposure use the observed mark.
- The price buffer estimates where **current remaining collateral** is exhausted by price loss
  alone. It is not Perpl's liquidation price: maintenance margin, funding and fees can liquidate
  earlier. Unknown marks retain the position and make dependent aggregates unknown.

## Read authorization

The user connects the marketplace wallet, signs in to Pickler when needed, then explicitly
authorizes a Perpl `read` key (scope 1) for at most one hour. The reviewed EIP-712 payload fixes
testnet, wallet, public key, expiry, origin and scope; it grants no trading, builder fee or
delegation. The Mera and injected adapters sign only that reviewed contract.

The browser creates a non-extractable native Ed25519 key. Its private key never leaves the browser
or enters React state/browser storage. Only the public key, wallet signature and proof of possession
reach enrollment. The opaque token and signer live in memory until expiry/disconnect. Refreshing
requires new explicit authorization. Perpl has a limit on active keys; unused keys can be revoked
at https://testnet.perpl.xyz/apikeys. If native Ed25519 is unavailable, authorization fails explicitly.

Every portfolio read carries two fresh proofs over `GET /v1/trading/wallet` and
`GET /v1/trading/positions`. The backend forwards only these targets and signed headers; no caller
URL, arbitrary headers or write method is accepted. The backend never receives the Ed25519
private key and never retains private snapshots or credentials. User JWTs protect the private
HTTP routes; Perpl independently verifies ownership and read access.

The fixed integration origin is `https://pickler.fun`. Perpl must permit it for enrollment and
subsequent authenticated reads. This requirement is explicit; the adapter never omits Origin to
bypass their policy. A wallet also needs a Perpl profile. The dashboard creates no exchange
account, enables no forwarding and moves no collateral.

## Endpoints

| Method | Path                         | Access                           | Purpose                       |
| ------ | ---------------------------- | -------------------------------- | ----------------------------- |
| GET    | `/v1/perpl/markets`          | Public                           | Current venue market overview |
| POST   | `/v1/perpl/read-key/payload` | User JWT                         | Prepare scope-1 authorization |
| POST   | `/v1/perpl/read-key/enroll`  | User JWT + wallet/PoP signatures | Enroll approved read access   |
| POST   | `/v1/perpl/portfolio`        | User JWT + fresh Perpl proofs    | Project real wallet snapshots |

No new environment secret or migration is required. API and Web must ship through the existing
automatic main deployment process; this change does not publish or enable an agent.

## Verification boundary

Deterministic tests cover scaling, long/short exposures, unknown values, current collateral,
unowned positions, stale context, fixed endpoints, read scope and HTTP authorization.
`node --import tsx scripts/design/perpl-dashboard.mjs http://localhost:3005` exercises the actual
UI, wallet adapter, Hono routes, gateway and trading projection with a controlled Perpl transport
and controlled Supabase authentication. It checks signatures, automatic refresh and mobile layout;
no external credential enrollment or transaction occurs.

A public GET to Perpl testnet through the adapter succeeded on 2026-10-13 with eight markets.
Real wallet enrollment and authenticated reads have **not** been validated: automatic approval
review rejected initiating enrollment preparation with an unapproved test wallet. An operator/user
must explicitly approve the reviewed read session in their wallet for live acceptance. Merge and
controlled tests do not establish that Perpl has whitelisted the integration origin.

Official contracts: [API enrollment](https://github.com/PerplFoundation/api-docs/blob/main/integrations.md),
[authentication](https://github.com/PerplFoundation/api-docs/blob/main/authentication.md),
[wallet/positions REST](https://github.com/PerplFoundation/api-docs/blob/main/rest-endpoints.md).

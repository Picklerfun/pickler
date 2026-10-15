# Perpl testnet dashboard

The public web route `/perpl` combines Perpl's current market overview with the connected wallet's
real on-chain exchange portfolio. Connecting the marketplace wallet loads its public account and
positions automatically. No Pickler sign-in, Perpl API key, wallet signature, account enrollment or
wallet network switch is needed to read the fixed Monad testnet contract. Reloading resumes reads
when the existing wallet connection is restored. This does not enable agent execution or orders.

## Public account source

`GET /v1/perpl/portfolio/:wallet` accepts one validated address. The infrastructure adapter uses
only `https://testnet-rpc.monad.xyz`, chain 10143 and exchange
`0x1964c32f0be608e7d29302aff5e61268e72080cc`. It checks the RPC chain and public venue context's
chain, exchange and six-decimal AUSD collateral identity. The browser never supplies a URL,
contract, method, calldata or private credential.

The adapter gets one canonical block and reads `getAccountByAddr` plus the held positions'
`getPositionV2` with EIP-1898 `{ blockHash, requireCanonical: true }`. It enumerates the account's
position bitmap, including markets missing from the open-market context. The first bank excludes
its three reserved high bits; subsequent banks start at market IDs 253, 509 and 765. Account and
position ownership, response IDs, chain, scaled integers and freshness are checked before the
business projection. Invalid/partial reads fail; they never become a zero balance or an empty
portfolio. Only the exact `AccountDoesNotExist(address)` revert for the requested wallet proves
that it has no exchange account. Unsupported/hidden market positions remain visible with unknown
price-dependent values rather than disappearing.

RPC reads have one ten-second deadline, batches of at most ten, at most 64 held positions, a
2-MiB response bound and no redirects. Nothing signs, broadcasts, enrolls a key, creates an exchange
account, enables forwarding or moves funds. Account snapshots and addresses are not retained in
application caches or failure diagnostics. Responses are private/no-store despite the public
on-chain source; only venue context is cached.

The compiler-generated `IPerplReadAbi` comes from `contracts/src/interfaces/IPerplRead.sol`.
Tuple layouts, the missing-account error and bitmap semantics were checked against
[Perpl's Exchange ABI](https://github.com/PerplFoundation/dex-sdk/blob/78ce8a06e39e2f9288792eba41aca5f3c08c1195/crates/sdk/abi/dex/Exchange.json),
[errors](https://github.com/PerplFoundation/dex-sdk/blob/78ce8a06e39e2f9288792eba41aca5f3c08c1195/crates/sdk/abi/dex/Errors.abi.json),
and [account bitmap reader](https://github.com/PerplFoundation/dex-sdk/blob/78ce8a06e39e2f9288792eba41aca5f3c08c1195/crates/sdk/src/state/account.rs).

## Projections and refresh

- Public context supplies open markets, mark, 24-hour move, funding interval and open interest.
  Missing interest/funding remains unknown.
- On-chain positions supply remaining size, side, current collateral, Q16 entry-price residue and
  a valid mark from the same block. Trading owns exact integer scaling, price-only P&L, gross/net
  exposure and current-collateral exhaustion estimates. Long entry prices use the contract's ceil
  convention; short prices use its floor convention when applying the residue.
- Equity/price P&L estimates exclude accrued funding and future closing fees. Price buffer is not
  Perpl's maintenance-aware liquidation price. Funding and fees can cause liquidation earlier.
- Original leverage, realized P&L, historical fees and volume are unavailable from this public
  account read. They remain null, never fabricated as zero or inferred from current collateral.
  The live UI omits the unavailable all-time P&L figure and original leverage badge.
- Markets refresh every ten seconds and positions every five seconds while visible. Loops are
  serial, abort on navigation/address changes, pause in hidden tabs and back off on failure. The
  last verified snapshot stays visibly stale. Changing/disconnecting a wallet immediately hides
  previous-wallet data. Snapshots older than sixty seconds are rejected.

## Compatibility endpoints

The existing scope-1 payload/enrollment and signed portfolio POST endpoints remain JWT-protected
for compatibility. They are not called by the default dashboard UI. Their fixed origin is
`https://pickler.fun`, expiry is at most one hour, and the browser's legacy Ed25519 key is
non-extractable and memory-only. Those routes retain reviewed signing terms, ownership checks,
independent timestamp validation and no credential persistence. Never omit/spoof Origin to bypass
Perpl's policy. The browser's signing clock is anchored to the public API clock using monotonic
time. A document reload still discards any legacy key; public on-chain reads need no such key.

| Method | Path                          | Access                           | Purpose                           |
| ------ | ----------------------------- | -------------------------------- | --------------------------------- |
| GET    | `/v1/perpl/markets`           | Public                           | Venue market overview             |
| GET    | `/v1/perpl/portfolio/:wallet` | Public chain data                | Current wallet positions and risk |
| POST   | `/v1/perpl/read-key/payload`  | User JWT                         | Legacy scope-1 preparation        |
| POST   | `/v1/perpl/read-key/enroll`   | User JWT + wallet/PoP signatures | Legacy approved read enrollment   |
| POST   | `/v1/perpl/portfolio`         | User JWT + fresh Perpl proofs    | Legacy signed REST projection     |

All routes are described in generated OpenAPI. No secret, migration or deployment permission is
introduced. API and Web ship through the existing automatic main deployment process.

## Verification boundary

Deterministic tests cover canonical-block identity, bitmap bank boundaries/reserved bits, hidden
markets, missing accounts, invalid marks, partial RPC failures, Q16 prices and exact risk
projection. `node --import tsx scripts/design/perpl-dashboard.mjs http://localhost:3005` exercises
the actual browser, Hono routes, RPC adapter and business projection with controlled public chain
responses. It checks automatic reads without signatures, document reload, wallet changes,
network independence, stale state, disconnect and responsive widths. Controlled tests do not
establish deployed acceptance.

An explicitly authorized unsigned Perpl enrollment preparation on 2026-10-13 returned HTTP 400
and only `Bad Request` (23:04:33 UTC, Cloudflare request `a4a1fbe21fdc443a-MIA`). Its cause was not
established; it must not be described as confirmed origin refusal or an expired grant. No key was
enrolled or wallet signed. This integration rejection remains unresolved for the compatibility
POST routes; it no longer blocks the public portfolio flow.

The actual new gateway successfully read the user-approved wallet's six positions from the real
contract at block 70809774 on 2026-10-13, with source `onchain`, account/position validation and
`stale=false`. The six observed markets were BTC, ETH, SOL, MON, LIT and PUMP. This is live public
contract acceptance, not a claim that legacy private REST enrollment succeeded or that the change
has already been deployed.

A local browser → actual Hono route → real gateway → public RPC acceptance also rendered all six
positions at block 70811133 with `stale=false`. The browser used a controlled connected address to
select already-public data; no actual wallet signature, enrollment or private credential was
used. This proves the new UI and live public data path together, not a deployed release or
extension-specific account connection. Controlled browser tests separately cover restoration,
account changes and mobile widths.

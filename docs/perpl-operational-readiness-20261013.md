# Perpl self-service readiness — 2026-10-13

## Scope

Perpl setup belongs to each eligible agent owner in Studio. No operator-selected agent, automatic
wallet funding, server-side parent-key signing, or automatic limit increase is introduced. Controls
shows the venue minimums, the reviewed deposit maximum, and a direct path to the owner's Limits.
The first execution mode remains one bounded open/hold/close sequence, at 1x and one position.

## Verified hosted observations

- Supabase staging has all 50 migrations from main `cf41747e` applied. The canonical migrator
  reports `pending: []`, `unknown: 0`; the original journal identities are preserved.
- `pickler.perpl_live_accounts` exists, has RLS, denies PUBLIC/anon/authenticated, and grants only
  backend access. Before configuration it held zero accounts, encrypted credentials, or sessions.
- The public Perpl testnet context identifies chain 10143, exchange instance 12, AUSD with six
  decimals, a 100 AUSD account minimum and a 10 AUSD deposit minimum.
- Monad's public testnet RPC and Ankr agree on the exchange runtime hash, ERC-1967 implementation
  address, and implementation runtime hash in the [reviewed capture](perpl-testnet-policy-20261013.json).
- API and Trading initially have their Perpl gates closed. Trading initially has an empty
  plaintext JWT issuer and none of the Perpl/Turnkey secrets needed by this execution path.
- The deployed app's entry is `https://app.pickler.fun/`. The inspected browser requires sign-in;
  no owner JWT/passkey has been used for remote account setup or financial acceptance.

## Configuration awaiting explicit approval

The tested code from `0f9565d3` was subsequently published with both Perpl gates still false,
preserving the existing plaintext runtime variables and uploading no new secrets:

| Worker  | Verified active version                |
| ------- | -------------------------------------- |
| Trading | `91ce935d-cb34-43f4-9a0b-1dbf38b667a4` |
| API     | `88244fc3-5fae-4c10-8d39-9447ce8e9649` |
| Web     | `7085b5d8-77d5-461e-ab77-897d4a63f62b` |

All three active versions carry tag `perpl-readiness-0f9565d3`. The app serves OpenAPI with
226 operations and the owner Perpl route. A request without a JWT returns 401 with
`Cache-Control: private, no-store`. Trading's issuer and execution secrets still await the
explicitly requested approval; code publication does not configure them.

The proposed destination is the existing `pickler-trading-staging` Worker in Cloudflare account
`bc8d4adf4860284fda426b24e7377bc2`. Its source issuer matches the staging Supabase project.
Configure JWT issuer, the API's existing read-only parent Turnkey credentials, a new 32-byte AES
key, and the reviewed policy via secret stdin only. Never print their values, put them in source,
send them to Web/Research, or rotate an existing encryption key with persisted accounts.

The capture caps each deposit at 100 AUSD, gas at 500,000, fee at 120 gwei and slippage at 100 bps.
The owner's current daily and trade caps remain additional enforced bounds. Each allowance,
account creation/funding, forwarding grant and trading-key enrollment requires the owner passkey.
New sessions require an explicit Start trading action. No action occurs during startup or a read.

Automatic approval review rejected uploading these specific secrets to this destination and
enabling Perpl for all eligible agents without more explicit authorization. No rejected upload
or gate change was executed. A single explicit confirmation has been requested. Gates remain
closed until authorization and technical checks both succeed.

## Enrollment acceptance still unresolved

Unsigned `/api/v1/api-key/payload` requests from both owned origins (`https://pickler.fun` and
`https://app.pickler.fun`) returned HTTP 400, plaintext `Bad Request`. Their shape matches the
official API documentation and the public first-party API-key UI bundle, including an Ed25519
public key, chain 10143, wallet address, scope 3, label, and JSON headers. This is not a successful
enrollment probe and does not identify the cause conclusively.

Perpl's [integration documentation](https://github.com/PerplFoundation/api-docs/blob/main/integrations.md)
requires a whitelisted Origin for backend enrollment as well as browser enrollment. Origin
approval remains unverified. Do not omit Origin or impersonate Perpl's own Origin as a fallback.
No key was enrolled and no wallet signature, deposit, approval or order was sent during the probes.
Resolve the refusal before declaring self-service setup operational or enabling financial entry.

## Controlled validation

The affected execution, JWT, DTO and API route suites pass, including reviewed/missing/changed
proxy implementations, unchanged-address bytecode changes, order refusal before credential use,
public requirements without funding, and retention of account history after requirement failure.
The Studio stage suite also passes with a dedicated inert setup fixture demonstrating the original
20 AUSD daily cap against the venue's 100 AUSD account minimum.

Shared compilation, Web/API/Trading types, architecture, staging topology, lint, formatting,
generated OpenAPI (226 operations), backend dry-run builds, production Web Worker build, and
rendered surfaces/tokens/contrast/type checks over the four Perpl stages pass. These are controlled
validation and public configuration observations, not evidence of a real opening/closing cycle.

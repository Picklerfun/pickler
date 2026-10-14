# Perpl self-service readiness — 2026-10-13

## Scope

The current hosted path lets each eligible Studio owner connect an existing Perpl API key for
their agent's already-funded account and explicitly start a bounded open/hold/close sequence at
1x with one position. Controls exposes the connection form and saved Limits. Automatic enrollment
and funding remain disabled while Perpl enrollment preparation is unresolved. No operator-selected
agent, automatic funding, parent-key signing, shared wallet credential or limit increase is introduced.

The initial checkpoints below are historical. The existing-key release and current active versions
are recorded at the end of this document.

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

## Authorized configuration applied — initial checkpoint

The owner explicitly authorized the existing API parent Turnkey reader credentials to be copied
only to the existing `pickler-trading-staging` Worker in Cloudflare account
`bc8d4adf4860284fda426b24e7377bc2`, together with JWT issuer, AES encryption and the reviewed
Perpl testnet policy. General eligible-agent activation is authorized only after the technical
checks succeed. Agent selection, deposit amount, saved limits and passkey approval remain
self-service owner actions.

The five backend secrets are now bound: `JWT_ISSUER`, `TURNKEY_API_PUBLIC_KEY`,
`TURNKEY_API_PRIVATE_KEY`, `PERPL_KEY_ENCRYPTION_KEY` and `PERPL_LIVE_POLICY_JSON`.
The issuer matches staging Supabase. No backend credential was sent to Web or Research, printed,
committed or saved in a new local file. No delegated signing key was copied.

The initial bulk request failed with Cloudflare error 10053 because the old empty plaintext
`JWT_ISSUER` binding occupied the name. Secret inventory remained empty. The same tested Trading
code was published after removing only that entry and preserving the other current plaintext
variables. A fresh read-only audit found zero encrypted accounts before a new 32-byte AES key
was generated and uploaded through stdin. An existing encryption key must never be rotated to
make configuration succeed.

| Worker  | Observed active version                | Perpl gate |
| ------- | -------------------------------------- | ---------- |
| Trading | `9da6a8a1-d42d-4dab-bb27-9efdf99ebba2` | false      |
| API     | `43daacb5-6ffd-4324-b382-0ecefaffbb74` | false      |
| Web     | `c9f083bf-5b25-4c5b-9198-bea4d22978ac` | n/a        |

Each version was observed at 100% traffic. API and Web are observed active versions, not an
assertion that their code hashes are unchanged from the earlier publication. Trading's final
version has the same script ETag as its issuer correction publication and is the secret update of
`9c76f4dd-e642-4d7e-8621-cd66c851f0bc`, the issuer correction publication. The tested code
commit is `0f9565d3`; configuration/deployment observations are separate from a merged release.
The source correction is in PR #185 and must be preserved in later main deployments.

Main advanced to `7bfc1a3a` with PR #184 during configuration. Its public, contract-backed
portfolio dashboard is incorporated into the isolated readiness branch without replacing the
active main publishers. At that checkpoint the hosted contract had 227 operations and retains owner JWT
protection (401 without a token; private/no-store), but it does not yet include this PR's optional
collateral requirements. Those UI/contract improvements were on PR #185 pending the next
reviewed release. Closed admissions prevent that producer/consumer gap from enabling setup.

Turnkey's stamped read-only identity query returned HTTP 200. Supabase JWKS returned HTTP 200
with one signing key. A temporary remote Cloudflare diagnostic, without wallet credentials,
confirmed the trusted Hyperdrive-to-Supabase connection by reading the empty Perpl table in a
read-only transaction and rolling it back. It also read JWKS, Perpl's public context and Monad
at block `0x4388703`: chain 10143, proxy hash and implementation address/hash all matched the
reviewed capture. The temporary preview was stopped after the probe. This verifies transport and
public bindings; no owner JWT/passkey setup or financial acceptance is implied.

The capture caps each deposit at 100 AUSD, gas at 500,000, fee at 120 gwei and slippage at 100 bps.
The owner's current daily and trade caps remain additional enforced bounds. Each allowance,
account creation/funding, forwarding grant and trading-key enrollment requires the owner passkey.
New sessions require an explicit Start trading action. No action occurs during startup or a read.

The earlier automatic approval refusals were resolved by the owner's explicit authorization.
There is no remaining permission block on the described configuration. At this initial checkpoint, both Perpl gates remained
false because unsigned enrollment preparation failed, not because approval was missing. The later
existing-key release has separate account-setup and session gates.

## Automatic enrollment acceptance still unresolved

Unsigned `/api/v1/api-key/payload` requests from both owned origins (`https://pickler.fun` and
`https://app.pickler.fun`) returned HTTP 400, plaintext `Bad Request`. Their shape matches the
official API documentation and the public first-party API-key UI bundle, including an Ed25519
public key, chain 10143, wallet address, scope 3, label, and JSON headers. This is not a successful
enrollment probe and does not identify the cause conclusively.

Perpl's [integration documentation](https://github.com/PerplFoundation/api-docs/blob/main/integrations.md)
requires a whitelisted Origin for backend enrollment as well as browser enrollment. Origin
approval remains unverified. Do not omit Origin or impersonate Perpl's own Origin as a fallback.
The same request from the temporary Cloudflare preview returned HTTP 400 with
`Content-Type: text/plain; charset=utf-8` and no `Access-Control-Allow-Origin`, while public context
returned HTTP 200. This rules out a refusal limited to the local machine but still does not prove
which remote validation failed. No key was enrolled and no wallet signature, deposit, approval or
order was sent during the probes.
Resolve the refusal before declaring automatic enrollment/funding operational. Existing-key
connection and bounded sessions use their independent authenticated path; they do not retry or
bypass enrollment.

The concrete provider prerequisite is confirmation that `https://pickler.fun` is accepted as the
server enrollment Origin for Pickler on testnet and that `/api/v1/api-key/payload` is available to
that integration. `https://app.pickler.fun` was also refused in the earlier probe. Ask Perpl to
identify the failed validation if the Origin is already approved. Requests use chain 10143, a
valid fresh 32-byte Ed25519 public key, scope 3, label `Pickler Studio` and a 90-day millisecond
expiry. Share only this request shape and sanitized response metadata; never send private keys,
Turnkey credentials or owner signatures. No external message has been sent by this work.

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

After integrating current main, 59 combined live-execution, dashboard, JWT, DTO, API route,
browser-client and clock tests pass with no failures or skips. Shared compilation, Web/API/Trading
types, architecture and provisioned staging topology pass. The combined source exports 227
OpenAPI operations, including the optional collateral requirements. These remain controlled
checks; no financial acceptance is claimed.

## Existing-key connection release

The owner requested that already-authorized trading credentials can be configured from any
eligible agent's Controls. The local agent-service environment contains Polymarket CLOB/builder
credentials, not a Perpl API token/Ed25519 seed. The user-identified full-stack chat contains Perpl
documentation references but no saved Perpl credential configuration. This investigation does not
establish that a usable Perpl key exists elsewhere. No credential value is included in this record.

Controls now provides a write-only existing Perpl key form, bound to the persisted agent wallet.
The private Trading Worker verifies the reviewed contract, on-chain account and five authenticated
venue reads, derives the Ed25519 public key, and encrypts both credentials with agent/wallet AAD.
Persistence rechecks owner authorization, unchanged authority/credentials and inactive execution.
Existing history and budgets remain intact. The form clears its password inputs on submission
and identity change. Connection neither funds nor starts a session and does not prove trade scope;
Perpl enforces that permission when the owner explicitly starts an order. Pickler imposes a
24-hour access deadline, subject to earlier venue expiry/revocation.

The approved operating configuration enables `PERPL_STUDIO_ENABLED` and
`PERPL_ADMISSIONS_ENABLED` for explicit owner-controlled sessions, while independently keeping
`PERPL_ACCOUNT_SETUP_ENABLED=false`. This prevents the unresolved enrollment failure from
exposing automatic setup/funding. Polymarket admissions and unrelated deployed variables are
preserved. Source flags are configuration intent; publication must be recorded separately.

Current controlled validation: 39 focused connection/execution/driver/JWT/DTO/API tests and
67 Studio/store regressions pass with no failures or skips. Store regressions use disposable local
PostgreSQL and verify migration histories and token grants. Shared compilation, Web/API/Trading
types, lint, formatting, architecture, static design tokens, backend dry-run builds and the
production Web Worker build pass. The source exports 229 OpenAPI operations. Rendered surfaces,
tokens, contrast and typography pass across all four Perpl stages. A temporary Cloudflare preview
using only public dummy keys verifies RFC8410 Ed25519 import/public derivation, signatures and
AES vault round trips; it made zero financial requests and has been stopped. These checks do not
replace real owner authentication, a usable venue credential, funding or open/close acceptance.

### Current publication and remaining financial acceptance

The reviewed backend code is commit `e0522fe4`; Web includes the precise identity-refusal copy
from `87ace924`. All three publications were observed at 100% traffic after deployment:

| Worker  | Active version                         | Current Perpl gates                |
| ------- | -------------------------------------- | ---------------------------------- |
| Trading | `f72ef974-0b9a-4b99-af95-d360dd771a0f` | Sessions true; account setup false |
| API     | `37ae4288-3215-4451-bb33-aaeb51a4d1e9` | Studio true                        |
| Web     | `1ca57505-0b79-4853-ba4d-b30d18c83780` | n/a                                |

Deployment preserved all previous backend secret names and unrelated plaintext variables,
including existing advice/token settings. The five Trading secrets remain bound, and Polymarket
admissions remain false. No encryption key was replaced. The hosted contract now exports
229 operations with strict write-only credential inputs. An unauthenticated connection attempt
returns 401 with `Cache-Control: private, no-store`. The app host serves exactly the tested UI
asset containing the connection fields, verified against its local SHA-256 hash.

The owner states that they have a Perpl API key for the bounty. It has not been supplied to or
connected by this work. The owner must sign in at `https://app.pickler.fun/`, select the agent,
open Controls → Use an existing Perpl key, and provide its token plus Ed25519 seed. The verified
account must be that agent's persisted wallet, funded with testnet AUSD and allowed to forward
orders. The owner then chooses saved limits/session settings and explicitly starts trading.
The localhost `stage=perpl-trading-setup` tab is an inert preview, not a credential entry surface.
No real key connection or open/close cycle has been observed; no financial request, wallet
signature or deposit was sent by this work. Publication is from PR #185, which is not merged;
future main publications must preserve this change before replacing these versions.

## Exact-key testnet acceptance checkpoint

The owner supplied an exact downloaded Perpl testnet key export after screenshot transcription
produced an ambiguous token. The token and all three secret encodings were reconciled locally,
without committing credential values. Signed wallet, positions and history GETs now authenticate;
public testnet chain, reviewed exchange/implementation and account identity checks pass. This is
actual venue read acceptance, separate from controlled tests and product-owner JWT acceptance.

The real history uses bare 32-byte transaction hashes. The adapter now normalizes that strict
format to `0x` before receipt verification, rejects malformed hashes and distinguishes invalid
account response data from bad credentials. Current position snapshots may carry `rq=0`; only an
opening event owned by the execution document for the exact position/account/market/side/leverage
can supply attribution, while current aggregate quantities remain intact. Trading verifies owned
net fills and original leverage before closing; foreign additions/reductions cannot be closed by
the session. Existing partial-close and required-exit tests remain passing.

The explicit local cycle is bounded to testnet, 1x, one minimum BTC lot, at most 1 AUSD of margin,
30 seconds, 10 bps slippage, no deposits and no automatic repeated opening. Its preflight found
six pre-existing positions; the acceptance entry refused before any financial request or local
session marker. No real open/close cycle is claimed. Those positions were not changed. Full
operator observations remain in ignored local records, not this public change.

The explicitly authorized `PERPL_API_KEY` and `PERPL_API_SECRET` were uploaded through stdin
only to `pickler-trading-staging`. The five previous secret bindings remained present; Web and
Research did not receive this pair. Secret-update version `4d47607f-26a0-4ee1-bb8f-bb709ff3a201`
was observed at 100% traffic. These are operator acceptance bindings, not an automatic credential
fallback for product agents; persisted owner/JWT/wallet checks remain mandatory. No backend
encryption key was rotated and no owner account was created or funded.

Current focused live-service/driver/HTTP/JWT/DTO/API tests: 44 pass, zero failures or skips.
Affected types, lint, formatting, architecture and the private Trading Worker dry-run build pass.
Financial acceptance still requires an eligible account state within the owner's approved scope.

The adapter/closure correction from `6b2fbca8` is published as Trading version
`a06f0626-c74b-41e7-b8bc-e47bed8bb466`, observed at 100% traffic. All seven secret names and
all prior plaintext variables were verified unchanged from the secret-update publication. No
Web/API/Research republication or financial request is part of this correction. PR #185 remains
unmerged; the full product-owner authenticated financial acceptance is still pending.

## Isolated existing-wallet execution and owner web connection

The owner identified the imported testnet wallet as their existing portfolio and explicitly
requested preserving/displaying its positions while making additional small trades. A new bounded
session now records pre-existing positions in other markets before its first order. It refuses an
occupied selected market; its closure still requires exact verified net fills and leverage.
Historical sessions never acquire unrelated position ownership retrospectively.

An explicit local operator run on 2026-10-14 UTC opened and closed one minimum NEAR lot (0.01 NEAR)
at 1x with a 0.06 AUSD margin ceiling, 10 bps slippage and a 30-second target hold. Perpl reported
both orders filled; both transaction receipts passed the existing reviewed-exchange/canonical-block
verification. The two reported fees total 36 micro-AUSD (0.000036 AUSD). Six pre-existing positions
retained their exact position IDs, markets, quantities, entry prices and original leverage. The
session completed one cycle with no remaining NEAR position, deposits or extra opening attempts.
The private operator audit remains ignored; this is actual local provider execution, separate
from hosted owner/JWT execution and controlled fixtures.

Controls now accepts an explicit `useKeyWallet` import. Signed Perpl reads resolve the address;
reviewed chain state verifies the account. The original agent custody address remains an ownership
fence. Account-scoped PostgreSQL serialization prevents two agents from connecting the same venue
account. External connections disable custody setup/funding and cannot move existing histories.
No operator environment credential is an automatic agent fallback. Shared business-owned position
attribution labels prior positions as unmanaged and limits Close actions to owned positions.

The public `/perpl?wallet=<address>` link uses real public contract reads without connecting or
impersonating a browser wallet. The hosted API returned the expected six positions. Controlled
browser acceptance covers explicit links, reload, invalid addresses, connected-wallet changes and
320/380/768/1280 widths. Five affected Design screens pass surfaces, tokens, contrast and type.
The final focused suites pass 71 tests with no failures or skips, including real disposable
PostgreSQL account exclusivity and original migration-history preservation. Affected types, lint,
shared compilation, architecture, the 229-operation generated contract and affected Worker builds
are verified separately from deployed acceptance.

Hosted publication and the owner-triggered web opening/closing still require their own recorded
versions and observations; the local operator run alone does not establish either.

The reviewed source `7d1b1319` was explicitly published to all three affected hosts. Each version
was observed at 100% traffic with existing service/Hyperdrive/Queue bindings retained:

- Trading: `8391b691-df32-4250-855d-441f49e39947`.
- API: `89b8ac62-9a96-4a68-88d6-b628e4da7bc5`.
- Web: `cd6b4ed6-17aa-4cdc-a8b3-69290e842824`.

Trading retains all seven private secret names, including the operator Perpl pair; Web has no
backend secret binding. The hosted OpenAPI exposes 229 operations, the optional key-wallet flag
and write-only credential fields. An unauthenticated connection attempt returned 401 with
`private, no-store`. The actual deployed browser loaded the requested wallet's six positions,
updated their canonical block/marks automatically and required no wallet signature or connection.
Owner sign-in also succeeded. The selected agent's additional NEAR configuration is prepared in
the browser but remains uncommitted pending the browser-required access confirmation. No hosted
owner connection or financial session has been claimed as accepted at this checkpoint.

## Visible hashes and hosted owner readiness on 2026-10-14 UTC

After the owner's explicit browser confirmation, the additional NEAR market was saved as
configuration v4 and the owner-provided testnet key wallet was connected to the selected owned
agent. The actual hosted Controls and Positions surfaces reported READY, six pre-existing
positions and zero new orders. NEAR, 0.06 AUSD, 1x and a 30-second target hold were prepared in
Controls. This supersedes the preceding uncommitted-configuration checkpoint; it does not claim
a completed hosted financial cycle.

Source `2a581f8a` exposes each server-provided transaction hash in Positions' recent orders and
Record, with an abbreviated explorer link, full-value copy and explicit missing-hash state.
It reuses ChainReference and adds no provider requests, signing or financial mutations. Inert
preview references remain unlinked. Setup references use the same display and retain their
existing confirmation semantics.

The production Web Worker build, affected web types, scoped lint/format, architecture, static
Design check over 478 files and two Perpl client tests passed. A separate read-only local browser
harness checked both history surfaces, exact full-hash clipboard contents, explorer destinations,
multiple hashes, an absent hash and unlinked preview references. Its recorded local acceptance
samples are not hosted agent orders and were never inserted into the application database.

Only Web was republished for this presentation change, as version
`38837a7c-590b-42a5-9cd4-0d7449a63394`, observed at 100% traffic. The hosted JavaScript asset matched
the tested local build byte for byte, and the existing API OpenAPI transport returned 200.
Bindings and runtime variables were retained; no migration, backend republication, deposit or
additional local trade was performed. PR #185 remains unmerged, and the authenticated hosted
open/close acceptance still awaits the owner's explicit Start trading action.

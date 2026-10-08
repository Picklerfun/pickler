# Studio X OAuth

Studio connects a creator-owned agent to X using OAuth 2.0 Authorization Code with PKCE S256.
Supabase remains Pickler's login. X grants read access only: `users.read`, `tweet.read`, and
`offline.access`. Connecting does not post to X, execute trading, or change any strategy.

## Boundaries and lifecycle

Core owns connection, ownership, scope, reading and publication rules. Infrastructure implements
fixed X HTTP transports, private Drizzle storage, AES-GCM encryption and transaction fences.
The API Worker composes these ports. Web contains presentation and same-origin `/api` transport.
Research has no X credential or post input. Neither AI credits nor historical model budgets pay
for these reads.

`POST /v1/studio/agents/:id/x/authorize` requires the creator's JWT and current ownership. The
server creates a ten-minute UUID attempt containing trusted user/workspace/agent identities,
SHA-256 state/browser hashes and an encrypted verifier. Its browser cookie is
`pk_x_<state>`, HttpOnly, SameSite=Lax, Secure outside local mode, scoped to
`/api/v1/studio/x/callback`. Supabase JWTs are never stored in attempts.

The callback is mounted separately, before JWT-only Studio. It accepts only the matching state
and browser cookie, atomically changes a pending attempt to processing, exchanges once, verifies
required scopes and obtains identity from `/2/users/me`. Permission and ownership are rechecked
before connection. Duplicate/expired callbacks cannot exchange again. An uncertain exchange
requires a new authorization. Provider errors and tokens never appear in the return URL.

Studio keeps its form mounted while a consent window is open. A same-origin BroadcastChannel
keyed by the random flow reports the sanitized outcome even if X removes `window.opener`.
The parent acknowledges the notification and rereads authenticated state; the notification itself
cannot link an account. Supported return paths are `/` and `/studio` with the selected agent
and one allowlisted section, never a client-supplied external redirect.

One X identity and case-insensitive handle belong to one agent. Reconnecting an existing account
requires the same X user ID; switching requires explicit disconnect. A refresh is claimed once
under the agent/grant locks, fenced by version and a thirty-second processing deadline. An
interrupted/uncertain refresh becomes `reconnect_required`, without another automatic exchange.

The private states are `disconnected`, `connected`, `reconnect_required` and
`revocation_pending`. Explicit disconnect immediately blocks local reads, including for public
agents, and revokes at X. Both access and refresh tokens are revoked explicitly. Each credential has a separate encrypted
pending record, removed on success; a partial failure retains only the remaining credential for
an explicit cleanup retry.
Tokens returned after a lost refresh/link fence are likewise kept in a private pending revocation
record. No autonomous cleanup transport or model retry is introduced. An owner can inspect and
disconnect after creator access is removed; linking, publication and reading still require access.

Migration `0034_x_oauth.sql` adds private attempts, grants, daily usage, immutable request records,
immutable account history and pending revocations. Existing verification evidence is archived
without changing publication, setup versions, scheduling, balances or trading history. Active
account rows record `post` or `oauth`; the old challenge table remains historical. RLS and explicit
privilege revocation keep these tables outside direct anonymous/authenticated Supabase access.
Never expose the `agents` schema through the Data API.

## Publication and reading

New publication requires a current OAuth grant. The API refreshes when necessary and verifies
identity immediately before publishing. The short publication transaction rechecks owner,
workspace/access, grant status, required scopes, expiry, no active refresh and a validation newer
than thirty seconds under locks coordinated with disconnect. Missing/historical authorizations
return `409 PUBLISH_BLOCKED` with `X_CONNECTION_REQUIRED`; an X outage does not prove revocation.
Already public agents keep their visibility, including after disconnect. Historical handles alone
are never displayed as current OAuth connections.

All connection/state, disconnect and timeline operations require an owner JWT; API keys and
agent HMAC do not qualify. The callback is the sole bearer exception and uses state/cookie/PKCE.
OpenAPI is generated from mounted route metadata, with the relative server `/api`.
Old `/x/challenge` and `/x/verify` operations, consumers and matching algorithms are removed.

Posts are read only after Load posts, Refresh posts or Next posts. The timeline includes replies,
excludes reposts and returns at most twenty `id`, `text`, `createdAt`, `url` values plus a cursor.
Returned authors must equal the linked identity. Content is held in the owner's page only, never
persisted or fed to the engine. Replies are included; partial/error responses are not presented
as a successful empty page. All responses use `Cache-Control: private, no-store`.

Before each identity/timeline transport a transaction reserves daily quota and inserts an
immutable request record. UTC counters and `Retry-After` are shared by operations on that agent.
A timeline request conservatively reserves twenty resources even if fewer posts return; failure
or uncertain transport does not refund that quota. This is platform X resource accounting, not
billing the user. There is no polling or automatic retry.

## API Worker runtime configuration

These eight variables belong only to `pickler-api-staging` runtime, not Next.js build variables,
Research, GitHub publishing credentials or a client bundle:

| Variable                         | Meaning / value                                                                                         |
| -------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `X_CLIENT_ID`                    | Confidential Web application's client ID from the X console                                             |
| `X_CLIENT_SECRET`                | Application secret, stored as a Worker secret                                                           |
| `X_REDIRECT_URI`                 | Exactly `https://app.pickler.fun/api/v1/studio/x/callback`                                              |
| `X_TOKEN_ENCRYPTION_KEY`         | Dedicated randomly generated 32-byte secret encoded as 64 hex characters; do not reuse `ENCRYPTION_KEY` |
| `X_TOKEN_ENCRYPTION_KEY_VERSION` | Positive integer identifying that key; drain pending revocations before rotating                        |
| `X_OAUTH_ENABLED`                | `false` until credentials, identity-read pricing and policy are reviewed                                |
| `X_READS_ENABLED`                | `false` until timeline pricing, quota and X platform budget are reviewed                                |
| `X_API_POLICY_JSON`              | Required reviewed policy described below; absent means no transports are admitted                       |

The policy contains a positive integer `version`, ISO UTC `reviewedAt`, and positive integers
`identityRequestsPerDay`, `postRequestsPerDay`, `postResourcesPerDay` (at least twenty).
Those quotas are per agent and counted in UTC. Decreasing quotas applies to future reservations;
already reserved requests remain attributed to their admitted policy version. The product supplies
no commercial rates, credits-to-USD conversion, or production quota defaults. Review the current
X pricing and set the application spending cap in the X console before enabling either flag;
identity queries can also consume paid resources. Aggregate platform spending must be covered
by that explicit X application budget. Exhaustion must never be worked around by retries.

Create/review a confidential Web app in [X Console](https://console.x.com), enable read-only
OAuth 2.0, and register the exact callback. For controlled local acceptance, register/use the
separate loopback callback only; the test provider has no real X credentials. The old
`X_BEARER_TOKEN` is no longer used by this flow. API secrets have no effect until that Worker
version is deployed; a merge alone is not remote OAuth acceptance.

Reference: [official authorization-code documentation](https://docs.x.com/fundamentals/authentication/oauth-2-0/authorization-code),
[user token lifecycle](https://docs.x.com/fundamentals/authentication/oauth-2-0/user-access-token),
and [X pricing](https://docs.x.com/x-api/getting-started/pricing).

## Reproduction and evidence

Use Node 22.22+, the committed lockfile and local disposable PostgreSQL. No real X transport is
allowed in acceptance:

```sh
npm ci
npm run build:shared
node --import tsx --test \
  packages/core/test/studio-x-oauth.test.ts \
  packages/infrastructure/test/x-client.test.ts \
  packages/infrastructure/test/controlled-worker.test.ts \
  packages/infrastructure/test/studio-go-public.test.ts \
  workers/api/test/studio-x-route.test.ts \
  workers/api/test/openapi.test.ts
npm run api:openapi -- --output /tmp/pickler-x-openapi.json
npm run design:check
```

The API suite creates and drops a separate `pickler_test_<uuid>` database per case, rejects remote
hosts before writing, and injects captured X responses only at the external provider boundary.
It traverses actual JWT-only route middleware, core services, encrypted PostgreSQL and publication.
Provider tests cover S256, confidential exchange, timeline attribution and explicit failures.

[Controlled Studio acceptance](studio-acceptance.md) now includes the real Connect X UI, protected
callback, PostgreSQL link, publication and Load posts in its existing isolated Supabase/Workers
flow. `scripts/studio/configure.mjs` generates fake credentials and reviewed **test-only** quotas.
The browser intercepts only the external X consent destination and sends it to the loopback
provider; PKCE is checked there. Product endpoints are never stubbed. Run the documented local
stack commands, then `npm run test:studio-local -- <controlled-stack-directory>`.

Real acceptance remains separate: X console configuration, credentials, reviewed paid budget,
remote migrations/version, real consent/renewal/revocation and private timeline availability.
No controlled response demonstrates these remote capabilities or authorizes real spending.

## Controlled acceptance matrix

| Scenario                                                                                                 | Status    | Evidence boundary                                                                                   |
| -------------------------------------------------------------------------------------------------------- | --------- | --------------------------------------------------------------------------------------------------- |
| Consent, rejection, expiry, missing scopes, incorrect state/cookie, duplicate callback and PKCE          | Passed    | Controlled provider, actual core/API and isolated PostgreSQL                                        |
| Owner and workspace isolation, member rejection, concurrent identity claims and access/ownership changes | Passed    | Actual JWT middleware and transactional PostgreSQL                                                  |
| Legacy proof preservation, mandatory OAuth publication and disconnect/publication races                  | Passed    | Isolated migration and locked publication repository                                                |
| Concurrent, interrupted and uncertain renewal without repeating exchanges                                | Passed    | Controlled provider and version-fenced PostgreSQL claims                                            |
| Public/private disconnect, failed revocation, explicit cleanup and immediate local blocking              | Passed    | Controlled provider; publication/trading state is retained                                          |
| Timeline attribution, paging, resource quotas, 429/Retry-After and no content persistence                | Passed    | Controlled provider and immutable request reservations                                              |
| Callback forwarding through Web and member access to the owner connection                                | Corrected | Redirects are no longer followed by the facade; actual principal is checked before owner operations |
| Public-page copy implying that connection enables posting to X                                           | Corrected | Connection is described as read-only; no public post feed is introduced                             |
| Studio creation, OAuth, publication, manual posts and existing four strategy journeys                    | Passed    | Compiled local Web/API/Research, external fixtures and dedicated Supabase                           |
| Real X consent, credentials, prices, spending cap, renewal/revocation and hosted release                 | Pending   | Requires reviewed operational configuration and separately authorized real acceptance               |

The focused provider/API/migration/OpenAPI regression run contains 67 passing tests. The full
repository suite is also required; consult the PR validation record for its final total. Design covers all 114 registered routes; the
separate loading, avatar readiness and sidebar motion checks remain enabled. Local logs,
browser captures and generated controlled configuration are private artifacts outside Git.
The acceptance runner records the tested source commit, local configuration identity, requests
and per-strategy results in its private run directory. These records are not live-provider evidence.

The compiled four-strategy journey completed against source commit
`ac12ed63bbe4cdb148888e3581e8024cefc991cc`: `combined`, `rules`, `deepseek` and `jev`, all at
`2.1.0`, retained their independent accounts and existing Queue/simulator behavior. The subsequent
revocation-only correction is verified by the focused PostgreSQL suite, including separate access
and refresh revocation and partial cleanup without retaining or resending the completed token.
The final commit is additionally verified by CI. Reproduce the full journey with the command above;
its artifact records the new checkout's exact commit rather than importing this historical result.

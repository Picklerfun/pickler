# PR #124 reconciliation with main

PR #124 merges main commit `0c0e3dd3901893525b6a95991018b0c20c16a124` without
reapplying #122 or #128. It preserves private token routes, economics, public persona token cards,
all four token previews, and advice/x402. Public Tokens and Leaderboard remain Soon and their
old pages remain unmounted. Radix navigation has one Create agent destination, `/create`.

## Migration provenance

Published main SQL, snapshots and journal entries through `0038_advice_x402` remain byte-identical.
Drizzle generated `0039_application_review` from the combined schema and generated the custom
`0040_application_access` metadata from that same schema. Generation commands from the root:

```sh
npm run db:generate --workspace=@pickler/infrastructure -- --name=application_review
npm run db:generate --workspace=@pickler/infrastructure -- --custom --name=application_access
```

The old PR-only SQL identities are superseded and must not be applied:

| Original PR migration     | SHA-256                                                            |
| ------------------------- | ------------------------------------------------------------------ |
| `0036_application_review` | `118e74daa82b29040099a52605d6548a4b2f186a247fef5506c06825a63af0dd` |
| `0037_application_access` | `34c51642536947f60ffecd541b3351094e28970bf2f7601582d96e48744acbd5` |

A read-only transaction inspected the configured shared Supabase operator database on 2026-10-09:
39 migration records, neither old application hash, and neither `growth.review_application` nor
`growth.claim_invite` present. The other configured application connections are loopback. No
shared migration or database write was performed. Before a future release, check its target
history again. If either superseded hash or an untracked application schema exists, stop and
reconcile that specific history explicitly; never reset it or relabel journal records.

## Access and API

`GET /v1/marketplace/activity` remains public. `GET /v1/studio/applications` and
`PUT /v1/studio/applications/{id}` require verified user JWT and server-controlled super-admin
membership. Inviting records reviewer, timestamp and note, and enables research access for an
existing account under the application's email. Future accounts claim the invite during
onboarding. No acceptance email is sent. Security-definer review, claim and status functions are
not executable by PUBLIC, anon or authenticated roles; the trusted backend executes them.
Public application and account notices describe access under the submitted email without
promising an email delivery. Inbox decisions retain the active status filter. Application IDs
are converted from PostgreSQL bigint strings into checked safe integers before the HTTP boundary.

`/v1/landing` and `POST /v1/studio/access-request` stay retired. OpenAPI is generated at
`/v1/openapi.json`, proxied by the web at `/api/v1/openapi.json`.

## Validation

The migration history suite covers fresh installation and main-through-0038 upgrades with stored
token projections and economic presets preserved. The PostgreSQL application suite covers
filters, audit, invitation, rejection, existing/future accounts and unauthorized review.
Executed on 2026-10-09 with Node 24.19.0 and npm 10.9.3:

- Full root suite: 3,002 tests, 2,993 passed, zero failed, nine conditional skips. This includes
  fresh installation, main-through-0038 upgrade preservation, actual PostgreSQL review and numeric
  API IDs, token authorization/confirmation/economics, and advice/x402 controlled acceptance.
- Architecture, all 17 workspace typechecks, design-fixture types, lint and Prettier passed.
- Shared packages, API Worker dry build and Next.js/OpenNext web Worker build passed. No publish.
- OpenAPI export validated 197 operations, public activity, JWT-only review, the preserved token
  and advice routes, and the absence of retired landing/access-write operations.
- Strict source, surfaces, tokens, contrast and type design checks passed over 13 affected routes:
  landing, create, Account access, three Studio access states, four private token previews, two
  public token card states, and the connected portfolio.
- Browser acceptance passed public navigation at 320–1440px with keyboard/touch, all four token
  previews, desktop/mobile public submission through local growth handlers, and nine delayed
  authenticated scenarios including review, access and preserved private token edits. These are
  controlled local checks, not remote provider or financial acceptance.

The merge also stabilizes the existing X daily-quota regression's clock so its two-hour advance
cannot cross UTC midnight unintentionally. Production X behavior is unchanged.

No PR merge, deployment, shared migration, launch activation or paid provider call is included.

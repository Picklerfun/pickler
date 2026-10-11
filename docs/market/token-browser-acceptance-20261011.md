# Token browser acceptance — 11 October 2026

## Scope

The requested acceptance is a real owner passkey launch, an owner Studio purchase, canonical
indexing, landing discovery and an ordinary visitor purchase. Controlled fixtures do not prove
this hosted flow. No manual deployment, mainnet transaction or merge was performed in this change.

## Confirmed hosted state

A read-only check at 18:41 UTC found:

- The API launch gate is enabled on testnet; public trading bindings were absent, so public
  preparation remained disabled independently of the launch gate.
- The indexer gate is enabled remotely. The factory cursor was 70,111,087 against head
  70,185,565: 74,478 blocks behind. Recent cursor timestamps do not establish catch-up.
- The published `teterabob` persona returned no launched token, with confirmation `absent`.
- Its previous missing-signature attempt was already closed with `EXPIRED_LAUNCH_NOT_CREATED`.
  No transaction hash or new token was confirmed for that attempt. Its draft remains intact.
- The open owner browser had 0 AUSD in the master wallet and 9.4974 MON. The separate agent
  wallet is not a source of buyer funds. An owner purchase requires testnet AUSD in the master.

The open browser session was detected, but the Mac was locked and native interaction failed.
The owner must unlock it and complete the passkey approval for the real launch. No passkey
approval was bypassed and no new signature or transaction was requested in this acceptance.

A second read-only observation at 18:58 UTC found factory cursor 70,113,687 against head
70,188,951: 75,264 blocks behind. Across the two observations the cursor advanced 2,600 blocks
and the chain advanced 3,386, so the backlog grew by 786. This interval does not demonstrate
sufficient catch-up capacity. Capacity investigation remains pending; resource ceilings and
historical cursors were not increased or skipped.

GitHub recorded `startup_failure` before starting any jobs on this PR and on the preceding main
commit. No CI check has passed for this head. Local validation is separate from the unavailable
hosted CI execution.

## Corrections

The landing now reads the existing public directory alongside activity. A nullable canonical
`launchedToken` summary drives compact cards linking to the public agent profile. Directory
reads share the persona/Studio confirmation predicate in one batched query, without RPC calls.
Private, pending, orphaned and unattributed launches do not appear. Failed reads have an explicit
unavailable message rather than claiming there are no tokens.

The versioned testnet API configuration enables public preparation with 10,000 RPC calls reserved
per UTC day, at most 250 preparation requests. Existing per-wallet and per-preparation limits
remain. The indexer source retains its already-enabled gate so a later automatic publication
does not disable it. Its cursor and resource policy are unchanged; no historical range is skipped.

## Validation

| Scenario                                                           | Evidence                                                              | Result  |
| ------------------------------------------------------------------ | --------------------------------------------------------------------- | ------- |
| Confirmation, wrong network, private visibility and orphan removal | Real isolated PostgreSQL, `token-launch.test.ts`                      | Passed  |
| Directory history, reads and failures                              | Real isolated PostgreSQL, `agent-directory.test.ts`                   | Passed  |
| Public JWT-free preparation, strict bodies, disabled/quota errors  | Injected API route suite                                              | Passed  |
| Concurrent public RPC reservation                                  | Real isolated PostgreSQL quota suite                                  | Passed  |
| Empty, failed and confirmed landing listings                       | Strict loopback API + production web, 390/1280 px                     | Passed  |
| Keyboard landing → public profile → Buy/Sell panel                 | Controlled browser, no external requests                              | Passed  |
| Owner passkey launch and Studio buy                                | Open hosted session; requires unlock, passkey approval and buyer AUSD | Pending |
| New token canonical indexing and hosted landing appearance         | No new launch; indexer still recovering history                       | Pending |
| GitHub CI                                                          | Startup failure before jobs, also present on preceding main           | Pending |
| Ordinary visitor buy/sell                                          | Testnet gate needs automatic release and a confirmed token            | Pending |

The controlled API/PostgreSQL run passed 29 tests. The browser run passed six scenarios with no
page errors or external requests. Shared and web builds, types, lint, format, architecture,
OpenAPI, design source, staging topology and API dry-run checks passed. API dry-run is not a deployment.

## Reproduce

Use Node 22.22+ and a disposable loopback PostgreSQL with CREATEDB. Never target these tests at
the hosted database.

```sh
npm run build:shared
node --import tsx --test --test-concurrency=2 packages/infrastructure/test/token-launch.test.ts packages/infrastructure/test/agent-directory.test.ts workers/api/test/public-token-trading-route.test.ts packages/infrastructure/test/public-token-rpc-quota.test.ts
npm run build --workspace=@pickler/web
node --import tsx scripts/design/token-discovery.mjs
```

Playwright must be installed globally as required by Design. Browser diagnostics and screenshots
are local under `scripts/design/.shots/diagnostics/token-discovery`; none contain a real signature,
credential or transaction. Only a later recorded canonical transaction can close hosted acceptance.

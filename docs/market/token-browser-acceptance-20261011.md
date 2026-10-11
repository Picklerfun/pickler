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

At those observations, the open browser session was detected, but the Mac was locked and native
interaction failed. The owner passkey approval remained pending. No passkey
approval was bypassed and no owner launch or trade was signed or sent during this acceptance.
The separate operator faucet transaction below only supplied testnet buyer funds.

A second read-only observation at 18:58 UTC found factory cursor 70,113,687 against head
70,188,951: 75,264 blocks behind. Across the two observations the cursor advanced 2,600 blocks
and the chain advanced 3,386, so the backlog grew by 786. This interval does not demonstrate
sufficient catch-up capacity. Capacity investigation remains pending; resource ceilings and
historical cursors were not increased or skipped.

The final read at 19:17 UTC still returned `tokenConfirmation: absent` for `teterabob` and
factory cursor 70,116,187 against head 70,192,635: 76,448 blocks behind. The correction below
is local/PR code and was not deployed to obtain these observations.

A bounded live log capture observed three overlapping Cron invocations returning `busy` without
exceptions. It did not capture the lease-owning run's completion, so it cannot identify whether
provider latency or persistence dominates that run. No remote throughput correction is claimed.

GitHub recorded `startup_failure` before starting any jobs on this PR and on the preceding main
commit. No CI check has passed for this head. Local validation is separate from the unavailable
hosted CI execution.

## Owner master testnet funding

At 19:29 UTC, the canonical receipt and current AUSD balance confirmed one operator-funded
faucet claim to the registered master wallet
`0xb02ef97791021e3e80d51e2db34871b1ec6b6bb2`. The faucet transferred 10,000 testnet AUSD;
it did not mint a Pickler token. The balance changed from 0 to 10,000 AUSD. The separate
agent wallet and its trading funds were not used.

- Network: Monad testnet, chain ID 10143.
- AUSD: `0xa9012a055bd4e0edff8ce09f960291c09d5322dc`, six decimals.
- Faucet: `0xd236c18d274e54faccc3dd9dda4b27965a73ee6c`; deployment identity was checked
  against the previously pinned runtime hash before simulation and signing.
- [Confirmed faucet transaction](https://testnet.monadscan.com/tx/0x633ae576591271045cac6b84ec802e8384a52e05c2922f098d624074c7c030ec).
- Canonical block: 70,194,504; reconciliation observed more than five later blocks and
  matching block/receipt hashes.
- Receipt gas: 156,720 at 102 gwei, costing 0.01598544 testnet MON, below the reviewed
  0.02 testnet MON cost ceiling. No fiat spend or paid RPC was introduced.

The signed transaction was persisted before the single broadcast. The initial receipt check
could not complete its mint-only assertion because this faucet transfers existing AUSD.
Read-only reconciliation of the same hash confirmed the transfer and balance; neither signing
nor broadcast was repeated. No owner passkey approval, launch, curve purchase or visitor
purchase is implied by this funding receipt. At that observation, the locked browser still
displayed its earlier balance snapshot; it was not reloaded over preserved form edits.

## Resumed owner browser preparation

At 21:44–21:47 UTC, the Mac was unlocked and the existing authenticated Studio tab was usable
through native browser controls. Refreshing the saved status showed the previous attempt as
failed; after saving the current name/ticker and reloading, the current UI explained
`EXPIRED_LAUNCH_NOT_CREATED` as an expired authorization with no token created. Copy actions use
icons, and addresses themselves link to the explorer. The master balance now displayed the
confirmed 10,000 testnet AUSD.

A new preparation for `teterabOb` / `TETERA` completed through the owner UI. The hosted repository
recorded `awaiting_signature`, with no activity ID, transaction hash or preparation error. Studio
showed Monad testnet, the registered master and factory, and a maximum gas cost of
0.35651088 MON. The owner was handed the `Sign with passkey` step; no approval, signature or
launch broadcast was performed by the browser agent. This preparation is not launch acceptance.

The read at 21:47 UTC still returned no launched token. The factory cursor was 70,134,787 against
head 70,222,469: 87,682 blocks behind. The grouped admission correction below had not been
published; sustained catch-up remains unproven. Public trading bindings were still absent and
PR #148 remained open with CI startup failures. No manual deployment was performed.

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

The indexer's private admission scheduler now reserves up to four queued reads in one PostgreSQL
update, for their actual call count, before transport. A 100-header controlled range uses 25
reservation statements instead of 100, with the same 100 RPC calls and at most four in flight.
Sequential identity/deployment reads reserve only their own count. A group that cannot fit the
remaining budget is refused as a whole. No SQL lock spans RPC; failed reads stop later groups,
and lease loss prevents canonical writes and cannot release a newer owner's claim. This reduces
database work without increasing RPC budgets or skipping ancestry. Sustained hosted capacity
remains pending until automatic publication and another real measurement.

## Validation

| Scenario                                                           | Evidence                                                            | Result  |
| ------------------------------------------------------------------ | ------------------------------------------------------------------- | ------- |
| Confirmation, wrong network, private visibility and orphan removal | Real isolated PostgreSQL, `token-launch.test.ts`                    | Passed  |
| Directory history, reads and failures                              | Real isolated PostgreSQL, `agent-directory.test.ts`                 | Passed  |
| Public JWT-free preparation, strict bodies, disabled/quota errors  | Injected API route suite                                            | Passed  |
| Concurrent public RPC reservation                                  | Real isolated PostgreSQL quota suite                                | Passed  |
| Empty, failed and confirmed landing listings                       | Strict loopback API + production web, 390/1280 px                   | Passed  |
| Keyboard landing → public profile → Buy/Sell panel                 | Controlled browser, no external requests                            | Passed  |
| Grouped reserves, daily quota, lease loss and historical parity    | 56 controlled admission/PostgreSQL/scheduling regressions           | Passed  |
| Owner passkey launch and Studio buy                                | Master funded; new launch prepared; requires owner passkey approval | Pending |
| Master-wallet AUSD for the test purchase                           | Canonical faucet receipt, 10,000 AUSD received                      | Passed  |
| New token canonical indexing and hosted landing appearance         | No new launch; indexer still recovering history                     | Pending |
| GitHub CI                                                          | Startup failure before jobs, also present on preceding main         | Pending |
| Ordinary visitor buy/sell                                          | Testnet gate needs automatic release and a confirmed token          | Pending |

The controlled API/directory PostgreSQL run passed 29 tests. The indexer admission, canonical
PostgreSQL indexing, historical operation compatibility and host scheduling runs passed 56 tests,
including UTC quota reset and loss of the lease while a read group is in flight. The browser run passed six scenarios with no
page errors or external requests. Shared and web builds, types, lint, format, architecture,
OpenAPI, design source, staging topology and API/indexer dry-run checks passed. Dry-run packaging
is not a deployment.

## Reproduce

Use Node 22.22+ and a disposable loopback PostgreSQL with CREATEDB. Never target these tests at
the hosted database.

```sh
npm run build:shared
node --import tsx --test --test-concurrency=2 packages/infrastructure/test/token-launch.test.ts packages/infrastructure/test/agent-directory.test.ts workers/api/test/public-token-trading-route.test.ts packages/infrastructure/test/public-token-rpc-quota.test.ts
node --import tsx --test --test-concurrency=2 packages/infrastructure/test/token-indexer-rpc-admission.test.ts packages/infrastructure/test/uniswap-indexer.test.ts packages/infrastructure/test/launch-indexer.test.ts workers/indexer/test/token-schedule.test.ts
node --import tsx --test --test-concurrency=2 packages/infrastructure/test/token-operations.test.ts packages/infrastructure/test/launch-index-store.test.ts
npm run build --workspace=@pickler/web
node --import tsx scripts/design/token-discovery.mjs
```

Playwright must be installed globally as required by Design. Browser diagnostics and screenshots
are local under `scripts/design/.shots/diagnostics/token-discovery`; none contain a real signature,
credential or transaction. Only a later recorded canonical transaction can close hosted acceptance.

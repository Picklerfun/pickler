# Studio, custody, Perpl and launchpad integration review

Status: audited implementation map and proposed follow-up plan, not an execution runbook.
Reviewed on 2026-09-29 against main `4b4bd2662d4d6597aaee6b0f5cdaf26c1c361704`.
PR #61 was inspected separately at `faa3294ccf679fcacab5d6101b96f4f6f1203d21`.
Three review agents covered custody, product/API and trading/indexing; the coordinating review
covered contracts and cross-system flows. This was static inspection, not new runtime, security,
remote-provider or deployment acceptance. No models, signatures, transfers or deployments ran.

Code dependency rules remain in [Trading architecture](trading-architecture.md). This document
maps product transitions and remaining integration work; it does not replace those rules.

## 1. Repository handoff

- Our evaluation checkout is clean at `4b78834`, already published in
  [PR #60](https://github.com/Picklerfun/pickler/pull/60). Its checks were green at inspection;
  it remains open. There were no additional uncommitted changes there to publish.
- [PR #40](https://github.com/Picklerfun/pickler/pull/40) merged custody and Studio wallet work;
  [PR #37](https://github.com/Picklerfun/pickler/pull/37) merged the launchpad foundation;
  [PR #59](https://github.com/Picklerfun/pickler/pull/59) merged the trading extraction.
- [PR #61](https://github.com/Picklerfun/pickler/pull/61) is open and conflicting. It introduces
  private drafts and previews, not just the wallet functionality already on main.
- The root checkout is clean on `codex/shared-jev-client`. All eleven branch commits have
  patch-equivalent changes on main (`git cherry`), so no duplicate publication is needed. This
  review leaves that checkout intact.
- This review uses `codex/wallet-perpl-audit`, isolated from both active and historical checkouts.
  Main was fetched and the branch created from its current remote head.
- The other session owns `codex/perpl-data-reliability`: coherent public BTC/ETH acquisition,
  skipped rounds, lease diagnosis and the unpaid thirty-minute stability check. This review does
  not duplicate or change that work. Paid comparisons remain a later gate.

## 2. What exists, and what is missing

| Area                    | Implemented on audited main                                                                    | Missing connection or qualification                                                                        |
| ----------------------- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Creator custody         | Supabase identity, Turnkey suborganization, passkey root and master wallet                     | Remote configuration and real ceremony acceptance were not established here                                |
| Agent wallets           | Separate wallets inside the creator's suborganization, approved policies and unique agent link | No Perpl account mapping or delegated Perpl signer                                                         |
| Funding                 | Passkey-approved AUSD transfer from master to agent wallet                                     | Exchange collateral deposit and receipt/finality reconciliation                                            |
| Agent execution         | Shared research runtime, Polymarket paths, Perpl virtual evaluation                            | Studio cannot yet create/run a Perpl agent                                                                 |
| Creator spending limits | Persisted per-call/per-day values                                                              | Main explicitly reports `spendEnforced: false`                                                             |
| Marketplace             | Agent directory reads PostgreSQL                                                               | Perpetual market board uses sample data; trade ticket cannot submit                                        |
| Launch contracts        | Fixed-supply token, factory, curve, V4 graduation, locker, fee escrow                          | No Pickler deployment manifest/scripts or end-to-end launch ceremony                                       |
| Launch API              | Public catalogue/detail/trades reads                                                           | No launch, quote, buy/sell or graduation preparation/submission                                            |
| Indexer                 | Raw blocks/logs, cursor, transactional persistence and reorg marking                           | Child emitters, composed projector, automatic projection rollback, attribution and full market projections |

Turnkey owns key custody and policy-controlled signing. Perpl is an exchange account/position
system, not the custodian of the creator's Turnkey wallets. A wallet funded with AUSD does not
therefore have Perpl collateral. The term “child wallet” describes our product relationship:
the implementation creates independent wallets in one suborganization, not wallets derived from
master-wallet keys. A single delegated platform public key is registered for the creator's
non-root Pickler user; it is not currently a separate key per agent.

Evidence:
[wallet schema](../packages/infrastructure/src/persistence/product/wallets.ts),
[Turnkey provisioning](../packages/infrastructure/src/turnkey/turnkey-sub-organization.ts),
[agent creation transaction](../packages/infrastructure/src/studio/directory.ts),
[delegated policies](../packages/core/src/features/wallets/domain/agent-wallet-policies.ts),
[Studio routes](../workers/api/src/routes/studio.ts),
[marketplace composition](../workers/api/src/growth/services.ts).

## 3. Proposed business flows and authorities

This is the target map, not a claim that every arrow runs today.

```mermaid
flowchart TB
  U[Creator: authenticated user and passkey] --> S[Studio: configure and test agent]
  U --> TK[Turnkey: creator suborganization and master wallet]
  TK --> AW[Dedicated agent wallet and approved delegation]
  S --> ID[Canonical product agent and runtime identity]
  ID --> AW
  AW --> VC[Perpl account: confirmed collateral]
  ID --> ENG[Shared trading engine: proposals and deterministic risk]
  ENG --> EX[Scoped execution service and Turnkey signer]
  EX --> PP[Perpl orders, fills, positions and funding]
  VC --> PP
  ID --> L[Explicit token launch with creator authorization]
  L --> C[Factory, agent token and bonding curve]
  B[Buyers using their own wallets] --> C
  C --> G[Graduation: reserve and token allocation]
  G --> DEX[Uniswap V4 pool and locked LP]
  B --> DEX
  C --> IDX[Canonical event ingestion and projections]
  DEX --> IDX
  PP --> REC[Perpl account reconciliation]
  IDX --> API[Shared API read models]
  REC --> API
  API --> S
  API --> M[Marketplace: public authorized projections]
```

Each fact has an explicit authority; “one source of truth” does not mean one table owns
identity, private keys and exchange balances:

| Fact                                                 | Authority and owner                                                      |
| ---------------------------------------------------- | ------------------------------------------------------------------------ |
| Identity, tenant membership, agent configuration     | Product/runtime records; core authorization, infrastructure persistence  |
| Key control, root consent and delegated signing      | Turnkey policies; custody application ports and infrastructure adapters  |
| Strategies, order admissibility and financial risk   | `@pickler/trading`; runtime composes model/provider plugins              |
| Actual token supply, curve reserve, pool and fees    | Deployed contracts and canonical chain receipts/events                   |
| Actual Perpl collateral, orders, fills and positions | Perpl contracts/account state, reconciled through its adapter            |
| Marketplace prices, candles, holders and status      | Rebuildable projections of authorized canonical sources, with watermarks |
| LLM cost                                             | Separate USD usage/reservation ledger                                    |

Persist an explicit binding across user, workspace, tenant, product agent, runtime agent,
Turnkey organization/wallet/address, chain ID, venue account, and launch agentKey/factory/token.
No component may infer this binding from ticker, display name or unsigned metadata.

### Agent lifecycle

Main creates an agent together with its approved wallet and public profile. PR #61 adds private
walletless drafts; its “Go Public” transition is disabled. Neither path currently launches a token.

Proposed lifecycle, pending the creator's choice about launch timing:

```mermaid
stateDiagram-v2
  [*] --> PrivateDraft
  PrivateDraft --> Tested: explicit preview or virtual evaluation
  Tested --> DeploymentPrepared: wallet, policies, metadata and launch terms
  DeploymentPrepared --> LaunchSubmitted: creator approves and signs
  LaunchSubmitted --> PublicAgent: canonical token receipt and index attribution
  LaunchSubmitted --> PendingRecovery: timeout, reverted transaction or reorg
  PendingRecovery --> DeploymentPrepared: reconciled outcome permits retry
  PublicAgent --> CurveTrading
  CurveTrading --> ReadyToGraduate
  ReadyToGraduate --> PoolActive: atomic graduation verified
```

Recommendation: token creation belongs to public deployment, while private drafts can be tested
without an on-chain token. If every persisted agent must instead have a token, adjust admission
and recovery explicitly; do not silently impose that rule on drafts introduced in PR #61.
Venue trading permission remains a separate state: public token status does not authorize Perpl
trading, and a stopped Perpl strategy must not erase its token's market or history.

### Money boundaries

Keep all of these separate in storage and UI:

1. Creator and agent wallet balances, including native gas.
2. Confirmed Perpl collateral, equity, reserved margin and withdrawable balance.
3. Virtual paper capital and results.
4. Token curve reserve and token inventory.
5. Permanently locked DEX liquidity principal.
6. Creator/protocol accrued and claimable fees.
7. Model cost in USD.

Buying an agent token does not automatically fund its Perpl account or confer a claim on its
trading P&L. The current contracts do not implement that relationship. Any future treasury or
fee-to-trading allocation requires a separately authorized, recorded flow; curve and LP reserves
must not become trading capital.

## 4. Endpoint inventory

These are API paths on audited main; the web forwards `/api/v1/*` to `/v1/*`.
Existence in source does not prove a route is mounted/configured in a deployed environment.

| Operation               | Existing endpoint family                                                                                                                                   | Status                                                      |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Profile/session         | `GET /v1/auth/me`, `GET/POST /v1/profile`                                                                                                                  | Authenticated user                                          |
| Master wallet           | `POST /v1/signing/passkeys/{challenge,register}`, `GET /v1/signing/wallets/me`                                                                             | JWT; conditional Turnkey mount                              |
| Additional passkey      | `GET /v1/signing/passkeys`, `POST /v1/signing/passkeys/add/{prepare,confirm}`                                                                              | User passkey ceremony                                       |
| Agent delegation/wallet | `GET /v1/signing/agents/state`, `POST /v1/signing/agents/{delegated,wallet}/{prepare,confirm}`                                                             | JWT and exact stamped activities                            |
| Agent policies          | `POST /v1/signing/agents/wallet/:walletId/policies/{prepare,confirm}`                                                                                      | Own wallet, server-owned policy terms                       |
| Agent creation/read     | `GET/POST /v1/studio/agents`, `GET /v1/studio/agents/:id`                                                                                                  | Scoped identity and approved wallet                         |
| Model drafting          | `POST /v1/studio/agents/draft`                                                                                                                             | Model-based drafting; not a saved private draft             |
| Funding wallet          | `POST /v1/studio/agents/:id/deposit/{prepare,confirm}`                                                                                                     | AUSD wallet transfer, not exchange collateral               |
| Controls                | `PUT /v1/studio/agents/:id/{config,limits,interval,pause,schedule}`                                                                                        | Research controls; stored spend limits not live enforcement |
| Research                | `GET/POST /v1/studio/agents/:id/runs`, `GET /v1/studio/runs/:id`, `GET /v1/studio/runs/:id/events`                                                         | Shared research runner                                      |
| Existing trading        | `/v1/studio/agents/:id/trading/*`, `GET /v1/studio/trading/orders/:id`, `POST /v1/studio/trading/orders/:id/submit`, `POST /v1/studio/runs/:id/live-order` | Polymarket-specific, not Perpl                              |
| Public product          | `GET /v1/marketplace/*`                                                                                                                                    | Agent directory persisted; perpetual markets sampled        |
| Token catalogue         | `GET /v1/launches`, `GET /v1/launches/:id`, `GET /v1/launches/:id/trades`                                                                                  | Reads only                                                  |

PR #61 separately proposes `POST /v1/studio/preview-runs`,
`GET /v1/studio/preview-runs/:id`, and `POST /v1/studio/drafts`.

Missing API use cases to specify before implementing routes: publish/launch preparation and
status, token quotes and transaction preparation, graduation status/preparation, venue-account
onboarding, Perpl collateral/withdrawal, order admission/status/cancel and account reconciliation.
Keep custody and venue execution distinct; do not expose a generic arbitrary-signing endpoint.

## 5. Findings that block end-to-end acceptance

### Custody and Perpl

- `VENUE_CONTRACTS` is empty, so the delegated user has no venue-signing ALLOW. Existing DENYs
  block ERC-20 transfer/approve and privilege escalation. Filling an address list is insufficient:
  define chain, account, contract methods, caps, nonce handling and revocation first.
- `workers/trading` currently uses a static Polymarket signer and credentials. It does not route
  agent Turnkey wallets into Perpl. Perpl has read-only tools and a virtual simulator only.
- Deposits record broadcast hashes, not confirmed exchange credit. Include chain ID, receipts,
  finality, reorg and orphaned external-effect recovery in the funding state machine.
- Review delegated-key blast radius and rotation: one configured platform key serves multiple
  creator suborganizations. Document what can be revoked per creator and per agent.

### Contracts and launch attribution

- Factory enforces one token per nonzero `agentKey`, but `_authorize` authenticates the supplied
  creator without checking a creator namespace for that key. Another creator can provide the
  same intended key first. This static finding requires a failing impersonation test and a
  canonical authorization/derivation design before deployment.
  Evidence: [factory](../contracts/src/PicklerLaunchFactory.sol), lines 146–160 and 258–275;
  the [development specification](specs/launchpad-monad-v1.md) requires creator namespacing.
- A Turnkey transaction builder exists internally, but public custody use cases currently only
  authorize the fixed wallet deposit. There is no launch-signing composition, deployment
  manifest, or product-agent-to-agentKey implementation.
- Graduation logic exists: release protected reserve and LP token allocation, initialize/verify
  a V4 pool, mint and lock liquidity atomically. The locker permits fee collection, not principal
  withdrawal. This is implemented code with historical tests, not a deployment acceptance claim.
  See [adapter](../contracts/src/PicklerGraduationAdapterV4.sol),
  [curve](../contracts/src/PicklerBondingCurve.sol) and
  [locker](../contracts/src/PicklerLiquidityLocker.sol).

### Indexer and public truth

- The [Worker](../workers/indexer/src/index.ts) composes one factory source and no projector.
  [Log acquisition](../packages/infrastructure/src/chain/launch-indexer.ts) filters only that
  source address. Curve trades, adapter graduation, token transfers, fees and subsequent pool
  swaps need explicit discovery and collection, including the creation/graduation block itself.
- The [projector](../packages/infrastructure/src/persistence/product/launch-projector.ts) writes
  `agentId: null`; there is no completed authoritative attribution flow. It has no candle/holder
  or V4-swap projection path. Metadata reading is injected but not composed in the Worker.
- Raw reorg marking does not reverse previously published tokens/pools/trades. The current
  [reorg projection test](../packages/infrastructure/test/launch-projector.test.ts) manually
  deletes trades before rebuilding; it does not validate automatic correction of public views.
- [Block advance](../packages/core/src/features/launch/domain/indexing.ts) validates the boundary
  against a cursor, but not every internal parent/number, and bootstrap trusts the whole range.
  [Persistence](../packages/infrastructure/src/persistence/product/launch-index-store.ts) needs
  concurrency fencing and consistent chain/stream rollback when adding multiple sources.
- [Freshness](../packages/infrastructure/src/persistence/product/launch-read-model.ts) derives
  from a raw cursor and labels it confirmed; it must instead expose projection progress and the
  effective finality policy. A high cursor from one source is not completeness of all streams.

### PR #61 reconciliation

- Its brief/preview path still configures sports research on Polymarket; it does not add Perpl
  execution. Leverage vocabulary in a brief does not change the configured protocol.
- Main mixes PostgreSQL Studio/custody with Supabase product-data adapters; PR #61 moves those
  product repositories to the invocation PostgreSQL pool, retaining Supabase authentication.
  Verify profile, workspace onboarding and public-agent identity consistency across that change.

- Pending paper logic still imports retired core financial contracts; preserve trading ownership.
- Its preview migration uses `0017`, already occupied on main, and its journal predates the merged
  custody/launch history. Append/reconcile changes without rewriting applied SQL or dropping data.
- Decide how private drafts acquire wallet, launch and publication; “Go Public” is currently disabled.
- Scope its paper-spend enforcement flag so it cannot imply that live wallet/Perpl caps are enforced.
- Preserve existing launch routes, runtime mappings, plugin permissions and the unified evaluation
  entry point. Do not accept whole-file replacements from the older branch to resolve conflicts.

## 6. Delivery plan and ownership

The audit is complete at the pinned revisions. Implementation remains proposed. Use separate
reviewable branches from current main, integrating one owner at a time for shared files.

| Stage                         | Owner/scope                                         | Deliverable and acceptance gate                                                                                                                        |
| ----------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A. Product contracts          | Coordinating session with product/custody reviewers | Agreed lifecycle, identity bindings, money map, endpoint and permission matrix; reconcile PR #61 without historical migration regression               |
| B. Launch safety and identity | Contract/custody review                             | Canonical agentKey authorization, replay protection tests, network manifest and explicit creator-signing intents; no token squatting                   |
| C. Indexing completeness      | Indexer review                                      | Multi-emitter ingestion, projector composition, fencing, full reorg recovery and attribution; replay yields identical API state without manual deletes |
| D. Launch experience          | API/Studio/marketplace review                       | Prepare/sign/submit/reconcile for publish, quote, buy/sell, graduation and fees; one UX with explicit pending/reverted/finalized states                |
| E. Perpl account integration  | Trading/custody review                              | Wallet-to-venue binding, root funding, restricted delegated execution and real limits; reuse the other session's validated acquisition module          |
| F. Testnet acceptance         | Coordinated operator release                        | Verified manifests, deployed bytecode, indexer backfill and full user journeys with controlled amounts and recorded receipts                           |
| G. Paid comparison/live pilot | Separate measured acceptance                        | New comparison window only after reliability; real Perpl activity separately authorized and reconciled                                                 |

B and C can be developed independently after A fixes the identifiers, ABI expectations and state
contracts. D depends on B/C. E can proceed independently of token liquidity, but relies on shared
identity/custody and the other session's data service. F is not an automatic deployment triggered
by this document or a merge.

The agents for the next review should retain distinct responsibilities: custody/permissions;
Studio/API/product lifecycle; contracts/economics; indexer/projections; Perpl/execution. With a
four-agent concurrency limit, run three review specialists plus a coordinator in two waves.
No two sessions should edit the same cross-cutting migration, DTO or composition file concurrently.

### Required acceptance journeys

1. Two creators, two agents each: all cross-owner wallet, scope, token and venue operations fail.
2. Interrupted wallet/policy/agent provisioning resumes or reconciles without duplicate effects.
3. Private draft stays private; public deployment creates exactly one attributed token and never
   treats a transaction hash as finality. A launch failure does not destroy the private agent.
4. Buyers quote/sign/buy/sell on the curve with min/max bounds and deadlines; limits/fees match
   Solidity and actual receipts. Do not substitute the current visual ticket arithmetic.
5. Exhaust allocation, graduate once, trade through the resulting pool, collect and claim fees;
   a failure leaves protected reserves intact and does not fabricate pool activation.
6. Replay all sources from deployment; handle duplicates, same-block creation/trades, internal
   batch reorgs, post-graduation reorgs, concurrent cron and RPC outages. Assert API projections,
   holders, candles, fees and attribution, not merely raw-log counts.
7. Fund wallet, then separately fund Perpl; place/cancel/reconcile, close and withdraw under
   explicit authority. Wrong network, excess amount, revoked policy and ambiguous send fail safely.
8. Verify wallet/venue/paper/model/curve/LP/fee balances remain separate; neither token market cap
   nor token purchases become automatically spendable Perpl capital.
9. Validate current-main and pending-branch migration histories, then full relevant tests,
   types, formatting, architecture checks, service/Worker builds and Solidity unit/fuzz/invariant
   tests. Run fork and testnet checks only as explicit gates with pinned network evidence.
10. Update each affected `AGENTS.md` alongside implementation; mark historical validation records
    by commit and preserve their evidence. Architecture diagrams and UI labels must match actual
    callable features, not specifications of future work.

## 7. Liquidity recommendation and network gate

Recommended architecture: curve trading first, then the existing atomic V4 graduation design.
Pickler can retain the buy/sell interface and construct transactions for users before and after
graduation; the DEX pool supplies post-graduation execution. Building a separate exchange or
having Pickler trade its own agents' tokens is not necessary to complete this flow. If proprietary
market-making is later desired, treat it as a separately funded, disclosed strategy with explicit
inventory limits; it must not spend locked liquidity or be presented as organic demand.

This is an engineering recommendation, not a claim about token returns or liquidity sufficiency.
Review preset economics, launch eligibility, fees and the irreversible LP lock before deployment.

The recorded [V4 spike](market/uniswap-v4-spike.md) used a Monad-maintained testnet deployment,
not an official Uniswap testnet deployment. That historical evidence does not establish current
addresses or code. Select the testnet V4 deployment explicitly, reverify chain/code hashes and
compiler/ABI compatibility, and record the choice. Official deployment addresses vary by network.
Perpl's exchange deployment and its collateral token require their own verified network manifest;
never assume the Studio default testnet or its AUSD address matches the chosen exchange.

Official references checked for this review:

- [Turnkey suborganizations](https://docs.turnkey.com/features/sub-organizations): user/org custody
  boundary and root authority; parent visibility alone is not signing permission.
- [Perpl SDK](https://github.com/PerplFoundation/dex-sdk/tree/main/crates/sdk): exchange state and
  order construction; the caller provides signing. Account state is separate from key custody.
- [Uniswap V4 deployments](https://developers.uniswap.org/docs/protocols/v4/deployments): choose and
  verify contracts per network, rather than reusing an address from another chain.

## 8. Decisions still needed

- Token timing: public deployment (recommended) versus every agent creation, including drafts.
- Testnet DEX deployment and verified contracts/versions; no automatic deployment approval.
- Approved launch preset, quote asset, creator fee recipient, gas payer and irreversible lock policy.
- Scope of the first Perpl integration: supported chain/account model and root/delegated operations.
- Confirmation of what a token represents. The current implementation promises no ownership of
  the agent wallet, revenue share or claim on Perpl P&L; any such product feature needs its own design.

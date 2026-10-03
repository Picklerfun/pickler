# Repository instruction audit — 2026-10-03

## Scope and evidence

Three reviewing agents inspected root/business boundaries, runtime/local laboratory instructions,
and hosts/infrastructure instructions. The coordinating agent inspected the imported mobile scopes
and reconciled the findings against the current source. This is an instruction audit, not an
authorization to change budgets, restart studies, deploy, or alter product behavior.

The inspected integration is `2ee6d1eeb0234895383615120cca27b596c8b174`: PR #80 with current
`main` merged into its branch, preserving the PR #83 audit and the advice implementation from main.
Its four conflicts were append conflicts in runtime, infrastructure and trading instructions and
the infrastructure export index. Both capabilities were retained. Local integration validation
passed 2,355 tests, with three optional skips and zero failures, plus types, lint and format checks.
GitHub reports PR #80 as mergeable; that does not imply its remote checks have all passed.

Inventory excludes dependencies, build output, local data and Git metadata. The 30 repository
`AGENTS.md` files contain 3,136 lines and approximately 41,438 whitespace-separated words.
This is the repository total, not the context loaded for every task.

| File                                | Lines | Words |
| ----------------------------------- | ----: | ----: |
| `apps/web/AGENTS.md`                |   505 | 8,413 |
| `packages/infrastructure/AGENTS.md` |   419 | 5,765 |
| `workers/api/AGENTS.md`             |   465 | 5,294 |
| `packages/core/AGENTS.md`           |   348 | 4,314 |
| `apps/agent-service/AGENTS.md`      |   202 | 2,783 |
| Root `AGENTS.md`                    |   164 | 2,093 |

The four largest files account for about 57% of all instruction words. A web task must read at
least root and web instructions: approximately 10,506 words before any more specific files.

## Confirmed contradictions and stale statements

### 1. Paper spending enforcement is described as disabled

[Core instructions](../packages/core/AGENTS.md) say spending is stored but not enforced and
`SPEND_ENFORCED` is false. [Schema instructions](../packages/api-schema/AGENTS.md) also describe
`spendEnforced` as false today. However,
[research types](../packages/core/src/features/research/types.ts) set `SPEND_ENFORCED` to true,
and [paper orders](../packages/trading/src/features/paper/orders.ts) enforce order and daily caps.
The [Studio schema](../packages/api-schema/src/studio.ts) already describes enforcement for paper.

Correction: describe paper-order cap enforcement precisely, and distinguish it from real-wallet
custody and live financial acceptance. Leaving this contradiction could encourage a change that
removes an existing guard.

### 2. New wallet-linked drafts are mixed with historical walletless drafts

[Core instructions](../packages/core/AGENTS.md) both require a wallet for new drafts and categorically
describe private drafts as walletless. [Studio access](../packages/core/src/features/studio/access.ts)
requires `walletId` for new drafts; the [wire schema](../packages/api-schema/src/studio.ts) correctly
distinguishes historical walletless records. Related comments in
[Studio locks](../packages/core/src/features/studio/locks.ts) also retain the older description.

Correction: distinguish creation rules from historical read compatibility. Do not migrate or
rewrite historical drafts as part of instruction cleanup.

### 3. Empty-contract and future-ABI descriptions are obsolete

[Root instructions](../AGENTS.md) say Foundry has no contracts to compile or test and call generated
ABIs future work. [Chain instructions](../packages/chain/AGENTS.md) simultaneously describe current
generation and say it will be introduced later. The repository contains substantive
[contracts](../contracts/src) and [generated ABI exports](../packages/chain/src/abi/index.ts).

Correction: describe the current generation/check workflow. Implemented contracts and generated
artifacts must not be presented as proof of a production deployment.

### 4. Migration ownership needs an explicit mobile exception

[Root instructions](../AGENTS.md) assign all migrations to Drizzle in infrastructure.
[Reads instructions](../services/reads/AGENTS.md) assign mobile migrations to a separate runner and
`mobile.migrations` ledger, implemented by [its migration script](../services/reads/scripts/migrate.mjs).
Local precedence resolves the exception, but the root absolute wording is misleading.

Correction: scope Drizzle ownership to product/research schemas and explicitly delegate the mobile
schema to reads. Never consolidate ledgers or reset schemas merely to simplify instructions.

### 5. Hosted database rules link to an obsolete transport description

[Root instructions](../AGENTS.md) prohibit a hosted direct-secret fallback, consistent with current
Worker database composition. Its linked [unification document](cloudflare-unification.md) still
describes API/research using `DATABASE_URL` directly. Root repeats the Hyperdrive/TLS/cache rules
in three sections.

Correction: retain one current constraint and link to [staging operations](cloudflare-staging.md).
Mark the older transport account as historical. Keep local/operator database connections distinct
from deployed Worker composition.

### 6. Runtime implementation ownership and paths drifted after extraction

[Service instructions](../apps/agent-service/AGENTS.md) attribute provider composition and lease
implementation to the host, then later describe their extraction into shared runtime. Some listed
paths are forwarding modules; `apps/agent-service/src/plugins/registry.ts` does not exist.
[Runtime composition](../packages/agent-runtime/src/composition/runtime.ts),
[lease management](../packages/agent-runtime/src/workers/lease.ts) and
[the registry](../packages/agent-runtime/src/plugins/registry.ts) own those implementations.

Correction: the service owns local Studio/HTTP/CLI/environment and laboratory composition;
runtime owns shared research lifecycle, models, prompts and plugins. Use public exports and current
paths rather than retelling the extraction.

### 7. Plugin instructions require files that are absent

[Runtime instructions](../packages/agent-runtime/AGENTS.md) require reading each registered plugin's
own instructions. Only Perpl and perps-paper currently have nested instruction files; six registered
plugins do not.

Correction: make the parent plugin instructions authoritative and require nested instructions when
present, or add substantive local files where responsibilities actually differ. Six empty copies
would increase maintenance without clarifying ownership.

### 8. Current capabilities are still described as unconnected or sample-only

[API instructions](../workers/api/AGENTS.md) retain a statement that product agents/workspaces are
not connected to research. [The Studio directory](../packages/infrastructure/src/studio/directory.ts)
persists workspace/tenant and agent/runtime mappings. API and infrastructure instructions also
retain sample-only market-board descriptions despite
[configured Perpl services](../workers/api/src/growth/services.ts).

Correction: describe current configured composition and its fallback separately. Availability in
code does not establish deployed-provider acceptance.

### 9. Migration numbers and command inventories have drifted

[Infrastructure instructions](../packages/infrastructure/AGENTS.md) attribute
`approved_policy_ids` to migration 0014; it is in
[0021](../packages/infrastructure/drizzle/0021_worried_sauron.sql). Another section correctly assigns
0014 to the Perpl study. Root omits trading/indexer from its project map, calls staging a three-Worker
configuration, and lists an incomplete test inventory. The
[staging checker](../scripts/check-staging.mjs) validates four configurations while build commands
in [package.json](../package.json) cover a different, five-Worker scope.

Correction: avoid global numeric counts for independently scoped commands; link to each authoritative
script. Keep migration history in schema documentation rather than repeated prose.

### 10. Smaller stale inventories and terminology

Runtime/schema instructions alternate between four and five Perpl tools; the current public tool
contract includes funding. TypeScript instructions list only some emitting consumers. UI instructions
describe `mono` as a font despite its compatibility styling. These are lower-risk maintenance issues;
prefer semantic constraints and links over lists that duplicate the implementation.

## Excess information and proposed ownership

Instruction files have accumulated release records, endpoint catalogs, protocol prompt versions,
example campaign budgets, completed acceptance counts, and detailed custody ceremony narratives.
These are useful records, but are poor substitutes for stable, scoped instructions. In particular,
a completed campaign's spend limit is not authorization for another paid campaign.

| Keep in instructions                                           | Move to existing guides or records                              |
| -------------------------------------------------------------- | --------------------------------------------------------------- |
| Layer ownership and allowed dependency direction               | Implementation/extraction history                               |
| Credential boundaries and no automatic paid retries            | Per-study costs, paid call counts and outcomes                  |
| Required historical budget accounting and unknown reservations | Campaign-specific approvals and fixed windows                   |
| Local versus hosted transport constraints                      | Deployment dates, versions and rollback probe outcomes          |
| Command entry points and how to select checks                  | Exhaustive endpoint/tool catalogs and migration inventories     |
| Package-specific invariants and immutable account derivation   | Detailed examples, custody walkthroughs and protocol narratives |

Suggested destinations include the service's Perpl/paper guides, Cloudflare staging records,
[trading architecture](trading-architecture.md), [API contract](api-contract.md), and current Studio/Mera
specifications. Keep every historical record and its provenance; moving it is not permission to erase
reservations, alter a STOP, or reinterpret an interrupted study.

A cleanup should target roughly 60–90 lines for root and 60–80 lines for service/runtime where feasible.
These are editorial targets, not a reason to omit safety-critical constraints. Root should contain
precedence, language exceptions, project lookup, boundaries, Git/worktree rules, secrets and check
selection. Local files should contain only their ownership, commands, unique invariants and guide
links. The large web/API/core/infrastructure files need a content-by-content move, not truncation.

## Differences that must not be flattened

- Hyperdrive's internal client hop and verified origin TLS are different connections.
- Operator/local Node connections and deployed Worker transport have different rules.
- Research and Perpl model deadlines belong to different frozen protocols.
- No model-executable trading tool is compatible with an explicit opt-in operator trading factory.
- Paper enforcement, real custody implementation and live acceptance are separate claims.
- Generated contracts/indexer code is not proof that those components are deployed.
- Historical records and new-session policies deliberately differ by version.
- Imported mobile Spanish documents and mobile-owned migration tooling have explicit local scope.
- Mera account derivation, RP ID and application identifiers are immutable interoperability contracts;
  do not simplify them as if they were incidental documentation.

## Separate source inconsistency

[The research wire schema](../packages/api-schema/src/research.ts) accepts `maxHorizonDays` up to eight,
while [core validation](../packages/core/src/features/research/types.ts) rejects values above seven.
Both instruction files specify seven. This is a code-contract discrepancy, not an instruction
contradiction. It needs a separately scoped fix and regression test; changing prose to eight would
hide the mismatch.

## Delivery and next change

This audit records findings without rewriting the instruction hierarchy or changing behavior.
The conflict resolution is published on PR #80, without merging it into main. The audit is a separate
documentation-only change based on that branch, preserving other sessions' work.

The next cleanup should first correct confirmed false statements, then move historical detail into
linked guides, and finally verify paths, commands and scoped precedence across all 30 files. Review
the root and each affected owner together. No paid experiment or deployment is needed for that work.

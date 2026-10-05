# API schema package instructions

Read [the root instructions](../../AGENTS.md) first and the local instructions of affected producers or consumers. Keep this file updated when public contracts change.

`@pickler/api-schema` owns transport contracts shared by API producers and clients. Exports include `HealthResponse`, the market contracts in `src/markets.ts` and the Zod research schemas in `src/research.ts`: configuration/limits, updates, dispatch, pause, scheduling, agent/run/event responses and decisions. Public runtime imports use compiled `dist`; types resolve to source.

- Keep this package portable and safe for browser imports. No Next.js, React, core, infrastructure, secrets, or provider SDK dependencies.
- Define explicit public request and response DTOs. Do not expose database rows, domain entities, `Date`, `bigint`, or credential-bearing fields directly.
- TypeScript types do not validate runtime input. When schemas are introduced, choose browser-compatible validation and apply it at untrusted boundaries. Apply the exported Zod schemas to requests, responses and structured decisions; health remains a TypeScript-only interface.
- Keep research invariants in core and financial invariants in trading; import neither into DTOs. HTTP parsing and error/status mapping belong in the app.
- Group future DTOs by feature, such as `src/bookings.ts`, and publish intentional exports through the package manifest or entry point.
- Treat changes to serialized fields as API compatibility changes. Coordinate producer and consumer updates and document versioning decisions.

From the root: `npm run typecheck --workspace=@pickler/api-schema`, `npm run lint`, and relevant consumer checks. There is no dedicated package test script yet.

## Research pilot

The local service consumes these schemas at the HTTP and model boundaries. Reject extra request fields, including caller-supplied tenant IDs. Financial prices are bounded decimal strings representing a fraction of one outcome payout per share. Research decisions contain no executable sizes. Separate manual paper-order DTOs describe virtual simulations only. Job timestamps use Unix milliseconds; evidence/decision timestamps use ISO UTC. Runtime schemas must stay portable and contain no business-owned imports.

The research `outputTokens` cap is 32,768 per model call, including provider reasoning tokens. Core defaults to this cap; existing persisted agent configurations retain their values until explicitly updated. The agent-service caps selection and connection probes separately at 2,000.

`modelAssessmentSchema` is the strict model-output contract; it includes a subjective probability range, uncertainty level and missing material information, but no policy verdict. `decisionV2Schema` describes stored final decisions with original model assessment and code-owned policy evaluation. `decisionSchema` accepts both v2 and unchanged legacy records for reads. Config accepts optional `uncertaintyPolicy` for backward compatibility; core resolves omitted policies conservatively.

Optional `discoveryPolicy` is versioned independently: version 1 accepts `open-market` or `pre-event`, minimum lead 15–1,440 minutes and horizon 1–7 days. Existing documents without this field retain open-market behavior. Updating a config uses the existing version check and disables scheduling; no historical backfill or database migration is needed. Decision v2 and polling contracts are unchanged.

Plugin configuration is optional for historical reads. New NFL output uses `nflAssessmentSchema` and `decisionV3Schema`; v1/v2 remain accepted. A v3 forecast is distinct from action and includes an explicit inability reason when probability cannot be estimated. Coverage has exactly nine protocol sections. Configuration adds two optional sports tools and per-plugin activation; no credentials belong in these DTOs.

`src/paper.ts` exports the manual simulation response schema. The POST body accepts no size, price override, credentials or tenant identity. Public orders include virtual budget and fill evidence but no internal lease columns. Research DTOs retain their shape.

NFL coverage `sourceIds` may identify retrieved sources or section-scoped execution context references recorded in the `research_references` event. Market/quote/availability references are not independent sports evidence. Top-level decision `sourceIds` remain retrieved-source identifiers; the public DTO shape is unchanged. Core enforces reference scope and quote attribution.

`marketScopeSchema` and `marketCatalogSchema` describe the version-1 two-level sports catalog. Scoped configs reject mixed legacy selection fields. `generalAssessmentSchema` has eight coverage sections; `decisionV4Schema` discriminates NFL and general outputs while `decisionSchema` still accepts v1/v2/v3. Plugins remain independent of sports selection.

## Public agents

`src/agents.ts` carries the public agent board, persona, directory, reads, analytics and
leaderboard. On every one of these DTOs `null` means absent: a figure that has no source yet — no
token launched, so no `ticker`, `slug`, `marketCap` or `stage`; nothing settled, so no
`calibrationGap` or `score`; no paid reads, so no `service` — is `null`, never `0` or `""`.
Consumers render the absence and must not coerce it. `followers`, `brief` and `rules` were removed
from the persona and profile DTOs because nothing stores followers and the brief is private runtime
configuration.

## Studio contracts

`src/studio.ts` validates agent identity and idempotency keys. Studio research responses reuse runtime schemas and preserve 202 plus runId. Product, growth and research response families remain distinct; see ../../docs/cloudflare-unification.md.

An agent is created one way: `draftCreateSchema`, the strict body of `POST /v1/studio/drafts` (name,
handle, voice, avatar, sources, brief, caps and the `walletId` of the agent wallet already made,
funded and policy-signed). `ACCENTS` (`src/landing.ts`) and `VENUES` (`src/agents.ts`) are the
lists their DTO unions derive from, the way `CATEGORY_OPTIONS` does; a workers/api test pins them,
and `draftCreateSchema`'s voices, to core's lists. `createAgentSchema`, `agentProfileInputSchema`,
the model drafter's schemas and the draft vocabulary they mirrored (`BEAT_*`, `SOON_*`,
`VENUES_ON_MAP`, `SPORT_SUB_IDS`, `STYLES`, `STYLE_POLICIES`, `SUGGESTED_SKILLS`) were removed with
`/studio/new`.

`studioAgentSchema` is the studio's agent DTO: the runtime `agentResponseSchema` plus optional
`productId`/`name`/`handle`, `wallet` (`{ walletId, address, balanceAusd }` or null for an agent
without a linked wallet) and two decided locks, `canSchedule` and `canCreateAnother`
(`lockSchema`: `ok` and a `reason` from `LOCK_REASONS`, null when open). The screen shows the
reason; it never re-derives the rule. `LOCK_REASONS` mirrors core's `features/studio/locks.ts`.
`canCreateAnother` closes with `unfunded_agent` or, at three private drafts, `draft_limit`.
The DTO also carries `spend` (the config's limits or null) and `spendEnforced` (false today).
`spendLimitsSchema` is `agentConfigSchema.spend`, bounded like core's `SPEND_BOUNDS`, and requires
that a day's limit is not below one call's. `limitsUpdateSchema` is the strict body of
`PUT /v1/studio/agents/:id/limits`: `perCallAusd` and `perDayAusd`, with no version, because saving
limits keeps the configuration version.

Setup and versions (docs/specs/studio-live-v1.md L10–L13): `src/research.ts` has `RISK_BOUNDS`, a
mirror of core's pinned by `workers/api/test/accent-venue-mirror.test.ts`, and `riskLimitsSchema`
and `entrySettingSchema`, which are `agentConfigSchema.risk` and `.entry` (both optional in the
strict config). `setupUpdateSchema` is the strict body of `PUT /v1/studio/agents/:id/setup`:
`expectedVersion` plus optional brief, sources, caps (with optional `maxOpenPositions` and
`dayLossStopAusd`), voice and `entry`; it checks shapes only and core's `reviseSetup` judges the
values. `versionsResponseSchema` answers `GET /v1/studio/agents/:id/versions`:
`{ versions: [{ version, summary (1–200 characters), at (ISO) }] }`.

## Local trading integration

The opt-in Polymarket pilot remains disabled by default. Read `../../apps/agent-service/LIVE-TRADING.md` for limits and acceptance gaps. No model tool or deployed signer is enabled by this change.

## Markets

`src/markets.ts` carries `PerpMarketDto`, `AgentSquareDto` and `MarketDetailDto`, plus the options a
client needs to draw the surface before it can ask anyone: `HORIZON_OPTIONS`, `LEVEL_OPTIONS`,
`READ_HORIZON_DTO` and `LEVERAGE_OPTIONS`. These mirror the business rules in
core the way `CATEGORY_OPTIONS` mirrors `CATEGORIES`; core stays authoritative for anything sent.
What the venue charges and demands is not an option of ours: each `PerpMarketDto` carries it in
`limits` (`MarketLimitsDto`), beside `source` (`MarketSourceDto`: `sample`, or `perpl` with its
network, the time it was read and `stale`). `agentsReading`, `openCalls` and `hourlyReach` are
`number | null`: null is "nobody has measured", never zero. `PERP_LIMITS_DTO` was removed on
2026-10-01 (`docs/specs/perps-board-live-v1.md`).

Wire units: prices in the market's quote currency, amounts in AUSD, `change24h` and `funding1h` as
signed fractions, and `hourlyReach` in per cent because a square's level is. `readQuestion` carries
the read's sentence with `{level}` where the chosen price goes, so a page fills in a number and
never rewrites the wording.

`SPORTSBOOKS` in `research.ts` mirrors core's list, labels included, for the web. `sourcesSchema`
accepts only its keys. `workers/api/test/accent-venue-mirror.test.ts` pins the mirror.

## Cloudflare trading pilot

Trading account DTOs include operator enablement; order previews optionally include outcome labels for historical compatibility. Public responses never contain lease tokens, signed payloads or secrets. See ../../docs/polymarket-worker-pilot.md.

## Paper resolution

Paper DTOs now include optional nullable settlement evidence, buy-time resolution identity and minimumShares. `paperSummarySchema` reports virtual costs, payouts, realized P&L and net cash flow; it is not a wallet balance. Existing orders without settlement remain readable. Scoped paper market snapshots include their classification.

## Perpl public data plugin

`src/perps.ts` exports independent Perpl data/config schemas with decimal strings, explicit network/provenance, candle gaps and bounded book depth. Do not reuse 0..1 prediction prices or the demo market DTOs. Research config accepts optional Perpl settings and four explicitly enabled tools; historical defaults remain unchanged.

## Perpetual paper accounts

`src/perps-paper.ts` exports virtual account, intent, position, ledger, status and risk DTOs. Monetary values are decimal strings; unknown valuation stays null. Lease owner tokens are deliberately excluded. Agent config accepts opt-in `perpsPaper` and the `perps-paper` plugin.

Perpl DTOs include explicit funding history bounds, event provenance, estimates and completeness. Paper account DTOs retain optional valuation timestamps and sticky funding disputes for compatibility with the account milestone.

`perps-study.ts` exports the strict portable local study configuration DTO with explicit identity,
fixed USD 5 ceiling, model IDs and reviewed pricing sources. It contains no credentials. The paper
account DTO accepts optional permanent admission closure without rewriting historical accounts.

## HTTP documentation contracts

`http.ts` defines the existing response envelopes and identity, custody and workspace-agent wire
schemas. `public-schemas.ts` defines schemas for public marketplace, growth and launch DTOs;
marketplace schemas are checked against their existing TypeScript DTOs. These are documentation
and consumer contracts, not automatic replacements for producer validation. Hono metadata remains
in the API Worker. Never add Hono or OpenAPI dependencies here. See
[API contract](../../docs/api-contract.md); changes to a wire response must update its schema and
representative contract tests in the same change.

## Consumer advice DTOs

`src/advice.ts` exports strict portable BTC/ETH requests, capabilities, asynchronous job states,
24-hour directional results and cursor history. No requester identity, internal scope, private
configuration, prices/rates, prompts or provider traces may cross these DTOs. Wallet sign-in
`kind` is `eoa | mera`. See [Agent advice](../../docs/agent-advice.md).

## Perpl paper runtime

`src/perps-runtime.ts` holds the studio runtime's DTOs (docs/specs/perpl-paper-runtime-v1.md §4):
`perpsCheckStartedSchema` (`{ checkId }`), `perpsActionStartedSchema` (`{ actionId }`, the 202 of
an approve, close or stop: a durable owner action the research worker carries out) and
`perpsActionSchema` (`GET /perps/actions/:id`: kind, status `pending` | `running` | `done` |
`failed`, attempts, last error, the latest `owner` check), `perpsCheckSummarySchema` / `perpsCheckDetailSchema` (the detail adds
timed steps) and `perpsChecksResponseSchema`, `perpsPositionsResponseSchema` (open with mark,
unrealized P&L, exits and `liquidationEstimate`; closed with `realizedPnl`),
`perpsProposalSchema` / `perpsProposalsResponseSchema`, `perpsProposalDecidedSchema` and
`perpsRecordSchema` (R13 stats, equity series, `today`, `runtimeEnabled`). Prices and stored paper
amounts are decimal strings; the record's computed figures are AUSD numbers; times are ISO.
`PERPS_CHECK_OUTCOMES`, `PERPS_CHECK_TRIGGERS`, `PERPS_CLOSE_REASONS`, `PERPS_OWNER_ACTION_KINDS`
and `PERPS_OWNER_ACTION_STATUSES` mirror trading's lists
(pinned by `workers/api/test/studio-perps-route.test.ts`); `PERPS_MANUAL_CHECKS_PER_DAY` is 6.

Studio setup and stored configuration accept `perpsStrategy` with an explicit identifier and version 2.0.0. Setup permits an empty entry section for rules; core still rejects missing AI entry conditions and unverified free-text rules conditions. No model or financial policy belongs in these portable DTOs.

## Studio strategy version 2

Studio setup selects a versioned common strategy; absent selection resolves combined@2.0.0.
New check results expose `strategyResult` with per-market proposals, three-state brief findings,
execution outcomes, funding status and incompleteness. Historical fields retain their recorded
values and are null/empty for new results rather than fabricated percentages. Model costs remain
USD micros, separately from virtual financial metrics; unknown daily costs stay null. The API
retains workspace authorization and generated OpenAPI. The web displays the strategy in both
agent studios and explicitly confirms clearing unsupported authored conditions for rules.
See [Studio perpetual execution](../../docs/studio-perps-execution.md).

## AI credit DTOs

`src/ai-credits.ts` exports strict portable balance, purchase, ledger history and agent/model allocation schemas. Exact amounts are decimal strings in micro-credit units; one credit is 1,000,000 units. Never expose internal provider costs, proof data or payer identity. No HTTP route is introduced by these DTOs. See [AI credits](../../docs/ai-credits.md).

# API schema package instructions

Read [the root instructions](../../AGENTS.md) first and the local instructions of affected producers or consumers. Keep this file updated when public contracts change.

`@pickler/api-schema` owns transport contracts shared by API producers and clients. Exports include `HealthResponse`, the market contracts in `src/markets.ts` and the Zod research schemas in `src/research.ts`: configuration/limits, updates, dispatch, pause, scheduling, agent/run/event responses and decisions. Public runtime imports use compiled `dist`; types resolve to source.

- Keep this package portable and safe for browser imports. No Next.js, React, core, infrastructure, secrets, or provider SDK dependencies.
- Define explicit public request and response DTOs. Do not expose database rows, domain entities, `Date`, `bigint`, or credential-bearing fields directly.
- TypeScript types do not validate runtime input. When schemas are introduced, choose browser-compatible validation and apply it at untrusted boundaries. Apply the exported Zod schemas to requests, responses and structured decisions; health remains a TypeScript-only interface.
- Keep business invariants and authorization in core. HTTP parsing and error/status mapping belong in the app.
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

`createAgentSchema` also requires `profile` (`agentProfileInputSchema`): accent, blurb, venue, the
four prose lines and an optional `@` X handle, all stored with the agent in one transaction. `ACCENTS`
(`src/landing.ts`) and `VENUES` (`src/agents.ts`) are the lists their DTO unions derive from, the way
`CATEGORY_OPTIONS` does; a workers/api test pins them to core's lists.

`createAgentSchema` also requires `wallet` (`agentWalletLinkSchema`): the `walletId` of the agent
wallet whose policies the person already approved with their passkey. An agent is created only
with a wallet; the field is not optional. The schema is `.strict()` and carries only `walletId` —
a request that also sends `policyIds` is refused (400) rather than having that field silently
ignored: the policy ids a wallet links are read server-side, from what core's `confirmPolicies`
already recorded, never from the client. The infrastructure layer links it inside the same
transaction that creates the agent, so a wallet not owned by the creator, one whose rules were
never approved, or one already linked to another agent, rejects the whole creation.

Drafting from one line: `draftRequestSchema` (`line`, 3–280 characters), `agentDraftSchema` (the
strict shape a model must answer with, also the validator the API injects into the drafter; every
subcategory must be one of `BEAT_SUBS[beat]` and a draft proposes at most 6 sites, though a config
still allows 20) and
`draftResponseSchema` (`draft` plus `unsupported` reasons). `VENUES_ON_MAP`, `SOON_VENUES`,
`BEAT_NAMES`, `SOON_BEATS` and `BEAT_SUBS` mirror core's `features/studio/draft.ts` and are pinned
by the same workers/api test.

`SPORT_SUB_IDS` (the runtime sport id behind each Sports subcategory label — `marketScope`'s
`subcategories` takes ids, never the labels a beat is drawn with), `STYLE_POLICIES` (the
`uncertaintyPolicy` numbers behind each `StyleDto`, mirroring core's `policyForStyle`) and
`SUGGESTED_SKILLS` (the skills a draft or the creation form's skills step may offer, by beat, with
`other` serving every beat without its own list) mirror the same core module and are pinned by the
same workers/api test. The web's own creation flow (`apps/web/src/features/studio/create/draft.ts`)
keeps a further literal copy of all five — `apps/web` is CommonJS to node's module resolver and
this package publishes only an `"import"` condition, so a module there that reads these values at
load time cannot be required by a test; only types cross that boundary statically. That file's test
still pins its copies against this package's by reaching it with a dynamic `import()`, which
resolves through node's ESM loader regardless of the importer's own module type.

`studioAgentSchema` is the studio's agent DTO: the runtime `agentResponseSchema` plus optional
`productId`/`name`/`handle`, `wallet` (`{ walletId, address, balanceAusd }` or null for an agent
without a linked wallet) and two decided locks, `canSchedule` and `canCreateAnother`
(`lockSchema`: `ok` and a `reason` from `LOCK_REASONS`, null when open). The screen shows the
reason; it never re-derives the rule. `LOCK_REASONS` mirrors core's `features/studio/locks.ts`.
The DTO also carries `spend` (the config's limits or null) and `spendEnforced` (false today).
`spendLimitsSchema` is `agentConfigSchema.spend`, bounded like core's `SPEND_BOUNDS`, and requires
that a day's limit is not below one call's. `limitsUpdateSchema` is the strict body of
`PUT /v1/studio/agents/:id/limits`: `perCallAusd` and `perDayAusd`, with no version, because saving
limits keeps the configuration version.

## Local trading integration

The opt-in Polymarket pilot remains disabled by default. Read `../../apps/agent-service/LIVE-TRADING.md` for limits and acceptance gaps. No model tool or deployed signer is enabled by this change.

## Markets

`src/markets.ts` carries `PerpMarketDto`, `AgentSquareDto` and `MarketDetailDto`, plus the options a
client needs to draw the surface before it can ask anyone: `HORIZON_OPTIONS`, `LEVEL_OPTIONS`,
`READ_HORIZON_DTO`, `LEVERAGE_OPTIONS` and `PERP_LIMITS_DTO`. These mirror the business rules in
core the way `CATEGORY_OPTIONS` mirrors `CATEGORIES`; core stays authoritative for anything sent.

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

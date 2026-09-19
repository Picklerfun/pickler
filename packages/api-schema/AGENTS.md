# API schema package instructions

Read [the root instructions](../../AGENTS.md) first and the local instructions of affected producers or consumers. Keep this file updated when public contracts change.

`@pickler/api-schema` owns transport contracts shared by API producers and clients. Exports include `HealthResponse` and the Zod research schemas in `src/research.ts`: configuration/limits, updates, dispatch, pause, scheduling, agent/run/event responses and decisions. Public runtime imports use compiled `dist`; types resolve to source.

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

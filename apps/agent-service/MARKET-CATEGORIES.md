# Market categories and research protocols

Pickler catalog version 1 has exactly two levels: `sports` and `soccer`,
`american-football`, `basketball`, or `tennis`. An agent can select one or several
sports. `"all"` expands to these four identifiers in version 1; extending the
catalog requires a new explicit configuration version. No provider is enabled by
selecting a sport.

```json
{
  "marketScope": {
    "version": 1,
    "category": "sports",
    "subcategories": ["soccer", "american-football"]
  }
}
```

This is a configuration fragment, not a full update body. Fetch the existing agent
and preserve its profile, plugins, tools, limits and interval. Remove legacy
`categoryIds`, `researchProtocol` and `discoveryPolicy`, then send the full config
with `expectedVersion` to `PUT /agents/:id/config`. Mixing formats, empty or
duplicate lists, unknown IDs and unsupported versions are rejected. Historical
configs retain their old permissions and protocols. Historical snapshots are never
rewritten. Updates invalidate pending/active work through existing version guards
and disable scheduling.

## Operator workflow

From the repository root, with the local environment already configured:

```sh
npm run dev:agent
npm run agent -- market-categories alpha
npm run agent -- agents alpha
npm run agent -- configure alpha /absolute/path/config-update.json
npm run agent -- run alpha
npm run agent -- run beta 608546
npm run agent -- result beta RUN_ID
npm run agent -- events beta RUN_ID
```

The sample market ID is historical validation input, not a promise of future
availability. Requests return `202` and `runId`; poll until terminal. No trades are
sent. Studio's `lab-presets` exposes `marketCategories`; use its configuration
workflow with the same full versioned update document. The authenticated
`GET /market-categories` is the local Pickler catalog and makes no provider call.
`GET /categories` remains the provider catalog for old clients.

The explicit lab migration is:

```sh
npm run configure:categories --workspace=@pickler/agent-service
```

It updates alpha to American football and beta to soccer, preserving plugins,
limits and history and disabling schedules. It uses the normal configuration
transaction and requires no schema migration: selections and v4 decisions use
existing JSONB. Stop old executors before changing the lab configuration, rebuild
shared packages and restart. Test migrations in isolated databases first.
`configure:nfl` remains an explicit legacy NFL configuration command; it removes
`marketScope` rather than producing a mixed document.

## Classification and timing

`core/features/research/market-scope.ts` owns catalog permissions, protocol
selection and timing. Infrastructure's `polymarket/classification.ts` owns the
reviewed provider tag mapping. Classification uses actual returned market tags,
never the request filter or model output. Ambiguous sport mappings are excluded.
The ambiguous `football` tag 10 is not an American football permission.

Discovery shares five pages of twenty across selected sports, interleaving primary
tags before aliases; this is a bounded scan, not an exhaustive inventory. Core
filters, ranks by liquidity and presents at most twenty candidates. Exclusions and
scan exhaustion are recorded. Unclassified markets fail manual validation too.

Match classification uses the Games tag or reviewed sports market types. Matches
need verified `gameStartTime` at least fifteen minutes ahead and no more than seven
days away. Awards use the Awards tag. Seasons use reviewed future/championship
metadata or the anchored championship-title mapping in the adapter. Conflicting or
unrecognized timing classes are excluded. Awards and seasons require an open
market, future closing time and nonempty resolution rules, without a kickoff or
seven-day limit. This allows a correctly tagged Ballon d'Or market under Soccer.

All scope and temporal checks run again on a proposed trade's final refresh. Each
run records the catalog, classification with mapping provenance, chosen protocol,
effective timing rule, configuration, plugins and exact prompt snapshots.

## Protocols, providers and decisions

Only verified NFL full-game winners use `nfl-winner-v1` (nine report sections).
Other eligible markets use `general-market-v1` with identity, timing, rules,
context, supporting evidence, contradicting evidence, quotes and limitations.
Users select no extra protocol level. Both retain tool research followed by a
separate structured final call, current budgets, source attribution and leases.

BALLDONTLIE and The Odds API currently declare NFL protocol coverage. Outside that
coverage they are `not_applicable`: no tools, calls, cache access or credential
requirements. Historical evidence stays available. Within coverage the existing
plugin/tool permissions and explicit configuration/provider failures still apply.
Polymarket and web search remain required capabilities.

New scoped configurations persist decision v4 with `protocol`, separate forecast,
protocol-specific coverage, the model proposal and core's final policy evaluation.
Top-level action fields stay compatible; v1/v2/v3 remain readable. Forecasting an
outcome does not require buying it: insufficient evidence or price edge can
legitimately produce ABSTAIN. Provider/schema errors remain failures.

Manual paper trading still supports only NFL winner proposals. A general v4 TRADE
is rejected with `PAPER_UNSUPPORTED_PROTOCOL`; selecting another sport never grants
simulation coverage or enables the paper plugin.

## Validation

Controlled tests cover both protocols, migration in isolated PostgreSQL/Supabase,
classification, timing boundaries, shared pagination, unsupported manual markets,
empty discovery, final refresh scope rejection, general TRADE and ABSTAIN,
nonapplicable NFL tools with missing credentials, and existing lease, isolation,
revocation, cache and historical behavior. Live results are recorded below after
the bounded two-investigation acceptance run.

### Live acceptance: September 17, 2026

Exactly two new paid investigations ran using the unchanged operator model
`deepseek-v4.1-flash` and Exa. Both completed, persisted v4 decisions and eleven
cited source IDs each, with no model-output failure or automatic retry:

| Tenant / run                                   | Market                              | Protocol          | Duration  | Model proposal → final |
| ---------------------------------------------- | ----------------------------------- | ----------------- | --------- | ---------------------- |
| alpha / `399a9b31-16bd-4f31-9f94-a6ea70541340` | `4424938`, Lions vs. Bills O/U 55.5 | general-market-v1 | 139.750 s | ABSTAIN → ABSTAIN      |
| beta / `1f428ef7-46c3-469e-bd5c-8ce632845e07`  | `608546`, Vinicius Jr. Ballon d'Or  | general-market-v1 | 163.517 s | TRADE → ABSTAIN        |

Automatic discovery chose an NFL **total**, not an NFL winner. General routing is
therefore correct; the unchanged winner protocol was verified with controlled v4
fixtures, not another paid run. Alpha retained Over probability 0.475
(range 0.44–0.52), abstaining because its price edge was too small. Beta retained
Yes probability 0.005 (range 0.002–0.012); core rejected the proposed trade with
`HIGH_UNCERTAINTY`, `MISSING_INFORMATION` and `INSUFFICIENT_CONSERVATIVE_MARGIN`.
These are recorded model judgments, not independently calibrated probabilities.

The award's actual tags were Sports (1), Awards (18), Soccer (100350). Its recorded
timing policy required an open market and future close, without kickoff. Both
runs recorded optional NFL providers as `not_applicable`. No new sports provider
was configured or invoked. Cross-tenant run and evidence reads returned 404 in
both directions. The Node executor processed these runs sequentially; this is not
a new concurrency benchmark.

Reported model usage (research plus structured final, counted once):

| Run   |   Input | Output |   Total | Reasoning, included in output |
| ----- | ------: | -----: | ------: | ----------------------------: |
| alpha | 116,382 | 17,914 | 134,296 |                        12,206 |
| beta  | 114,519 | 22,395 | 136,914 |                        15,877 |

Alpha also used 1,668 input / 207 output tokens for selection (1,875 total).
Provider usage is not a guaranteed monetary cost. Both used three searches.
Evidence, original proposals, final policy verdicts and prompt/classification
snapshots remain in local Supabase; `result` and `events` expose tenant-scoped reads.
No paper order, real trade, remote deployment or extra paid investigation ran.

Final checks: all 128 automated tests passed against PostgreSQL and again against
Supabase, using isolated databases. Formatting, lint, type checks, all workspace
builds and both Cloudflare dry-run bundles passed. No DDL was added. The first
workspace build correctly refused to overwrite a running Studio; it passed after
stopping the idle server.

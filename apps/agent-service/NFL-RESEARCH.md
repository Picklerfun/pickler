# Configurable NFL research

The `nfl-winner-v1` protocol covers NFL full-game moneyline markets only. It retains the two-phase Mastra flow and existing execution leases. Research and final decision share twelve model steps, the existing token cap and a five-minute deadline. It does not imply forecasting profitability.

## Plugins and configuration

Reviewed plugins are `polymarket`, `exa`, `balldontlie`, `the-odds-api` and `paper-trading` (see [manual simulation](PAPER-TRADING.md)). Core owns permissions and capability ports; infrastructure owns provider calls and storage; the service binds them and exposes validated tools. No external code installation occurs.

Configuration adds `plugins: { version: 1, enabled: [...] }` and optional `researchProtocol: "nfl-winner-v1"`. A tool requires both its individual permission and its owning plugin. Historic configurations infer only Exa/Polymarket permissions from existing tools. Sports providers never become enabled implicitly. Versioned updates materialize the plugin configuration without rewriting run snapshots.

Polymarket and web search are required. The sports providers are optional; disabled, missing credentials, absent coverage, stale data and technical failure are distinct conditions. An invoked provider failure remains a failed investigation. A configuration change blocks new calls, cache reads and result writes; previously stored evidence remains available. Requests already sent may incur usage.

Explicit operator migration, from the repository root after shared builds and database migration:

```sh
npm run configure:nfl --workspace=@pickler/agent-service
# Explicitly enable both optional sports sources only after configuring their keys:
npm run configure:nfl --workspace=@pickler/agent-service -- --sports
```

This updates both lab agents through the normal versioned configuration path and disables scheduling. It preserves their categories and existing tool permissions; select an NFL-compatible category before discovery. NFL configuration requires `pre-event` discovery. The API configuration endpoint also supports individual toggles.

Optional environment variables: `BALLDONTLIE_API_KEY`, `THE_ODDS_API_KEY`. Neither startup nor activation makes provider calls. Explicit per-agent checks: `POST /agents/:id/plugins/:plugin/check` with the tenant token (under `/pilot` in Studio). Existing model connection checks remain explicit operator actions.

## Evidence and limitations

BALLDONTLIE free access supplies teams and games, not injuries, rosters or advanced statistics. Matching requires both teams and a unique scheduled event within fifteen minutes of Polymarket's start. No ambiguous event is accepted as verified. The bounded lookback provides recent final games where available.

The Odds API supplies NFL `h2h`, US bookmakers and decimal prices. Reference odds retain their original update times and bookmaker attribution; they are not model probabilities. Ties, overtime, cancellations and bookmaker margins may prevent comparison. Distinct bookmakers or websites are not automatically independent evidence.

Public provider data is cached in private PostgreSQL tables: teams 24 hours, game context five minutes, odds two minutes. Cache reads require current permissions. Retrieval time never resets when served from cache. Shared key quotas are coordinated transactionally: five BALLDONTLIE requests/minute and a conservative 500 Odds API requests/month. Calls made outside Pickler are not included; provider errors still take precedence. Exhaustion fails explicitly without retries. Each research allows at most six BALLDONTLIE and two odds HTTP requests, including pagination.

Decision v3 retains legacy top-level fields and adds a separate forecast and section-by-section coverage. Abstention can preserve an estimate; inability to estimate is explicit. Core verifies citations, probability order and agreement between a trade and its forecast. This validates attribution and consistency, not the truth of every model statement. Decisions v1/v2 remain readable. Decisions and provider evidence use existing run/event JSONB; public cache/quota tables require migration 0003.

## Evaluation

```sh
npm run build:shared
npm run evaluate:nfl --workspace=@pickler/agent-service -- --all-six
```

This is an explicit paid model evaluation using six synthetic frozen-evidence scenarios, without Exa or sports API calls. It is excluded from CI. Results and usage are stored in ignored `.data/nfl-evaluation-v1`. An attempted case is not repeated automatically; a model error stops evaluation and leaves reliability acceptance pending. Fixtures are never production fallbacks.

Live acceptance is limited to two complete investigations. Missing sports credentials block full provider acceptance. A justified abstention is valid; a fabricated result or an output failure is not. Record real results separately from fixtures.

Run format, lint, types, PostgreSQL/Supabase tests and Node/Cloudflare builds. Apply migrations to isolated databases first. Stop old executors before upgrading existing databases, then migrate and restart. Never expose `pickler` through Supabase's Data API.

Deferred work: #11 resolution/settlement, #12 calibration, #13 automatic portfolio lifecycle, #14 verified injury/advanced data, #15 additional protocols, #16 tenant credentials/UI. Shared observability remains #5.

## Citation contract

Retrieved `sources` and execution `references` are separate. Core creates context references for the selected market, each observed quote, and plugin availability. These data were already supplied to the model but previously lacked consistent citable identifiers. References are accepted only for their declared report sections: market identity/schedule/rules, quotes, or limitations. They cannot establish injuries or sporting advantages. Top-level `sourceIds` still require retrieved evidence. Core persists `research_references` alongside the assessment; original market and quote events remain available. No historical decisions are rewritten.

The NFL final prompt is version 1.2.0; research is version 3.2.0. Both distinguish concrete missing material facts from ordinary outcome/execution risk and mere optional-plugin absence. This clarifies the existing policy inputs without changing its thresholds. Both phases receive references with the original evidence; the summary is never a replacement for it. Unknown IDs, empty supported citations, and context references in sporting-evidence sections still fail validation.

## Explicit diagnostic attempts

The default six-case command preserves the original ledger and refuses to overwrite attempted cases. A new explicitly authorized attempt requires a unique label; this is never an automatic production retry:

```sh
npm run evaluate:nfl --workspace=@pickler/agent-service -- --all-six --attempt citation-fix --case clear-edge
```

Omit `--case` to evaluate all six. Failed evaluations preserve the rejected assessment, safe step diagnostics and reported usage in ignored local files. Expected-action mismatches return a nonzero exit status even when the output is structurally valid. A valid schema does not imply that the decision matches the expected scenario: inspect `matches` and the policy verdict separately.

See [live validation](NFL-LIVE-VALIDATION.md) for the reproduced failure and real-run results, and [sports source assessment](NFL-SOURCES.md) for provider tradeoffs.

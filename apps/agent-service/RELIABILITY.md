# Research reliability

The model remains operator-selected through `MODEL_BASE_URL`, `MODEL_ID` and `MODEL_API_KEY`. No credentials, model defaults, provider fallback, order execution or additional database migration are introduced.

## Research and decision

Automatic selection consumes one model step. Research then uses tools and produces a plain-text summary. A final tool-free call to the same model produces `modelAssessmentSchema`, using the selected market, resolution rules, all original retrieved sources, observed quotes and an explicitly untrusted summary. Core still checks citations, supporting and contradicting searches, final quotes and decision policy. Decision v2 and `202 + runId` polling remain unchanged.

The configured twelve-step ceiling includes selection and reserves one step for finalization. All phases share the original five-minute signal. The per-call output cap remains 32,768 tokens; selection remains capped at 2,000. Three searches and five page reads remain maximums. Ownership and current configuration are checked before model calls and tools, and all event/result writes remain lease-fenced. Losing ownership never authorizes a final write.

Empty, malformed or schema-invalid output is failed research. There is no fallback abstention, JSON repair, provider switch or automatic paid retry. The adapter validates original JSON text as well as Mastra's resulting object. Invalid/missing tool results stop subsequent calls. Provider failures are not evidence for abstention.

## Discovery policy

Existing configs without `discoveryPolicy` retain open-market behavior. Explicitly update a Sports agent through the existing versioned configuration API with:

```json
{
  "discoveryPolicy": {
    "version": 1,
    "mode": "pre-event",
    "minLeadMinutes": 15,
    "maxHorizonDays": 7
  }
}
```

This is a field of the complete agent configuration, not a standalone PATCH body. Updating configuration disables scheduling as before. No history is rewritten.

Pre-event mode requires a valid future `gameStartTime` with explicit timezone and provider provenance. It rejects started/too-close games, starts beyond the horizon, unknown timing and season/futures market types. Market closing/opening timestamps are never substitutes for game start. The same policy applies to manual markets and the final trade refresh. Time boundaries are inclusive at fifteen minutes and seven days; moving within the lead window during research blocks a trade proposal.

Discovery shares at most five pages of twenty markets across configured categories, round-robin. Core records exclusions, ranks eligible candidates by liquidity and supplies at most twenty to selection. The scan event reports budget exhaustion and unvisited categories. `NO_ELIGIBLE_MARKETS` finishes without calling the model or manufacturing an abstention; it does not claim no eligible market exists beyond the scan budget.

Exact normalized public HTTP(S) links from resolution metadata/rules can be read without a preceding search, alongside search-discovered URLs. They do not authorize the whole domain. Local/private literal addresses, local hostnames, credentials and nonstandard ports are rejected. Rule-link provenance does not certify official status. Search and read events preserve content, dates, requested URLs and truncation. Missing publication dates, truncation and publications older than seven days are recorded as evidence limitations rather than provider failures or automatic conclusions.

## Diagnostics and usage

`model_diagnostic` JSONB events record phase, step, duration, finish reason, numeric reported usage, text presence/length, structured-object presence, and reviewed tool names/status. Step events are emitted before aggregate validation. `model_failure` records classified codes and allowlisted schema issue paths, without raw values, messages, reasoning, headers or credentials.

Relevant codes include `MODEL_EMPTY_RESPONSE`, `MODEL_NO_STRUCTURED_OUTPUT`, `MODEL_INVALID_JSON`, `MODEL_INVALID_SCHEMA`, `MODEL_OUTPUT_TRUNCATED`, `MODEL_INVALID_TOOL`, `MODEL_HTTP_<status>`, `MODEL_TIMEOUT` and `MODEL_CANCELLED`. Root schema errors without underlying text cannot retrospectively prove why output was missing.

`model_step_usage` is per-step consumption; `model_usage` is its research-plus-decision aggregate. Selection usage is in `selection`. Diagnostics repeat usage for troubleshooting: do not add their counters to usage events or sum both steps and aggregate. Reasoning tokens are a subset of output when reported, not additional tokens. Failed calls retain available step usage, but missing provider usage is unknown, never zero-cost.

From the repository root, build shared packages first:

```sh
npm run build:shared
cd apps/agent-service
npm run diagnose -- combined
npm run diagnose -- split
```

Each invocation makes paid model calls with a controlled local tool and persists a metadata-only report under ignored `.data/model-diagnostic-*.json`. It does not call Exa, investigate a real market, change readiness or schedule jobs. Combined mode exercises tools and structured output in one agent loop; split mode uses a separate finalizer. Both use the same provider/model, 32,768 token cap, five-minute deadline and no retries. These synthetic prompts are not a replay of historical research. The acceptance budget is a maximum of three such invocations and two real investigations, explicitly launched without automatic repeats.

## Validation record

Local acceptance on 2026-09-17 used the configured `deepseek-v4.1-flash`, two diagnostic invocations and two complete investigations. No third diagnostic, retry, remote deployment or trading call was made.

| Diagnostic                   | Result                           | Reported input tokens | Reported output tokens |
| ---------------------------- | -------------------------------- | --------------------: | ---------------------: |
| Combined tools + structure   | Passed; one controlled tool call |                 2,810 |                    479 |
| Separate research + decision | Passed; one controlled tool call |                 1,928 |                    488 |

Both synthetic paths succeeded, so the historical incident was **not reproduced**. Its retained evidence shows missing structured output, not a demonstrated provider fault or token-limit exhaustion. Offline fixtures reproduce and distinguish absent output, malformed JSON, schema errors, truncation and tool failures. Mastra can surface non-JSON text as schema validation failure and a failed tool as a missing tool result; the adapter now preserves the more specific observed diagnostic and stops new calls.

| Tenant / run                                   | Duration | Result  | Cited sources | Input / output / total tokens |
| ---------------------------------------------- | -------: | ------- | ------------: | ----------------------------: |
| alpha / `5446eda6-b425-4bc1-ad22-48ed54a5fec1` | 96.782 s | ABSTAIN |             8 |       72,322 / 7,234 / 79,556 |
| beta / `e002a31b-a806-43ed-b801-41cd07737af6`  | 92.998 s | ABSTAIN |             8 |       68,467 / 7,414 / 75,881 |

Token totals above include selection once and research/finalization once. Reported reasoning tokens (4,173 and 4,889) are already included in output totals. Exa reported $0.021 for three searches in each run; this is not an overall monetary cost estimate.

Both agents independently selected market `3398287` (Lions–Bills) from twenty eligible candidates. Its verified `gameStartTime` was `2026-09-18T00:15:00Z`, after both runs at approximately 12:11–12:16 UTC on September 17. Each discovery scanned 100 markets and reported exhaustion of its five-page budget. Both original model assessments abstained because available prices were consistent with the researched consensus and did not establish a sufficient advantage. Core preserved those assessments (`MODEL_ABSTAINED`); neither abstention was fabricated after an error. No structured-output or provider failure occurred. Both persisted final-decision diagnostics show a structured object.

These runs validate the research pipeline on one shared sporting event, not profitability, calibration, breadth across sports or guaranteed future model reliability. Eight cited sources are not eight independently verified facts. Exact resolution-link authorization was exercised with controlled tests; these two live runs used search results without invoking page reads.

Evidence, snapshots, diagnostics and decisions remain in tenant-scoped JSONB in the isolated local queue experiment database. Both of its lab configs were explicitly updated to pre-event, with schedules disabled. Other databases/configs and historical records were not rewritten.

The complete Supabase suite passed 85 tests, covering malformed/empty output after successful tools, deadline and lease loss between phases, diagnostics privacy, temporal/manual/final-refresh boundaries, pagination, exact resolution links and existing tenant/configuration behavior.

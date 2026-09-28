<!-- historical-evidence -->

> Historical validation record: refers to the implementation and runs described below,
> before the trading-package extraction (integration baseline `8f37f1f`). Not current
> operating instructions. See [Evaluation operations](EVALUATIONS.md).

# BTC quantitative pilot validation

## Implementation and controlled checks

PR: https://github.com/Picklerfun/pickler/pull/52. No merge or pilot runtime deployment was performed. The existing Cloudflare PR build completed; the quantitative study runs locally only.

The live runner uses commit `048a858f42d690f672cec694e4b35fb6b29c0bad`. Subsequent commits add controlled tests and report fields only; the running forecast, admission policy, provider routing and thresholds remain unchanged.

CI at commit `28b0c35b77e80200d604f5966dd5311057906819` passed format, lint, type checking across 11 workspaces, 425 tests (zero failures, one existing skipped test), workspace builds and Worker builds. The local Node/Mastra and research Worker builds also passed. Controlled fixtures exercise both Up and Down full-budget virtual purchases, fees and depth, duplicate admission, stale data, budget exhaustion, review veto/doubt, invalid review diagnostics and permission revocation. Report tests verify that saved-book explanations do not create fills or change decisions, and compare Brier scores using matched quote coverage. These fixtures are not live-provider or profitability evidence.

## Seven-day chronological proxy evaluation

The saved Coinbase candle dataset covers September 20–26, 2026 UTC, with additional warmup candles. September 20–24 is development; September 25–26 is evaluation. Parameters were fixed before inspecting the evaluation results and were not tuned afterward.

| Horizon    | Development cases | Development Brier | Evaluation cases | Evaluation Brier | 50% baseline |
| ---------- | ----------------: | ----------------: | ---------------: | ---------------: | -----------: |
| 5 minutes  |             1,440 |          0.221423 |              576 |         0.220274 |         0.25 |
| 15 minutes |               480 |          0.240411 |              192 |         0.237953 |         0.25 |

These 2,688 observations use Coinbase closes as substitutes for the opening reference and terminal TWAP outcome. They are not official Polymarket outcomes, executable prices or a profitability backtest. Inputs precede each prediction; future closes are used only as labels. Five- and fifteen-minute windows overlap and are not independent samples.

## Prospective study

Study ID: `btc-quant-20260927-222623`.

The admission interval begins at September 27, 2026 22:30:03.100 UTC and ends at September 28, 2026 00:30:03.100 UTC. The run permits up to 24 five-minute and eight fifteen-minute markets. Every admitted market receives at most one attempt. Jev is called only after a quantitative proposal passes the unchanged conservative edge policy.

Historical reservations total $1.009377536 against the original $5 authorization. New reservations are limited to $0.10; historical unknown charges are not released or reset. No Exa, DeepSeek, wallet, signing or real-order operations are used.

**Status: admissions closed; all 21 valid forecasts have finalized official binary outcomes.** No new study or missed-window recovery was started.

| Horizon    | Attempts | Valid forecasts / abstentions | Data failures | Official outcomes | Virtual buys |
| ---------- | -------: | ----------------------------: | ------------: | ----------------: | -----------: |
| 5 minutes  |       21 |                            17 |             4 |                17 |            0 |
| 15 minutes |        7 |                             4 |             3 |                 4 |            0 |
| Total      |       28 |                            21 |             7 |                21 |            0 |

The host entered macOS **Clamshell Sleep at 00:13:42 UTC (02:13:42 Madrid)**, confirmed by the local `pmset` power log. This prevented four remaining admission slots: five- and fifteen-minute windows starting at 00:15 UTC, and five-minute windows starting at 00:20 and 00:25 UTC. The original deadline was not extended. The runner later exited with `ADMISSIONS_COMPLETE`, preserved its history and released its writer locks. This was a bounded two-hour window, but not two uninterrupted hours of observation.

There were five `PROVIDER_HTTP_429` failures and one `PROVIDER_HTTP_400`, all before Jev. Later status-only diagnostics returned successful responses but did not establish which endpoint caused each historical failure; no permanent-block or provider-root-cause claim is made. One `QUANT_STALE_TICKER` case was actually a timestamp 8–9 milliseconds ahead of the recorded local capture/completion clocks, rejected by the version's strict future-timestamp check. It was not an old quote. No failed case was retried or relabeled as an abstention.

No candidate met the frozen conservative edge requirement. The best saved-book conservative edge across both outcomes was **−4.2639 percentage points**, below the required **greater than +3 points**. Some central estimates appeared favorable before sensitivity: market `5004642` Down had a central edge of +5.5779 points but a conservative edge of −12.4936 points. These explanatory calculations did not change decisions or authorize hypothetical fills.

Jev calls: **0**. New input/output tokens, estimated API cost and reservations: **0**. Historical reservations remain $1.009377536. There are no virtual positions, payouts or realized trading P&L to report. No real orders were placed.

| Horizon    | Binary scored cases | Quantitative Brier | 50% baseline | Contemporaneous book midpoint Brier |
| ---------- | ------------------: | -----------------: | -----------: | ----------------------------------: |
| 5 minutes  |                  17 |           0.120393 |         0.25 |                            0.121778 |
| 15 minutes |                   4 |           0.265892 |         0.25 |                            0.264575 |

All scored cases are abstentions; each has a contemporaneous book reference and finalized Polygon evidence. No pending result, failed-input case or inferred price-based outcome enters scoring. These small, overlapping samples do not establish calibration, an executable edge or profitability.

The public-data → quantitative forecast → policy → official-resolution path was exercised live. Up/Down purchases and Jev review behavior were exercised with controlled fixtures. **Live Jev contract acceptance and a live-data virtual purchase remain unexercised**, because no proposal qualified. No extra paid diagnostic was added merely to fill that gap.

## Reproduction and evidence

Artifacts are local and ignored by Git under `apps/agent-service/.data/paper-studies/btc-quant-20260927-222623/`:

- `configuration.json`: exact configuration and reviewer metadata.
- `campaign-link.json`: historical reservation linkage and configuration fingerprint.
- `execution-commit.json`: runner commit and initial controlled checks.
- `state.json`: immutable observations, forecasts, review records, decisions and finalized resolution evidence.
- `results.csv`, `index.html`, `summary.json`: derived tracking reports.
- `history-candles.json`, `history-proxy.json`: chronological proxy inputs and results.
- `public-http-diagnostic.json`: status-only public connectivity diagnostics, separate from research attempts.
- `acceptance.json`: final counts, missing windows, sleep evidence and report-code revision.

The reporting-only quoted edge replays the saved book with a full virtual budget and the maximum valid tick. It does not authorize a purchase or modify the original decision. Actual purchase eligibility still uses the frozen conservative price limit and a fresh post-review input check. Brier comparisons with quoted probabilities use matched coverage counts. Abstentions with official binary outcomes remain in forecast scoring; missing forecasts, pending results and split payouts do not.

Use the explicit `settle` command in [the pilot guide](QUANT-PAPER.md) for public resolution reads only. It cannot create another forecast, call Jev or buy. Preserve old studies and STOP files. Never infer outcomes from closing time or spot prices.

# BTC paired-policy paper laboratory

This opt-in local protocol (`btc-policy-comparison-v1`, configuration/state version 3) compares `conservative-v1` (lower sensitivity probability) and `central-v1` (point probability) on the same inputs and forecasts. Both require more than three percentage points of net edge, reviewed identity/rules, fresh public data, liquidity, fees and a successful Jev review. The formula and sensitivity assumptions are unchanged. Ten virtual units fund each independent hypothetical purchase. This does not change hosted agents or place real orders.

## Commands and accounting

Build shared packages from the repository root, then run commands from `apps/agent-service`:

```sh
npm run paper:compare -- replay .data/paper-studies/OLD_ID/state.json
npm run paper:compare -- probe .data/comparison.json --allow-paid
npm run paper:compare -- run .data/comparison.json --allow-paid
npm run paper:compare -- settle .data/comparison.json
npm run paper:compare -- report .data/comparison.json
```

Copy `comparison-paper.example.json` to an ignored configuration with a new ID and declare every existing study in `historicalStudies`. Verify the pinned Jev tariff before use. Replay consumes only version-2 saved inputs and forecasts, ignores later evidence/outcomes, needs no credentials and prints proposal summaries without fills or executed P&L. Existing v1/v2 commands and immutable study snapshots remain available.

Probe/run require the existing app `.env` (`TYPESAFE_API_KEY` only), a clean committed checkout, the study lock and shared `quant-campaign` lock. All historical reservations, including uncertain charges and v3 probes, carry against the original USD 5 authorization. This experiment permits at most USD 0.25 new reservations, including the probe, and 65 distinct reviews total. Each reserves 65,536 input tokens at the verified configured rate; known token estimates are not billed charges. Paid errors never release reservations or trigger retries. Probe failures write STOP and prevent the run. Never delete STOP or locks to reset an authorization.

The one paid probe uses a labeled, synthetic five-minute opportunity with a controlled clock, original rule text, deterministic inputs, refreshed virtual liquidity and a controlled resolution. It must produce one shared valid non-veto review and both virtual fills/settlements. Its results remain separate from live markets and calibration metrics. No public source calls occur in the probe. The reviewer remains strict and pinned to `jev-1.13.0`; no fallback exists. A failed or unexpected-veto probe stops acceptance before the live batch.

The immutable configuration snapshot includes the commit and reviewer prompt. Changing it rejects continuation; do not edit parameters after inspecting live outcomes. New fixture or data corrections require a new reviewed experiment, not automatic resumption of paid failures.

## Prospective execution

Run freezes a two-hour deadline and persistent minute-one slots (up to 24 five-minute and eight fifteen-minute markets). Admission tolerance is 30 seconds, with at least 90 seconds remaining. Two cases may run concurrently; writes and all-or-none review reservations are serialized. Missed, failed and interrupted slots are not retried or backfilled. macOS start verifies the lid is open and holds an idle-sleep assertion until admissions end; lid closure and forced sleep can still interrupt execution. Time gaps are recorded, never added to the deadline. Other host platforms currently fail the awake check explicitly.

Each case shares one initial snapshot. Only identical market/outcome/limit/budget/input/forecast/reviewer snapshots share a review. Different limits require separate reviews reserved together before transport. Jev reviews material contradictions, not strategy preference; negative conservative sensitivity alone cannot veto a valid central proposal. After reviews, both policies share one refresh. No outcome switch or higher approved price cap is permitted. Each virtual policy uses its own counterfactual liquidity; purchases do not compete with each other.

An exhausted budget or failed Jev review blocks new paid calls and purchases while free forecasts continue. Such proposals are `blocked`, not no-edge abstentions. Revoked plugins block subsequent calls and final fills. Public-provider failure remains technical failure. Already sent requests may incur usage.

Public data requests run at most twice per second per provider with no concurrent requests to that provider. A 429 pauses that provider for `Retry-After` or 60 seconds; the failed market is not retried. Request records contain generated IDs, allowlisted operations, HTTP status, timing and safe codes only. Metadata is fetched once per input snapshot and reused to validate both outcomes' trading conditions, with a permission recheck and original metadata timestamp. There is consequently no additional HTTP request for those cached conditions. Old 400/429 causes remain undemonstrated. Ticker age is at most ten seconds with at most one second of future clock skew; raw signed age/timestamps are preserved.

Settlement checks run independently of admission, using finalized public Polygon data by immutable outcome identity. Both policies reference the same per-outcome resolution evidence. No fake order is created for abstained forecasts. After admissions, only public settlement may continue for at most 24 hours while the process remains alive. `settle` performs one bounded pass after STOP without discovery, forecast, model or purchases. Unknown results remain pending.

## Reports and acceptance

The study writes atomic `state.json`, `summary.json`, `results.csv`, `index.html`, `requests.json`, configuration and budget snapshots. Reports distinguish shared forecasts, policy proposals, reviews, decisions, fills and official resolutions. Probe accounting appears once, separate from prospective metrics. Brier is computed once per shared forecast and separately by horizon, including abstained forecasts. Quote baseline coverage is matched; incomplete/nonbinary resolutions are not scored as losses. Overlapping windows are dependent and two hours cannot prove profitability.

Controlled checks, the real Jev contract probe, historical proposal replay and prospective results must be reported separately. No policy is guaranteed a live purchase. Do not tune thresholds mid-run or count saved-book replay as execution. See COMPARISON-PAPER-VALIDATION.md for the acceptance record.

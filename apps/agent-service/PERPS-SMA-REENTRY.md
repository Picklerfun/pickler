# SMA continuity, timing and hourly reentries

The local `perps-sma-reentry-latency-v1` protocol uses configuration version 7. It compares two
independent 1,000 virtual AUSD portfolios on the frozen eleven-market catalog. `sma-reference`
and `sma-once-bar` both use the existing hourly SMA20/50, selective 1x risk policy, 100 AUSD
maximum sizing, five-position cap, 2% individual stop and four-hour holding horizon. The SMA
separation must be strictly greater than ten basis points. Both use improved execution.
This experiment measures the reopening rule economically, not the economic effect of latency.
No models, Exa, signer, real orders, deployment, automatic retries or scheduled monitor are used.

## Frozen identity and hourly keys

The once-bar key is `(symbol, side, 3600, openTime of the final snapshot's last closed hourly bar)`.
The gate runs after the original ranking and selection, without replacement candidates. Final
refresh cannot promote an initial hold or change direction. The account's immutable entry policy
and the trusted persisted initial/final admissions are checked under its transactional lock. A
confirmed fill and consumed key are persisted together. A rejection consumes nothing, and a close
retains consumed keys. Old accounts without the entry-policy field keep their historical behavior.
The same-slot close fence includes both the originating slot and actual confirmation slot.

## Execution and traces

Price valuation and mandatory stop/expiry exits precede slower candle preparation and funding.
Hourly invalidation uses an available current closed window. All three reference candle resolutions
(1h/15m/5m, sixty consecutive closed bars) remain required for entry eligibility. The shared reader
checks permissions and ownership before each request and cache reuse. Public requests remain
serial, at least one second apart, at most 24 per session. Candle preparation has sixty seconds;
price capture has twenty seconds. Original timestamps, thirty-second freshness and five-second
future/skew bounds are unchanged. No stale or missing price is substituted.

Mark-only observations preserve pending funding. Reconciliation includes closed positions, and
unknown required funding blocks new opens. Mandatory closes still use the existing accounting,
simulator and selective planner. No exposure-policy tuning is part of this change.

Versioned diagnostics record monotonic phase durations: calendar wait and delay, provider queue,
headers, body, validation, candles, funding, connection/query/transaction, simulation and reports.
Database diagnostics exclude SQL text, parameters, credentials and result bodies. Exit traces retain
pre-maintenance positions and marks, the detected condition, first observed executable opportunity,
attempt and confirmation or impediment. Detection does not identify the market's exact crossing
instant. Missing transport phases in earlier studies cannot be inferred.

Compact status is published after every recorded observation. Full reports run in a worker after
round progress or closing-state changes; requests coalesce without overlapping generations.
Each artifact is published using a temporary file and atomic rename. Reporting never replaces
compact status with an older snapshot. Failures retain the original error and attempt all cleanup.

## Commands and qualification

Run from `apps/agent-service` in the frozen clean worktree, after building shared packages. The
private environment must contain only the loopback `DATABASE_URL`; model and trading keys are
neither required nor copied. The Node option separator before the script is required: it prevents
Node from interpreting the laboratory `--env-file` argument itself. The unified npm command
includes this separator. All outputs are private, ignored local data.

```sh
node --import tsx -- src/evaluate.ts prepare --config /absolute/study.json --env-file /absolute/database.env --output /absolute/new-study
node --import tsx -- src/evaluate.ts timing-check --state /absolute/audit-export.json --output /absolute/new-timing
node --import tsx -- src/evaluate.ts stability --config /absolute/study.json --env-file /absolute/database.env --output /absolute/new-qualification
node --import tsx -- src/evaluate.ts run --config /absolute/study.json --env-file /absolute/database.env --qualification /absolute/new-qualification/report.json --output /absolute/new-study
node --import tsx -- src/evaluate.ts status --config /absolute/study.json --env-file /absolute/database.env --output /absolute/new-study
node --import tsx -- src/evaluate.ts report --config /absolute/study.json --env-file /absolute/database.env --output /absolute/new-study
node --import tsx -- src/evaluate.ts stop --config /absolute/study.json --env-file /absolute/database.env --output /absolute/new-study
node --import tsx -- src/evaluate.ts audit-export --config /absolute/study.json --env-file /absolute/database.env --diagnostics /absolute/new-study/diagnostics.jsonl --output /absolute/new-export
```

`timing-check` dispatches before environment/provider composition. It verifies the export payload
hash and uses existing financial functions with thirty paired samples per controlled scenario.
Median, p95, raw samples, parity hashes and regressions are published. Injected waits model known
scheduling dependencies, not measured historical provider latency. It refuses an environment file
or paid mode and writes only a new directory.

The one public qualification records thirty fixed minute slots on an independent PostgreSQL
lease, without accounts or executions. At least 29/30 complete eleven-market sets, no ownership or
permission failure, released lease and closed resources are required. `run` checks that proof against
the clean commit and exact configuration. A failed qualification does not authorize the six-hour
comparison or an automatic repeat. Capture with no positions does not certify mandatory exits.

The one comparison admits 72 slots in minute one of each five-minute interval, within thirty
seconds, and records missed slots without recovery. Minute observations and lease renewal
(90-second lease, every twenty seconds, PostgreSQL clock) stay serialized. macOS uses the existing
sleep protection and closed-lid refusal. After the fixed six hours admissions close; deterministic
exits may run for fifteen minutes. Ownership or persistence failure aborts immediately. Positions
and funding that cannot be reconciled remain pending. No automatic restart or extension exists.

## Outputs and interpretation

Reports include all 1,584 slot/asset/variant decision rows, separate execution and observation detail,
entry keys, blocked reentries, filters, fees, funding, realized net AUSD, verifiable marked equity
and drawdown. API calls, tokens, spend and new reservations are explicitly zero. Spread/slippage
already in fill prices are never deducted twice. Historical results are preserved, not paired controls.

`reentry-economics.json` and `.csv` link blocked keys to actual confirmed reference openings on
the same common valid slot, direction and final hourly bar. Closed positions use their original
fee, realized-P&L and reconciled funding postings to classify reference wins, losses or flat
outcomes. Missing or duplicate postings and unknown funding remain `NOT_VERIFIABLE`; open
positions remain pending. This does not assign P&L to the unexecuted once-bar proposal. The
observed aggregate fee difference between evolving portfolios is not a causal per-slot saving.

`coverage.json` checks 69/72 complete rounds, 753/792 common valid asset-slots, 342/360 recorded
and valued observations, 95% of held-at-minute-start minutes valued, no exposed valuation gap
above 120 seconds, all detected exits traced, and no ownership violations. Missing observations
and unavailable assets are not holds or zero returns. Pending funding is not zero funding.

Technical conclusions concern measured coverage and servicing delays. Economic conclusions
concern independently evolving portfolios and the reopening restriction; a better negative result
is loss reduction. Sparse reentry activity is inconclusive. Six hours cannot establish profitability,
optimal parameters or automatic promotion. If qualification or operating coverage fails, publish
its quantified causes and explicitly limit or defer the economic comparison.

See [the 2026-10-08 delivery record](PERPS-SMA-REENTRY-ACCEPTANCE-20261008.md) for the controlled
checks, actual failed public qualification, frozen provenance and pending economic acceptance.

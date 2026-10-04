# Evaluation operations

Use the repository-root command with an absolute private configuration path:

```sh
npm run build:shared
npm run evaluate -- preflight --config /absolute/private/study.json
npm run evaluate -- prepare --config /absolute/private/study.json
npm run evaluate -- run --config /absolute/private/study.json --allow-paid
npm run evaluate -- stop --config /absolute/private/study.json
npm run evaluate -- report --config /absolute/private/study.json
```

These examples do not authorize execution. Existing studies and monitors remain paused. Never
remove STOP files or reset balances/reservations to restart a study. Use the checkout containing
the session's private artifacts and the explicitly selected database. `--env-file` selects credentials.

## Protocol capabilities

| Protocol              | Version                        | Available commands                                                       |
| --------------------- | ------------------------------ | ------------------------------------------------------------------------ |
| Perpetual comparison  | 1, `perps-comparison-v1`       | prepare, preflight, run, resume, status, stop, settle, report            |
| SMA entry ablation    | 3, `perps-sma-ablation-v1`     | prepare, preflight, run, status, stop, settle, report                    |
| BTC benchmark         | 4, `btc-decision-benchmark-v1` | prepare, preflight, validate, run, status, stop, settle, report, compare |
| Original paper study  | 1, no protocol field           | status, report                                                           |
| Quantitative BTC      | 2, `btc-quant-jev-v1`          | status, report, settle, history, replay                                  |
| Paired BTC comparison | 3, `btc-policy-comparison-v1`  | status, report, settle                                                   |

Legacy executable commands and aliases have been removed. Original v1 configurations are
recognized in memory without rewriting the saved format. Historical adapters cannot construct
a paid model or start a new evaluation, even when `--allow-paid` is supplied. Reports and public
reconciliation preserve existing ledgers, reservations, configuration and STOP files. No missing
historical state is initialized. `history` downloads the same explicitly requested public quote
history; `replay` analyzes saved inputs without fabricating executions.

Compare saved benchmark states explicitly:

```sh
npm run evaluate -- compare --config /absolute/private/benchmark.json --output /absolute/private/comparison --state /absolute/private/first/state.json --state /absolute/private/second/state.json
```

BTC preflight validates configuration only. Perpl preflight checks public evidence and catalogs
without a paid evaluation. `settle` makes no paid model calls: Perpl may simulate risk-reducing
exits, while binary protocols reconcile official resolution. Manual trading commands are separate
operations that consume the same engine. Perpl reports support `--output`; ordinary BTC reports
remain in their session directory.

## Ownership and accounting

Read the [canonical architecture](../../docs/trading-architecture.md). The portable engine is in
`@pickler/trading`; `src/evaluation-host/local.ts` performs local composition and artifact IO.
The two accounting policies remain distinct: PostgreSQL Perpl reconciles known costs, while the
BTC campaign retains reservations. Neither currency balances nor model budgets are merged.

All four active Jev adapters use one infrastructure client. Runtime retains prompts, thresholds
and error mapping. Usage persists before answer validation, with no retries or repairs. BTC has
a 1 MiB response bound; existing timeouts remain 30 seconds for quantitative review, 180 seconds
for legacy evidence routing and 20 seconds for Perpl. Extraction does not establish live-provider
acceptance. New prospective runs require frozen configuration and the remaining authorized budget.

## Perpl public stability acceptance

Run from the agent-service workspace using the unified CLI:

```sh
node --import tsx src/evaluate.ts stability --config /absolute/path/study.json --env-file /absolute/path/study.env --acquisition-choice /absolute/path/new-diagnostic/choice.json --output /absolute/path/new-stability-report
```

The configuration identifies an existing study whose three agents still have matching, enabled Perpl permissions. The command creates only a separate diagnostic record/lease, references the existing agents, and performs no account mutation, model request or purchase. Do not supply `--allow-paid`. Its provider operations share the same coherent reader used for new comparison studies. Keep the laptop open; the command prevents idle sleep, not lid-close sleep. Closing the lid may invalidate the lease; it must never resume paid work automatically.

The duration is fixed at thirty minutes. Cycles start once per minute, with no catch-up. A cycle more than five seconds late is marked missed. Both markets must pass at one reference time, within twenty seconds total. Existing limits remain thirty-second freshness, five-second future tolerance, five-second component skew, one public request per second and twelve requests per read session. A Retry-After cooldown can consume the whole acquisition window. No missing price or timestamp is substituted.

The output includes report.json, report.csv, report.html and append-only events.jsonl. Acceptance requires at least 29 valid joint cycles out of 30, no lease failure and successful completion; this is an availability threshold, not a profitability test. A failed acceptance is reported without another run or threshold changes. The command refuses a tracked dirty checkout and records the tested commit. There are no migrations.

New comparison records carry `coherent-20s-v1`. Data-unavailable rounds are skipped once, preserving proposals and known model cost, while execution failures after mutation remain incomplete and stop decisions. Reports exclude omitted rounds from completed comparisons rather than treating them as holds or zero returns. Historical records are not upgraded or restarted implicitly.

The host also checks the elapsed local renewal gap synchronously before work. A gap of ninety seconds fails closed with `PROCESS_INTERRUPTED`, even if a delayed timer or temporarily lagging database clock would otherwise let a renewal appear successful after wake. This guard never renews or extends ownership. See [the recorded acceptance result](PERPL-RELIABILITY-VALIDATION.md); the first public run was interrupted by lid-close sleep and did not pass.

### Perpl connectivity diagnostics

The public stability command records safe DNS/connect/TLS error codes when the transport supplies
one, plus response-header/body phases and timing. Unknown causes remain unknown. On a failed
acquisition with a request error, it performs one guarded, three-second read of Cloudflare's
public connectivity endpoint, without retaining its body. The control is separate from the
20-second BTC/ETH acquisition budget and is never substitute price data. An HTTP response proves
reachability at that instant, not that Perpl or the local network caused a historical outage.
The existing 29/30 acceptance threshold, timestamps, lease protocol and zero-paid-call scope stay
unchanged. Report v2 preserves the original acquisition duration separately from control duration.

Read [the transport diagnostic guide](PERPL-STREAM-ACQUISITION.md) before new public acceptance. The explicit data-diagnostic command freezes transport selection; stability requires that choice file. Historical reports remain readable and are not rerun.

See [the 2026-10-01 public results](PERPL-STREAM-VALIDATION.md): both transports reached 10/10; the selected paced REST reader passed 30/30. This does not authorize a paid continuation.

## Offline Perpl decision audit

The perpetual protocols support audit-export. The separate audit command reads a versioned export
without a study config, environment file, database or provider clients. See
[the audit guide](PERPS-DECISION-AUDIT.md) for exact commands, provenance and acceptance boundaries.

For the model-free SMA protocol, read [PERPS-SMA-ABLATION.md](PERPS-SMA-ABLATION.md).
Do not pass `--allow-paid`. Its preflight is database/permission-only; `settle` only renders a
read-only report. Only its original runner may observe public data and close virtual positions.

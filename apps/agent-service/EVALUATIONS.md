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

# Unified evaluation entry point

Use the repository-root `evaluate` command for new BTC benchmark and Perpl comparison work:

```sh
npm run evaluate -- preflight --config /absolute/path/study.json
npm run evaluate -- prepare --config /absolute/path/study.json
npm run evaluate -- run --config /absolute/path/study.json --allow-paid
npm run evaluate -- stop --config /absolute/path/study.json
npm run evaluate -- report --config /absolute/path/study.json
```

`--env-file` selects local credentials. Never commit credentials or private study data.
These examples do not authorize a restart: the existing evaluations remain paused.

The frozen native configuration selects the protocol. The core coordinator validates its
version, supported command and paid opt-in before calling an adapter. The local application
service is `src/evaluation-host/service.ts`; future trusted hosts can call this boundary,
but no web or Worker integration is enabled by this change.

| Protocol                    | Configuration | Commands specific to this protocol | Accounting                                                     |
| --------------------------- | ------------- | ---------------------------------- | -------------------------------------------------------------- |
| `perps-comparison-v1`       | v1            | `resume`                           | Existing PostgreSQL reservations and known-cost reconciliation |
| `btc-decision-benchmark-v1` | v4            | `validate`                         | Existing campaign ledger; reservations retained                |

Both support prepare, preflight, run, status, stop, settle and report. BTC preflight validates
configuration only and explicitly does not claim provider connectivity. Perpl preflight
checks public evidence and model catalogs without a paid model evaluation. `settle` performs
public reconciliation; Perpl can execute virtual risk-reducing exits. It never opens a position
or calls a paid model. BTC reports remain in their session directory; Perpl supports `--output`.

Protocol adapters retain their existing scheduling, settlement and risk rules. Binary BTC
outcomes and perpetual positions are different instruments: their financial calculations
must not be combined. Strategy implementations and prompts remain in their existing shared
core/runtime modules; the coordinator does not implement another strategy. Protocol versions
identify the different strategy and accounting policies rather than silently translating them.

Legacy `perps:study`, `paper:study`, `paper:quant`, `paper:compare` and `paper:benchmark`
execution entries reject new runs. Their historical reporting and explicitly allowed
reconciliation commands remain available. This does not retire the separate manual paper
trading tools. Existing reports, balances, STOP files, campaign budgets and model usage remain
unchanged. Historical local paths must be used from the checkout containing that study.

A shared model transport is not evidence of strategy quality. Controlled replay validates
compatibility; a new prospective comparison must record its commit and frozen configuration,
retain outstanding reservations, and remain within the previously authorized budget. Do not
remove STOP files or reset an old session to restart it. Old incomplete results remain incomplete.

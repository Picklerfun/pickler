# SMA profiles and selective exposure

This opt-in local paper experiment compares four independent 1,000 AUSD accounts over one
fixed six-hour window (72 slots, eleven markets). No models, Exa, signing, or real orders are
constructed. New API spend, model tokens, calls, and reserves are zero. Historical budget
reservations remain unchanged. Do not restart, recover missed slots, or create an automation.

| Variant          | Signal                                             | Exposure management                               |
| ---------------- | -------------------------------------------------- | ------------------------------------------------- |
| hourly-legacy    | Original hourly SMA20/50, strictly over 10 bps     | Historical 50% cap and collective exit            |
| hourly-selective | Same hourly signal                                 | 40% opening target; selective reduction above 50% |
| fast-legacy      | 15m SMA20/50 and latest closed 5m candle direction | Historical management                             |
| fast-selective   | Same fast signal                                   | Selective management                              |

Fast signals do not depend on hourly trend. A 5m tie does not confirm an entry. Confirmation
is entry-only; own-profile SMA neutral/opposite invalidates an open position. Both profiles
retain 2% individual stops, four-hour maximum holding, 1x execution, up-to-100 AUSD entries,
five-position capacity, emergency daily-loss/drawdown/insolvency response, and no reversal
or reopening within a slot. SMA separation ranks candidates; it is not a profit probability.

## Selective reductions

The trusted account document stores `riskManagement`; old absent fields retain legacy behavior.
Both coordination and PostgreSQL admission enforce it. A selective opening must finish at no
more than 40% marked exposure/equity after its actual fill and costs. Between 40% and 50%,
existing admissible positions remain and openings stop. Strictly above 50%, mandatory individual
exits happen first, then at most 32 subsets of remaining positions are simulated. Choose the
fewest full exits, then lowest fee plus adverse execution distance from mark, then numeric
market IDs. Accumulated losses are not exit cost. Recompute after each confirmed close.
Unknown marks/equity/depth leave reduction pending and block openings. No partial closes.

## Data and ownership

All arms require the same 60 original closed consecutive candles at 1h, 15m, and 5m per asset.
The preparation deadline is 60 seconds. Cache by configuration, market, resolution, and closed
window; recheck permissions/ownership on reuse. Each horizon uses a separate public session
with at most 24 requests, sharing the existing one-second start spacing and 429 treatment.
Slower candles/funding precede prices. `rest-universe-20s-v1` retains the twenty-second price
acquisition deadline, thirty-second age, and five-second future/skew limits. The final capture
refreshes candles across boundaries. Exclude a missing asset from all four arms. An initial hold
cannot become an opening, nor can the final refresh change its direction.

Slots start at minute one of five-minute intervals, with thirty-second admission tolerance.
Minute observations never overlap; missed observations/slots are retained. The runner immediately
checks the current minute when a slow cycle has crossed a minute boundary; it never sleeps past
an otherwise unexpired admission or recovers an expired slot.
Reopening is fenced by both the cycle slot and the slot containing the confirmed exit, so an
observation crossing a boundary cannot reopen that position in the new slot. The PostgreSQL
lease remains ninety seconds, renewed every twenty. macOS rejects a closed lid and holds its
existing idle-sleep guard. Data failure before execution is an omission; uncertainty after
partial writes requires interruption/reconciliation. Lost ownership admits no further writes.
At fixed end, admissions close and deterministic exits run for at most fifteen minutes.

## Commands

From `apps/agent-service`, using Node 22.22+ and built shared packages:

```sh
node --import tsx src/evaluate.ts prepare --config /absolute/study.json --env-file /absolute/database.env --output /absolute/new-study-directory
node --import tsx src/evaluate.ts preflight --config /absolute/study.json --env-file /absolute/database.env --output /absolute/new-study-directory
node --import tsx src/evaluate.ts run --config /absolute/study.json --env-file /absolute/database.env --output /absolute/new-study-directory
node --import tsx src/evaluate.ts report --config /absolute/study.json --env-file /absolute/database.env --output /absolute/new-study-directory
node --import tsx src/evaluate.ts audit-export --config /absolute/study.json --env-file /absolute/database.env --diagnostics /absolute/new-study-directory/diagnostics.jsonl --output /absolute/new-export-directory
```

A v6 config contains only version/protocol/hours/budgetUsd/tenantId/sessionId/network/markets.
Use `version: 6`, `protocol: perps-sma-profile-risk-v1`, `hours: 6`, and historical `budgetUsd: "5"`.
The exact catalog is BTC1, MON10, ETH20, SOL31, HYPE40, ZEC50, LIT60, VVV70, PUMP90, NEAR100,
and UNI110. No provider tariff/key/paid opt-in is accepted. `report`/`status` are read-only and
make no provider call. `run` rejects any already-started study; initialization never rewrites it.
`audit-export` writes one consistent read-only `audit-export.json` packet in a new directory.
The historical model-decision `audit` analyzer does not support this profile protocol; use its
own offline report and shared profile business functions for proposal diagnostics.

## Evidence and interpretation

Outputs are `report.json`, `report.html`, `report.csv`, `rounds.csv`, `decisions.json`, local safe
diagnostics, and runtime state. `executions.json`/`executions.csv` retain every execution event,
including closing-window exits outside the 72 admission slots. `observations.json`/`observations.csv`
retain risk, failed/missed observations and selective projections. Exactly 3,168 rows identify
scheduled, complete, omitted, missed, and not-evaluated decisions. Full closes/risk observations
are separate events. The original study commit and report-generation commit are distinct;
regenerating a read-only report cannot rewrite frozen metadata or establish process liveness.
Cleanup attempts all resources even when an earlier cleanup rejects, without hiding the primary
failure. Fees and
funding form net realized AUSD P&L; marked equity/drawdown exist only at verifiable observations.
Spread/slippage already in fill prices are diagnostics, never a second subtraction. Pending
positions/funding are not assumed losses or zero. Compare common valid asset/slots and report
independently evolving portfolio totals separately. Six hours are exploratory evidence, not
proof of superiority or profitability. Historical runs are context, not paired controls.

The offline incident replay uses saved position marks and contemporaneous captured books only.
It compares immediate requested exits/projections, never hypothetical future performance of
retained positions. Missing inputs are explicitly not verifiable.

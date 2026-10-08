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

## Recorded six-hour acceptance: 2026-10-08

The single authorized `sma-profiles-risk-20261007` run completed from
2026-10-08 00:56:00 UTC to 06:56:00 UTC. Admissions were not extended or repeated. The runner
and idle-sleep guard exited, and read-only PostgreSQL inspection confirmed the lease owner and
expiry were released. All positions closed and funding was reconciled. There were 1,029
successful renewals and no renewal/release failure. Model/news/signing calls, tokens, API USD
and new model reservations were zero; historical reservations were not changed.

| Variant          | Open/close fills | Gross realized AUSD | Fees paid AUSD | Funding AUSD | Net realized AUSD | Return on initial 1,000 AUSD |
| ---------------- | ---------------- | ------------------- | -------------- | ------------ | ----------------- | ---------------------------- |
| hourly-legacy    | 14 / 14          | -1.294496           | 0.959257       | 0.054219     | -2.199534         | -0.2199534%                  |
| hourly-selective | 9 / 9            | 0.465915            | 0.617350       | 0.038548     | -0.112887         | -0.0112887%                  |
| fast-legacy      | 20 / 20          | -15.182113          | 1.367653       | -0.054124    | -16.603890        | -1.6603890%                  |
| fast-selective   | 12 / 12          | -6.942098           | 0.822372       | -0.018717    | -7.783187         | -0.7783187%                  |

Net equals gross realized fill P&L minus actual fees plus recorded funding. Spread and slippage
were already included in fills and are not subtracted again. Portfolio cash reconciled to the
initial 1,000 AUSD plus net movements. Observed maximum marked drawdowns were approximately
1.2092%, 0.9402%, 1.7972% and 0.7783%, respectively; these are sampled valuations, not continuous
price paths.

Coverage was incomplete: 52 of 72 slots completed; 20 were durably recorded as missed and were
not recovered. Within completed rounds, 43 asset/slots were excluded from all four variants:
45 initial/final component diagnostics comprised 35 inconsistent-data, eight unavailable-data,
and two stale-data reports. Components can coincide within an asset/slot. There were 529 valid
common asset/slots and 26 missed minute observations. The 3,168 decision identities comprise
2,116 valid rows, 172 unavailable-data rows and 880 missed-slot rows. No whole round was omitted
after admission, and no partial/uncertain execution or ownership violation was found. Missing
slots and assets are not holds or zero-return observations. The report therefore does not mark
the complete scheduled comparison as fully comparable.

Selective management had a higher observed net result within each signal profile: +2.086647 AUSD
for hourly and +8.820703 AUSD for fast relative to legacy management. The fast profile had a worse
observed result within each management policy. All four portfolios finished negative. These are
independently evolving portfolio totals, not causal per-slot estimates or proof of superiority.
The common-input proposal diagnostic separately reuses the original hourly-legacy account in
each round without carrying hypothetical positions forward or assigning them P&L.

Both legacy accounts experienced one exposure-related collective batch of five confirmed closes.
The selective accounts experienced none, but neither live selective account reached the
above-50% subset-reduction path. That path is validated by controlled tests and saved-snapshot
replay, not claimed as a live execution. On the same five-position hourly-legacy snapshot from
05:37 UTC, the historical policy requested all five closes. Selective rules first required the
MON individual exit; its existing simulator/ledger projection restored exposure to
398.483673 / 999.810017 AUSD, at most 40%, so four positions could remain. No later performance
or hypothetical P&L is assigned to those retained positions.

The frozen runner used commit `7c87ed691bca3ecb567de4a5b2580f965f8791ca`. Source, configuration
and catalog hashes remained unchanged. Post-freeze delivery changes through
`b03ec38a9da5bc6c6fe2c564f9b74e563758d9ab` correct cleanup, scheduling across minute boundaries,
cross-slot reopening fences and reporting; they were not patched into the running experiment.
Financial policy, simulator, data and PostgreSQL admission implementations remained identical
to the frozen run. Controlled report-hash memoization reduced the same saved report from
10.56 seconds to 0.54 seconds with identical HTML/CSV/decision hashes. That observation does
not establish the cause of every missed slot, and corrected prospective coverage remains
unvalidated without another separately authorized experiment.

Local artifacts are in the original checkout under
`apps/agent-service/.data/perps-studies/sma-profiles-risk-20261007/`: `report.html`, JSON/CSV
reports, `analysis.json`, `common-input-proposals.csv`, execution/observation exports,
`verification.json`, `resource-verification.json`, and both immediate incident replays.
The consistent read-only final packet is `final-evidence/audit-export.json`, payload SHA-256
`f02793ae734902e322b310cf42ab559f4dff463f354a73d89416b96cb8e4ac18`.
Its exporter/analyzer commit is recorded separately from the frozen study commit. Offline
verification passed 3,168 identity, ownership, slot, post-fill exposure, no-reopening and
confirmed-execution-window checks. These private local artifacts are not committed.

Validation through the delivery code commit passed formatting, lint, types, PostgreSQL tests,
Node and Worker builds, architecture checks and all PR checks. The targeted profile suite
passed 17/17 tests; the CI root suite reported 2,858 tests, 2,855 passes, three explicit skips
and no failures. Two browser-only tests were skipped in that job (the separate rendered Design
check passed), and one optional Supabase-stack consumer test was skipped. No provider calls
were made in CI. This run demonstrates the circuit and tested financial invariants, with
explicit operational coverage gaps; it does not establish profitability or authorize promotion,
automatic repeats, merge or deployment.

# BTC decision benchmark

`btc-decision-benchmark-v1` is an opt-in, local, version-4 paper experiment. It leaves hosted
research, trading, wallets, databases and historical studies unchanged. Ten virtual units fund
each hypothetical full fill. The quantitative formula remains experimental and uncalibrated.

| Variant | Entry probability       | Reviewer                          |
| ------- | ----------------------- | --------------------------------- |
| A       | Sensitivity lower bound | Existing Jev reviewer 1.1.0       |
| B       | Central estimate        | Existing Jev reviewer 1.1.0       |
| C       | Central estimate        | Compact semantic reviewer 1.0.0   |
| D       | Central estimate        | No Jev veto; virtual control only |

Every variant requires net edge **strictly greater than 0.03**, valid identity/rules, fresh
Coinbase data, available fees, sufficient depth and the existing ten-unit simulator. D bypasses
only the semantic veto. It cannot bypass deterministic checks, revoked plugins or a campaign stop.

## Commands

Build shared packages at the repository root. Run subsequent commands from `apps/agent-service`:

```sh
npm run build:shared # from the repository root
cd apps/agent-service
cp benchmark-paper.example.json .data/benchmark.json
npm run paper:benchmark -- prepare .data/benchmark.json
npm run paper:benchmark -- evaluate .data/benchmark.json --allow-paid
npm run paper:benchmark -- run .data/benchmark.json --allow-paid
npm run paper:benchmark -- settle .data/benchmark.json
npm run paper:benchmark -- report .data/benchmark.json
npm run paper:benchmark -- compare .data/benchmark-comparison \
  .data/paper-studies/OLD_ID/state.json .data/paper-studies/NEW_ID/state.json
```

Set a unique ID, list **every** prior study under `historicalStudies`, and verify the Jev tariff
before replacing the example's null rate. The existing app `.env` supplies `TYPESAFE_API_KEY` for
evaluate/run only. Reports, comparison and preparation load no credentials. There is no default
paid invocation, automatic phase restart, alternate model or provider fallback.

`prepare` requires a clean committed checkout and freezes configuration, experiment constants,
both prompt snapshots, commit, 48 scenarios and their SHA-256 hashes. Labels are synthetic authored
references, not human-reviewed judgments. Each split has 24 cases (12 coherent, 12 materially
contradictory), balanced across four checks, with disjoint wording families. Both reviewers see
the same rule evidence and proposal; expected labels, IDs encoding labels and split metadata
never enter the provider request. Do not tune after inspecting heldout results.

`evaluate` reserves each reviewer pair together, performs two contract probes followed by 96
scenario calls, and records usage before validating answers. Valid but poor judgments do **not**
stop the experiment. The report marks a reviewer as passing these synthetic cases only when all
24 heldout cases are valid and all twelve material errors are detected with no false veto; otherwise
it remains not validated. This is a strict descriptive gate, not proof of general accuracy.
Invalid responses or technical failure retain reservations, write STOP and prevent the live run.

## Semantic review

The existing reviewer is unchanged. The compact adapter receives original rules, source
provenance, the system's explicit interpretation, forecast and proposal, without candles or order
books. Its independent questions cover point versus average price, final versus whole-event
averaging, equality, and predictive versus official resolution source. Answers are strictly
validated `CONSISTENT`, `CONTRADICTED` or `NOT_STATED` distributions. Only a contradiction with
confidence and selected probability each at least 0.90 vetoes. Uncertainty is not approval.
Confidence is derived from the distribution, not a second independent confirmation.

Both adapters pin `jev-1.13.0`. The compact adapter uses bounded requests, cancellation, no retry
and allowlisted diagnostics; rejected values, unknown field names and error bodies are never
persisted. Core retains numeric and identity validation. Missing live Chainlink prices remain a
limitation, not an automatic veto. Coinbase prediction is never relabeled official settlement.

References: [model and tariff](https://docs.typesafe.ai/models),
[confidence](https://docs.typesafe.ai/confidence),
[documented model limitations](https://docs.typesafe.ai/model-jaggedness/jev-1.13).

## Reservations and lifecycle

The original USD 5 authorization includes every historical reservation. The new experiment caps
additional reservations at USD 1.25, with at most 386 records: 2 contract probes, 96 labeled reviews
and up to 288 prospective reviews. Each reserves 65,536 input tokens at the configured tariff.
Reservations are never released, even for errors or unused jointly reserved calls. At USD 0.042
per million input tokens, the full 386-call ceiling reserves USD 1.062469632. Reported token cost
is a separate estimate, not an invoice. Free output may still have positive token counts.

The campaign writer lock excludes v2/v3/v4 paid execution. Legacy v2/v3 readers include v4
reservations; the v1 runner explicitly refuses campaigns containing v4 rather than ignoring them.
Historical snapshots, STOP files, outcomes and reserves remain immutable.

The six-hour deadline is fixed on first run. Persisted minute-one slots permit a 30-second
admission tolerance, at least 90 seconds remaining and at most two concurrent markets. There are
at most 72 five-minute and 24 fifteen-minute opportunities. No backfill, paid restart or deadline
extension is permitted. macOS requires an open lid and retains an idle-sleep assertion through
admissions; forced sleep can still interrupt it. Interruptions and missed slots remain visible.

Each market has one initial snapshot and forecast. Identical proposals may share a call only
within the same reviewer/version/snapshot. Required reviews reserve jointly before sending.
After valid reviews, even vetoes, all four variants share one updated snapshot and final clock.
They cannot switch outcome or increase the original cap. Counterfactual fills do not consume one
another's virtual liquidity. Recorded review latency, total wait and edge/price changes are
diagnostics, not a causal attribution of price movements to Jev.

Budget exhaustion or a technical review failure blocks subsequent reviews and purchases for
**all four variants**. Free forecasts and public settlement may continue. Public calls retain
the existing serial-per-provider two-per-second limit, 429 cooldown and permission checks.
After admissions, only public resolution checks may continue for up to 24 hours while the process
is active. Unknown resolutions remain pending. `settle` cannot discover, forecast, review or buy.
It can run after STOP and performs one bounded pass; invoke explicitly again for still-pending
results. Do not reactivate the historical heartbeat or remove STOP to bypass a failure.

## Reports and interpretation

Each study saves state, configuration, scenarios, request diagnostics, HTML, market CSV,
evaluation CSV and summary JSON. Per-market evidence exposes initial/refreshed inputs, immutable
probabilities, limits, review identity/hash, final decisions, fees and official resolution proofs.
The cumulative offline command imports explicit files, rejects duplicate studies/markets, and
preserves unknown historical metadata. Missing historical C/D variants are not synthesized.

- Brier and calibration count each shared forecast once, by horizon, including abstainers.
  Quote baselines use contemporaneous, matched observations. Overlapping windows are dependent.
- P&L includes confirmed virtual settlements only. Return uses settled cost; open cost is separate.
  No investment means null return. Drawdown is on the realized P&L curve, not open-position value.
- Errors and blocked proposals are not zero-profit abstentions. Valid abstentions contribute zero
  to paired economic comparisons; pending positions and incomplete pairs are excluded explicitly.
- B−A, C−B and C−D differences use paired UTC-hour blocks, fixed seed 20260928 and 2,000 bootstrap
  resamples. Six-hour intervals and favorable/adverse labels remain exploratory.
- The economic evidence gate requires unchanged frozen parameters, three distinct UTC days,
  twenty hour blocks, thirty markets bought by either variant, positive prospective P&L and a
  favorable paired interval. Counts enable assessment; they do not guarantee profitability.

Synthetic evaluation measures error recognition, not price forecasting. No strategy is promoted,
no threshold changes mid-run, and no extra campaign starts automatically to obtain positive P&L.

## Verification

Run root format, lint, typecheck, the full suite with isolated local PostgreSQL, shared builds,
Mastra build and Worker build checks. CI uses controlled transports only. The implementation's
tests cover shared snapshots, independent fills, semantic failures, reservations, refresh guards,
synthetic label isolation, safe diagnostics and known reporting arithmetic. Controlled purchases
do not establish live profitability. Record live acceptance separately in
`BTC-DECISION-BENCHMARK-VALIDATION.md` after execution.

## Explicit operator continuation and diagnosis

After renewed user authorization, prepare a new study declaring every prior study. Never remove
a historical STOP or rewrite prior results. Prior v4 money and review counts are carried into
the original USD 1.25 and 386-call ceilings, including unused reservations. A fresh evaluation
is a repeated development experiment, not a new independent sample. Prompts and heldout labels
must remain frozen.

`npm run paper:benchmark -- diagnose CONFIG --case CASE_ID --allow-paid` reserves and sends
exactly one current-reviewer call for that frozen scenario. It preserves usage and distinguishes
PROBABILITY_SUM_INVALID from CHOICE_NOT_MAXIMUM without rejected values. The diagnostic study
cannot pass the 98-review live gate. Any subsequent evaluation needs its own explicitly prepared
study, accounting for the diagnostic reservation as history; no automatic retry occurs.

## Optional per-case isolation (not enabled by default)

A new frozen configuration may explicitly set `invalidAnswerPolicy: "block-case"` after operator
approval to change the original stop rule. This does not repair Jev's answers or relax validation.
Only `JEV_INVALID_ANSWERS` with known valid usage is isolated, and never during the initial contract
probes. Both reviewer calls on a synthetic case are still observed; incomplete/invalid responses
remain failures in their respective denominators. Evaluation finishes as `completed_with_errors`
when applicable. It is not a successful technical acceptance of the reviewer.

During prospective evaluation, an invalid review blocks every proposed purchase in that market,
including the no-veto control. The next distinct market can proceed without resending the failed
request. Budgets, unknown usage, transport errors, invalid contract probes and cancellations retain
the global stop. This preserves matched execution comparisons but conditions economic results on
markets where required reviews were valid; report the excluded failed markets separately.

The default `stop-study` remains unchanged for existing configurations. Configuration and state
must agree on the frozen policy. Never edit an existing study to enable it or remove its STOP.

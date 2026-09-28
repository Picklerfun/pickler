<!-- historical-evidence -->

> Historical validation record: refers to the implementation and runs described below,
> before the trading-package extraction (integration baseline `8f37f1f`). Not current
> operating instructions. See [Evaluation operations](EVALUATIONS.md).

# BTC decision benchmark acceptance — 2026-09-28

## Status

The implementation and controlled verification passed. **Paid acceptance stopped during
development evaluation; the heldout evaluation and six-hour prospective run did not start.**
The stop followed the approved invalid-response rule. No review was retried, no schema or prompt
was relaxed, and no fallback, new paper purchase, real order or deployment occurred.

The frozen experimental commit is `1f93319dd7daef975b2415fc9830fde90a7c9654` on
`codex/btc-decision-benchmark`, based on PR #53. Later report-only changes make stopped evaluations
visible in the cumulative table; they do not change the frozen experiment or its results.

- Study: `btc-benchmark-20260928-160857`.
- Dataset SHA-256: `c5142cf1490c617be452807e8bbeece719f5ba6278eb3b45b14724c43eb16683`.
- Current reviewer: 1.1.0, prompt `05c89c133b89a3e6405f95b0e007855a13de72636ee923a76450ce90e63e6e89`.
- Compact reviewer: 1.0.0, prompt `a945e8763c29b0ecc21aaa48d1ab901de7a2280cc59d5806d30a04471f6ab37a`.
- Both pinned `jev-1.13.0`. The current reviewer source is unchanged from the parent PR.

## Controlled checks

Root formatting, lint and all workspace type checks passed. The complete suite against isolated
local PostgreSQL databases reported **467 passing tests, zero failures, one existing opt-in skip**
(468 total). The twenty added cases cover four-way parity, shared/separate reviews, joint budgets,
technical stop, valid veto/uncertainty, refresh changes, revocation, interruption recovery,
independent settlement, known Brier/calibration/return/drawdown arithmetic, seeded paired bootstrap,
label isolation, safe diagnostics and historical import. Existing public-provider 400/429,
freshness, concurrency and lease regressions also passed.

Shared packages, the Node/Mastra consumer and all Cloudflare bundles compiled successfully.
These are builds, not deployments. Controlled buys validate virtual execution only.

## Real reviewer evaluation

Both initial contract probes returned valid responses without a veto. Thirteen development cases
then completed for both reviewers (seven coherent and six materially contradictory). The next
current-reviewer request failed validation; its paired compact call was reserved but never sent.

| Development metric                                   | Current Jev | Compact Jev |
| ---------------------------------------------------- | ----------: | ----------: |
| Started development calls                            |          14 |          13 |
| Valid development responses                          |          13 |          13 |
| Detected material errors / valid material cases      |       0 / 6 |       5 / 6 |
| Missed material errors / valid material cases        |       6 / 6 |       1 / 6 |
| False vetos / valid coherent cases                   |       0 / 7 |       0 / 7 |
| Responses containing uncertainty                     |     13 / 13 |      8 / 13 |
| Technical failures                                   |           1 |           0 |
| Mean latency of valid development responses          |   563.54 ms |   550.38 ms |
| Development input tokens, including the failed call  |      66,954 |      24,001 |
| Development output tokens, including the failed call |       1,905 |       2,456 |

Uncertainty and veto counts can overlap: a clear contradiction in one independent question can
coexist with an uncertain answer to another. Uncertainty is never reported as approval.
The compact result is encouraging **development-only evidence** of material-error recognition;
it is incomplete, unvalidated on heldout cases, and says nothing about financial prediction or P&L.

## Demonstrated failure and uncertainty

At `2026-09-28T16:09:50.214Z`, request
`development-tie_rule-0-conflict:current` started. It returned parsable JSON, the pinned model,
reported usage (4,782 input / 137 output tokens), all three expected answer objects, and the
expected probability keys. It failed one custom validation at `answers.gap` after 595 ms.

This proves failure of the existing probability invariant. That invariant rejects either:

1. A probability sum more than 0.001 away from one; or
2. A selected choice below the maximum probability by more than 0.000001.

The safe diagnostic records both under `custom`, so **the retained evidence cannot distinguish
which condition failed**. Rejected values were intentionally not stored. Do not attribute a
specific numeric defect, provider bug, truncation or model reasoning failure without further
evidence. The [official API contract](https://docs.typesafe.ai/api) describes probabilities summing
to one and the selected choice as the highest-probability option; this delivery does not relax
either rule to continue the experiment.

`STOP` contains `JEV_INVALID_ANSWERS`, evaluation is `failed`, deadline is null, and there are zero
prospective slots/cases. All locks were released. The failed call retains its reported usage and
reservation; the unsent compact member of that reserved pair also retains its reservation.

## Accounting

| Measure                                      |       Value |
| -------------------------------------------- | ----------: |
| Historical reserved USD before this campaign | 1.025892608 |
| New reserved records                         |          30 |
| Calls actually sent                          |          29 |
| Valid responses                              |          28 |
| New reserved USD retained                    | 0.082575360 |
| Total campaign reserved USD retained         | 1.108467968 |
| Reported input tokens                        |      97,526 |
| Reported output tokens                       |       4,686 |
| Known estimated API USD                      | 0.004096092 |
| Sent calls with unknown usage                |           0 |
| New virtual purchases                        |           0 |

The verified tariff was USD 0.042 per million input tokens, with free output, from the
[official model page](https://docs.typesafe.ai/models) on 2026-09-28. Estimated token cost is not
an invoice or permission to release reservations. The additional USD 1.25 and original USD 5
ceilings were preserved.

## Inspectable local artifacts

Paths below are relative to `apps/agent-service`; these private study files are ignored by Git:

- `.data/paper-studies/btc-benchmark-20260928-160857/`: configuration, scenarios, state,
  per-call diagnostics, evaluation CSV and HTML.
- `.data/paper-studies/benchmark-cumulative-20260928/`: imported historical and new results,
  economic CSV, reviewer CSV, HTML and evidence summary.
- `.data/benchmark-active.json`: frozen operator configuration; no credentials.

The cumulative report imports six prior studies explicitly and preserves their original results.
The earlier v3 central-policy result remains two settled virtual purchases with P&L
`-4.83616942`; it is not a new v4 result. No C/D historical buys are reconstructed.

The six-hour comparison, heldout accuracy, prospective C/D fills, official outcomes and economic
improvement remain **pending**, not successful zero-P&L results. A separate authorized diagnostic
revision is required before further paid work. This study must not be restarted or have STOP removed.

The browser automation surface refused local `file:` URLs; no visual browser inspection is claimed.
The report generation, escaping, historical compatibility and metric contents were checked offline.

## Explicit continuation — 2026-09-28

The user requested continued testing and fixes. Commit
`745abbe5a602eed737c22f184ca6c3a783e220b5` separates normalization failures from selected-label
inconsistency without changing prompts, thresholds, validation acceptance, model or quantitative
policy. New studies account for prior v4 reservations toward the same USD 1.25 / 386-call caps.
Historical STOP files, results and reservations were preserved.

- `btc-benchmark-diagnostic-20260928-170635`: one explicitly requested repeat of the previously
  failed development case. Valid response, 4,782 input / 137 output tokens; it does not explain
  the original rejected values or establish reliability.
- `btc-benchmark-continuation-20260928-170716`: two valid contract probes and seven valid
  development pairs, followed by `development-averaging_window-0-conflict:current` failing with
  **CHOICE_NOT_MAXIMUM**. The selected option was not the largest probability according to the
  strict adapter guard. Reported usage survives: 4,780 input / 137 output tokens for that call.
  The paired compact reservation was retained without sending it. This attempt has 18 reservations,
  17 sent calls and 16 valid responses. Heldout and the prospective six-hour window did not start.

The official API describes `choice` as the highest-probability option:
https://docs.typesafe.ai/api . The observed failure violates that documented invariant. It is not
an empty output or evidence of an output-token limit. No response was repaired or converted to
approval. A separate, explicitly approved per-market failure policy would be required to continue
prospective purchases after malformed responses without claiming the original global-stop protocol
passed. That policy was requested from the user and was not enabled by these changes.

Controlled benchmark tests: 22 passed. Shared compilation, formatting, lint and workspace types
passed (an initial test-only tuple inference error was corrected before the diagnostic commit).
The full PostgreSQL suite then passed 469 tests with one existing opt-in skip; Node and all
Worker builds passed after granting npm cache access outside the sandbox.

An optional `invalidAnswerPolicy: "block-case"` was prepared after identifying the failure. It
remains disabled pending the user's explicit response to the policy-change question. Tests cover
no purchases in any variant for a malformed reviewed market, continued evaluation of a different
market, unknown-usage global stop, and mandatory valid contract probes. The revised controlled
suite passes 472 tests with one opt-in skip, zero failures; all workspace types, lint and formatting
pass. This is controlled acceptance, not a completed six-hour prospective study.

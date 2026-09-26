# Initial decision evaluation — September 22, 2026

## Scope

32 author-labeled synthetic evidence cases, two classification tasks per case. Each of Jev
`jev-1.13.0` and DashScope International `deepseek-v4.1-flash` received one paid request per
case, with the same evidence. The LLM used JSON mode with thinking disabled. The code baseline
always reports insufficient semantic evidence. This is not a production research-loop comparison,
a market-selection benchmark, a forecasting test, or a profitability study.

All 64 provider requests completed without errors or retries. The first four development cases
were reused from their saved results, not rerun. The remaining 12 development cases were followed
by 16 held-out cases without prompt or dataset changes. Both splits are manually constructed,
closely related behavioral controls; they do not represent independent real-world samples.

## Results

| Split       | Provider | Evidence correct | Next step correct | Both correct | Unsafe finalizations |
| ----------- | -------- | ---------------: | ----------------: | -----------: | -------------------: |
| Development | Rules    |             6/16 |              8/16 |         6/16 |                    0 |
| Development | Jev      |            14/16 |             16/16 |        14/16 |                    0 |
| Development | DeepSeek |            15/16 |             15/16 |        15/16 |                    0 |
| Holdout     | Rules    |             6/16 |              8/16 |         6/16 |                    0 |
| Holdout     | Jev      |            16/16 |             16/16 |        16/16 |                    0 |
| Holdout     | DeepSeek |            16/16 |             16/16 |        16/16 |                    0 |

Scores above use the original frozen reference labels, including the questionable label discussed
below. They have not been adjusted after inspecting predictions.

| Provider | Cases | Mean elapsed seconds | Total estimated USD |
| -------- | ----: | -------------------: | ------------------: |
| Rules    |    32 |      Less than 0.001 |                   0 |
| Jev      |    32 |               0.6694 |         0.000969444 |
| DeepSeek |    32 |               1.6896 |         0.004523100 |

Total estimated provider spend: **$0.005492544**, including the initial four-case comparison.
Jev's reference-rate cost was 4.67 times lower, with 2.52 times lower mean elapsed time.
These estimates use provider-reported usage and published Jev rates ($0.042/M input, free output)
and conservative DashScope busy-hour rates ($0.30/M input, $1.20/M output). They are not invoices;
cache and off-peak discounts can reduce DeepSeek's actual bill and narrow the cost ratio.
Timing is one sequential run per case, includes request overhead, and is not a latency guarantee.

## Disagreements and improvements

1. **`rumor-not-confirmation`: review the reference label.** The claim says a coach confirmed a
   lineup; the evidence says the coach made no statement. The frozen label is INSUFFICIENT, but
   Jev's CONTRADICTED is defensible. Its subsequent RESEARCH answer also conflicts with its own
   evidence classification under this rubric. Do not describe this as an established Jev factual
   error or silently change the old score. Clarify the annotation guideline in a future dataset.
2. **`qualified-training`: missing confirmation is not necessarily contradiction.** Jev classified
   unannounced medical clearance as CONTRADICTED rather than INSUFFICIENT. Its ABSTAIN answer
   matches the reference but conflicts with its evidence answer under the routing rubric. This
   is a concrete weakness to test with independently labeled real sources.
3. **`neutral-confirmed`: LLM false negative.** An explicit neutral-venue confirmation was
   classified INSUFFICIENT/ABSTAIN by DeepSeek. No retry or prompt repair was used.

The two Jev inconsistencies motivate a new offline consistency diagnostic. It does not alter
original answers or create a runtime fallback. Independently evaluated questions need not form
a coherent joint action. Never blindly derive a finalization from one answer to repair another;
that would turn these conservative outcomes into potential premature finalizations.

## Captured evidence and gradual adoption

Eight atomic claims from two locally saved investigations (Lions–Bills and Vikings–Bears)
were replayed against both providers, four per event, with each event in one partition. Source
text, snapshot timestamps, truncation flags and hashes were preserved. Provider inputs excluded
prior model labels, tenant configuration and credentials. These are real captured inputs, not
independently verified reporting. Assistant provisional annotations were recorded before the
calls in a separate private file; `expected` and human `review` remain null.

### Captured shadow replay: September 22, 2026

| Provider            | Completed | Failures | Internal inconsistencies | Mean seconds | Estimated USD |
| ------------------- | --------: | -------: | -----------------------: | -----------: | ------------: |
| Rules               |         8 |        0 |                        0 |       <0.001 |             0 |
| Jev 1.13.0          |         8 |        0 |                        2 |       0.8540 |   0.000561288 |
| DeepSeek v4.1 Flash |         8 |        0 |                        0 |       1.7301 |   0.003230100 |

These runs are **unscored**: agreement is not accuracy, and zero inconsistency is not proof of
correctness. The rules baseline always reports insufficient evidence; its consistency is trivial.
The eight claims represent only two events, with repeated sources, not eight independent events.
No runtime routing changed and no bets were submitted.

The providers agreed on evidence in 6/8 cases and next step in 8/8. Exact joint agreement was 6/8.
The following labels are provider responses, not adjudicated answers:

| Case                                 | Jev evidence / next     | DeepSeek evidence / next |
| ------------------------------------ | ----------------------- | ------------------------ |
| Bishop questionable                  | SUPPORTED / FINALIZE    | SUPPORTED / FINALIZE     |
| Johnson confirmed playing            | CONTRADICTED / RESEARCH | INSUFFICIENT / RESEARCH  |
| Mahogany out                         | SUPPORTED / FINALIZE    | SUPPORTED / FINALIZE     |
| Immediate settlement on postponement | CONTRADICTED / FINALIZE | CONTRADICTED / FINALIZE  |
| Murray cleared                       | CONTRADICTED / RESEARCH | INSUFFICIENT / RESEARCH  |
| Wentz third quarterback              | CONTRADICTED / FINALIZE | CONTRADICTED / FINALIZE  |
| Wentz conditional start              | SUPPORTED / FINALIZE    | SUPPORTED / FINALIZE     |
| Bears model probability              | SUPPORTED / FINALIZE    | SUPPORTED / FINALIZE     |

Both disagreements reproduce the synthetic weakness: Jev interprets incomplete confirmation as
contradiction but still requests research. The Johnson source lists him as questionable; the
Murray article describes recovery and conditional clearance. Murray's wording permits debate
about contradiction versus insufficient evidence, so human adjudication is especially useful.
The Bears percentage also merits review because attribution relies on the flattened page's
layout order. FINALIZE means finish this evidence check, never place a bet.

At the same reference rates used above, Jev cost 5.75 times less (82.6% lower), with 2.03 times
lower mean elapsed time. Captured replay cost **$0.003791388**; cumulative estimated spend across
the 32 synthetic and 8 captured comparisons is **$0.009283932**. These remain usage-based
estimates, subject to the rate and timing limitations above.

### Migration decision

Keep Jev in bounded evaluation/shadow use for now. Preserve both independent answers and flag
inconsistencies rather than deriving a FINALIZE action from its evidence label. Before a live
routing trial, broaden independently reviewed events and measure full pipeline cost, including
fallback calls and extra research. A cheap classifier can still increase total cost if it triggers
unnecessary searches. The current sample cannot establish prediction quality or profitability.

A market selector needs its own task-specific evaluation before replacement; evidence
classification results alone do not establish selector quality. Keep authorization, prices, dates,
budgets, lease checks and execution policy in deterministic code.

## Reproducibility

Private immutable attempt directories under `.data/decision-evaluation-v1`:

- `comparison-dev-live-01`: first four development cases.
- `comparison-dev-live-02`: remaining twelve development cases (`--offset 4`).
- `comparison-holdout-live-01`: sixteen holdout cases.

All three manifests have the same fingerprints:

```text
rubric:  f8dffa50d824185843af8a70079c5e918b38a6c6c47c00f04e7cc5f07a89836f
dataset: 46a139d34c4f80f0f428ea9bb645ebe20ed1322e44cb6e9bb52733f4fd1760b5
```

Run instructions and limits: [DECISION-EVALUATION.md](DECISION-EVALUATION.md).

Captured replay attempts: `captured-shadow-dev-01` and `captured-shadow-holdout-01`. Both
completed without retries using the unchanged captured rubric and dataset fingerprints:

```text
rubric:  4f2f6d9e1370275c12c62101391368f514a1366af99fb85dd2c44c6cc75b5dad
dataset: 28bf8b6e206cb7820aba399e2a5a188093d51a8f57b9e69f36797e37d7cd8920
```

## September 24: broader corpus and fallback economics

Preparation completed with **40 unreviewed cases across 10 games** (20 dev, 20 holdout), using
13 distinct source texts. Eight existing cases were retained with explicit event IDs; 32 new cases
use short official-team excerpts. The new games are Packers–Bears (January 2025), Ravens–Bengals
(Thanksgiving 2025), Seahawks–Rams (December 2025), Chargers–Chiefs (September and December
2025), Buccaneers–Falcons, Broncos–Titans, and Eagles–Cowboys (November 2025).

The public collection was retrieved on September 24, 2026. It is a retrospective reading test,
not a pregame archive. New excerpts are marked truncated, with source links and collection
provenance. Claims are authored tests; human labels remain null. No new paid model calls were
made. The short excerpts should be complemented with broader context in later evaluation.

Useful source cases include [the Chargers Week 15 report](https://www.chargers.com/news/injury-report-justin-herbert-ladd-mcconkey-chiefs),
whose paragraphs mix doubtful and out statuses, and [the Eagles Saturday update](https://www.philadelphiaeagles.com/news/cowboys-vs-eagles-injury-report-week-12-2025),
which explicitly confirms clearance. These help distinguish missing confirmation from explicit
clearance and unresolved conflicting text. The review packet preserves the selected evidence;
reviewers must assess that evidence rather than silently substituting current page content.

The offline comparison command was run on the eight previously completed captured cases. The
exploratory policy would accept six coherent Jev finalizations and consult the existing LLM for
the other two cases. It preserves all original answers.

| Strategy on the same 8 cases                          | LLM calls | Estimated classification cost USD |
| ----------------------------------------------------- | --------: | --------------------------------: |
| Existing LLM only                                     |         8 |                       0.003230100 |
| Jev plus simulated LLM fallback                       |         2 |                       0.001649988 |
| Both providers on every case, actual comparison spend |         8 |                       0.003791388 |

Simulated savings including fallback are **48.9%**, compared with 82.6% for Jev calls alone.
The simulated cascade agrees with the LLM on all eight final pairs, but the policy was selected
after viewing these cases. This is neither held-out policy validation nor proof of accuracy.
Additional research, search-provider charges and production overhead are unmeasured. The cost
comparison reuses the September 22 rate assumptions; no claim of newly verified pricing is made.
Cumulative estimated provider spend remains **$0.009283932**.

Local artifacts:

- `.data/public-decision-excerpts-v2.json`: eight new public excerpt snapshots and claims.
- `.data/captured-decision-evidence-grouped-v2.json`: prior cases with explicit event grouping.
- `.data/decision-evidence-40-v2.json` and its `.review.md`: merged review corpus.
- `.data/captured-cascade-comparison-v1.json`: paired comparison and simulated routing detail.

Next gate: independent label review, then frozen paired evaluation of the 32 new cases. Report
new cases separately from reused cases, and assess premature finalization against reviewed labels.
Live shadow routing and production migration remain unimplemented pending this evidence.

## New 32-case execution: September 24, 2026

The 32 new public-excerpt cases were submitted once to each provider (64 calls in total), using
the unchanged captured rubric and previously frozen exploratory cascade policy. None of the eight
older cases was resubmitted. Assistant provisional annotations were recorded before these calls;
the dataset's human review and expected-label fields remain null, and execution used unscored
shadow mode. The two Molden claims containing "unambiguously" require adjudication because
contradiction of that meta-claim and conflict in the underlying status are both plausible readings.
They are excluded from provisional match counts, not silently relabeled after seeing responses.

| Provider            | Calls | Valid responses | Format failures | Internal inconsistencies | Mean seconds, valid responses | Known estimated USD |
| ------------------- | ----: | --------------: | --------------: | -----------------------: | ----------------------------: | ------------------: |
| Jev 1.13.0          |    32 |              32 |               0 |                        1 |                        0.3252 |         0.001050924 |
| DeepSeek v4.1 Flash |    32 |              31 |               1 |                        1 |                        1.1800 |         0.004817700 |

Timing means have different denominators and describe this sequential experiment only. The
DeepSeek failure returned `INVALID_ASSESSMENT` on `chargers-chiefs-2025-12-14-molden-doubtful`.
The runner stopped and preserved the failure. A separate attempt sent only the seven never-started
cases; no request was retried or repaired. The failed request's billing is unknown, with a retained
admission reservation of $0.006900900. That reservation is not a known charge or guaranteed limit.

Known new estimated spend is **$0.005868624**; cumulative known estimated spend is
**$0.015152556**, plus the unknown failed-call charge. Estimates use reported usage and the
[TypeSafe model rates](https://docs.typesafe.ai/models) and
[Alibaba Singapore busy-hour rates](https://www.alibabacloud.com/help/en/model-studio/deepseek-v4-1-flash),
rechecked September 24. Discounts and caching can change billed amounts.

### Matched-case cascade simulation

There are 31 complete provider pairs and one incomplete pair. Providers agree on evidence in
26/31 and next step in 28/31. The frozen cascade would accept 23 Jev responses and use the paired
LLM response for eight, agreeing with the LLM on 29/31 final pairs.

| Strategy on the 31 complete pairs only         | Estimated USD |
| ---------------------------------------------- | ------------: |
| Existing LLM only                              |   0.004817700 |
| Jev plus simulated LLM fallback                |   0.002272956 |
| Both providers, actual paired comparison spend |   0.005834856 |

These figures exclude the unmatched Jev response and unknown failed-LLM charge. The comparator
correctly leaves overall savings null because one pair is incomplete. Research/search-provider
cost remains unmeasured. This is a counterfactual classification calculation, not production
savings, a forecast backtest, or evidence of profitability.

### Provisional quality findings

On the 30 cases without the two annotation ambiguities, Jev matches the assistant's provisional
joint labels in 27/30, DeepSeek in 25/30, and the simulated cascade in 25/30. These are **annotation
agreements, not human-validated accuracy**. Both individual models have two potential premature
finalizations relative to these provisional labels; the cascade combines their weaknesses and has
three. A coherent answer can still be unsupported, and the fallback model is not an oracle.

- **Missing temporal scope:** both models use a current-game absence to close the question about
  Higgins returning for the following game. The excerpt contains no following-game information.
- **Uncertain availability:** Jev finalizes the Adams confirmation claim from a doubtful listing.
  DeepSeek finalizes the Cox confirmation claim from a questionable listing. The Cox fallback
  would replace Jev's provisional-correct request for research with premature finalization.
- **Independent-answer coherence:** Jev returns CONTRADICTED/RESEARCH for Adkins availability;
  DeepSeek returns CONTRADICTED/ABSTAIN for Norman-Lott confirmation. The diagnostic catches
  these combinations, but it cannot catch coherent unsupported answers.
- **Abbreviations:** DeepSeek treats Vea's Friday nonparticipation claim as insufficient despite FP
  in the excerpt. Its abbreviation glossary was omitted; a future input variant should preserve
  headings and definitions rather than rely on undocumented sports knowledge.

Do not activate the exploratory cascade as a production decision gate. The next focused variant
should preserve explicit event/date scope and abbreviation definitions, clarify the conflicting
meta-claims, and evaluate the risk of fallback finalization against reviewed references. Version
any changed rubric or corpus and use fresh cases for subsequent validation. Keep this run frozen;
do not tune confidence thresholds on it and call the same cases an independent holdout.

### New run reproducibility

- `captured-new32-dev-01`: dev offset 4, limit 16; all calls completed.
- `captured-new32-holdout-01`: holdout offset 4, limit 16; stopped at the ninth LLM call.
- `captured-new32-holdout-unattempted-01`: holdout offset 13, limit 7; first attempts only.

All manifests share these hashes:

```text
rubric:  4f2f6d9e1370275c12c62101391368f514a1366af99fb85dd2c44c6cc75b5dad
dataset: 35ff766b97e493187d1ee5e5bd338dc3846ac6651959aa6a1845054981c7daa7
policy:  1df1615285770557ba37134860e8e2da434b0ec185c64618607924b987e3ec2a
```

Additional private artifacts: `decision-evidence-new32-provisional-v1.json` and `.md`,
`decision-new32-analysis-v1.json` and `.md`, and `captured-new32-cascade-comparison-v1.json`.
The analysis checks 64 unique started provider/case pairs, 63 completed records, one preserved
failure, unchanged manifests, and pre-call annotation timing. No runtime, prompts or provider
transport code changed in this execution.

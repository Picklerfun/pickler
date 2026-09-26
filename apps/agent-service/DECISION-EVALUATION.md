# Decision evaluation laboratory

This opt-in local evaluator compares a conservative code baseline, Jev, and the configured
OpenAI-compatible model on the same frozen evidence. It does not change the research runtime,
place paper/live orders, access PostgreSQL, search the web, or deploy anything.

## Dataset and comparison

`src/evaluation/decision-cases.ts` contains 32 author-labeled synthetic controls: 16 development
and 16 held-out cases, with invented teams. They cover explicit support, contradiction, conflicting
reports, missing evidence, and instructions embedded in documents. Labels require human review
before drawing quality conclusions. The holdout is a separate split, not an independently collected
dataset. Do not tune questions against holdout results.

Each provider sees only the case state and the versioned rubric, never the expected labels or split.
Two decisions are evaluated: evidence status and whether to finish reviewing, research further,
or abstain. `FINALIZE` means finish reviewing the claim, never approve an order. A contradicted
claim can be finalized. Missing/conflicting evidence needs research if the supplied budget flag
allows it, otherwise abstention. The code baseline always reports insufficient semantic evidence.

Jev receives two Choice questions in one request. The LLM receives the same criteria and returns
the two labels via JSON mode. This compares atomic classification, not the full production research
loop or its report quality. DashScope thinking is explicitly disabled, as in market selection;
other providers retain their defaults. There are no tools or retries. Jev distributions are
classification signals, never probabilities of a team winning.

## Commands

Run from the repository root. The default is offline and never loads credentials:

```sh
npm run evaluate:decisions --workspace=@pickler/agent-service -- --provider rules --split dev --limit 16 --attempt rules-dev-01
```

For a deliberate paid Jev smoke run, put `TYPESAFE_API_KEY` in the ignored
`apps/agent-service/.env`, then run:

```sh
npm run evaluate:decisions --workspace=@pickler/agent-service -- --provider jev --split dev --limit 4 --attempt jev-dev-01 --allow-paid --budget-usd 0.05 --max-calls 4
```

To compare all three, retain `MODEL_BASE_URL`, `MODEL_ID` and `MODEL_API_KEY`. Add verified
rates for that exact provider/model to the same ignored file. Do not copy example prices:

```dotenv
EVAL_LLM_INPUT_USD_PER_MILLION=<verified maximum applicable input rate>
EVAL_LLM_OUTPUT_USD_PER_MILLION=<verified maximum applicable output rate>
EVAL_LLM_PRICE_SOURCE=https://<official-provider-pricing-page>
```

For `deepseek-v4.1-flash` on the international Singapore DashScope endpoint, the
[official model page](https://www.alibabacloud.com/help/en/model-studio/deepseek-v4-1-flash)
listed maximum busy-hour rates of $0.30 input and $1.20 output per million tokens on
September 22, 2026. Those values are suitable conservative estimates for that exact configuration;
off-peak and cache discounts can make actual billing lower. Reverify before later runs or after
changing providers. Do not use DeepSeek's direct-API prices for Alibaba-hosted calls.

```sh
npm run evaluate:decisions --workspace=@pickler/agent-service -- --provider all --split dev --limit 4 --attempt comparison-dev-01 --allow-paid --budget-usd 1 --max-calls 8
```

`--provider llm` runs only the configured LLM. `--offset 4 --limit 12` selects the remaining
development cases without repeating the initial four. `--split holdout --limit 16` evaluates the separate
holdout after freezing improvements. Paid runs require all four explicit controls: a unique attempt
label, `--allow-paid`, `--budget-usd`, and `--max-calls`. The limit counts cases; max-calls counts
paid requests across providers. Nothing contacts providers at application startup or in CI.

## Costs and failure handling

Jev is pinned to `jev-1.13.0`, at the published September 22, 2026 rate of $0.042 per million input
tokens and free output. Confirm [current pricing](https://docs.typesafe.ai/models) before running
later experiments. LLM rates are operator supplied; cache discounts are not assumed.

Before each request, admission reserves a conservative estimate using serialized request UTF-8
bytes plus 4,096 input tokens of overhead, and up to 4,096 LLM output tokens. This is an admission
estimate, **not a provider-enforced dollar cap**. Provider tokenization, billing changes, and hidden
overhead can differ. Use a provider-side spending cap when a hard billing limit is required.
Reported usage determines the recorded cost estimate; missing usage is never treated as free.
The run stops if reported cost exceeds its reservation, or on any provider/validation error.
An ambiguous request retains its reservation, has unknown actual billing, and is never retried.

Requests time out after 180 seconds. SIGINT/SIGTERM abort active fetches. A started record is
written before network I/O; an interrupted attempt is never automatically resumed. Attempt
directories are exclusively created, so rerunning the same label cannot overwrite prior results.
Use a new label only for a deliberate new experiment after reviewing the existing attempt.

## Results and interpretation

Results are private local files under `apps/agent-service/.data/decision-evaluation-v1/<attempt>`:

- `manifest.json`: synthetic cases, expected labels, rubric/version, dataset and rubric hashes,
  and requested limits. Expected labels stay in this artifact, not model inputs.
- Per-request records: requested/returned model, request hash, usage, rates, duration, validated
  labels and Jev distributions. Failure records contain only reviewed error codes, no raw provider
  messages, reasoning, credentials or response bodies.
- `summary.json` and `report.md`: planned/attempted/completed counts, per-task and joint matches,
  unsafe finalizations, known estimated cost, and per-case results. Compare matched cases when
  a run stops early; incomplete runs are not evidence that one provider is better.

Review disagreements manually. A lower-cost incorrect decision is not a saving. Change one rubric
or state-preparation choice at a time, bump the rubric version, and retest development cases.
The initial dataset establishes neither statistically reliable accuracy nor profitable forecasts.
Subsequent work should add independently labeled captured evidence and prospective forecasts;
repeat simulations of one event do not count as additional independent events.

Protocol reference: [TypeSafe API](https://docs.typesafe.ai/api).

## Captured evidence preparation

`prepare:decision-evidence` imports local saved research exports with `{run, events: {events}}`.
It reads only explicit capture paths, selects source records, and never contacts a database or
provider. It does not export tenant identifiers, configuration, tokens, or previous model answers.
Captured text remains private under ignored `.data`; the output is exclusively created.

Create a selections JSON array with one atomic claim per item:

```json
[
  {
    "id": "player-availability",
    "runId": "00000000-0000-4000-8000-000000000001",
    "split": "dev",
    "claim": "The final report lists the player as unavailable.",
    "sourceIds": ["replace-with-a-source-id-from-the-capture"],
    "canResearch": true
  }
]
```

The identifiers above are placeholders. `canResearch` is a stipulated evaluation condition, not
a claim about the original run's remaining monetary budget. From the repository root:

```sh
npm run prepare:decision-evidence --workspace=@pickler/agent-service -- --capture .data/saved-run.json --selections .data/selections.json --output .data/captured-review.json
```

Workspace commands resolve these relative paths from `apps/agent-service`. Repeat `--capture`
to select sources from multiple exports. The command writes JSON plus `<output>.review.md` with
claims and captured source text for manual review. It leaves `expected` and `review` null. Do not
copy old model judgments into the expected answer. A reviewer must fill both fields, for example:

```json
{
  "expected": { "evidence": "SUPPORTED", "next": "FINALIZE" },
  "review": {
    "reviewer": "reviewer-name",
    "reviewedAt": "2026-09-22T12:00:00Z",
    "rationale": "The named source explicitly lists the player as unavailable."
  }
}
```

This is an example, not a completed review. Graded execution refuses unreviewed datasets before any
provider request, including for the offline baseline. Run graded evaluation after every case has been reviewed:

```sh
npm run evaluate:decisions --workspace=@pickler/agent-service -- --dataset .data/captured-review.json --provider rules --split dev --limit 4 --attempt captured-rules-01
```

Use the same paid flags and rates as above for Jev/LLM comparison. `--limit` must fit the selected
partition (maximum 16 cases per invocation). The importer checks snapshot timestamps, exact source
content hashes, duplicate IDs and source provenance. Events, markets and identical source texts
cannot straddle dev/holdout splits. It refuses ambiguous versions of a selected source instead of
silently choosing one. Captured inputs use the separate `1.0.0-captured` rubric; scores measure
textual support, not external truth, prediction quality, or profitability.

The evaluator now also records `consistencyReview` per completed result and `consistencyReviews`
in the summary when evidence status and next-step answers contradict the routing rubric. This is
a diagnostic only: neither answer is repaired, no extra call is made, and runtime behavior is
unchanged. Historical artifacts remain immutable.

See [the initial 32-case results](DECISION-EVALUATION-RESULTS.md) before enabling any runtime use.

## Unscored captured replay

Use `--shadow` with `--dataset` to compare responses before human labels are available. This is
an offline replay of captured evidence, not a production shadow integration. Provenance, snapshot
and partition checks still apply. The mode deliberately suppresses all grades, including when the
input contains reviewed labels. Summaries record `mode: "shadow-unscored"`, `graded: 0`, and null
accuracy/unsafe-finalization counts; null means unmeasured, not zero errors. Costs, durations,
failures and internal consistency flags remain measurable. Provider agreement is not accuracy.

```sh
npm run evaluate:decisions --workspace=@pickler/agent-service -- --dataset .data/captured-review.json --shadow --provider rules --split dev --limit 4 --attempt captured-shadow-rules-01
```

Paid providers require the same explicit budget, call limit, attempt, and rate settings described
above. Assistant annotations must remain separately identified as provisional; never record them
as human review. Broaden independent events and establish reviewed labels before a migration gate.

## Broader public corpus and cascade comparison

`--public-collection <path>` is an alternative to `--capture`/`--selections`. Its JSON has
`kind: "public-excerpt-collection"` and `snapshots`. Each snapshot records `snapshotId` (UUID),
`eventId`, `observedAt`, `split`, source records with the existing source fields, and `claims`
(`id`, `claim`, `sourceIds`, `canResearch`). Keep source excerpts faithful, mark `truncated: true`,
and use the actual collection time. `publishedAt` may be null when a timestamp cannot be verified.
Do not backdate collection to publication or represent a public snapshot as a model investigation.

Existing research selections optionally accept `eventId`. Assign it consistently across different
markets for the same game. The validator checks event IDs in addition to run, market, snapshot
and source-content grouping. Old datasets remain readable; absent event IDs are reported as gaps,
not counted as independent events.

```sh
npm run prepare:decision-evidence --workspace=@pickler/agent-service -- --public-collection .data/public-decision-excerpts-v2.json --merge-dataset .data/captured-decision-evidence-grouped-v2.json --output .data/decision-evidence-40-v2.json
```

The September 24 corpus has 40 cases, 10 explicit events, 13 distinct source texts, and 20 cases
per split. Eight cases were previously evaluated; the remaining 32 are new excerpt tests.
All reference labels remain unreviewed. Historical 2025 pages collected now are retrospective
text tests, not a forecast backtest. Excerpts intentionally omit context, so insufficient evidence
applies to the supplied text only. The preserved 2026 captures exercise longer context. The old
holdout cases have already been inspected and are not a fresh holdout for a revised policy.

After paired runs, compare their saved results without spending on new calls:

```sh
npm run compare:decisions --workspace=@pickler/agent-service -- --attempt .data/decision-evaluation-v1/captured-shadow-dev-01 --attempt .data/decision-evaluation-v1/captured-shadow-holdout-01 --output .data/captured-cascade-comparison-v1.json
```

Output is exclusive; use a new output filename for a deliberate subsequent analysis. This command
reads no environment credentials, contacts no providers and changes no existing artifact. It
rejects incompatible rubric/dataset hashes and duplicate provider results. Missing pairs are
reported and suppress overall savings estimates rather than treating unknown costs as zero.

The exploratory cascade accepts only coherent Jev evidence plus FINALIZE; all other answers use
the paired LLM response. The policy was chosen after examining the pilot, so these simulated
results are exploratory. Report actual paired experiment spend separately from hypothetical
Jev-plus-fallback cost. Neither includes measured downstream research cost. LLM agreement is not
reference accuracy and an LLM fallback is not guaranteed correct. No deployment gate has passed.

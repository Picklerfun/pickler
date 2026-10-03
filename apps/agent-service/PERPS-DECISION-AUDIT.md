# Perpl decision circuit audit

This local, read-only audit explains recorded actions without another evaluation, provider request,
model call, migration or order. It preserves historical proposals, reservations, costs and omissions.
It does not change SMA, prompts, Jev thresholds or risk policy.

## Commands

Build shared exports first with `npm run build:shared`. From `apps/agent-service`:

```sh
node --import tsx src/evaluate.ts audit-export --config /absolute/private/study.json --env-file /absolute/private/study.env --diagnostics /absolute/private/data-diagnostics.jsonl --output /absolute/private/new-export
node --import tsx src/evaluate.ts audit --state /absolute/private/new-export/audit-export.json --output /absolute/private/new-audit
```

Both output directories must be new, with an existing parent. Export parses only DATABASE_URL
from the selected private environment; it never populates process.env. Only loopback PostgreSQL
is accepted. Diagnostics are optional and allowlisted, with a 32 MiB limit. Missing diagnostics
remain unavailable. No command permits `--allow-paid`.

`audit` requires only an explicit export and output directory. It rejects environment and study
configuration options, and loads no database, dotenv, provider transport or model adapter. The
normal evaluator composition is imported lazily so the CLI does not defeat this separation.

Export format 1 (`perps-decision-audit-export-v1`) contains the study, scoped accounts, attempts,
movements and safe diagnostics. A repeatable-read, read-only transaction obtains a consistent
snapshot, without calling paper.view(), which can recover expired attempts. The packet records
export commit, source paths, diagnostic content hash and canonical SHA-256 payload hash. Hashes
check integrity, not independent verification of the source's truth.

Analysis format 1 (`perps-decision-audit-v1`) produces audit.json, audit.csv and audit.html with
original study metadata, export and analyzer commits. Repeating analysis of the same packet at
the same commit produces identical outputs. CSV cells are protected against spreadsheet formulas;
HTML escapes recorded text. Suspicious secret fields cause refusal instead of an unsafe export.

## What can be verified

The portable trading analyzer reuses validatePaperFrame, perpsRules, perpsJevDecisions,
perpsJevReviewed and simulatePerpsFill. It checks each slot/asset/variant, original timestamps,
hourly candle continuity and closure, SMA values, stored Jev distributions, original DeepSeek
reasons, conversions, final frames and execution events. Exported attempts supply persisted fill
references; when original inputs exist, fill evidence is replayed and compared.

Model state is transformed by the same pure perpsModelState function used by the runtime. It is
labelled as a current transformation of recorded context, not the original HTTP request bytes.
A request hash and byte count cannot reconstruct missing request bytes or prove their contents.
Missing context, responses, final frames and execution-time risk/account state remain explicitly
NOT_VERIFIABLE. No later observations fill historical gaps. A historical hold is a valid policy
choice only when the response and replay support it; that does not prove economic optimality.

Omission diagnostics use only the twenty-second interval preceding the matching persisted event.
This is time correlation, not a request-ID join. Untimestamped HTTP diagnostics cannot establish
which request failed, its duration, or a transport root cause.

## Recorded study: perps-four-20261002

The original code commit is 97b47ad69dbf06e105198e3b01cf8fce861f9c3f. Eight slots were scheduled:
seven contain model calls; six completed execution. Slot 4 was omitted before models, and slot 7
was omitted during the shared execution refresh after model calls. The omission is operational,
not an abstention or a comparable zero return.

The export showed 56 matching policy conversions across the seven recorded rounds, including
42 model-variant asset decisions, all hold. No converted action was improperly discarded. Jev
selected UNSUPPORTED; its long/short support probabilities were below 0.70. DeepSeek's recorded
reasons describe insufficient evidence/edge, and the combination's own DeepSeek proposal was
already hold; a reviewer veto did not turn an opening into hold. These are observed choices,
not explanations of unobservable model reasoning.

Each asset has two distinct sets of sixty closed hourly candles. Repetition within an hour is
expected; the set advances at the next hour. A repeated set is not evidence of stale one-minute
data: this frozen protocol explicitly supplies hourly candles. SMA's broad trend and the models'
shorter-term descriptions need not produce the same action.

The preceding diagnostics show BTC ticker/book skew of 18 seconds for slot 4 and 12 seconds
for slot 7, above the frozen five-second limit. Repeated timestamps were followed by stale-data
codes; ETH had a valid one-second pair. A ticker update near the first deadline still left an
18-second mismatch with the book. No valid joint BTC/ETH set was obtained within twenty seconds.
The provider's internal publication/cache cause and individual request timing are not established
by the available diagnostics. Thresholds remain unchanged.

No demonstrated live data-selection or action-conversion defect was found. This change adds
inspection and regression coverage; it does not retroactively “correct” the historical decisions.
Potential changes to candle horizon, decision criteria or data transport require a separate plan.

## Controlled acceptance

`test/perps-audit.test.ts` runs the real coordinator, PostgreSQL repositories and simulator with
controlled model adapters. It demonstrates BTC longs, ETH shorts and closes in all three model
variants; replays stored fill evidence; detects conversion divergence and bad data; and verifies
invalid final ETH data prevents execution in every account without erasing completed usage.

The strict offline CLI test forbids database/provider/environment modules during analysis, with
invalid credentials present. It verifies deterministic JSON/CSV/HTML and tamper rejection. Scope
isolation and repeated read-only export are tested against isolated PostgreSQL. Existing four-way
tests cover exact thresholds, conflicting support, uncertainty, material veto and strict runtime
responses. These tests are controlled circuit validation, not decisions made by real models or
evidence of profitability.

## Delivery validation

Code tested: 3869205eaf92cc1ed69b42a9470b6335cc5656da, stacked on the open PR #80.
Main was verified at fed9524418c4257a175983c08c0dc3f6360ae64f. Its unrelated advice integration
is excluded from the audit diff. Documentation-only commits follow the tested code commit.

- Full root PostgreSQL/controlled suite: 2,340 passed, zero failures, three optional skips.
- Root format, lint and types: passed.
- Shared packages and Node agent-service build: passed.
- API, research, trading and indexer Worker dry-run builds: passed; nothing deployed.
- Final read-only export payload SHA-256: f1948e48a0e64cb67757ca25876acba2b2eedd8ef776e96b0ccc333bda2310c6.

The final payload hash equals the preliminary export before the tests, confirming the exported
historical study, accounts and diagnostics remained unchanged. Private artifacts are deliberately
untracked. The final analyzer report contains 64 rows, 56 matching conversions, zero divergences,
42 model holds, six complete slots and two documented omissions. Historical missing request bytes
and execution-time risk state remain unverifiable rather than reconstructed.

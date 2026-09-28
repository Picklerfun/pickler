# Evaluator v2: explicit context and evidence-backed fallback

This is an isolated laboratory in `apps/agent-service`. It does not change runtime routing,
research tools, databases, deployments or trading. The v1 reader and historical attempts remain
available. No provider calls run at import, preparation or offline preflight.

## Files and contracts

- `src/evaluation/v2/context.ts`: strict v2 envelope around unchanged v1 case text and provenance,
  explicit target/document event and date (nullable), sourced glossary, deterministic 800-character
  fragments and review fingerprints. Fragment offsets refer to JavaScript string positions.
- `provider.ts`: original two-question controls and five-question v2 adapters; model identity,
  usage, response schema and fragment validation. Context, instructions and policy have separate
  versions. Original validated answers and Jev distributions are stored before policy routing.
- `policy.ts`: conservative closure checks and at most one blind backup. Both providers must cite
  an existing fragment with a known matching event/date and coherent answers. Known mismatches,
  Jev-reported mismatch and unresolved Jev conflict veto backup closure. Unknown scope cannot
  establish closure. Existing citations establish provenance, not semantic correctness.
- `ledger.ts` and `runner.ts`: exclusive request reservations, one sequential request per variant,
  no retry/repair, persisted failures and a fixed campaign ledger across attempts.
- `report.ts`: paired variant and event tables; separate full experimental accounting from
  strategy cost, reusing the same Jev v2 response in the cascade. Search cost stays unmeasured.
- `src/prepare-decisions-v2.ts` and `src/evaluate-decisions-v2.ts`: explicit operator commands.

Every unresolved result proposes RESEARCH or ABSTAIN according to `canResearch`; neither runs a
search. A malformed response, transport failure, cancellation or budget failure stops the batch.
An unknown fragment in a provider response is a format failure, not a reason to repair the answer.
No backup sees a reference label, reviewer rationale or Jev answer. Metadata and document contents
are untrusted evidence, not instructions. A model can still misinterpret valid evidence; only the
jointly reviewed references measure that failure.

## Review before evaluation

The private candidate packet contains 12 cases selected from the 40 already observed and 32 new
cases, four per event across eight other events. All 40 historical event IDs are excluded from the
holdout. Development includes prior uncertain-availability errors, future-game extrapolation,
practice/status confusion, competing Molden statuses and positive controls. Historical source
text is preserved. New excerpts are retrospective public captures, not pregame research captures.
Publication timestamps without verified timezone information remain null.

The candidate packet is **not frozen or human reviewed**. Unknown historical dates/document scope
must be verified or retained as unknown. The two historical Molden questions and the new Eagles
report/promotion scope question require joint adjudication or replacement. Do not label an
assistant proposal as human review or use model results to settle these references.

From the repository root, prepare explicit v1 input plus annotations:

```sh
npm run prepare:decisions:v2 --workspace=@pickler/agent-service -- \
  --dataset apps/agent-service/.data/v2-combined-input.json \
  --history apps/agent-service/.data/decision-evidence-40-v2.json \
  --annotations apps/agent-service/.data/v2-annotations.json \
  --output apps/agent-service/.data/decision-v2-review-next.json
```

Annotations are keyed by case ID, each with `context` and `proposal: {assessment, rationale}`.
Preparation writes a new JSON and a full `.review.md` with sources, exact fragments and hashes.
It always clears v2 review fields. Use a new output name; existing files are never overwritten.
Review the complete packet together. Resolve or replace ambiguous claims, regenerate the packet,
then record the actual human reviewer, review time, rationale and displayed `approvedHash` in each
case's `review`. `reviewHash` covers original case, context and proposed reference; edits invalidate
approval. This is an operator attestation, not authenticated identity verification.

Offline validation needs neither keys nor price configuration:

```sh
npm run evaluate:decisions:v2 --workspace=@pickler/agent-service -- \
  --dataset apps/agent-service/.data/decision-v2-review.json --phase dev
npm run evaluate:decisions:v2 --workspace=@pickler/agent-service -- \
  --dataset apps/agent-service/.data/decision-v2-review.json --phase holdout
```

## Paid execution after joint review

Before execution, verify current primary-provider model availability and prices. Supply a private
JSON with `checkedAt` (ISO timestamp within seven days), and `jev` and `llm`, each containing
`model`, `input`, `output` (USD per million tokens), and HTTPS `source`. Jev is pinned to
`jev-1.13.0`, with the currently configured laboratory rates of 0.042 input / 0 output; if current
rates differ, stop and revise the implementation before calling. The LLM model must equal the
explicit `MODEL_ID` in the app's ignored `.env`. No prices or model availability were revalidated
by the offline preflight. Price verification is an operator attestation, not an automated lookup.

The existing `TYPESAFE_API_KEY` and `MODEL_API_KEY` are read only for explicit paid runs. Do not
place credentials in the dataset, review packet or price file.

```sh
npm run evaluate:decisions:v2 --workspace=@pickler/agent-service -- \
  --dataset apps/agent-service/.data/decision-v2-reviewed.json \
  --phase dev --attempt dev-01 \
  --prices apps/agent-service/.data/v2-verified-prices.json --allow-paid
```

Then use `--phase holdout --attempt holdout-01` with the same frozen dataset, models and rates.
Optional `--offset` and `--limit` select unattempted cases, never repeat started requests. A later
attempt may continue only previously unattempted cases; missing comparisons remain visible and
prevent acceptance. The fixed `.data/decision-evaluation-v2` campaign freezes dataset, instructions,
policy, endpoint and model/rate configuration across both phases. Reverification timestamps may
change without changing rates or models. A retained `.lock` after a crash requires inspection;
never silently delete it or reset the ledger to make room for another run.

The campaign admits at most 176 started calls and USD 0.50 in additional accounted spend. It also
includes historical v1 charges and unresolved reservations against the overall USD 1.00 ceiling.
Failed calls with unknown charges retain their full reservation. Reservations are conservative
estimates, not a provider-enforced invoice cap; over-reservation actual usage stops subsequent work.
Four strategies need three shared primary calls per case and zero or one conditional LLM backup.

## Reports and acceptance

Each unique attempt writes its manifest, JSON summary and Markdown table. Original validated
answers, usage, costs and failures are stored in exclusive per-request records; policy records
retain the selected citation text and decision reason. Provider error bodies are not persisted.
Tables show completed/missing comparisons, failures, reference matches, premature/correct closures,
unresolved cases, backup calls, total latency and completed-result strategy cost by variant/event.
The summary includes experimental accounting and unknown-charge reservations, which must not be
added to strategy cost or treated as zero-cost failures. Latency totals are observed sequential
request durations, not projected concurrent throughput.

Only a complete, jointly reviewed 32-case holdout with known costs can pass: zero premature
closures, at least baseline joint matches, at least 80% of baseline correct closures, and at least
20% lower classification cost including backup. A zero baseline closure or cost denominator is
ineligible. Passing only permits proposing shadow observation; it establishes neither autonomous
betting readiness nor profitability.

## Local verification

```sh
node --import tsx --test apps/agent-service/test/decision-v2.test.ts \
  apps/agent-service/test/decision-evaluation.test.ts \
  apps/agent-service/test/captured-evidence.test.ts \
  apps/agent-service/test/decision-comparison.test.ts
npm run typecheck --workspace=@pickler/agent-service
npm run lint
npm run build --workspace=@pickler/agent-service
```

These evaluator tests use controlled transports and temporary local files, not live providers.
The broader service suite additionally requires its existing PostgreSQL integration environment.

## Explicitly delegated review

When the user delegates the remaining review and execution, full-case reviews may carry
`kind: "assistant-delegated"`, an `authorization` string, the assistant reviewer identity and the
usual hash/time/rationale. This permits the authorized laboratory comparison without representing
assistant inspection as human review. Reports count the review kinds separately; any delegated
holdout reference prevents the original human-reviewed pilot acceptance gate from passing.
Historical review records without a kind retain their original meaning. A label-only approval is
not a full context review. Published-rate estimates remain distinct from an actual provider invoice.

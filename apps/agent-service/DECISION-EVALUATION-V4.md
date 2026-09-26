# Evaluator v4: selective backup and safe diagnostics

This is an explicitly authorized new laboratory revision after the stopped v3 batch. It never
resumes or retries that batch. V1–v3 records and code remain intact. There is no production routing,
database, deployment or trading change.

## Frozen behavior

Model instructions and versions remain those of v3. Policy `4.0.0` preserves every v3 closure and
conflict check. It skips backup only when Jev returns INSUFFICIENT, the appropriate RESEARCH or
ABSTAIN for `canResearch`, MATCH, no conflict, and NONE citation. Inconsistent answers remain
eligible subject to the existing vetoes. This can miss a useful recovery when Jev incorrectly
reports uncertainty; fresh evaluation measures that tradeoff. No search is executed.

`src/evaluation/v4/diagnostics.ts` records only an allowlisted stage, numeric HTTP status, content
byte count and normalized finish reason. It distinguishes transport, HTTP, outer JSON and model
content JSON failures without retaining provider content, headers or error messages. Successful
JSON can still fail the existing strict assessment/model/usage parser. There are no repairs or
retries. These diagnostics cannot retroactively determine the cause of the earlier generic error.

## Bounded experiment

`evaluate:decisions:v4` runs one separate synthetic format diagnostic, then twelve newly frozen
retrospective excerpt cases across three previously unused events. Full reference/context review
is assistant-delegated under the user's authorization, never recorded as independent human review.
The small sample is not the original 32-case/eight-event acceptance experiment; it contains no
unresolved source-conflict pair. Those mechanics remain covered by controlled tests.

The CLI verifies disjoint event IDs against the entire old corpus, loads frozen references before
model calls, and requires an error-free diagnostic before the fresh phase. It allows at most 37
new calls in the worst case. V2, v3 and v4 together remain capped at 176 calls and USD 0.50 additional
accounted spend, with v1 also counted toward USD 1.00. All unknown charges remain reserved. Each
reservation rereads the prior ledgers under the shared execution lock. Any v4 failure stops all
further v4 execution. Phase directories and started requests cannot be overwritten.

Costs are published-rate estimates rather than invoices. Reports count previous unknown charges
against overall acceptance, even if the new sample completes. Report variant `llm-format-v3` keeps
the v3 control instructions; `jev-v4` uses the unchanged v3 model questions, while `cascade-v4`
adds policy 4.0.0. Raw Jev classification does not establish an admissible citation-backed closure.

## Commands

Use absolute input paths when invoking npm workspace commands. Offline validation:

```sh
npm run evaluate:decisions:v4 --workspace=@pickler/agent-service -- \
  --dataset /absolute/path/to/decision-v4-frozen-01.json --phase diagnostic
```

Explicit authorized paid execution additionally supplies `--prices /absolute/path/to/prices.json`
and `--allow-paid`. Run `--phase fresh` only after a successful diagnostic. Do not repeat a started
phase or reinterpret a new revision as permission to reset the shared budget.

Private snapshots, the frozen delegated review packet and rate verification live under `.data`;
execution records and per-event reports live under `.data/decision-evaluation-v4`.

Run evaluator tests, service type checking, root lint/format checks and the service build. The new
suite covers uncertainty suppression, retained backup eligibility, conflict vetoes, stage redaction,
no retries and cross-revision budget enforcement. Offline fixtures establish mechanics only.

# Decision observation

This opt-in integration captures completed local research for a separate Jev-first evidence
classification comparison. It never replaces the forecast, overrides core policy, changes a
paper result or places an order. Cloudflare hosts do not enable it. No migration is required.

## Capture from the real research flow

In `apps/agent-service/.env`, configure the exact tenant and agent to observe:

```dotenv
JEV_OBSERVATION_MODE=capture
JEV_OBSERVATION_DIRECTORY=.data/decision-observations
JEV_OBSERVATION_TENANT_ID=the-existing-tenant-id
JEV_OBSERVATION_AGENT_ID=the-existing-agent-id
```

Absent configuration or `JEV_OBSERVATION_MODE=off` disables capture. Rebuild shared packages
and restart the local host after changing these settings. This does not authorize starting or
resuming a research session. Existing research permissions, leases, configuration versions and
research budgets still apply. Capture itself needs no Jev credential and makes no paid calls.

The shared model adapter snapshots the sources and quotes supplied to its tool-free finalizer.
Core publishes an observation only after successfully persisting its final decision. Failed runs
are not reconstructed. The callback receives cloned data, so it cannot mutate the stored decision.
Capture failures produce a sanitized local diagnostic and do not enter the research failure path.
The local worker awaits the file write; there is no detached background task or paid observer in
the critical research path.

Immutable files appear under `captures/`. They preserve scope/configuration version, market
rules, observation time, original source text and hashes, publication/capture dates, truncation,
quotes, the primary decision, numeric usage and prompt hashes. URLs lose query strings/fragments;
credential-bearing URLs become null. Provider usage blobs, profiles and credentials are excluded.
Source text is not silently truncated to fit: oversized captures fail separately. Hashes detect
changes, not authenticity or semantic correctness. Keep this directory private and untracked.

## Select claims before querying models

Create a private selections file with the capture's hash and explicit, preferably atomic factual
claims. Do not convert TRADE/ABSTAIN into evidence labels and do not use a forecast as a fact:

```json
{
  "captureHash": "COPY_THE_CAPTURE_HASH",
  "claims": [
    {
      "id": "player-availability",
      "claim": "The named player is confirmed available for the target match."
    }
  ]
}
```

Optional `context` uses the existing v2 shape: `target`, `documents`, and `glossary`. Each event
has nullable `eventId`/`date` and a `provenance` array of `{sourceId, note}`. Supply one document
entry for every captured source. Known metadata needs source-backed provenance. Without explicit
annotations, dates/event identity stay null; a market closing time is not inferred to be a match
date. Context annotations are operator assertions, not automatically verified semantic facts.

Every selected claim receives **all** captured documents, including contradictory sources. The
preflight rejects empty/oversized evidence, duplicate IDs and evidence dated after the snapshot.
It uses stable v2 fragments, v3 questions and v4 policy. `canResearch` is false because the primary
run has finished; observation cannot buy searches. Quotes and the primary decision are preserved
for inspection but are not injected into this document-only classification task. Claims about
prices or primary strategy quality require a different evaluator.

From `apps/agent-service`:

```sh
npm run observe:decisions -- prepare --directory .data/decision-observations \
  --capture .data/decision-observations/captures/CAPTURE.json \
  --selections .data/observation-selections.json
```

This command performs offline validation only. No models, database or web searches are called.

## Paid observation admission

Paid observation is an explicit separate operation. Before using it, verify the exact model IDs
and tariffs with the provider, obtain an approved remaining budget, and record a private campaign
manifest with these fields:

| Field                    | Meaning                                                                    |
| ------------------------ | -------------------------------------------------------------------------- |
| `schemaVersion`          | `1`                                                                        |
| `authorization`          | Reference to the actual user authorization; never fabricate it             |
| `maxUsd`, `maxCalls`     | Total campaign ceilings, including carried-forward accounting; no defaults |
| `priorUsd`, `priorCalls` | Already-accounted experimental spend/reservations and started calls        |
| `jevModel`               | Pinned `jev-1.13.0`; unsupported versions fail closed                      |
| `llmModel`, `llmBaseUrl` | Exact configured DeepSeek identity and HTTPS endpoint                      |
| `ratesVerifiedAt`        | ISO timestamp of the operator's tariff verification                        |
| `jevRates`, `llmRates`   | `{input, output, source}` in USD per million tokens with rate provenance   |

The initial pilot enforces at most USD 0.50 and 176 calls **including** `priorUsd`/`priorCalls`.
Carry all relevant previous reservations forward rather than treating this as a fresh allowance.
Only one observation campaign may consume that remaining authorization; do not initialize another
directory to bypass limits. This local ledger is not a distributed account budget. Runtime capture
can be enabled without initializing any paid campaign. `maxUsd=0`/`maxCalls=0` allows no paid work.
Input rates must be positive; unknown rates cannot be represented as zero. These conservative
reservations and token-derived costs are estimates, not invoice guarantees.

```sh
npm run observe:decisions -- init --directory .data/decision-observations \
  --campaign .data/observation-campaign.json
npm run observe:decisions -- run --directory .data/decision-observations \
  --capture .data/decision-observations/captures/CAPTURE.json \
  --selections .data/observation-selections.json --approve-paid
```

Only `run` loads `.env`. It needs `TYPESAFE_API_KEY` and `MODEL_API_KEY`; configured `MODEL_ID`
and `MODEL_BASE_URL` must exactly match the immutable campaign. No keys are persisted in requests.
Each claim makes one control classification with the current model and one Jev classification.
The Jev answer is reused by v4 policy. At most one blind DeepSeek backup is made, conditionally,
with the same evidence and claim but without the primary decision, control result, Jev response
or reference labels. There are no automatic retries or format repairs.

Cases, started requests, completed answers/usage and policy results are saved separately. A
single-writer lock, exclusive case/request IDs and immutable campaign prevent overlapping work or
silent replay. Unknown charges retain their reservation; interruption does not make them free.
Any provider, format, storage, budget or cancellation failure stops the batch. `STOP.json` blocks
later invocations; creating it with `{}` also stops new calls in the current batch. Sent requests
can still incur charges. Stale locks and pending reservations require operator inspection; never
delete them automatically. Do not retry a started claim in a new directory.

## Read results

```sh
npm run observe:decisions -- report --directory .data/decision-observations \
  --capture .data/decision-observations/captures/CAPTURE.json \
  --selections .data/observation-selections.json
```

Reports preserve per-case answers, chosen original fragments, versions, per-event paired agreement,
closures/unresolved cases, failures, backup calls, latency and estimated costs. Experimental spend
includes control + Jev + actual backup. Strategy cost includes Jev + backup only. Primary research
cost and extra research cost remain unmeasured, never zero. Pending/incomplete comparisons suppress
savings claims. Agreement is not correctness: accuracy, correct/premature closure counts and the
original acceptance gate remain unscored until independently reviewed references exist.

## Paper-study boundary

The separate paper-study laboratory is not the production research runner and is not automatically
instrumented by this hook. Coordinate an adapter against its persisted pre-decision evidence and
model snapshot after its own changes are integrated. Do not resume a stopped study, rerun searches,
substitute later quotes, rewrite original results, or treat a manual fixed-side virtual control as
an agent recommendation. The current integration is ready for new local research-runner captures;
it does not claim that Jev was used by earlier paper studies or by deployed Workers.

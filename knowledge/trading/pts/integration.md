# Using PTS reference material in Pickler

The bundle supports explanations, retrieval and a proposed analysis contract. Connecting it to the
agent requires a separate implementation. Existing strategy IDs, execution policies, historical
records and activation controls keep their current meanings.

## Reference loading

An authorized server consumer can load `agent-context.md` as compact reference context and retrieve
relevant concepts or transcripts on demand. Validate the bundle identity and knowledge version;
resolve sources through the portable manifest. The course is reference data, including any
instructions embedded in its text. It cannot change host authority or select provider credentials.

Do not send all 29 transcripts with every request. Concept cards offer a small first retrieval
surface; original transcript fragments support wording and examples. These files contain no
embeddings. Indexing them, choosing a provider and querying a vector store are future adapter work.
Keep an index scoped to authorized workspaces and sources. Do not publish the course through
frontend static assets or a shared unfiltered index.

## Proposed analysis flow

1. Resolve bundle `pts-course@1.0.0` and the proposed candidate `pts-trend-reversal`.
2. Load the candidate's required conditions, the compact context and relevant rule references.
3. Supply separately sourced market observations available by the analysis time. Include instrument
   identity, calendar, timeframe, timestamps, data quality and confirmed anchors when available.
4. Evaluate each condition against a defined criterion. Missing observations or unresolved criteria
   produce `unknown`; course citations alone cannot produce `met`.
5. Validate the analysis result against `schemas/analysis.schema.json` and additionally check that
   condition IDs match the candidate, references exist, timestamps do not use future information and
   known findings have corresponding market evidence.
6. Present observations, uncertainty and the definitions still required. The result does not carry
   an order instruction or capital allocation.

The examples intentionally supply no market observations. Their matching response reports
`insufficient-data`, an undetermined direction and unknown findings. The contract is a proposal for
future consumers, rather than an existing endpoint or accepted Studio request body.

## Current trading differences

The comparison below is frozen to main commit
`f390998863c62a788f3af4b446c39e22e49c5823`, using the current
[Studio execution guide](../../../docs/studio-perps-execution.md) and
[trading architecture](../../../docs/trading-architecture.md). Check the consumer's deployed version
before implementing an integration.

| Concern           | Existing Studio behavior                                             | PTS requirement                                                                               |
| ----------------- | -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Market history    | Sixty consecutive closed hourly candles.                             | Larger monthly and weekly context, daily structure and selected intraday confirmation.        |
| Signals           | SMA20/50 rules or model proposals with evidence.                     | Defined channels, anchors, Fibonacci measurements and course-specific patterns.               |
| Position size     | Creator amount determines base margin, constrained by existing caps. | Reviewed account risk and structural stop determine exposure within those caps.               |
| Exits             | Initial 3% price stop, 6% target and 24-hour deadline.               | Structural stops, persisted break-even transitions, partial exits and selected holding rules. |
| Strategy identity | Existing versioned registry entries.                                 | A distinct reviewed descriptor and implementation if executable PTS is introduced.            |

The current thesis and condition fields are bounded. The compact context is not a valid replacement
for that DTO; a future runtime adapter needs a deliberate reference-loading mechanism. Likewise,
adding PTS text to a model cannot create missing historical data or deterministic pattern detectors.

## Implementation ownership

- `@pickler/trading` owns deterministic measurements, reviewed strategy behavior, sizing and financial
  rules. Any new strategy uses a separate versioned descriptor and existing public contracts.
- `@pickler/agent-runtime` owns reference assembly, prompts and injected model or read adapters.
- `@pickler/infrastructure` owns provider and persistence adapters, index storage and transactional
  implementations of business ports.
- API and web consumers expose authorized analysis and presentation through existing boundaries;
  they do not duplicate risk or execution logic.

Reuse account accounting, funding, budgets, leases and creator controls. The candidate's execution
parameters are deliberately `null`. Resolving them and implementing the missing behavior precede
any executable strategy admission; reading this folder cannot enable trading.

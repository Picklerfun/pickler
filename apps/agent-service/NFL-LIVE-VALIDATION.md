# NFL research validation — 2026-09-17

## What failed and what changed

The original delivery's first synthetic evaluation returned JSON but failed `INVALID_RESEARCH_REPORT`; its rejected assessment was overwritten by error handling. That original artifact cannot establish the exact violated rule.

A deliberate reproduction preserved the assessment and demonstrated `INVALID_RESEARCH_REPORT_ATTRIBUTION`: identity, schedule and rules were marked supported with empty citations. Market/quote data were supplied, but lacked consistent citable references. Core now supplies section-scoped context references, separate from retrieved sports sources. Unknown references and unsupported claims still fail.

The first real follow-up run, `d63789fe-3008-4f81-9c79-1d9ea42be7e5`, exposed a second mismatch: a quote section cited both the actual books and market metadata identifying the outcomes. Allowing market identity in that section, while requiring an observed-book citation, corrected the mismatch. The saved assessment passes offline replay against the corrected validator. The failed database record remains failed; no historical result was overwritten.

Two additional defects were corrected: sports tool names were missing from diagnostic allowlists, and NFL schema paths were redacted as unknown. Report attribution failures now retain a safe schema path without source values or provider text.

The positive synthetic control also revealed that normal future execution risk and absent optional feeds were being listed as missing material facts. Research prompt 3.2.0 and NFL decision prompt 1.2.0 distinguish those limitations from unresolved facts affecting a forecast. Policy thresholds are unchanged. The evaluator now supplies both outcome books and complete synthetic settlement rules, preserves failed assessments, and distinguishes technical validity from expected-action agreement.

## Real persisted research

Both successful runs used the configured `deepseek-v4.1-flash` model at DashScope International with actual Exa and Polymarket calls. No model was changed. BALLDONTLIE and The Odds API remained disabled; no keys, hidden calls or substitute providers were added. Results live in local Supabase's private `pickler.runs` and `pickler.events` tables, not `public` or Mastra's storage.

| Tenant / selection          | Run ID                                 | Market                        | Duration  | Result                          |
| --------------------------- | -------------------------------------- | ----------------------------- | --------- | ------------------------------- |
| alpha / automatic discovery | `6fc5831a-f05d-448c-bc7f-5a4845986652` | Lions vs. Bills (`3398287`)   | 127.014 s | Completed, decision v3, ABSTAIN |
| beta / manually selected    | `5aa87c5e-a261-41c8-9878-80ec270ce39a` | Vikings vs. Bears (`3482612`) | 159.125 s | Completed, decision v3, ABSTAIN |

Alpha forecast Buffalo at 0.67, range 0.60–0.74, against an observed ask of 0.69. Beta forecast Chicago at 0.65, range 0.60–0.70, against an observed ask of 0.66. Both declined for insufficient estimated price advantage and retained the forecast, sources, counterevidence, coverage and limitations. These are subjective model estimates, not validated probabilities or profitability claims.

Alpha retained 15 distinct source IDs including market rules and cited all 15. Beta retained 16 and cited 13. Original source URLs, dates and truncated content remain in events; execution references are separately recorded. Alpha retrieved an official Detroit team injury report through Exa alongside favorable and contradictory reporting.

Reported model consumption, summing selection once plus research/finalization once:

| Run   | Input tokens | Output tokens | Total tokens | Reasoning tokens (included in output) |
| ----- | ------------ | ------------- | ------------ | ------------------------------------- |
| alpha | 73,978       | 16,305        | 90,283       | 10,630                                |
| beta  | 85,021       | 21,431        | 106,452      | 16,332                                |

Do not add `model_diagnostic` or `model_step_usage` counters again to these totals. Provider usage is not a monetary-cost guarantee. Both runs used research prompt 3.1.0 / NFL decision 1.1.1; the later material-fact clarification is evaluated separately below and recorded in future runtime snapshots.

The final local API returned 200 for each owner's run and events, and 404 when the other tenant requested either resource. Scheduling remains disabled. The sequential Node worker processed these runs one after the other; this validation does not claim a new concurrency load test.

No valid live TRADE was produced, so no live paper order was requested. Controlled paper-order regression tests still cover fills and rejection paths. No real orders, wallets, subscriptions or remote deployments were used.

## Controlled model evaluation

Local ignored artifacts retain every deliberate attempt. The first corrected six-case pass returned valid reports in all six cases, with five matching expected actions. Its positive control proposed TRADE but was policy-blocked by fixture incompleteness and the material-fact ambiguity described above. An explicit intermediate positive-control run isolated the remaining `MISSING_INFORMATION` issue.

The final `material-facts-20260917` ledger uses the complete synthetic fixture context and final prompts. All six cases returned valid reports and matched their expected actions. The positive control produced a policy-approved TRADE; all five negative controls produced ABSTAIN. Synthetic evidence never enters live research and proves neither real-world calibration nor profitable trading.

| Final fixture            | Final action | Duration  | Reported model tokens |
| ------------------------ | ------------ | --------- | --------------------- |
| `clear-edge`             | TRADE        | 69.263 s  | 20,558                |
| `no-edge`                | ABSTAIN      | 88.345 s  | 19,869                |
| `injury-unknown`         | ABSTAIN      | 91.580 s  | 25,818                |
| `contradictory-evidence` | ABSTAIN      | 110.473 s | 23,861                |
| `incomparable-odds`      | ABSTAIN      | 77.525 s  | 19,681                |
| `untrusted-instructions` | ABSTAIN      | 110.301 s | 22,220                |

This follow-up used 14 explicitly initiated synthetic case evaluations across diagnostic/final ledgers and three real investigations (one preserved failure, then two completions). This count excludes the original delivery's earlier failed evaluation. No model-call retry, silent model change, or automatic repetition of failed research was added. The final six-case pass tests the final prompts; it is not a statistical reliability estimate.

## Reproduce and inspect

```sh
npm run dev:agent
npm run agent -- result alpha 6fc5831a-f05d-448c-bc7f-5a4845986652
npm run agent -- events alpha 6fc5831a-f05d-448c-bc7f-5a4845986652
npm run agent -- result beta 5aa87c5e-a261-41c8-9878-80ec270ce39a
```

These result commands are read-only. Starting another research or evaluator is an explicit potentially paid operation; neither runs on startup. See [the evaluation instructions](NFL-RESEARCH.md) and [the provider assessment](NFL-SOURCES.md).

## Engineering checks

- 113 controlled tests passed on isolated PostgreSQL databases and on local Supabase.
- Formatting, ESLint, all workspace types and the Node/Next/Mastra production builds passed.
- Both Cloudflare background and HTTP-probe bundles passed `wrangler deploy --dry-run`; nothing was deployed.
- Existing manual-paper tests cover full fills, insufficient depth, fees, duplicate requests, plugin revocation and reservation loss. A live paper fill remains conditional on a valid live TRADE; neither successful research produced one.

The real-run evidence proves the research flow works with the current provider configuration. It does not establish a zero-error rate, independent forecast calibration, optional sports-provider connectivity or profitability.

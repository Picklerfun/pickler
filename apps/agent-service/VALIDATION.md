<!-- historical-evidence -->

> Historical validation record: refers to the implementation and runs described below,
> before the trading-package extraction (integration baseline `8f37f1f`). Not current
> operating instructions. See [Evaluation operations](EVALUATIONS.md).

# Pilot validation record

PostgreSQL migration verified locally on 2026-09-16. This records engineering verification, not research quality or profitability.

| Boundary                       | Evidence                                                                                                                                                                                                                                                  |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Persistence                    | Real PostgreSQL 17 in Docker; Drizzle migrations applied to isolated databases for each integration test                                                                                                                                                  |
| Migration command              | `npm run db:migrate` applied the initial migration and completed again without duplicating tables                                                                                                                                                         |
| Schema drift                   | `npm run db:generate` reports no schema changes after the committed migration                                                                                                                                                                             |
| Automated tests                | 28 passing tests covering tenant HTTP isolation, Mastra tool/structured output fixtures, provider contracts, PostgreSQL quotas/idempotency, simultaneous claims and schedules, exclusive database worker ownership, recovery, citations and quote refresh |
| Mastra storage                 | `@mastra/pg` initialized the separate `mastra` schema and returned workflow storage against local PostgreSQL                                                                                                                                              |
| Static checks                  | Repository ESLint, formatting and workspace type checks pass                                                                                                                                                                                              |
| Build                          | Shared ESM packages, Next.js and Mastra build successfully without provider credentials                                                                                                                                                                   |
| Supabase hosted connection     | Pending operator project connection URLs; local PostgreSQL verification does not claim a hosted Supabase deployment                                                                                                                                       |
| Paid providers / full research | Pending operator credentials; no real model/Exa connection check or full real-evidence decision is claimed                                                                                                                                                |

The previous SQLite revision was also checked in Studio on 2026-09-15: the public-category/preset workflow and live read-only Polymarket categories, discovery, market rules/tags and order books worked. Those historical checks do not establish that the new Supabase deployment is configured. Test transports remain fixtures only, and no paid calls run in automated tests.

The runtime now uses a PostgreSQL session advisory lock instead of a local file lock. One worker owns recovery and processes jobs serially. The database adapter separately tests safe concurrent admission, quota enforcement, claims and schedule deduplication. Multiple active research workers remain outside this pilot's recovery model.

To complete acceptance, follow the README: configure Supabase direct/session connection URLs and provider values, apply migrations, start Studio, select categories, run the paid connection check, and complete a manual research workflow. A justified, source-backed abstention is valid. Enable scheduling only afterwards. Existing SQLite files are preserved but not automatically imported.

## Local Supabase verification

On 2026-09-16, Supabase CLI 2.111.0 started the full local stack using project `pickler-monorepo` and ports 54521/54522/54523. Drizzle migrations applied successfully; all 28 tests passed against this Supabase PostgreSQL instance. The Mastra adapter wrote, loaded and deleted a workflow snapshot in its separate schema. Studio returned HTTP 200. Both laboratory agents were seeded without model/provider calls. The ignored app `.env` contains local database URLs and generated tenant tokens; model and Exa values remain empty.

The first image download was interrupted when Docker stopped responding; reopening Docker and retrying completed successfully. The Supabase stack is left running for operator inspection. Hosted Supabase and paid-provider acceptance remain pending.

## Versioned prompt verification

The research and market-selection instructions are separate versioned modules. The extraction preserves the research text byte-for-byte. The 29-test suite passes against local Supabase, including exact system-prompt metadata/hash checks, user-profile separation in actual Mastra request payloads, and prompt snapshots persisted before provider calls and on failed started runs. Snapshots include full instructions and use existing JSONB runtime events; no migration is needed. Historical runs are not backfilled.

## First live provider check and sports investigation

On 2026-09-16, the configured `deepseek-v4.1-flash` model at DashScope passed the actual tool-call and structured-decision probes. Exa search and page reading passed, and the public Polymarket category API returned 100 entries. This supersedes the earlier pending connection-check status, but not full research acceptance.

The live check exposed JSON-mode compatibility requirements: requests must explicitly mention JSON, and the OpenAI-compatible adapter does not transmit a native JSON Schema by default. Prompt version 1.0.1 includes the output schema in the instructions; diagnostic fixtures also include it. Runtime validation remains enabled and no model fallback was introduced.

The operator selected Sports (verified Polymarket tag ID 1). Alpha configuration version 2 uses that category with scheduling disabled. One manual run, `725b1217-483c-4791-9508-8e995715d4bd`, persisted runtime prompt snapshots and candidates, then failed before selection completed with `PROVIDER_OR_MODEL_FAILURE`. It has no decision and is not a valid abstention. The existing generic failure code does not establish the precise model failure cause; model-stage diagnostics need improvement before another paid attempt. The run was not automatically retried. Full research acceptance and scheduling remain pending.

The 29-test Supabase suite passes after the compatibility change. Tests now require JSON instructions and explicit schema requirements in the configured research prompts and structured connection probe. Offline fixtures still do not establish a completed live research run.

## Market selector isolation and regression coverage

An isolated replay of the saved sports candidates on 2026-09-16 succeeded with the unchanged configured model: HTTP 200 and a validated selection, with 1,091 reported output tokens including 986 reasoning tokens. This does not identify the historical failure cause or constitute a full research run. It exposed a stale closing date being described as future.

The runner now excludes expired, boundary-time, missing and invalid closing dates; rechecks manual/selected markets and final trade refreshes; and passes its clock to selection. Prompt version 1.0.2 references that clock. Safe model diagnostics retain stage, status, finish reason and numeric usage when available. Regression fixtures cover truncation, malformed structured output, HTTP failures, timeout/cancellation, metadata redaction and preservation of partial evidence. No additional paid research run or scheduling activation is part of this correction.

Validation: all 38 tests pass against local Supabase. Repository lint, format and type checks pass, and the full Next.js/Mastra build succeeds. The selector transport fixture also verifies an actual Mastra HTTP 429 is preserved as `MODEL_HTTP_429`.

## Selector reasoning control

The explicitly requested full retry `8b867c96-741a-4499-b058-8581f08068e8` failed in selection with `MODEL_OUTPUT_TRUNCATED`: 2,000 output tokens, all reported as reasoning, and no decision. DashScope selection now sends `enable_thinking: false`; research retains its provider default and the 2,000-token cap is unchanged. An isolated real selector call with saved eligible candidates succeeded with 125 output tokens and zero reasoning tokens. This verifies selection only; no new full research run is claimed. All 38 tests pass, including transport assertions that the setting is present only on selection requests.

Provider reference: [DashScope thinking controls](https://www.alibabacloud.com/help/en/model-studio/deep-thinking).

## Research output allowance

Run `e2469799-b136-4074-8bbf-79564dd35a2e` passed selection, read market rules and quotes, performed three Exa searches and two page reads, and then failed in research with `MODEL_OUTPUT_TRUNCATED`. Its final model call reported 2,000 output tokens, all reasoning. Partial evidence remains stored; no decision was produced.

The research cap and default are now 8,000 tokens per call in core and API validation. Selection remains capped at 2,000 with DashScope reasoning disabled; research retains provider-default reasoning. The existing alpha agent was updated through the authenticated versioned API to configuration version 3, outputTokens 8,000, Sports category 1 and scheduling disabled. Historical run snapshots remain unchanged. Existing beta configuration was not modified. This setting lives in versioned agent configuration, not `.env`.

All 39 tests, lint, format, type checks and the full build pass. The service was restarted and the persisted alpha configuration was read back successfully. No paid investigation with the higher limit was launched as part of this configuration change.

## Model request timeout

Run `4725915c-7a82-43ea-a73d-c557d76cc48b` used the 8,000-token research cap and preserved three searches (15 results) and three page reads. A successful research step reported 4,839 output tokens, but a later call failed with `MODEL_TIMEOUT`; the run ended after approximately 166 seconds without a decision.

Individual model requests now allow 180 seconds instead of 60. The existing incoming cancellation signal and five-minute overall research deadline still take precedence. All 40 tests pass against local Supabase, including a transport test that observes the 180-second timeout and verifies caller cancellation propagation. No paid retry is included in this timeout change.

## Follow-up PR live run

After opening PR #3, the authorized run `989d2de5-9191-4c3f-b06b-58e12789e16b` researched market `608546` (Vinicius Junior winning the 2026 Ballon d'Or). Selection, market rules/quotes and three Exa searches completed, preserving 15 search results. The run failed after approximately 110 seconds with `MODEL_OUTPUT_TRUNCATED` in research, not a timeout. Its final call consumed 8,000 output tokens, all reported as reasoning, and returned no final decision. Aggregate research output was 9,827 tokens across calls; it must not be confused with the per-call limit. No page reads were completed. The five-minute deadline, 180-second request timeout and 8,000-token cap were not changed or automatically retried after this result. Full live research acceptance remains incomplete.

## First completed live investigation

On 2026-09-16, run `b2274788-b4f6-4d88-86b7-f3b6cd644c96` completed in 104.229 seconds using alpha configuration version 4 (32,768 research output tokens). It researched market `608546`, asking whether Vinicius Junior will win the 2026 Ballon d'Or, and persisted a research-only `TRADE` proposal for Yes at observed/limit price `0.001`. No order was submitted.

Verification read the saved result and events: all 10 cited source IDs exist in retrieved Exa results, three searches include both supporting and contradicting intents, resolution rules were fetched, and the final ask equals the saved observed price. No page-reader calls occurred; evidence came from search content. The model reported high uncertainty. This demonstrates end-to-end execution and attribution, not independent verification of every factual claim, probability calibration or profitability. The proposal's seven-day expiry also needs product-policy review before any execution capability is considered.

Research reported 80,193 input tokens and 9,233 output tokens across five steps, including 7,846 reasoning tokens. Its final call used 3,997 output tokens, so this success alone does not prove the larger cap was necessary or eliminates variability. Selection usage is recorded separately. Scheduling remains disabled. This completes the first live manual research acceptance through the HTTP/worker path; a full Studio-triggered investigation and hosted deployment remain unverified. Earlier failed runs are preserved unchanged.

## Decision v2 and deterministic uncertainty policy

New research outputs are model assessments; only core creates final decision v2. Conservative defaults block HIGH uncertainty, reported missing material information, probability ranges wider than 0.2, and lower estimates that fail to exceed the worse of refreshed ask and proposed limit by more than 0.01. The original proposal is preserved, and the final verdict records policy version, effective settings, reason codes and evaluation time. Missing probabilities lead to policy abstention; malformed ranges and provider failures remain execution failures.

All 51 tests pass against local Supabase, including a Vinicius-like regression (TRADE proposal retained, final ABSTAIN), positive and boundary cases, policy customization, malformed output, model-policy field injection rejection, JSONB persistence and cross-tenant isolation. Historical decision/config fixtures remain unchanged and readable. Lint, format, types and the full build pass.

The rebuilt service returns HTTP 200 for Studio. Alpha now has config version 5 with explicit conservative policy settings and scheduling disabled. Its historical successful v1 decision was read before and after the update and verified unchanged. No SQL migration or historical backfill was performed. No paid research run with prompt 2.0.0 was launched; live generation of the new assessment schema remains unverified. Probability ranges and uncertainty labels are model estimates, not calibrated statistical guarantees.

## Live decision v2 validation

On 2026-09-16, authorized beta run `4822e490-610c-41fe-ad9d-28666564f152` completed in 69.227 seconds using Sports category 1, a 32,768-token research allowance and the conservative uncertainty policy. This supersedes the preceding pending live-assessment status. Alpha had reached its rolling quota and was not modified or retried.

The selected market was `4182979`, asking whether Club Atlético de Madrid vs. CA Osasuna would end in a draw. The model proposed `TRADE` for Yes with probability estimate 0.22, subjective range 0.19–0.26, MEDIUM uncertainty and five missing-information items. The observed ask and proposed limit were both `0.19`; the refreshed ask matched the persisted observed price. Core produced final `ABSTAIN` with `MISSING_INFORMATION` and `INSUFFICIENT_CONSERVATIVE_MARGIN`. The lower estimate equals the price and therefore fails the required margin of more than 0.01.

The saved result passes `decisionV2Schema` validation. Structural comparisons confirm that its original `modelAssessment` and `policyEvaluation` match their separately persisted evidence events. Policy version `1.0.0`, effective settings and evaluation time are present. All eight cited source IDs occur in the retrieved results from three Exa searches; no page-reader calls occurred. Market rules, initial quotes and final quote were preserved. This verifies attribution and the execution path, not independent accuracy of each source or probability calibration.

Using alpha's token to request beta's run and evidence returned HTTP 404 for both endpoints. Scheduling remains disabled and no orders were submitted. This verifies live decision v2 through the authenticated HTTP/worker path against local Supabase; Studio-triggered execution and hosted deployment remain unverified.

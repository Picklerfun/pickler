# Studio perpetual execution

This guide describes the version 2.0.0 product consumer of the
[common trading architecture](trading-architecture.md). It is virtual paper execution only.
The historical [PR #87 specification](specs/perpl-paper-runtime-v1.md) documents an earlier
implementation, not current operating instructions. Advice and laboratory protocols are separate.

## Strategy and setup

Every agent selects `rules`, `deepseek`, `jev` or `combined` at `2.0.0`. Missing selection resolves
`combined@2.0.0` without enabling execution. A setup save increments configuration version,
records its selection and disables scheduling until preparation succeeds for that version.

Hourly checks require explicit scheduling, validated connections and a complete successful manual
Studio v2 check for the current configuration version. Listing a due agent is not authorization:
the database revalidates readiness when queuing and claiming the check, reserving USD, starting
each paid call and increasing exposure. Revoked queued checks finish as skipped without a lease.
Manual preparation remains available with scheduling disabled. Disabling scheduling blocks new
hourly calls and openings, while started usage can settle and owner closes and public exit
supervision continue. No strategy, tariff or activation default changes with these checks.

Successful, complete manual Studio v2 completion records the current connection-validation
marker under the same ownership transaction. The generic research probe is not required for
Perpl. Studio Controls exposes explicit hourly activation through the existing schedule endpoint;
runtime availability and publication alone do not turn it on. The shared schedule policy uses
Perpl's authorized markets instead of binary sports categories.

See [controlled acceptance](studio-acceptance.md) for the compiled web/API/Queue/PostgreSQL
journey, external-provider fixtures, independent cash oracle and remaining real-provider limits.

- Rules reuse SMA20/50 over closed hourly candles, with the existing strict 0.1% boundary. They
  call no models or paid sources. Authored entry/exit/prohibition conditions are rejected; Studio
  offers an explicit clear-conditions save. The thesis can remain.
- DeepSeek uses one direct proposal with complete brief findings and existing references.
- Jev uses atomic direction/thesis and per-condition evidence questions. Support retains the
  existing 0.7 threshold. Unknown conditions cannot establish an entry or an authored exit.
- Combined obtains its own direct proposal, then Jev's material review. Existing 0.9 material
  veto semantics remain; ordinary uncertainty is not a veto. No other account's answer is reused.

Version 1.0.0 registry entries, laboratory prompts and both persisted evaluation protocols keep
their previous interpretation. Atomic answer measures are not financial probabilities.

## Evidence, execution and protection

Trading prepares sixty consecutive closed hourly candles, ticker/book evidence and authorized
sources. Frames keep original provenance, a thirty-second freshness limit and five-second skew
limit. Source bodies and the creator brief are untrusted data, not transport instructions.
The strategy receives immutable evidence and its own account, never repository/execution access.
Invalid evidence, references or model usage fails the check without repair or retry.

Execution refreshes the complete authorized-market package after models and reconciles funding
again before opening. The creator's per-operation amount is the fixed base margin, subject to
available funds, leverage, day/open caps, pause, approval and small-entry controls. Models cannot
choose probabilities, size, leverage or execution prices. Required exits run before strategies
and on final observations; an opposite signal closes without reopening in the same check.
New positions use a 3% stop, 6% target and 24-hour deadline with the existing Studio leverage clamp.
Books and exact decimal paper services determine fills, fees and actual margin. Approved increases
use the actual margin already opened, preserving the creator's cap.

Funding uses the existing block eligibility, event identity and estimated quantity/index/rate
formula. Unknown or disputed funding blocks additional exposure; no missing history implies zero.
Public minute supervision reconciles valuation/funding and closes required exits under an unpaid
agent lease even while paid decisions are disabled. A busy agent is skipped until its owner
finishes. Failed public reads preserve limitations; exits cannot guarantee prices across gaps.
Owner closes use stored account/network identities, so a later configuration edit cannot strand
an old position. Neither observation nor execution is an exchange-margin guarantee.

Every product financial mutation checks tenant, agent, session, network, configuration version
and lease ownership inside the same transaction. Paid checks additionally require their active
USD reservation. Creator caps and unknown costs are checked again before increasing exposure.
Interrupted checks retain started calls and financial attempt keys; recovery never repeats them.

## Internal USD policy and activation

Default `PERPL_RUNTIME_ENABLED=false` remains. A separate reviewed `PERPS_RUNTIME_POLICY_JSON`
is required for decision admission. There are no enabling default tariffs or limits. Its fields:

| Field                                | Meaning                                                                                 |
| ------------------------------------ | --------------------------------------------------------------------------------------- |
| `version`                            | `1`, internal cost-policy format, separate from strategy versions                       |
| `enabled`                            | Explicit operator admission after review                                                |
| `reviewedAt`                         | Review timestamp in ISO format                                                          |
| `perOperationMicros`, `perDayMicros` | Explicit positive USD limits per agent, integer micro-USD strings                       |
| `forecast`                           | Optional reviewed `baseUrl`, `model`, `inputMicrosPerMillion`, `outputMicrosPerMillion` |
| `jev`                                | Optional reviewed `model`, `inputMicrosPerMillion`, `outputMicrosPerMillion`            |
| `searchMaximumMicros`                | Optional explicit maximum per enabled paid source call                                  |

Only adapters required by the selected strategy may run. Forecast configuration must exactly
match Research's `MODEL_BASE_URL`/`MODEL_ID`; its credential remains `MODEL_API_KEY`. Jev uses
`PERPS_JEV_API_KEY`, independently of advice. Permitted web evidence uses `EXA_API_KEY`; a missing
enabled source is a failure. Store the policy privately in the Research Worker runtime environment,
not frontend variables or build-time configuration. Do not copy credentials to a different host.

All required model/search maxima are reserved before any paid transport. Call rows precede the
request and retain provider/model/prompt versions, original request hash, bounded usage and times.
Known token usage is priced with frozen reviewed rates; unknown charges retain their maximum and
block subsequent agent admissions across days. Public supervision and reducing owner actions
continue. Budgets are separate from advice, laboratory campaigns and virtual AUSD.

`PostgresPerpsCheckCostStore.reconcileCall` is a trusted operator-only method, not an API route.
It requires the original request hash, verified billing/usage evidence, a failed terminal check
and no active agent owner. It prices against the original plan, records immutable reconciliation
evidence and never repeats the request. Charges beyond the original reservation require explicit
incident investigation; they cannot be silently admitted.

Infrastructure owns appended migration 0028. Apply it through the normal reviewed migration
process before deploying this composition. Migration 0027 and historical records are unchanged.
This change does not apply remote migrations, deploy, enable execution or authorize paid tests.

## API, results and controlled validation

Existing workspace-protected checks, actions, positions, proposals and record routes remain.
Their generated OpenAPI comes from route metadata and portable schemas, exported by
`npm run api:openapi -- --output /tmp/pickler-openapi.json`.
New `strategyResult` documents use `studio-perps-check-v2`, with strategy attribution, per-market
proposal/references/brief findings/execution, mandatory exits, funding status and completeness.
Legacy percentages appear only when actually stored in historical decisions. Virtual financial
metrics and USD model costs are separate; unknown costs remain null.

Build shared packages before consumers. Run strategy/model controlled tests, PostgreSQL runtime
and owner-action suites, root tests, types, lint, format, architecture, OpenAPI and shared/service/
Worker builds. Studio uses shared presentation tokens and the design harness. Controlled providers
and disposable local databases establish compatibility and fencing, not live-provider reliability,
profitability, deployed readiness or permission to execute real orders.

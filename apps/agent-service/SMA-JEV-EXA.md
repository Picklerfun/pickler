# SMA, Jev and Exa comparison

Local protocol perps-sma-jev-exa-v1, config v4. Three independent 1,000 AUSD virtual portfolios,
two hours, eight fifteen-minute BTC/ETH slots. No real orders, signing, DeepSeek, deployment,
automatic repeats, resume or changes to deployed agents.

| Arm         | Opening policy                                             | Exits                                                                 |
| ----------- | ---------------------------------------------------------- | --------------------------------------------------------------------- |
| rules       | Original hourly SMA20/50, strictly above 10 bps separation | Original SMA invalidation and conservative 1x risk, four-hour maximum |
| sma-jev     | Own SMA proposal with Jev material veto                    | Same deterministic exits                                              |
| sma-exa-jev | Own SMA proposal, same Jev questions with Exa news         | Same deterministic exits                                              |

The session's two-hour admission end causes exits within at most fifteen minutes of grace.
Only openings are reviewed. Jev cannot create trades, change direction/size/risk or block exits.
Veto requires selected CONTRADICTED probability and confidence both at least 0.90. These related
answer measures are not financial profit probabilities. Uncertainty is recorded, not approval.
This experiment checks material contradictions; it is not an economic support classifier.

Shared initial evidence, own portfolios, one common final BTC/ETH set after both review branches.
Validate every frame before any execution. Initial holds/vetoes cannot become openings; changed
directions are blocked. Independent simulations do not consume liquidity between arms. Risk
exits precede strategy proposals and prevent reopening that asset in the same slot. Preserve
rest-paced-20s-v1, provider timestamps and existing public request/coherence limits.

## Paid admission and evidence

The operator approved both providers for this comparison. An explicit technical ceiling retains
at most USD 0.50 in new reservations including checks. Authorization-hash admission serializes
all phases: at most 27 calls, including nine Exa searches and eighteen Jev reviews. Skip paid
work when no opening is proposed. Never retry or start extra sessions to obtain more calls.
The finite ceiling accommodates every frozen call; it changes no other protocol budget.

Preserve historical reservations and unknown costs. The old database is unavailable; local
reports do not reconstruct its ledger and historical total may be null. Never claim a new
database resets the original campaign. New unknown usage retains reservation and stops admission.

[Jev pricing](https://docs.typesafe.ai/models): pinned jev-1.13.0, USD 0.042/million input,
output free. [Exa pricing](https://exa.ai/pricing): auto search USD 0.007/request before possible
contents costs. Exa reservation is USD 0.05/call; record reported costDollars.total separately
from Jev tokens. API USD and virtual AUSD are distinct; no invented conversion or double charging.

One Exa auto search per opening round, up to five text results, publication window from 24 hours
before initial evidence through that evidence time. Exclude and record undated/future/older
results. Bounded text is untrusted data. The Exa arm alone has explicit searchWeb/plugin permission,
rechecked before/after access. Persist sources, review distributions, usage and pre-transport hashes.

## Unified CLI

From apps/agent-service, with explicit configuration, private environment and new output paths:

```sh
node --import tsx src/evaluate.ts prepare --config STUDY_JSON --env-file PRIVATE_ENV --output NEW_DIRECTORY
node --import tsx src/evaluate.ts preflight --config STUDY_JSON --env-file PRIVATE_ENV --output NEW_DIRECTORY
node --import tsx src/evaluate.ts validate --allow-paid --config STUDY_JSON --env-file PRIVATE_ENV --output NEW_DIRECTORY
node --import tsx src/evaluate.ts run --allow-paid --config STUDY_JSON --env-file PRIVATE_ENV --output NEW_DIRECTORY
node --import tsx src/evaluate.ts stop --config STUDY_JSON --env-file PRIVATE_ENV --output NEW_DIRECTORY
node --import tsx src/evaluate.ts report --config STUDY_JSON --env-file PRIVATE_ENV --output NEW_DIRECTORY
```

Private loopback DATABASE_URL, TYPESAFE_API_KEY and EXA_API_KEY are required for paid operations;
no forecast/trading key. Read-only report/status use exportPerpsAudit, no provider calls or clients.
The runner updates JSON/CSV/HTML every minute. No new monitor/automation is created.

Validate is one-shot synthetic input through the real runner, repository and simulator, using
two paid Jev calls and one paid Exa search. Retain actual Exa results separately; exclude them
from synthetic price evidence. Check controlled openings and deterministic closures. This is not
live economic validation. Preserve its exclusive STARTED marker and failed consumption. Live run
requires passed checks with the same frozen commit/config; no retries or silent prompt adjustments.

Prepare/test first, durably stop original SMA admissions and let the existing runner close its
positions and reconcile funding. Verify lease release and preserve its partial results. Start
three fresh portfolios together. Previous historical profit is context, not a paired control.

Public data unavailable before execution omits the entire slot without repeating models. Technical
provider/usage errors stop openings in all arms and allow only deterministic exits for fifteen
minutes. Ownership/persistence loss aborts immediately. Reports expose original proposals, final
gates, vetoes, fills, fees, funding, virtual net P&L, tokens and API costs. Unknown/pending values
remain explicit. Two hours check the circuit and give exploratory evidence, not profitability.

## Validation record

The implementation passed 83 controlled and local PostgreSQL regression tests, workspace type checks, lint, the architecture check and shared/Workers consumer builds. Provider fixtures made no paid calls. The real single contract check and prospective run are separate operator artifacts; build success does not establish provider acceptance.

## Authorized recovery after interruption

`evaluate resume --allow-paid` requires `operator-resume.json` beside the report, containing `sessionId`, `approved: true`, the operator's `statement` and a unique recorded timestamp. This is an explicit trusted operator action, never automatic. It schedules only slots after the last attempted slot against a fresh clock, preserving the original start, prior end and interruption in an event. Completed or omitted slots and paid calls are never replayed. Existing positions first undergo fresh public risk and funding observation, including original holding limits. No budget, tariff, prompt or strategy changes are permitted. Partial execution or unknown consumption requires reconciliation rather than resume. The report labels continuation as a discontinuous sample.

A process failure records an interrupted terminal state when relinquishing its own lease. This administrative status write cannot touch another owner's session and does not authorize any execution after lease loss. macOS idle-sleep prevention does not prevent clamshell sleep; keep the lid open during the local run.

Recovery validation passed 86 controlled/local PostgreSQL tests, including untouched-slot scheduling, unknown-cost refusal and stale-owner fencing; workspace types, lint, formatting, architecture and shared/Workers builds also passed without paid test calls.

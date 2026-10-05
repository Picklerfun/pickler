# Local SMA entry ablation

`perps-sma-ablation-v1` uses configuration version 3. It compares `sma-hourly`,
`sma-multiframe`, and `sma-direction` in three independent 1,000 virtual AUSD accounts.
It never constructs model/signing clients or reserves model calls. Historical budgets and
studies retain their original meaning. Public Perpl traffic remains subject to existing permissions.

Hourly entries select 1h explicitly and require a SMA20/50 gap strictly greater than 10 bps.
Multiframe entries retain historical 1.1.0. Direction entries remove only the activity magnitude
hurdle; known costs, depth, directional momentum, sizing, fees, funding and risk remain required.
All variants use common exits: risk first, invalidated hourly trend, adverse 5m momentum, or
30-minute holding age. A close prevents reopening that asset in the same cycle.
This hourly arm is not a full replay of the old historical strategy.

## Commands

Run from `apps/agent-service`, using Node 22.22+ after `npm run build:shared` from the root:

```sh
node --import tsx src/evaluate.ts prepare --config /absolute/new-study/study.json --env-file /absolute/new-study/database.env
node --import tsx src/evaluate.ts preflight --config /absolute/new-study/study.json --env-file /absolute/new-study/database.env
node --import tsx src/evaluate.ts run --config /absolute/new-study/study.json --env-file /absolute/new-study/database.env
node --import tsx src/evaluate.ts report --config /absolute/new-study/study.json --env-file /absolute/new-study/database.env
node --import tsx src/evaluate.ts stop --config /absolute/new-study/study.json --env-file /absolute/new-study/database.env
```

`database.env` contains only `DATABASE_URL` for loopback PostgreSQL. No model, trading or
signer credentials are needed. `settle` is a read-only report projection for this protocol;
only the original runner observes funding and performs deterministic exits. `validate`,
paid overrides, acquisition overrides and resume are rejected.

Example configuration (proposed values; preparation creates dedicated agents):

```json
{
  "version": 3,
  "protocol": "perps-sma-ablation-v1",
  "tenantId": "perps-lab",
  "sessionId": "sma-example",
  "network": "mainnet",
  "hours": 6,
  "acquisitionPolicy": "rest-paced-20s-v1",
  "strategyVersion": "sma-ablation-v1",
  "entryPolicyVersion": "sma-ablation-entries-v1",
  "exitPolicyVersion": "multiframe-common-exits-v1"
}
```

## Frozen execution and failure handling

Commit all code before admission. Preparation records HEAD and the canonical configuration hash;
preflight/run reject differing metadata, dirty code and already-started studies. Each owned read
rechecks the configuration text and HEAD. Preserve the checkout throughout the run.

Claim schedules the next quarter-hour at minute one, followed by 24 slots over six hours.
Admission tolerance is 30 seconds, with no recovery or extension. Minute observations reconcile
risk, funding and exits. The lease remains 90 seconds with renewal every 20 seconds. macOS
retains the existing closed-lid rejection and idle sleep protection.

Each round records initial multiframe evidence and independent proposals. A single final BTC/ETH
set validates before execution writes. Initial holds cannot become openings; directions cannot
switch. Simulations do not consume each other's liquidity. Acquisition remains
`rest-paced-20s-v1`: 20 seconds jointly, 30-second freshness, 5-second future/skew, and existing
serialized REST limits. No missing prices or candles are substituted.

Unavailable data omits the slot, including already-computed proposals. Partial execution failures
stop new decisions and require reconciliation. Lost ownership or persistence aborts immediately.
There is no automatic reclaim or restart. Six hours end admissions; at most 15 minutes remain
for deterministic exits. Unknown funding and unclosed positions stay pending.

## Reports

The runner atomically regenerates `report.html`, `report.csv` and `report.json` after each cycle
and termination. There are always 144 decision rows, with separate observations/exit events,
initial/final evidence, original accounts, filter traces and provenance. Output directories have
an exclusive study marker; do not reuse historical directories. Read-only report export uses a
consistent PostgreSQL snapshot. Local runner errors override the displayed active status while
preserving the persisted status and pending positions.

Fees, realized cash movements, reconciled funding, sampled equity/drawdown and open positions
are separate. Unknown funding suppresses net/equity conclusions. Marked drawdown reports only
verified samples and their count, not continuous valuation. Missing slots are not holds or zero
returns. Compare direction versus multiframe for the activity hurdle and direction versus hourly
for directional confirmation; accounts evolve independently, so economic differences are not
single-round causal estimates. Six hours remain exploratory. Do not pool past studies as paired
controls, promote a policy, repeat automatically, or alter parameters for a positive outcome.

## UTC-day startup regression

A prepared account may belong to the UTC day before the first scheduled slot. The original
risk engine requires continuous minute observations across midnight to establish its daily
equity baseline. Waiting without observations before admission can therefore leave
`DAY_BASELINE_PENDING`; it is not an SMA or activity filter rejection.

The runner now performs public risk/funding observations while waiting for the first slot.
Negative slots cannot admit decisions. This preserves the existing financial baseline rule;
no day-equity value or timestamp is fabricated or reset. If a valid first observation still
leaves a baseline pending, the session records `admission-failed`, closes new admission and
reports `STARTUP_BLOCKED`, rather than silently running a comparison that cannot open.

## Independent execution and failure notice

The explicitly authorized independent launcher uses two one-shot macOS launchd jobs. Run the
existing unified CLI with `run --independent --config FILE --env-file DATABASE_ONLY_FILE` after
preparation. The launcher admits only config v3 SMA and runs preflight first. No model/signing
credentials are inherited by children. There is no KeepAlive, repeating schedule, resume,
automatic restart, missed-slot recovery or strategy change. This is local process supervision,
not a recurring Codex automation or a deployed service.

The supervisor records child identity, exit status and terminating signal. A separate watchdog
checks the original child and supervisor every ten seconds, and checks renewal health and the
fixed exit deadline. The supervisor also stops the child if the watchdog disappears. A missing
heartbeat after 120 seconds or a failed component stops the verified original child, never a
reused or unrelated PID. PostgreSQL still fences every write with its original lease rules.
SIGINT, SIGTERM and SIGHUP are named failures. Abrupt SIGKILL may only be observed by the other
process; the report labels the cause as unavailable unless an exit signal was captured.

`supervision.json`, both plists, identity/health files, `runner-exit.json`,
`supervision-failure.json` and `supervision-notice.json` are private local evidence. Only one
terminal notice is admitted. macOS notification submission is recorded separately; submission
is not proof of visible delivery. An independent process cannot notify while the entire machine
is powered off. On failure the read-only report includes the supervision diagnostic and marks
remaining slots NOT_ADMITTED. Missing positions/funding remain pending; the watchdog cannot
trade, fetch prices, claim a lease, reset history or restart a campaign.

Keep the frozen worktree and the local study directory throughout execution. At completion,
inspect JSON/CSV/HTML, pending positions/funding and PostgreSQL lease release, then unload only
the two labels recorded by this study using `launchctl bootout gui/UID/LABEL`. Do not unload jobs
belonging to other studies or sessions. A future repeat still requires explicit authorization.

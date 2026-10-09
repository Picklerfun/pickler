# Explicit component-freshness paper policy

`stream-universe-component-paper-20s-v1` is a separately authorized local financial experiment.
It does not change the capture-only `stream-universe-component-20s-v2`, historical accounts,
Studio, deployed agents, REST selectors, financial formulas, signals, risk, fees or funding.

The operator authorized implementation and one six-hour SMA reopening comparison on 2026-10-09.
This authorization supersedes the earlier capture-only exclusion for this new selector only.
No model, news, trading key, real order, automation, merge or deployment is admitted.

## Data contract

Use the latest ticker and reconstructed book from one copied live connection generation.
Both native timestamps must independently be at most 30 seconds old and at most five seconds
ahead. Record their skew; do not gate this policy on a five-second difference between them.
Require an advancing heartbeat received at most five seconds ago, with its sequence, head block,
receipt and buffer copy time. Identical heartbeat messages cannot renew that receipt. Heartbeats
never advance price timestamps. Acquisition still has one total twenty-second deadline and no
REST price fallback. Missing, disconnected, old or contradictory proof cannot authorize a fill.

Frames hash the snapshot, book and copied `streamEvidence`. The account's immutable
`marketDataPolicy` selects validation; an intent cannot select it. Historical absent fields keep
the strict ticker/book skew rule. Product accounts reject this field. Financial observation,
simulation, risk valuation and PostgreSQL admission use native component dates. Opening and
closing completion verify the frame hash and recompute the fill under the account lock; trusted
v7 initial/final gates, account policy and study ownership are rechecked transactionally.
Native price freshness, funding, position times and lease fencing use PostgreSQL's financial
clock in persistence. Local heartbeat receipt and buffer-copy ordering use the trusted local
receipt clock that produced those dates; comparing them to the database clock would reject a
valid copy when that clock trails by even one millisecond. Both limits remain unchanged: native
age 30 seconds, native future bound five seconds and heartbeat age five seconds. The receipt
clock is an infrastructure dependency, never an intent, configuration value or provider field.
Component validation failures retain allowlisted reason codes, frame hashes and both clocks;
no raw provider payload, connection value or credential is logged.

All final frames must share the copied generation, heartbeat and reference time before any
portfolio execution. Funding reconciliation and once-bar atomic key consumption remain intact.

## Qualification adoption

Configuration v7 must explicitly select the new policy and pin `captureQualification.commit`
(40 lowercase hexadecimal digits) and `captureQualification.reportSha256` (64). These identify
the immutable component capture. Other selectors cannot carry this field.

`run --qualification ORIGINAL_REPORT` revalidates all retained component frames at their original
clocks, checks configuration/catalog hashes, and replays the complete bounded public capture.
It requires at least 29 of 30 joint cycles, release, socket closure, no ownership/reconstruction
errors, no truncation and unchanged public transport/reconstruction source under an ancestor
commit. Only the new session ID, explicit selector and capture pin differ from the capture's
frozen configuration. The adoption writes a new proof with the paper commit/configuration hash;
it never changes source artifacts or invents historical fills. Controlled financial tests are
required separately. This explicit adoption avoids repeating the already passed public capture.

`prepare`, `status`, `report`, `stop`, `run`, and read-only `audit-export` retain their v7 meanings.
For this selector `preflight --qualification ORIGINAL_REPORT` performs offline adoption and
PostgreSQL preparation, without a public request. Use a fresh output directory for each adoption.
`stability` rejects the financial selector before loading environment or providers; capture-only
stability remains separately available and does not implicitly authorize another run.

## One concurrent paper comparison

Freeze a clean commit, v7 configuration, catalog and pinned adoption. Use a dedicated file with
local `DATABASE_URL` only, never a model/trading environment. The existing runner executes
`sma-reference` and `sma-once-bar`, each with 1,000 virtual AUSD, across 72 five-minute slots and
eleven markets. Shared initial/final data, independent portfolios, hourly signals, selective risk,
100-AUSD maximum size and existing exits remain unchanged. Close admissions at the fixed six-hour
end; allow at most fifteen minutes of deterministic virtual exits. Do not recover missed slots,
restart a started session, alter parameters, repeat automatically or create a monitor.

The process publishes reports after rounds and at completion, and compact observation state.
Report the effective financial policy, capture adoption, common valid rounds, omissions, detected
exits, blocked reentries, fills, fees, funding, realized P&L, verifiable marked equity and pending
positions. API calls, tokens and new monetary reservations are zero. Preserve historical costs.
Independent component freshness is an experimental assumption; capture acceptance does not prove
joint economic accuracy, profitability or a latency effect. Six hours remain exploratory.

## First execution and clock regression

The first frozen execution at `8af5a43503672c60ae5426c32d1a5f336944e283` stopped after four
complete slots with `INVALID_MARKET_DATA`. Its common frame validation passed before the first
portfolio valuation failed. The original record did not retain the rejected frame and database
validation time, so the exact historical condition is not verifiable. Preserve this interruption,
its open virtual positions and costs; do not report a completed six-hour comparison.

Controlled replay demonstrated a separate clock-domain defect: a local copy one millisecond
ahead of the database clock was rejected despite admissible native timestamps and heartbeat.
The regression uses distinct receipt and financial clocks; PostgreSQL coordinator tests confirm
open, valuation and deterministic stop closes while ledger dates remain database-owned.
This proves the defect and its correction, not the missing historical failure values.

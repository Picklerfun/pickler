# Local PTS basic paper comparison

PTS `pts-trend-reversal@0.2.0` is experimental and local only. Its frozen definitions and
eleven resolved questions are in [the versioned decision record](../../knowledge/trading/pts-versions/pts-trend-reversal/0.2.0/DECISIONS.md).
The immutable course and disabled draft are unchanged. This implementation incorporates the
preservation from PR #135 and the necessary reader/laboratory components from tested commit
`0bf07d70037878da1edb93cc8325c7d9d1670b32`, separately from the PTS policy.

## Preparation and offline commands

Use the unified `evaluate` entry point, Node 22.22+ and a fresh output directory.
A committed inactive configuration template lives at
`src/pts-study/pts-basic-template.json`; it contains no credentials and does not schedule execution.

```sh
node --import tsx src/evaluate.ts prepare --config src/pts-study/pts-basic-template.json --env-file /absolute/path/database-only.env --output /absolute/path/new-preparation
node --import tsx src/evaluate.ts replay --state /absolute/path/new-preparation/history.json --output /absolute/path/new-replay
node --import tsx src/evaluate.ts preflight --config /absolute/path/new-preparation/study.json --env-file /absolute/path/database-only.env --output /absolute/path/new-preparation
node --import tsx src/evaluate.ts audit-export --config /absolute/path/new-preparation/study.json --env-file /absolute/path/database-only.env --output /absolute/path/new-export
node --import tsx src/evaluate.ts audit --state /absolute/path/new-export/export.json --output /absolute/path/new-audit
```

Prepare makes one bounded public Perpl history capture: at most ten minutes and 96 actual requests,
including retries. Sessions use at most 24 requests and a shared one-second serialized-start
scheduler with Retry-After. Metadata identifies BTC, ETH, SOL, MON, HYPE, ZEC, LIT, VVV, PUMP,
NEAR and UNI. Native queries use at most 1,024 candles. There is no external source, interpolation,
relaxed coverage or automatic repetition. Original response bodies and their hashes remain local.

An environment file, when supplied to prepare/preflight/online commands, must contain only
DATABASE_URL with a literal loopback PostgreSQL destination. No model or trading credential is
read or composed. Prepare creates inactive accounts and freezes configuration; it never claims
the execution lease. Preflight is read-only, verifies frozen coverage/policy/permissions/database
accounts and refuses to enable a run if no market has the required Perpl history. Fresh prices
and current closed windows still require guarded validation during the future run.

Replay and audit reject env/config options and dispatch before provider composition. Replay
emits five-minute proposal projections over thirty complete days using only closed original
candles at each clock, without hypothetical positions carried between signal evaluations.
Optional original financial captures go through the actual shared coordinator, simulator and
accounting. Candle-only inputs report financial results as NOT_VERIFIABLE. Controlled long/short,
partial/stop/expiry fixtures demonstrate transitions, not market returns.

Audit-export reuses a REPEATABLE READ READ ONLY transaction. The packet and report manifests
pin hashes and study/exporter/analyzer commits. Missing evidence remains NOT_VERIFIABLE.

## Future explicit run: not started by this delivery

Configuration v8 `perps-pts-sma-v1` defines two independent 1,000-AUSD portfolios:
sma-reference and pts-basic. The original hourly SMA retains current reopen behavior, selective
risk, 2% stop, 100-AUSD maximum sizing and four-hour horizon. PTS uses the new structural stops,
seven-day horizon and partial schedule. Studio selectors, deployed agents, model budgets and
historical unknown reservations remain unchanged.

A future operator-approved `run` needs the frozen clean commit, same prepared configuration,
verified eligible history and a dedicated local database file. The host refuses any started
session; there is no resume or automatic restart. Decisions occupy 4,032 five-minute slots at
minute one with thirty-second admission tolerance. Minute observations prioritize marks and
mandatory exits before history/funding preparation. PostgreSQL lease is ninety seconds,
renewed every twenty seconds; macOS refuses a closed lid and prevents idle sleep.
The fixed fourteen-day end allows at most fifteen minutes of deterministic virtual exits.
Unclosed positions and unknown/disputed funding remain pending.

`stop`, `status` and `report` use the same frozen configuration and database-only file.
Reports run separately from execution with coalesced publication, atomic individual files,
compact observation state and explicit active/closing/interrupted/finished status.
JSON/CSV/HTML separate signals, initial/final gates, stops, partial quantities, fees, funding,
realized net AUSD and marked equity when verifiable. USD model cost and reservations are zero.
Spread/slippage already included in fill prices are not deducted again.

The eleven-market financial acquisition is explicitly
`stream-universe-component-paper-20s-v1`: native components retain original dates, thirty-second
age, five-second future allowance and copied live heartbeat proof. Its recorded native pair skew
has no gate under this existing experimental policy. No REST fallback is added.
Candle/funding sessions remain public REST outside priority price/close work.
No new table, migration, API endpoint, model, signer, scheduler, automation or deployment is added.

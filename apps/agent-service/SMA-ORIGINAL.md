# Original hourly SMA paper study

`perps-original-sma-v1` is an explicit local rules-only protocol (configuration version 3).
It runs one independent `rules` account for 24 hours, with 1,000 virtual AUSD, 100 AUSD
openings, 15-minute decisions and minute observations. It reuses strategy `rules` 1.0.0,
hourly SMA20/50 with a strict 10-bps separation, and `conservative-1x-v1` risk, including
the original four-hour holding limit and 2% adverse-mark stop. There is no 5m momentum
exit or 30-minute maximum holding period. Sampled stops do not guarantee execution prices.

The original reference is commit `760ad3eae3001ee8ca81d02b4356f6065782db5e`.
A fresh market sample does not reproduce or validate the earlier positive result.
Trading fees and estimated funding remain in virtual AUSD; model costs/reservations are
explicitly zero USD. Spread and slippage are included in fill prices, not subtracted twice.

## Configuration and commands

Use an ignored JSON file with exactly these fields (replace the session ID):

```json
{
  "version": 3,
  "protocol": "perps-original-sma-v1",
  "tenantId": "perps-lab",
  "sessionId": "original-sma-example",
  "network": "mainnet",
  "hours": 24,
  "budgetUsd": "5"
}
```

`budgetUsd` preserves the original campaign identity; this protocol cannot consume it.
The private environment file contains only a loopback `DATABASE_URL`. The host parses only
that field, never populates `process.env`, and never constructs a model or trading signer.
Existing missing databases must not be reconstructed from incomplete reports. A fresh
unpaid database must retain an explicit provenance record identifying unavailable history;
it grants no new paid allowance. Existing databases and reservations must never be reset.

Run from the repository root after building shared packages:

```sh
npm run evaluate -- prepare --config /absolute/private/study.json --env-file /absolute/private/study.env --output /absolute/private/results
npm run evaluate -- preflight --config /absolute/private/study.json --env-file /absolute/private/study.env --output /absolute/private/results
npm run evaluate -- run --config /absolute/private/study.json --env-file /absolute/private/study.env --output /absolute/private/results
npm run evaluate -- report --config /absolute/private/study.json --env-file /absolute/private/study.env --output /absolute/private/results
npm run evaluate -- stop --config /absolute/private/study.json --env-file /absolute/private/study.env --output /absolute/private/results
```

No `--allow-paid`, model configuration, resume or automatic restart is accepted. Preparation
creates one dedicated agent/account only. Public preflight does not start the decision window.
Freeze and commit the code and configuration before starting. A second start is refused.

## Lifecycle and results

Acquisition is frozen to `rest-paced-20s-v1`, preserving the original provider timestamps,
30-second freshness, five-second future/component skew, twenty-second joint deadline and
existing REST pacing. Evidence has 60 consecutive closed hourly candles per symbol.
BTC/ETH share the final execution frames; invalid data skips the slot before writes.
The original strategy proposals are unchanged. Compulsory exits precede decisions and
prevent same-round reopening. Paper writes remain study-lease fenced.

The PostgreSQL lease lasts 90 seconds and renews every 20 seconds. macOS rejects a closed
lid and holds the existing awake protection while running. A stopped window permits up to
15 minutes of deterministic virtual exits; unresolved positions/funding remain pending.
A lost lease or persistence failure aborts; there is no automatic recovery.

The process regenerates HTML, CSV and JSON after every minute cycle and on termination.
`runtime-status.json` separates active decisions, closing, finished and interrupted process
states. No automation or earlier monitor is reactivated. Reports use a consistent read-only
PostgreSQL export; reporting never recovers expired attempts or calls providers.

Controlled PostgreSQL tests cover both opening directions, the exact four-hour horizon,
no reopening, duplicate slots, empty model lanes, explicit model-client/paid-guard rejection,
fees, reports and lease loss. These fixtures are not live-provider performance evidence.
A 24-hour result is exploratory, including a negative or zero-trade result.

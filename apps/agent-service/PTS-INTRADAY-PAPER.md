# Independent local intraday PTS experiment

`pts-intraday@0.1.0` reuses the PTS business geometry, sizing and financial accounting with genuine
shorter native frames. Basic `pts-trend-reversal@0.2.0`, the disabled draft, course, SMA and all
previous studies remain unchanged. This policy is absent from Studio and deployed selectors.
See the [frozen decision record](../../knowledge/trading/pts-versions/pts-intraday/0.1.0/DECISIONS.md).

## Frozen roles and risk

| Role                   | Native candles | Minimum closed consecutive bars |
| ---------------------- | -------------- | ------------------------------- |
| Primary trend          | 1 day          | 24                              |
| Aligned channel        | 4 hours        | 104                             |
| Impulse and ATR14      | 1 hour         | 240                             |
| Confirmed correction C | 15 minutes     | 180                             |
| Entry cross            | 5 minutes      | 168                             |

The strict dated pivots, channel geometry and independent correction/recovery drawings retain
basic formulas. An hourly impulse may form for at most 72 hours, C remains eligible for 24 hours,
and the entry cross expires after five minutes. Projected fills must remain strictly between
0.38 and 0.495. Stop, break-even and 20%/20%/remainder targets are unchanged in ratio space.
Positions last at most six hours and must close at UTC day end; verified daily/4h invalidation or
two hourly closes outside the frozen channel also close them. Missing exit evidence is pending.

Opening planned loss is capped at 1% equity and total planned loss at 3%, with known fees and a
50-bps exit provision. Keep 1x, 100 AUSD maximum, five positions, selective 40%/50% exposure and
existing emergencies. Planned risk does not guarantee realized loss during gaps/funding.

## Preparation, reproduction and explicit run

Use Node 22.22+, a clean tested feature commit, fresh output directories and a dedicated file
containing only a literal loopback DATABASE_URL. Native capture is at most ten minutes/96 physical
requests, serialized one second apart in sessions of at most 24, respecting Retry-After. All five
native frames are captured for seven rolling days plus warmup; pages contain at most 1,024 bars.
No provider fallback, rescaling, interpolation or silent repetition is allowed. Original public
responses and provenance are retained. Preparation never starts admission.

From `apps/agent-service`:

```sh
node --import tsx src/evaluate.ts prepare --config src/pts-study/pts-intraday-template.json --env-file /absolute/path/database-only.env --output /absolute/path/new-preparation
node --import tsx src/evaluate.ts replay --state /absolute/path/new-preparation/history.json --output /absolute/path/new-replay
node --import tsx src/evaluate.ts preflight --config /absolute/path/new-preparation/study.json --env-file /absolute/path/database-only.env --output /absolute/path/new-preparation
node --import tsx src/evaluate.ts run --config /absolute/path/new-preparation/study.json --env-file /absolute/path/database-only.env --output /absolute/path/new-preparation
node --import tsx src/evaluate.ts audit-export --config /absolute/path/new-preparation/study.json --env-file /absolute/path/database-only.env --output /absolute/path/new-export
node --import tsx src/evaluate.ts audit --state /absolute/path/new-export/export.json --output /absolute/path/new-audit
```

Offline replay/audit reject environment/configuration and load no provider composition. Replay
re-evaluates each native closed five-minute window using only knowable evidence, with no evolving
hypothetical portfolio or candle-only P&L. Original complete financial captures and controlled
fixtures use the actual shared coordinator/simulator. `prepare --state` reuses verified original
bytes offline; it never implies another capture. Missing coverage disables affected signals.

Configuration v9 `perps-pts-intraday-sma-v1` defines 1,000 AUSD each for `sma-reference` and
`pts-intraday`. SMA remains hourly 1.0.0, with its existing selective risk, 2% stop and four-hour
horizon. The intraday account policy is immutable and separate; version-qualified setups, target
consumption, stop changes and partial fills remain atomic under account/ownership locks.

One authorized run occupies 288 five-minute slots at minute one, thirty-second admission tolerance,
minute observations and a fixed 24-hour end with at most fifteen minutes of deterministic exits.
It keeps the existing twenty-second continuous public WebSocket component-paper reader, candle/
funding REST preparation outside valuation, 90-second lease/20-second renewals and macOS sleep
protection. No resume, missed-slot recovery, parameter changes or automatic repeat is implemented.
Original funding uncertainty and unknown monetary reservations remain intact. There are no models,
signers, provider monetary reservations, migrations, endpoints, automations or deployments.

Reports publish off the execution path and distinguish active, closing, interrupted and finished.
JSON/CSV/HTML retain signals, original/final gates, anchors, exits, partial quantities, fees, funding,
realized net virtual AUSD and marked equity when verifiable. Model API USD is zero and separate
from capital. Never deduct spread/slippage twice. Candle-only or controlled financial results do
not establish market profitability. A 24-hour result is exploratory; more trades alone are not a
successful strategy and positive results cannot justify automatic promotion.

## Preparation cohort and first interruption

The host freezes the symbol cohort that passed original preparation into the shared v9 reader.
Known invalid or insufficient histories stay in the packet/reports; their symbols are omitted
commonly before candle requests and signal evaluation. Do not repair those bars, lower minima,
turn omissions into holds, or admit new schema/identity/ownership failures as availability errors.
Basic v8 and the numerical intraday policy remain unchanged.

The first authorized intraday process at `037a4def5623c5addb3fb7f0d8131297d150fe8e` interrupted
at its first slot with `INVALID_MARKET_DATA`, before rounds or position attempts were persisted.
The saved preparation excluded four symbols, but composition did not pass that cohort and the
reader re-evaluated excluded histories. A controlled regression reproduces the same validation
path, then checks common initial/final exclusions, source immutability and revocation. The exact
failed live candle bytes were not recorded, so no specific new response is reconstructed.
Preserve the first study and audit; any explicitly authorized repair test uses a new identity,
never resumes or rewrites the interrupted attempt.

# Perpl public transport measurement

This local-only experiment compares REST with the public Perpl WebSocket and selects one
transport using a frozen rule. It does not load model/trading clients, call paid providers,
create paper accounts, buy, migrate, or deploy. Historical studies and results remain unchanged.

## Commands

Build shared packages first. From `apps/agent-service`:

```sh
node --import tsx src/evaluate.ts data-diagnostic --config /absolute/path/study.json --env-file /absolute/path/study.env --output /absolute/path/new-diagnostic
node --import tsx src/evaluate.ts stability --config /absolute/path/study.json --env-file /absolute/path/study.env --acquisition-choice /absolute/path/new-diagnostic/choice.json --output /absolute/path/new-acceptance
```

Only DATABASE_URL is read from the environment file. The endpoint must be loopback PostgreSQL.
Each output directory has an exclusive STARTED marker. The checkout must be committed; the
reports identify the exact commit and configuration hash. Keep the Mac lid open. The existing
idle-sleep protection is released on all outcomes. Never restart an interrupted opportunity or
repeat acceptance automatically. Do not pass `--allow-paid`.

## Measurement and frozen choice

The diagnostic has ten fixed opportunities, one per minute, with a shared twenty-second deadline.
REST uses the original `coherent-20s-v1`; WebSocket uses `stream-20s-v1`. Each side records its
first jointly valid acquisition, and both are rechecked at a common reference time without
replacing one side's input after its counterpart has finished. The WebSocket remains connected
between opportunities; cadence and repeated timestamps are measured independently from scoring.

Select WebSocket only if it achieves at least nine valid joint opportunities, exceeds REST,
and has zero reconstruction or ownership errors. Otherwise select `rest-paced-20s-v1`: retain
REST and wait two seconds after an unchanged component timestamp before its next refresh.
This wait consumes the same deadline and request allowance; freshness thresholds are unchanged.
There is no automatic fallback within a session. `choice.json` freezes counts, reason, transport,
policy, commit and configuration hash. The acceptance command verifies that its selection follows
the frozen rule, rather than trusting an arbitrary transport label.

The thirty-minute acceptance performs thirty fixed slots through the same reader used by
observation and final execution refresh. Passing requires at least 29 valid BTC/ETH joint cycles,
zero lease failures, no permission/ownership breach, reader closure, and a PostgreSQL readback
confirming release. Missed opportunities are recorded without catch-up. Availability is not
profitability; a failed acceptance leaves paid comparison pending.

New explicitly prepared comparison sessions may pass `--acquisition-choice` to persist the
chosen policy in their immutable metadata/dataPolicy. Older sessions retain original behavior.
No paid continuation is authorized by preparing or measuring a transport.

## State and permission safety

Infrastructure normalizes both transports with the same exact fixed-point conversion and book
checks. Market IDs and precisions come from reviewed context metadata. The public socket sends
one subscription batch for heartbeat, market-state, and both books. Each subscription result and
stream identity is validated. Initial book snapshots replace state; updates modify levels by
price and remove `o: 0`. Heartbeats never advance component timestamps. Identical book messages
are deduplicated; time/block regression and demonstrated heartbeat discontinuity invalidate state.
A disconnected socket discards books and ticker state and requires new subscriptions/snapshots.
Connection attempts are bounded to two per minute and occur only within live acquisition.

Messages are limited to 2 MiB, queued processing to 32 messages, and books to 10,000 levels per
side. Returned depth remains twenty levels. Permissions and configuration version are checked
before every request/read and buffer access; an idle stream is checked every second. Revocation,
configuration change, cancellation or lost ownership closes the reader and prevents buffer reuse.
All PostgreSQL writes retain the existing owner fence. Leases remain ninety seconds, renewed
every twenty seconds, with synchronous interruption detection and no overlapping renewal.

## Evidence and offline analysis

JSON, CSV and HTML distinguish both transports, BTC/ETH availability, original timestamps/blocks,
local reception, skew, first-valid latency, errors, missed slots and renewal diagnostics. Public
messages/REST responses are captured in events.jsonl up to 32 MiB; truncation is explicit. No
sign-in message or authenticated endpoint is sent or captured. `transport-report.ts` analyzes
these files offline without credentials, preserving repeated dates and cadence separately from
price freshness. A heartbeat is evidence of activity, not a fresh price.

Official protocol: [Perpl public WebSocket](https://github.com/PerplFoundation/api-docs/blob/main/websocket.md).
Only the public market-data endpoint is used. Controlled tests do not establish public acceptance.

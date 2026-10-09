# Local eleven-market WebSocket reader

This delivery adds the explicit v7 `stream-universe-20s-v1` acquisition selector. Omission keeps
historical REST behavior. It does not change strategies, monetary budgets, deployed agents,
Hono routes, or Cloudflare composition. No economic comparison starts after qualification.

## Reader contract

Runtime composes one `PerplPublicStream` for observation, initial evidence, and final evidence.
Trading validates a copied connection generation at one common clock. A single subscription
request contains heartbeat, market state, and eleven order books. IDs come from scoped REST
metadata and must match the frozen catalog. Every acknowledgement is checked. Perpl documents
16 subscriptions and 10 requests per minute per public connection in its
[WebSocket protocol](https://github.com/PerplFoundation/api-docs/blob/main/websocket.md).

Snapshots precede deltas; `o: 0` removes a price level. Existing depth, 2 MiB message, 32-message
queue, and 10,000-level-per-side bounds remain. Exceeding a bound closes the reader; no updates
are silently dropped. Heartbeats never update price timestamps. Provider dates/blocks and local
reception remain distinct. The most recent components are used; no older matching component is
selected. Disconnects discard state. Only an active acquisition may reconnect, at most twice
per minute, with new subscriptions and snapshots. There is no REST price fallback.

The twenty-second deadline includes cold metadata, connection, subscriptions, waits, and guarded
copies. Age remains at most thirty seconds; future dates and ticker/book skew at most five.
Deadline exhaustion returns no executable frames. Retained partial copies are diagnostic evidence,
not successful joint acquisition. Configuration, permissions, and ownership are rechecked before
connection and buffer access. Revocation closes the reader. Candles and funding keep their REST
scheduler, one-second spacing, per-session cap of 24, caches, and existing permission checks.

## Explicit public qualification

First complete controlled tests, PostgreSQL tests, format, lint, types, architecture and consumer
builds. Freeze a clean commit and a new v7 configuration copy selecting the stream policy.
The copy retains the existing source study identity and all other frozen fields. Diagnostic
initialization creates a distinct record and lease; it never mutates the source or its accounts.
Use a dedicated file containing only loopback `DATABASE_URL`, never a model/trading environment.

From `apps/agent-service` in the frozen checkout:

```sh
node --import tsx src/evaluate.ts stability \
  --config /absolute/path/to/new-stream-config.json \
  --env-file /absolute/path/to/database-only.env \
  --output /absolute/path/to/new-qualification-directory
```

The first of thirty one-minute slots includes cold boot. The connection remains open between
slots. There is no missed-slot recovery, extension, automatic repetition, account, position,
model, signer, paid reserve or automation. The lease is ninety seconds and renews every twenty
using PostgreSQL's clock. macOS retains the lid/idle-sleep guard. Availability failures continue
to the next slot; identity, schema, reconstruction, permissions, ownership or persistence failures
stop the check. Remaining identities are explicitly not admitted after interruption.

Acceptance requires 29/30 joint valid cycles, thirty recorded slots, zero reconstruction,
permission or ownership failures, verified socket closure and released PostgreSQL ownership.
Cleanup closes the reader before releasing ownership and the database. A failed check still
exports evidence and must not be repeated automatically.

## Artifacts and offline inspection

Stability report v3 retains the existing stability protocol and records the stream adapter version,
frozen commit/configuration/catalog hashes, 30 cycles and 330 market identities in `markets.csv`.
`report.csv` retains the cycle view. JSON contains copied snapshots, original dates/blocks,
reception, age/skew, checks, timing, cadence counters, safe errors and renewal diagnostics.
`events.jsonl` contains validated public messages and an allowlisted metadata projection. Unknown
fields and authentication messages are not captured. This is not a byte-identical raw-wire log.

Capture stops retaining events at the first overflow of 32 MiB. Its contiguous prefix hash,
truncation and dropped-event count are explicit; counters continue independently. Missing data
is not manufactured. Partial market validity never upgrades a failed joint cycle.

```sh
node --import tsx src/evaluate.ts reader-audit \
  --state /absolute/path/to/qualification/report.json \
  --output /absolute/path/to/new-offline-audit-directory
```

The offline v3 analyzer verifies configuration, catalog, snapshots and retained capture hashes,
then replays only the retained validated prefix through the existing pure book reconstruction.
It constructs no network transport or database and reads no environment. Missing captures are
`NOT_VERIFIABLE`; corrupt hashes are rejected. Older audit/capture versions remain readable.
HTML and CSV escape evidence. Historical captures are context, never paired controls.

Controlled cold/warm benchmarks collect thirty measurements per transport and scenario with
identical prices and books. Mock-clock scheduling and actual fixture-processing wall time are
reported separately with median, p95 and denominators. Neither is public network latency.
Qualification establishes local availability, not profitability or Cloudflare performance.

To reproduce the controlled measurements from the repository root, without any environment file:

```sh
PICKLER_CONTROLLED_TIMING_FILE=/absolute/path/to/new-measurements.json \
  node --import tsx --test packages/agent-runtime/test/perpl-universe-reader.test.ts
```

The optional output is test evidence only and must not replace a public qualification report.

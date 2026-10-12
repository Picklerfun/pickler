# Local PTS report persistence isolation

The local PTS report path previously captured the complete consistent audit source on the financial
host thread and its pool before starting the report worker. Moving rendering alone did not isolate
JSON decoding, hashing, serialization or database demand. This correction moves that source capture
into the worker without changing strategies, financial functions, budgets, provider deadlines or
recorded studies.

## Composition and failure handling

- Execution uses four local PostgreSQL connections. Every study, account and Drizzle permission
  query uses the observed guarded pool from construction.
- The coalesced report worker uses one separate connection, with PostgreSQL's
  `default_transaction_read_only=on`. Capture still uses `REPEATABLE READ READ ONLY`, the original
  deterministic exporter and the v2 content-addressed manifest.
- Together these roles partition the existing five-connection local runtime capacity. This is not
  a global cap on unrelated operator processes. Hosted pools and legacy store callers are unchanged.
- A worker receives only its explicit input and an empty inherited environment. Its source parses
  the dedicated DATABASE_URL-only loopback file; no model, signing or Perpl adapter is composed.
- Source timeout, cancellation or connection failure preserves its specific code. The first bounded
  report diagnostic has `origin: report-worker`; compact interruption state remains publishable.
  No failure authorizes a retry, session recovery or a write after ownership loss.
- Cancellation terminates the worker and preserves the original cancellation reason. A blocked
  PostgreSQL read can remain server-side until the unchanged ten-second statement deadline;
  controlled tests verify backend disappearance separately. Thread exit is not database-release
  evidence. Existing histories and pending positions are never rewritten to report cleanup.

The exact reviewed pg-pool queue and new-client deadline branches both map to
`PERSISTENCE_CONNECTION_TIMEOUT`. Optional safe counters and initial checkout disposition help
future diagnosis, but do not reconstruct missing historical evidence. No timeout limit is raised.

## Controlled validation

Build shared packages first, then run from the repository root against an isolated test PostgreSQL
instance using `TEST_DATABASE_URL` supplied privately:

```sh
node --import tsx --test packages/infrastructure/test/perps-local-store.test.ts packages/infrastructure/test/perps-lab-query.test.ts packages/infrastructure/test/perps-lab-pool.test.ts packages/infrastructure/test/connection.test.ts
node --import tsx --test apps/agent-service/test/pts-report-isolation.test.ts apps/agent-service/test/pts-report-capacity.test.ts
node --import tsx --test apps/agent-service/test/pts-report-benchmark.test.ts
```

The integration suite proves source-hash equality and unchanged account/history documents. It holds
a real round-table lock while execution continues permission/account reads and lease renewals,
then verifies a specific query timeout, no success publication and resource release. Separate
fixtures cover ownership cancellation, pre-aborted work, provider import rejection and absent
inherited model/trading credentials. Financial behavior is covered by the unchanged PTS/SMA
coordinator and accounting regressions; a source exporter does not execute positions.

The benchmark alternates thirty paired measurements of identical synthetic read-only source
capture on the host thread and in a new worker. Both paths use one report connection. It verifies
all sixty payload hashes and publishes median/p95 elapsed time, maximum host heartbeat gap and
callback denominators. Worker startup is included. The fixture's JSON padding is explicitly
synthetic, not market evidence. Its private `benchmark.json` is stored in a new temporary directory;
optional `PTS_REPORT_BENCHMARK_OUTPUT` accepts only a new file.

## Evidence limits

A measured host-blocking improvement does not prove the cause of an earlier connection timeout,
that a provider became faster or that PTS is profitable. A new-client deadline without transport
phases cannot be assigned to DNS, TLS, authentication or the server. A queue deadline identifies
the driver queue branch; original counts and competing work are still needed to explain it.

A failed public run remains terminal. Open positions, expired unreleased ownership and unknown
costs retain their original state. Any subsequent prospective test requires a new identity, a clean
tested frozen commit and the already authorized scope; this correction does not resume a study or
enable models, real orders, deployed agents, monitors, merge or deployment.

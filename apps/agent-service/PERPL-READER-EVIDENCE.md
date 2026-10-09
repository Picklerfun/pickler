# Perpl universe reader: evidence and correction

This correction is a local public-data change. It does not start a portfolio comparison, call
models, change trading signals or relax any frozen data limit. Preserve the failed 2026-10-08
qualification and its original commit, configuration, files and PostgreSQL history.

## Demonstrated observations

The original capture at commit `a6a9f54fa5272e1101834d3de02f3ef14c03bd64` recorded 30 unique
cycles and 330 unique market observations. Only 15 complete eleven-market sets were valid;
301 individual market observations were valid. There were 501 HTTP 200 responses, four
cancellations at the acquisition deadline, no HTTP 400/429 and zero ownership failures.

The original algorithm scans every symbol before returning to an early invalid pair. In slot 2,
BTC was invalid 2.406 seconds after the actual cycle start and was checked again at 15.703
seconds: a 13.297-second recovery delay within the twenty-second deadline. Across seven early
BTC failures, the interval to the next check ranged from 11.937 to 13.331 seconds. A logical
recheck is not a new HTTP request: the original adapter can reuse the bulk ticker response for
three seconds, preserving its original receipt date and provider timestamps.

The original reader updates the requested symbol rather than every saved pair when it reads a
new aggregate ticker. In 255 of the 301 accepted frames, the saved ticker receipt precedes a
later successful aggregate request. Those frames passed the original policy. The newer raw
aggregate entries were not saved, so this does not establish that their individual prices or
source dates changed; do not retroactively declare them invalid.

The saved trace demonstrates scheduling and data coherence failures. It does not identify
Perpl's internal cache, publication mechanism, DNS, TLS or server cause. Missing request bytes
and missing cache-hit instrumentation remain limitations rather than fabricated explanations.

## Explicit correction

Configuration v7 optionally selects `acquisitionPolicy: "rest-universe-coherent-20s-v2"`.
An absent field or explicit `rest-universe-20s-v1` retains the historical reader. Older
configuration versions reject the new selector. No running session is upgraded.

The new reader:

- Uses a genuinely new bulk ticker request when refreshing that component, validates each
  requested symbol and propagates the newest returned batch to all pairs.
- Gives invalid components an earlier recovery opportunity while ensuring unread assets still
  receive service. A repeated timestamp delays only that component by two seconds.
- Includes metadata and queue waits in the existing twenty-second deadline. Requests remain
  serialized with at least one second between starts and at most 24 requests per session.
- Preserves original dates, thirty-second maximum age and five-second advance/component-skew
  limits. It never chooses an older book or ticker to manufacture coherence.
- Discards absent entries in a successfully refreshed batch, rejects timestamp regressions,
  and checks permissions, configuration, cancellation and live ownership around reads and reuse.
- Records allowlisted ticker-read diagnostics identifying `network` versus `cache`, requested
  markets, receipt date, per-market source date and block. No credentials, complete headers,
  raw bodies or unfiltered error messages are recorded.

Request diagnostics v3 additionally identify recognized individual book/ticker requests by numeric
market ID, including cancellation before dispatch. Bulk requests omit that field. This last
instrumentation change has controlled-test validation only: it was added after the public
diagnostic below and cannot retroactively identify its HTTP targets.

The new policy is recorded in both study metadata and persisted diagnostic state. A configuration
or metadata mismatch fails closed. Confirmed financial rules, positions, unknown costs and budgets
are outside this change.

## Reproduce recorded facts offline

From `apps/agent-service`, after building shared packages:

```sh
node --import tsx -- src/evaluate.ts reader-audit \
  --state .data/perps-studies/sma-reentry-capture-20261008/report.json \
  --output .data/perps-studies/reader-audit-NEW
```

The command dispatches before environment/provider composition and rejects environment, paid or
provider-mode flags. It writes HTML, JSON and two CSV files in a new directory only. It records
the exact input byte hash and original/analyzer commits, allowlists output fields, distinguishes
logical checks from network calls, and retains unavailable cache attribution as `NOT_VERIFIABLE`.
It never modifies the source file or reconstructs responses to requests that were not made.
Audit protocol v2 excludes initial ticker-only preparation from recovery intervals. An interval
starts at the first invalid check with both original source dates and ends at its next check;
it does not require that next check to succeed. Do not compare this with an earlier audit that
included initial book preparation, or interpret it as request latency.

## Controlled proof and its limits

The paired scheduler regression injects the same time-dependent provider functions into both
readers, one-second request starts, a three-second cache for v1, the same 24-request cap and the
same twenty-second deadline. V1 excludes BTC at the deadline. V2 repairs BTC at 2.1 seconds and
obtains eleven valid pairs in 12.1 seconds with 13 acquisition requests. Metadata is outside
this scheduler fixture; runtime regressions separately verify its inclusion in the deadline.

Additional controlled tests exercise real adapter cache/network selection, permissions,
cancellation, rejected schemas, missing batch members, latest-state propagation, per-component
cooldowns, ownership loss, PostgreSQL policy fencing and read-only artifact safety. The source
date is never advanced merely because a response or heartbeat arrived.

A negative regression with eleven continuously advancing markets remains incomplete under the
unchanged serial rate and skew limits. Correcting the reader does not guarantee that every public
dataset can converge, that the historical failed cycles would have passed, or that 29/30 future
complete sets will be available.

## Bounded public evidence check

`reader-check` makes exactly three scheduled public captures, 25 seconds apart, using the
explicit v2 reader and an independent local PostgreSQL diagnostic lease. It loads only a
database-only environment file. There are no accounts, strategies, executions, models or signer.
It requires committed clean code and a new output directory; it makes no automatic repeat.

```sh
node --import tsx -- src/evaluate.ts reader-check \
  --config .data/perps-studies/reader-check-NEW/study.json \
  --env-file .data/perps-studies/sma-reentry-latency-20261008/database.env \
  --output .data/perps-studies/reader-check-output-NEW
```

The explicit configuration must select `rest-universe-coherent-20s-v2`. The diagnostic records
source dates and cache/network attribution, omissions, requests, renewals and verified lease
release. Its protocol is `perpl-reader-check-v1`, qualification is
`DIAGNOSTIC_ONLY_NOT_ACCEPTANCE`, and `passed` is always false. An incomplete capture is reported,
not retried. Ownership, permission or cleanup failures fail the command.

This diagnostic cannot satisfy or bypass the separate thirty-minute 29/30 qualification. A new
economic comparison remains gated by an independently frozen, passing qualification and operator
planning; this correction does not restart the failed acceptance or the six-hour comparison.

## Recorded three-capture outcome

The single bounded diagnostic ran at commit
`e6eb1a8d0abf03d09080c741e4092a52b19da485`, beginning at 00:18:00 UTC on 2026-10-09
(the evening of 2026-10-08 in Bogota). It completed all three scheduled opportunities,
without retries or lost ownership: **0/3 joint sets and 25/33 individual market captures valid**.
There were 55 HTTP 200 responses, three cancellations while queued, no HTTP 400/429, fourteen
ticker emissions from the network and zero from cache. Five renewals succeeded and the lease was
released. No accounts, positions, models, tokens or monetary reservations were created.

These are the last observed candidates, not accepted final snapshots. All available components
were within thirty seconds of age; the seven date-pair failures exceeded the five-second skew.
The dates are UTC on 2026-10-09.

| Slot | Market | Last ticker | Last book | Skew         | Recorded exclusion       |
| ---- | ------ | ----------- | --------- | ------------ | ------------------------ |
| 0    | SOL    | 00:18:17    | 00:18:09  | 8 s          | INCONSISTENT_MARKET_DATA |
| 0    | UNI    | 00:18:11    | Missing   | Unverifiable | DATA_UNAVAILABLE         |
| 1    | HYPE   | 00:18:40    | 00:18:33  | 7 s          | INCONSISTENT_MARKET_DATA |
| 1    | ZEC    | 00:18:40    | 00:18:34  | 6 s          | INCONSISTENT_MARKET_DATA |
| 1    | LIT    | 00:18:41    | 00:18:35  | 6 s          | INCONSISTENT_MARKET_DATA |
| 2    | SOL    | 00:19:05    | 00:18:56  | 9 s          | INCONSISTENT_MARKET_DATA |
| 2    | HYPE   | 00:19:06    | 00:18:56  | 10 s         | INCONSISTENT_MARKET_DATA |
| 2    | LIT    | 00:19:06    | 00:19:00  | 6 s          | INCONSISTENT_MARKET_DATA |

Slot 0 SOL had both dates at 00:18:09 when checked at 00:18:12.677. A genuinely new bulk ticker,
received at 00:18:17.779, advanced the ticker to 00:18:17 while its book remained 00:18:09.
The common latest-state check correctly excluded that now-incoherent pair. Serial collection of
eleven books, intervening aggregate refreshes, measured response durations and mandatory spacing
consume the available deadline; they do not guarantee convergence as source dates advance.

Slot 0's last book operation entered our queue at 00:18:19.799, never started an HTTP request,
and was cancelled after 216.208 ms. The next permitted start was 00:18:20.478, after the cycle's
00:18:20.013 deadline. The frozen scheduler's sequence identifies the pending asset as UNI;
the historical request diagnostic itself has no market ID, so that attribution is derived from
the code and sequence. Slots 1 and 2 also ended with queued operations that could not dispatch
before their deadline. These are not evidence of HTTP rejection or an unresponsive Perpl book.

The first already-acquired invalid BTC pairs were checked again after 2,158, 941 and 764 ms.
These are logical validation intervals, not causal before/after estimates; the three captures
and the original thirty-minute qualification occurred at different market times. Neither this
sample nor the controlled improvement establishes 29/30 joint availability or economic benefit.
The captures contain no raw bodies that could explain Perpl's internal timestamp publication.

Local immutable artifacts under `apps/agent-service/.data/perps-studies/` are:

- `perpl-reader-check-capture-v2-20261008/report.{json,csv,html}`: original three-capture output.
- `perpl-reader-check-capture-v2-20261008/lease-proof.json`: independent read-only PostgreSQL
  check of release, zero diagnostic accounts/rounds and unchanged original study.
- `perpl-reader-original-audit-20261008/`: offline facts from the thirty-minute original capture.
- `perpl-reader-v2-reviewed-audit-20261008/`: reviewed offline analysis with initial book
  preparation excluded from repair intervals. Preserve the earlier audit directory separately.

The three-capture JSON byte SHA-256 is
`4d5a86e4c8d86cfbe1a9bf47b9a6b96e382e1d546114ec60db4419c77059aeb7`.
The independent PostgreSQL comparison matched the original study's canonical state hash before
and after: `48e9ec5bf469d4ad56513783ba35fc941ba9e68f021c57312bb2e579ece6542b`.
Reader corrections are demonstrated; eleven-market capture acceptance remains **not achieved**.

## Execution hosts

The failed qualification uses local Node APIs, records the checkout commit and permits only
loopback PostgreSQL through `database-env.ts`. It did not execute in Cloudflare Workers.
The separately deployed product API is Hono in `workers/api`; the web forwards `/api/v1/*`
through its Cloudflare Service Binding. Its public OpenAPI route is a safe read-only availability
check and does not execute Perpl reads or models. A successful contract GET verifies API
reachability, not every authenticated operation or provider integration.
The explicit GET of
`https://pickler-web-staging.gilbertsahumada.workers.dev/api/v1/openapi.json`
returned HTTP 200 with OpenAPI 3.1.0 and 173 documented paths. This does not establish the
currently deployed source commit or the readiness of every operation.

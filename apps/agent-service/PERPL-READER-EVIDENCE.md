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

## Execution hosts

The failed qualification uses local Node APIs, records the checkout commit and permits only
loopback PostgreSQL through `database-env.ts`. It did not execute in Cloudflare Workers.
The separately deployed product API is Hono in `workers/api`; the web forwards `/api/v1/*`
through its Cloudflare Service Binding. Its public OpenAPI route is a safe read-only availability
check and does not execute Perpl reads or models. A successful contract GET verifies API
reachability, not every authenticated operation or provider integration.

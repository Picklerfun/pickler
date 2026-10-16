# Hourly breakout: fixed screen and source continuity

This is a local experimental protocol, not a Studio strategy or a deployed trading service.
Configuration version 10 selects `perps-hourly-breakout-fixed-screen-v1`. The
[disabled example](hourly-breakout-disabled.example.json) has no financial start or operator.
Its identity is the reviewed T1 r2 namespace
`8d7aff6751aee7e2dc55bc4c3ded9e66766015c8ed9408fb60784d19be8fbb68` and the final T5 protocol
`36a06bef5267e7dc4407e78e508000e557da8df53e7df3f3f282cbe37e739816`.
The private implementation dossier preserves a verified copy of the sealed research, rather than
editing that research. No implementation result establishes profitability.

## Policy and financial boundaries

Trading owns three independent financial roles: C (`hourly-breakout`), S (`sma-reference`) and L
(`hourly-long`). N is a deterministic 1,000 AUSD cash reference without an account. PTS responsive
`0.2.0-fast.2` supplies contextual signals only, with no portfolio, fills or financial comparison.

C reads exactly 22 consecutive closed hourly bars ending at the evaluated hour. A new strict
20-bar breakout requires a known, different preceding raw direction. Discovery consumes it before
financial admission, even when positions, unavailable financial data or risk prevent opening.
Equality does not break out. Rank by numerical market ID and retain original candidates without
replacement. The final copy can cancel, never promote or change the original direction or candles.
An executable price back inside the original channel is recorded and remains allowed by T1 r2.
Changed full-candle content invalidates final admission without releasing discovery consumption.

C has its full opposite 10-bar channel exit. All financial roles retain native full fills, actual
fees, signed funding, 100 AUSD maximum intentions, 1x, five positions, 2% individual stop, four-hour
age and selective 40%/50% exposure. S retains its existing hourly signal, rank and exits. L offers
longs once per hour and has no short/channel exit. No partials, targets, break even or trailing
orders are added. Native 101 AUSD reservations are not an expense.

The coordinator isolates ordinary risk/capacity rejection by account. This differs from the older
coordinator's common admission blocking. Technical failure still stops new admissions globally.
Discovery, the next account intention's reservation and financial confirmation are three durable
boundaries. Confirmed fill, movements, account state, fences and reservation release commit
atomically. Queued candidates reserve zero. Historical writers reject version-10 accounts before
expiring reservations or recovering state.

An unknown outcome preserves possible effects, cost and reservation. It blocks conflicting writes
to that account and new admissions to all three; unaffected accounts retain authorized reductions.
A known commit whose acknowledgement journal fails is a known effect with unproved valuation
receipt, not a proved rollback or an unknown commit. Lost ownership forbids subsequent writes.
Funding includes closed positions and late/revised evidence. A contradiction rolls back all new
funding postings, including one detected on the last history page. Unknown funding is never zero.

## Restricted commands

Run from the repository root with the supported Node runtime and built shared packages. Select a
new private output directory for every export/analysis. Replace the example's permission identity
with an existing explicitly authorized public-data agent; preparation never creates one.

```sh
npm run evaluate -- prepare --config CONFIG --output NEW_DIRECTORY
npm run evaluate -- preflight --config CONFIG --env-file DATABASE_ONLY_FILE --output NEW_DIRECTORY
npm run evaluate -- stability --config CONFIG --env-file DATABASE_ONLY_FILE --output NEW_DIRECTORY
```

`prepare` is offline and emits a disabled specification. Preflight permits only an explicit
DATABASE_URL-only file pointing at loopback PostgreSQL; it checks permissions, local clock
compatibility, free space and macOS awake protection. It does not query public prices or models.
`stability` is a separately authorized one-shot, source-only 24-hour operation. It creates one
diagnostic record and lease, no financial accounts, positions, attempts, monetary reservations or
funding operations. It is never automatically repeated.

```sh
npm run evaluate -- status --state CAPTURE/source-manifest.json
npm run evaluate -- stop --state CAPTURE/source-manifest.json
npm run evaluate -- report --state CAPTURE/source-manifest.json --output NEW_DIRECTORY
npm run evaluate -- audit-export --state CAPTURE/source-manifest.json --output NEW_DIRECTORY
npm run evaluate -- audit --state EXPORTED/source-manifest.json --output NEW_DIRECTORY
npm run evaluate -- replay --state EXPORTED/source-manifest.json --output NEW_DIRECTORY
```

Saved-state operations dispatch before environment/provider composition. `stop` creates only the
selected run's pre-reserved local STOP marker; a read-only status does not prove process liveness.
Financial read commands instead select their frozen `--config` and dedicated `--env-file`.
The future financial `run` additionally requires an independently authorized acceptance bundle.
Neither source acceptance nor this delivery supplies that bundle or starts the financial screen.

## One 24-hour source population

Freeze the next UTC minute at least two minutes after preflight, moving exact midnight to 00:01,
before the first public request. End exactly 24 hours later. The first original window includes
metadata and WebSocket cold start. Early unavailable copies remain in the denominator; there is
no prewindow bootstrap, catch-up or extension.

There are 4,320 original twenty-second windows and 47,520 market-copies. Only offset zero supplies
the 1,440 canonical minutes and 15,840 market-minutes. Offset 20/40 never rescues them. A busy or
expired original window is omitted. Background candles have 288 original five-minute
opportunities, each limited to sixty seconds. Common 60-bar 1h/15m/5m preparation and additional
PTS coverage are reported separately from price continuity.

The single continuous public reader retains `stream-universe-component-paper-20s-v1`: twenty
seconds per acquisition, thirty-second component freshness, five-second future/heartbeat bounds
and no REST price fallback. It records component skew without restoring the retired skew veto.
REST preparation retains serialized pacing, session limits and Retry-After behavior. Revocation,
identity/schema/reconstruction failure, ownership loss or persistence failure stops the capture.

Acceptance requires 1,368 valid joint canonical minutes, 15,048 valid market-minutes and 1,368 for
each market, conservative qualified J intervals no greater than 90 seconds including endpoints
and trailing checks, no integrity/ownership failures, and confirmed socket/lease cleanup. A cold
availability miss is counted under these criteria, not silently removed or assigned another slot.

J is receipt of the exact valid public copy. V is receipt of definitive durable acceptance of an
exact account/market valuation; this capture has no V population. Paired UTC/monotonic brackets
have nonzero uncertainty and process-epoch identity. The authority is explicitly the local OS
clock; external UTC accuracy is unverified. PostgreSQL compatibility uses the complete local RTT
interval. An excessive gap, unproved compliance and incompatible clocks retain distinct labels.

Rejected database samples now save their raw numeric brackets and conservative offset interval
before rejection. Nonfinite values cannot be accepted; rejected evidence represents them as null.
The acceptance calculation is unchanged: `[databaseAt - wallAfter - 1, databaseAt - wallBefore + 1]`
must contain zero. A later measurement with a wider RTT can pass while a tighter interval fails;
passing preflight is not a guarantee that every subsequent sample will pass.

The first rejected proof stays separate from the primary interruption, including any independent
proof-journal failure. Preflight writes rejection evidence before public composition. A clock error
does not prevent technical diagnostic release after ownership has been checked; release still uses
the adapter's transactional fence. Detected ownership loss prevents any further database call.
No receipt comparisons means maximum J intervals are null, not a measured zero.

## First source attempt: interrupted before Perpl

The single authorized attempt used frozen commit `12758b5bd045f9ce7726a4606db522a29362a407`.
Its frozen window was 2026-10-16 01:39:00 UTC to 2026-10-17 01:39:00 UTC, but it stopped before
that start with `CLOCK_INCOMPATIBLE`. The public reader had not been constructed: all source,
HTTP and wire journals are empty, and no account, position, financial attempt, monetary reserve,
model call or public-provider request occurred. Coverage is zero against the unchanged planned
populations; it is not a completed 24-hour measurement or evidence of Perpl unavailability.

The original accepted preflight interval was [-7, +1] ms with a 5.334458 ms monotonic RTT. The
rejected startup sample was not retained by that frozen code, so its exact numbers and causal
phase remain unverifiable. A separate subsequent read-only diagnostic rejected all 100 samples;
their conservative offset bounds lay between -5 and -2 ms. These later measurements demonstrate
incompatibility under the unchanged local rule. They neither reconstruct the rejected startup
sample nor establish an NTP, virtual-machine, hardware or external-UTC cause.

That attempt also exposed two host defects: rejected proof was discarded before persistence, and
end-clock rejection skipped the diagnostic release. The original capture retains its unconfirmed
lease/socket cleanup and confirmed pool closure. The subsequent code repair preserves rejected
proof, checks every numeric clock input, performs fenced technical cleanup independently, and
labels absent interval evidence correctly. Controlled regressions cover those changes. They do
not amend the original capture, authorize repetition, or satisfy source/financial acceptance.
The financial configuration remains disabled with no T0, operator or acceptance bundle.

## Evidence, bounded operation and future acceptance

Original snapshots, complete native HTTP bodies and first/revised candle versions remain in
immutable hashed parts no larger than 64 MiB. Only the contiguous first 32 MiB WebSocket prefix
may truncate, explicitly. Replay cannot claim transport reconstruction outside retained wire
evidence. All artifacts and concurrent temporary writes share a 16 GiB budget; preflight requires
20 GiB free. Exhaustion interrupts without trimming required evidence.

One coalesced, read-only report worker publishes verified generations and the pointer last.
Only current and previous derived generations remain; original evidence is retained. Reports
separate missing opportunities, availability, preparation, clock proof and financial acceptance.
Controlled test fixtures are not public-provider or economic acceptance.

Each verified generation includes the exact source manifest used by that analysis, complete
`report.json`, `minutes.csv` (15,840 canonical cells), `pumps.csv` (47,520 original cells), HTML and
a compact `acceptance.json` without the large row arrays. Future authorization pins the compact
acceptance and reproduces its original manifest/evidence offline. Within the same 16 GiB ceiling,
128 MiB is held for the final fixed-population failure/completion report; this is not extra capacity.
The future financial clock certificate is immutable and separately reviewed, including its numeric
bounds, epoch and validity. Every actual paired sample must fit that envelope. Its certificate ID
does not change per boundary, while the actual observations and boundary identities remain unique.
The reviewed final JSON hash is the accepted protocol digest; separate configuration, commit,
catalogue, clock and operator hashes identify the particular authorized run.

The implemented financial calendar remains disabled: 28 days from a future separately authorized
UTC midnight, four more hours for exits and 72 more hours for funding reconciliation. It never
recovers missed slots or retries an unknown outcome. Financial acceptance additionally requires
its fixed 95% coverage populations, exact V supervision, complete account/action-obligation
evidence and the frozen breadth/concentration tests. Forty closed C positions, twenty entry hours,
four weeks, five markets and ten positions per direction are exploratory minima, not power.
Low activity is inconclusive. Even source continuity passing cannot establish these future facts,
28-day reliability, PTS financial superiority or a profitable strategy.

The separately authorized financial host has an explicit nonmonetary resource envelope: 64 GiB
of artifacts, 80 GiB initially free and 256 MiB terminal publication headroom within the ceiling.
Those values are pinned by its future technical and operator authorization, not supplied by this
delivery. The 24-hour source check keeps its 16 GiB / 20 GiB envelope. See the implemented
[financial authority contract](PERPS-HOURLY-BREAKOUT-FINANCIAL-AUTHORITY.md).

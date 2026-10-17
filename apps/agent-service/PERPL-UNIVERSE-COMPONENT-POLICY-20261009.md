# Component-freshness reader experiment — 2026-10-09

## Problem and demonstrated evidence

The direct-reconstruction reader completed its original thirty-minute measurement at commit
`28d2b854684e3d6366fb2738bbd4873bc6d3e72c`: 38,216 received and applied messages,
one connection, no reconstruction or ownership failure, and verified closure/release. Its
availability result was **17/30**, with 292/330 valid market observations. Thirty-six rejected
observations exceeded the original ticker/book timestamp-skew gate; two exceeded maximum age.
The historical result remains failed and immutable.

An offline cadence analysis of the retained public messages found 68 BTC ticker updates in which
the native date advanced while the six inspected prices stayed equal. The largest BTC
message-reception gap was 44,993 ms. Thus neither “timestamp means last price change” nor
“an active heartbeat makes all prices current” follows from this evidence.

Artifacts are under the main checkout's ignored `apps/agent-service/.data/perps-studies/`:

- `perpl-universe-stream-direct-qualification-20261009/`: immutable original measurement.
- `perpl-universe-stream-direct-date-proof-20261009/`: native-date and lifecycle proof.
- `perpl-universe-stream-component-evidence-20261009/cadence.json`: component cadence.
- `perpl-universe-component-replay-20261009/`: new-policy offline candidates, not acquisitions.

The source report SHA-256 is
`69d085541d078ff204313bad21c4c99f652adf1447d459cbbb98449c67f51cfa`.
The retained event SHA-256 is
`23096179cdd22b59507b249c3bf489fe230437f62e814b1732ed38cffd78a886`.
Perpl's [public WebSocket protocol](https://github.com/PerplFoundation/api-docs/blob/main/websocket.md)
documents market-state timestamps and contiguous heartbeat sequences. It does not define a
heartbeat as a new publication of unchanged prices.

## New policy and financial boundary

`stream-universe-component-20s-v2` is a separately named capture-only experiment. It keeps
identity, schema, native dates, latest-component selection, thirty-second age, five-second future
allowance, twenty-second total acquisition and ownership guards. It accepts independently fresh
ticker/book components without requiring their timestamps to differ by at most five seconds,
and records that skew explicitly. It also requires a contiguous advancing heartbeat received
within five seconds in the same generation. Duplicates never refresh continuity.

Adapter `public-universe-stream-v4` adds copied continuity evidence to the existing private
direct replica; it does not change reconstruction, memory bounds, subscription limits or REST.
Disconnected or revoked generations cannot deliver their buffer. The experimental descriptor,
strict-rule market/cycle results and `financialExecutable: false` are persisted in report v4.

Existing financial validation and fill simulation retain the five-second skew rule. New-policy
financial initialization and host commands are explicitly rejected. No accounts, positions,
model calls, monetary reserves, signing, Cloudflare operation or economic comparison is created.
Passing a capture is not a finding that a trade is safe, profitable or authorized.

## Verification and prospective acceptance

Controlled regressions cover exact age/future/heartbeat boundaries, original-date immutability,
stale-price rejection despite fresh heartbeats, duplicate heartbeat receipt, generation reset,
eleven-market joint completeness, bounded cold start, permission/configuration/ownership loss,
diagnostic-only PostgreSQL isolation, financial rejection before environment loading and audit
metadata/denominator integrity. The unchanged public reader's financial tests remain applicable.

Offline replay uses the recorded scheduled windows and a 250 ms candidate-check clock with
network access forbidden. It reuses the business validator and pure reconstructor. These
counterfactual candidates do not reconstruct actual ownership or delivery and cannot count
toward prospective availability.

The hash-verified 38,216-message replay found independent-freshness candidates in 30/30
scheduled windows, versus strict-rule candidates in 17/30. This isolates the observed skew
eligibility difference under the retained inputs; it is not a newly owned historical capture.

After controlled checks pass, freeze a clean commit and explicit new configuration, then perform
one isolated thirty-minute qualification. Keep all original limits except the separately declared
skew eligibility policy; never enlarge them to obtain a pass. Require at least 29/30 joint cycles,
330 market rows, zero reconstruction/permission/ownership errors, socket closure and PostgreSQL
release. Report both experimental availability and the unchanged strict-rule count. The new
acceptance is determined only from the completed report and independent verification; no automatic
economic run follows it.

## Completed public qualification

The single new measurement ran **2026-10-09 16:33–17:03 UTC** (11:33–12:03 America/Bogota)
from clean frozen commit `46bcca8c36d91edd0508ff05e3f6b6aedab304df`.
It passed the experimental capture policy: **30/30 joint cycles, 330/330 market observations**,
no missed windows, zero reconstruction or ownership errors, 91 successful lease renewals and
no failed renewal. One disconnect was recovered within an active acquisition using a second
connection with new subscriptions/snapshots; prior-generation state was discarded.

All 40,589 received messages were reconstructed. The 23,681,378-byte retained capture was not
truncated and replayed completely offline across two generations. Acquisition duration was
40.120 ms median and 3,101.967 ms p95 over thirty successful cycles, including cold boot and
reconnection. These are acquisition durations, not provider publication latency.

An independent verifier reapplied the business validation to all 330 stored frames at their
original common clocks, verified configuration/catalog/frame/capture hashes, and checked release
in a repeatable-read, read-only PostgreSQL transaction. Ownership and expiry were cleared,
no live owner remained, and the diagnostic contained zero accounts and zero decision rounds.
The socket was closed. New model calls, tokens and monetary reserves were zero.

The unchanged strict rule accepts **11/30 of these same joint snapshots**. Therefore the
new result establishes availability under independent component freshness, not compliance
with the original five-second skew gate. Financial validation remains unchanged and this
configuration is rejected by financial initialization and commands. No economic run followed.
The original failed 17/30 report and retained events were hash-checked again and remain unchanged.

New artifacts under the ignored local study directory:

- `perpl-universe-component-config-20261009/study.json`: explicit frozen selection.
- `perpl-universe-component-qualification-20261009/`: thirty-slot HTML/CSV/JSON and public capture.
- `perpl-universe-component-audit-20261009/`: offline v4 audit and complete replay.
- `perpl-universe-component-proof-20261009/`: independent frame and PostgreSQL verification.
- `perpl-universe-component-conclusion-20261009/`: readable conclusion and 330-row CSV.

The new report SHA-256 is
`d4219ba01505ee124553204b239484e2b2a5dfbef37bbf25b9fc4302e9755d04`.
The retained events SHA-256 is
`612c826ed6794f83f52e081e3e0d5ae512a02fb9cbb245e2e2d2d09902b71658`.

Local checks passed: format, lint, types across all consumers, architecture, PostgreSQL-backed
root suite (2,973 passed, zero failed, three skipped), Node build and Workers builds. The code
head's nine CI checks passed, including rendered design. Controlled regressions are distinct
from this prospective qualification. Changes retain one file per commit; no merge or deployment
was performed.

# Eleven-market SMA / Jev / Exa comparison

This operator-only, local protocol is `perps-sma-jev-exa-all-markets-v1`, configuration v5.
It runs once for two hours: eight quarter-hour slots at minute one, with a 30-second admission
tolerance. Missing slots are persisted, never recovered. No deployment, signer, real trading,
DeepSeek, automatic repeat, resume or monitoring automation is composed.

The frozen catalog is BTC 1, MON 10, ETH 20, SOL 31, HYPE 40, ZEC 50, LIT 60, VVV 70,
PUMP 90, NEAR 100 and UNI 110. Each market must confirm its identity and AUSD collateral.
Private Perpl configuration v2 permits this catalog. Public DTOs and existing v1 configurations
still permit only BTC/ETH. Historical studies keep their original interpretation.

## Decision and execution

Three independent 1,000 virtual AUSD accounts run `rules`, `sma-jev` and `sma-exa-jev`.
They retain hourly SMA20/50, strictly greater than 10 basis points, 100 AUSD opens, conservative
1x risk and the original four-hour horizon. The session ends sooner. Selected openings rank by
exact absolute SMA separation, then numerical market ID. A portfolio admits at most five
positions and 50% marked equity exposure; fees can make fewer than five admissible.
Exits precede ranked openings. An exit cannot reopen that asset in the same slot. A veto or final
rejection never admits a replacement or upgrades an initial hold.

The universe reader uses `rest-universe-20s-v1`: one serialized public request per second,
at most 24 requests per trusted session, all-market tickers cached at most three seconds,
batch funding and individual books. Prices retain original timestamps. Joint acquisition is
bounded by 20 seconds, with 30-second freshness and five-second future/skew tolerances.
Repeated unchanged component timestamps wait two seconds. There is no WebSocket fallback.
Sixty consecutive closed hourly candles are prepared before fresh prices. Invalid assets are
excluded from every arm and shown as `DATA_UNAVAILABLE`. An unvalued existing position blocks
all new openings. Valid deterministic exits remain available.

Jev `jev-1.13.0` reviews each selected entry through prompt adapter 1.1.0. It receives only that
asset's market/candle evidence and its own portfolio risk. Identity, evidence and costs are
separate questions. Only material contradiction with selected probability and confidence both
at least 0.90 vetoes an opening; these are related measures, not financial win probabilities.
Jev never vetoes compulsory exits. Exa searches once per selected asset, five results from the
24 hours preceding the common snapshot. Undated, future or unattributed results are excluded;
source content is limited to 1,800 UTF-8 bytes. No news is not an automatic veto.

At most two requests per paid provider run concurrently. Queue wait consumes the 45-second
model phase; individual requests remain limited to 20 seconds and Jev bodies to 30,000 bytes.
All required calls are reserved jointly. One final fresh subset is shared by all three portfolios
before any round execution. Calls and executions are not shared between portfolios.

## Budget and contract gate

The same tenant/network/database campaign ceiling stays USD 5. The operator's USD 2.50 new
reservation ceiling includes 15 synthetic checks and up to 120 prospective calls: at most
90 Jev calls and 45 Exa searches (135 total). Worst-case full reserves are USD 2.497726080.
Full new reservations remain retained after errors or lower reported use. Missing historical
history is disclosed: exact campaign spend stays null, with a documented verified upper bound
and the original unknown reservations retained. Admission rejects changed history, other active
campaign owners, unrecognized unknown usage and exceeded ceilings.

`validate` uses five coherent synthetic opening/closing opportunities for all accounts. Actual
Exa evidence is saved separately and excluded from synthetic market facts. Technical failure or
an unexpected veto stops launch; there is no retry or silent adjustment. Any prospective model
failure/unknown consumption closes paid admissions and all openings, then allows at most fifteen
minutes of deterministic virtual exits. Lease/persistence loss aborts immediately.

Run from `apps/agent-service` after building shared packages. Paths below are examples, not a
configuration or authorization to spend:

```sh
node --import tsx src/evaluate.ts prepare --config /private/study.json --env-file /private/study.env --output /private/new-study
node --import tsx src/evaluate.ts preflight --config /private/study.json --env-file /private/study.env --output /private/new-study
node --import tsx src/evaluate.ts validate --allow-paid --config /private/study.json --env-file /private/study.env --output /private/new-study
node --import tsx src/evaluate.ts run --allow-paid --config /private/study.json --env-file /private/study.env --output /private/new-study
node --import tsx src/evaluate.ts report --config /private/study.json --env-file /private/study.env --output /private/new-study
```

The run prevents idle suspension on macOS, rejects a closed lid, renews a 90-second PostgreSQL
lease every 20 seconds, and writes reports after each cycle. Closing the lid is not protected.
Commit, configuration and reviewer/catalog hashes are frozen before paid checks and the run.
The report command is read-only and makes no provider requests.

Reports contain 264 decision identities, evidence hashes, initial/final actions, exclusions,
reviews, latency, tokens and per-call consumption. Virtual gross P&L, fees, funding, net realized
P&L and verifiable marked equity remain separate from paid API USD and reservations. Pending
funding/positions are not losses or zero. Fill prices already include spread/slippage, which are
shown diagnostically and never deducted twice. Only valid common observations are comparable;
two hours cannot establish profitability or justify automatic promotion.

Official references: [Perpl REST](https://github.com/PerplFoundation/api-docs/blob/main/rest-endpoints.md),
[Jev models](https://docs.typesafe.ai/models), [Exa search](https://exa.ai/docs/reference/search).

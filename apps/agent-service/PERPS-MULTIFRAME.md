# Local multiframe Perpl comparison

`perps-multiframe-v3` is an explicit local two-hour paper experiment. It retains configuration
shape version 2, selects laboratory strategy version `1.1.0`, and uses four independent 1,000
virtual AUSD accounts: rules, Jev-only, direct DeepSeek and DeepSeek-to-Jev review. Studio strategy
2.0.0, deployed agents, historical studies, prompts 1.0.0 and the conservative 1x simulator are
unchanged. No migrations, public endpoints, signer or real orders are added.

## Frozen experimental criteria

Every asset requires sixty consecutive closed candles at each resolution: 1h, 15m and 5m. Identity,
range, OHLC validity and the latest completed boundary are checked before any model reservation.
Missing short histories are data-unavailable omissions, never fabricated hourly subdivisions.
The existing public read session remains capped at twelve requests and one request per second.
Short histories are read through the existing guarded Perpl plugin; no alternative feed is used.
Initial frames are refreshed after candle acquisition, and the final BTC/ETH refresh is common to
all four strategies. It is validated in full before execution writes begin.

Rules retain SMA20/50 hourly trend with a strictly greater than 10 bps gap, then require matching
momentum over the last three closed five-minute intervals and the last closed fifteen-minute
interval. Existing positions close on trend invalidation or adverse five-minute momentum. All
four variants have a maximum thirty-minute holding horizon, supervised by minute observations.
There is no within-round reversal after an exit.

The common entry gate requires both momentum magnitudes strictly above 1.5 times an estimated
round-trip activity hurdle: current relative bid/ask spread, two public taker fees, five bps
slippage allowance per side and absolute funding for the ceiling number of funding intervals in
thirty minutes. Funding must be known. Depth within the simulator's 50 bps cap must cover 100
virtual AUSD. The actual simulator still determines fills, commissions, funding and risk.

This is an uncalibrated activity filter, **not an expected return or evidence of positive alpha**.
The slippage allowance is a frozen assumption, not a promise that future exits cost that amount.
Prices moving far enough in the past do not establish that they will move further in the future.
The filter may reduce or eliminate trading; do not lower it during a session to obtain fills.

## Model revision and evidence

Forecast prompt 1.1.0 and atomic Jev prompts 1.1.0 explicitly state a fifteen-minute cadence,
thirty-minute maximum horizon, entry/exit criteria and the interpretation of costs. They receive
all sixty close/time pairs per resolution, market/depth/funding metadata, their own account and
reproducible features. Full original OHLC inputs remain in the saved evidence. Request size is
still bounded to 30,000 bytes. Jev support remains >=0.70; material review veto requires selected
probability and confidence >=0.90. Neither is a probability of financial profit.

Models can choose hold when entry conditions pass. Forecast hold explanations request a leading
reason code followed by evidence; raw valid proposals remain saved separately from final policy
blocks. `final-policy-gate` events record the original action, executable action and policy
version. Final price/depth/cost changes can remove an entry without another model call. Invalid
responses, unknown usage and technical errors retain the existing stop-and-close behavior.

## Explicit new experiment

Copy a reviewed config into a **new ignored directory**, set protocol `perps-multiframe-v3`,
strategyVersion `1.1.0` and a new session ID, preserving tenant/network/database and pricing.
Do not mutate, resume or reset earlier sessions. Recalculate their accounted costs and unknown
reservations first. This new protocol allows at most 35 calls (three synthetic contract checks
and eight rounds of four calls), while all protocols retain the same original USD 5 monetary
campaign ceiling. It does not create a new USD 5 allowance. Beginning another experiment still
requires operator authorization; a protocol name is never that authorization.

From `apps/agent-service`, with shared packages built:

```sh
node --import tsx src/evaluate.ts prepare --config FILE --env-file ENV
node --import tsx src/evaluate.ts preflight --config FILE --env-file ENV
node --import tsx src/evaluate.ts validate --config FILE --env-file ENV --allow-paid
node --import tsx src/evaluate.ts run --config FILE --env-file ENV --allow-paid
node --import tsx src/evaluate.ts report --config FILE --env-file ENV --output DIRECTORY
```

Keep the same `--acquisition-choice FILE` on every applicable command. All three new contract
checks must pass with matching frozen metadata and commit. No model retries, budget resets,
real capital, remote publishing or automatic promotion are permitted.

Reports preserve four per-strategy results, proposals, omissions, final gate events, API USD
and virtual AUSD separately. Compare only valid common rounds within the new experiment.
Historical 1.0.0 results remain a different market sample, **not a paired economic control**.
A positive new result does not prove improvement over history or establish profitability.

# Independent fast intraday PTS candidate

`pts-intraday@0.2.0-fast.1` is an experimental local candidate. It preserves the course,
`pts-intraday@0.1.0`, basic PTS 0.2.0, SMA and every historical study. It is absent from Studio,
Workers and deployed strategy selectors. Configuration v9 selects its complete identity explicitly;
unknown or mismatched candidates fail before provider composition.

## Frozen temporal roles

| Role                   | Native candles | Minimum consecutive closed bars |
| ---------------------- | -------------- | ------------------------------- |
| Primary trend          | 4h             | 24                              |
| Aligned channel        | 1h             | 104                             |
| Impulse and ATR14      | 15m            | 240                             |
| Correction C and entry | 5m             | 180                             |

Correction and entry use one genuine native 5m series. C needs two subsequent closed bars to
confirm; the crossing bar must close strictly after all setup components became knowable. A
cross during confirmation cannot establish an entry. No native timestamp is rescaled or relabeled.

The geometry, strict pivots, 0.61–0.78 inclusive retracement, channel/ATR tolerances and projected
fill interval strictly between 0.38 and 0.495 are retained. Formation remains 72 hours, C lifetime
24 hours and entry expiry five minutes. Positions last at most six hours and close at UTC day end.
Invalidation uses this candidate's 4h/1h trends or two 15m closes outside its frozen channel.
Thus this candidate changes the timeframes of both entry and invalidation, not only entry speed.

Stop, break-even, 20%/20%/remainder partial targets, 1% opening/3% aggregate planned risk,
50-bps exit allowance, 100 AUSD size, five positions, 1x and selective 40%/50% exposure are unchanged.
The immutable account policy is `pts-intraday-1x-0.2.0-fast.1`; setup/intent/position versions must
match under the existing financial transaction. Confirmed fills and setup/target consumption
remain atomic. Estimated or incomplete funding stays pending.

## Evidence and limitations

This candidate was proposed after examining saved seven-day native candles. A preliminary paired
check found 2,242 aligned primary/channel windows versus 1,138 for 0.1.0 among 14,112 eligible
asset/windows. These are repeated five-minute windows, not independent trials, complete setups or
profit estimates. The historical sample informed candidate selection and is not an independent
holdout. Full geometry, confirmation, expiry and projected fill checks still apply.

Controlled fixtures demonstrate long/short openings and all partial/final closes using the actual
coordinator and simulator. They establish circuit behavior, never market profitability. Offline
signal replay has no evolving hypothetical portfolio and no candle-only P&L. Missing books,
funding or historical availability cannot be replaced with later observations.

The currently running 0.1.0 study stays frozen at its original commit, configuration and fixed
end. This implementation does not modify it, restart it or start the fast candidate automatically.
No model, Exa, signer, monetary reservation, automation, migration, endpoint, merge or deployment
is added. More aligned windows or more trades cannot establish profitability.

## Existing local commands

Read [the intraday guide](PTS-INTRADAY-PAPER.md) for the public-only boundaries, lease, fixed
calendar, reporting and original interruptions. The new inactive template is
`src/pts-study/pts-intraday-fast-template.json`. Explicit preparation captures seven rolling days
plus this candidate's native warmup, within the unchanged ten-minute/96-request bound. The shared
reader refreshes 1h/15m/5m eligibility and this candidate's 4h history, without requesting daily
candles solely for fast PTS. Basic and 0.1.0 requests retain their original ordering/minima.

From `apps/agent-service`, offline replay remains:

```sh
node --import tsx src/evaluate.ts replay --state /absolute/path/explicit-fast-history.json --output /absolute/path/new-fast-replay
```

The state must identify `pts-intraday@0.2.0-fast.1` explicitly. Deriving a retrospective hypothesis
from a saved public capture requires a new artifact, the parent byte/canonical hashes and the
unchanged native bars; it is never a relabeling of a historical run or prospective evidence.
`prepare --state` refuses a packet with a different policy/candidate. Future public preparation,
preflight and run use the existing commands and require a new study identity and frozen commit.
No admission is implied by this guide or by an offline result.

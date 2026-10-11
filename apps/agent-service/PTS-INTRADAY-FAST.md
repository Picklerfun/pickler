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

## Recorded complete signal replay, 2026-10-11

The frozen analyzer at `874052bda28e8b4b13f5571a9d7e1e1a63922981` evaluated both candidates
against the same saved native Perpl candles from 2026-10-04 06:50 UTC through
2026-10-11 06:50 UTC. The original preparation and its 82 public-response files remain unchanged.
The replay contains 44,352 rows: 2,016 five-minute opportunities per market, eleven markets and
two candidates. These repeated opportunities are not independent statistical observations.

| Measure                            | Intraday 0.1.0 | Fast 0.2.0-fast.1 |
| ---------------------------------- | -------------- | ----------------- |
| Candidate-valid eligible windows   | 14,112         | 14,696            |
| Common eligible asset/windows      | 12,859         | 12,859            |
| Signal windows, all eligible data  | 0              | 4                 |
| Distinct setups, all eligible data | 0              | 2                 |
| Signal windows, common data        | 0              | 3                 |
| Distinct setups, common data       | 0              | 1                 |

The common fast setup is a PUMP short, signaled at 2026-10-11 06:01, 06:11 and 06:36 UTC.
The three crossings share the same A/B/C identity; they are not three independent entries.
Only a confirmed opening consumes that identity. No hypothetical portfolio was propagated.
The other setup is a LIT short at 2026-10-04 22:11 UTC. LIT is not part of the paired comparison:
its original daily bars fail validation for 0.1.0, whereas the fast candidate uses the unchanged
valid native 4h/1h/15m/5m series. No daily bar was repaired or substituted.

The fast policy's longer 15m/5m warmup excludes the first 179 opportunities for each of its eight
eventually eligible markets. VVV, NEAR and UNI have invalid required original bars and remain
unverifiable. These are missing eligibility, not valid strategy abstentions. In the common sample,
the first blocking reason for 0.1.0 is primary trend in 9,146 windows and four-hour alignment in
2,754; fast uses primary trend in 5,586 and hourly alignment in 5,245. These ordered reasons
describe gates under identical recorded inputs, not independent causal effects or profitability.

Artifacts live in the new private directory
`apps/agent-service/.data/perps-studies/pts-intraday-20261011-capacity2/fast-full-signals-20261011`:
`report.html`, `report.csv`, `report.json`, `manifest.json`, the exact analysis/guard scripts and
`verification.json`. Full traces are retained for every signal and the first occurrence of each
reason per market/candidate; all other rows retain reproducible analysis and projection hashes.
Verification checked all 44,352 projection hashes, 86 retained analyses, file hashes/byte counts,
unique identities and denominators. A fresh replay reproduced 48 selected original-input rows,
including all four signals. Independent CSV parsing also counted 44,352 rows. Offline network
attempts were zero.

| Provenance            | SHA-256                                                          |
| --------------------- | ---------------------------------------------------------------- |
| Original history file | afe0b20ee764f6497f8ebd002ea213a3c9ddc9eb8e27c4636256841a1681afde |
| Canonical history     | f9e25ffcffb547ff5cef8a53f55112734e1c6a6016920059f668b60f957594eb |
| Original policy       | e7e82fa551994ada3d5754b9dae05a19ac4ea6f1d3e7f6de63a823a60870561d |
| Fast policy           | 82568834ca3c470e0c9575d794524d9e0390dbd8cc89480037ab05500161d627 |
| Canonical report      | f4995114267446cc5459ec25839c8754f4e377c148fbc25795964783cd3de36f |

Conclusion: the fast temporal roles can produce complete recorded candle signals while preserving
the fixed geometry and financial rules. Signals remain sparse: two setups across this development
sample, with only one in the paired cohort. There are no contemporary full-history books/funding,
verified historical fills or net financial returns in this replay. Historical response availability
and revisions are not reconstructed. The sample informed candidate selection; it is not a holdout.
The 0.1.0 prospective trial remains frozen and separate. Neither this report nor profitable
controlled fixtures meet the goal of demonstrated prospective PTS profitability.

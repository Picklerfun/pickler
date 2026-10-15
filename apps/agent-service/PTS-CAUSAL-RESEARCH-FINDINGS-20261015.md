# PTS causal research findings — 2026-10-15

## Decision and evidence scope

The four research policies are implemented and tested, but none is selected for execution.
Preserving admissible setups and the additional ready-band trigger warrant further examination
as signal-availability hypotheses. This dataset does not establish that either earns money.
ER20 removes reference signals without adding any; the alternative retracement band replaces
the reference signals rather than confirming a more profitable ratio.

The immutable calculation used analyzer commit `28f633b398504dae76f57261702dd80f1996a603`,
Node 22.22.0 and the original `pts-responsive-20261014-01` export. Its source payload hash is
`ff08d73bb6db2554805175aa9fd51afd81427447a616b54be4d6054949e91020`; saved history hash is
`8aceb4c1977fa974fc3c1bd758938ba54db506425a2c063c35cbf600a41f7dce`. The published canonical
report hash is `e3a895d635c5f0371709f7487787db475f14cea8d274ce5d7de3ac4b813024f8`.
Documentation commits after that calculation do not relabel its analyzer identity.

The private outputs are under
`apps/agent-service/.data/perps-studies/pts-causal-research-20261015-01/analysis/`.
They contain 2,145 five-arm forensic rows, 858 original-account decision rows, 249 separately
unrecorded slots and 110,880 seven-day candle projections. No new trial, provider/model call,
database connection, account, order or monetary reservation was created by the analysis.

## Why the recorded study did not trade PTS

All 429 original PTS decisions reproduce as holds. Their recorded first blockers are:

| First blocker            | Original rows |
| ------------------------ | ------------: |
| Primary trend            |           224 |
| Fifteen-minute alignment |           153 |
| Retracement 0.61–0.78    |            47 |
| Confirmed correction C   |             5 |

All four candidate arms also have zero signals at those 39 recorded decision times. Removing
one condition does not imply that the other conditions pass. The control band moves 12 rows
beyond the original retracement block, but four then fail the channel and eight fail confluence.
Examples are `forensic:22:LIT:retracement-control` and
`forensic:26:LIT:retracement-control`, respectively. Changing the entry trigger alone cannot
remove those earlier blocks.

The 47 originally retracement-blocked rows contain five A–B–C corrections and three A–B
impulses. The 52 rows originally reaching impulse evaluation contain four impulses. The report's
broader `uniqueAB`/`uniqueABC` fields instead count every computable identity across a diagnostic
population, including rows blocked at other gates. These are different denominators.

## Chronological development sensitivity

The seven-day replay is separate from the recorded trial. These are candle signal events,
not executed positions or independent opportunities to make money.

| Arm                 | Signal events | Added / removed against reference | Distinct signal-bearing AB / ABC |
| ------------------- | ------------: | --------------------------------: | -------------------------------: |
| Frozen reference    |             6 |                                 — |                            5 / 5 |
| Primary ER20        |             4 |                             0 / 2 |                            3 / 3 |
| Persistent setups   |            12 |                             6 / 0 |                            6 / 6 |
| Ready-band entry    |             7 |                             1 / 0 |                            5 / 5 |
| Retracement control |             3 |                             3 / 6 |                            2 / 2 |

- **Persistence:** the six added crossings are concentrated in MON and ETH. They add only one
  distinct impulse overall. For example, `history:1791416100000:MON:persistent-setups` and
  `history:1791438300000:MON:persistent-setups` are two crossings of the same retained ABC.
  A real confirmed opening would consume that setup; this replay does not invent such fills.
- **Ready-band:** `history:1791619500000:ETH:ready-band-entry` is an extra timing opportunity
  within an existing episode. There is no added independent impulse and no verified fill price.
- **ER20:** it loses two reference events, in ETH and ZEC, with no gained event. An extra
  indicator is therefore not automatically a less restrictive or better strategy.
- **Control band:** its three signals occur in two SOL episodes and share none of the six
  reference events. This shows sensitivity to the retracement definition; it does not rank the
  bands by returns. One example is `history:1791441000000:SOL:retracement-control`.

Stage counts follow each declared dependency graph, not one sequential funnel. For example,
the forensic reference has 52 alignment passes out of 205 dependency-eligible rows, ten
retracement passes out of 156, and zero confluence passes out of 52. Those populations differ.
Repeated rows, several crossings of one setup and correlated markets are not independent samples.

## Reproduction, finances and limits

All 858 original proposals reproduce with zero action-level divergences. Both independent PTS
analysis and original-account reproduction match all 429 full **initial** traces. The 429
final-clock projections differ from the preserved historical hold traces only in top-level `at`;
replacing that clock with the original time yields exact hashes. Historical holds retained their
initial traces. These clock differences are not incorrectly discarded actions. Exact final
portfolio reproduction remains explicitly unverifiable without its original pre-execution account.

The new candidates have no verified fills, positions, fees, funding path or P&L. Their financial
results remain `NOT_VERIFIABLE`, with null hypothetical positions and P&L. The original SMA
posted ledger subtotal remains −7.563085 AUSD: −7.249245 realized gross, −0.308084 fees and
−0.005756 funding. Three original SMA positions remain open; this subtotal is not a terminal
portfolio return. Original PTS has zero fills. API USD is separate from virtual AUSD.

Validation passed: 96 domain/offline tests, 38 isolated PostgreSQL regressions, formatting, lint,
all-workspace types plus final affected-workspace types, architecture, shared/Node builds and
four Worker dry-run builds. Independent verification checked ten artifact byte hashes, the
canonical published JSON hash, every history row, 142 stage denominators and 88 comparison sets.
Browser checks verified pagination, market/policy filtering and absence of external requests or
page errors. Initial local cache-permission failures are retained in the private validation logs;
the required Node build subsequently passed with normal cache access.

The next step is a separate reviewed financial protocol after complete executable books/funding,
causal setup consumption, disconfirming cases and an untouched chronological evaluation period
are available. Keep at most two independent hypotheses with the frozen reference and no-trade
control. No candidate is automatically promoted, and no new duration, runnable configuration,
data collection or public trial is authorized by these findings. See
[the research guide](PTS-CAUSAL-RESEARCH.md) for those conditions.

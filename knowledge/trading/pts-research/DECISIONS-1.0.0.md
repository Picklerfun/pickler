# PTS causal research decisions, documentation 1.0.0

Catalog: `pts-research-candidates-v1`. Candidate version: `0.1.0`. Baseline:
`pts-intraday@0.2.0-fast.2`. Knowledge: `pts-course@1.0.0`. Date: 2026-10-14.

## Identity and evidence boundary

The course describes channel direction, an impulse's reversal zone and subsequent confirmation.
It leaves numerical anchor selection, confirmation timing, tolerance and execution decisions
unresolved. The [manual](../pts/manual.md) identifies these interpretation gaps. Its source
references include M1C3 lines 35–56, M1C4 lines 9–35, M2C1 lines 20–46, M2C2 lines 8–23 and
M3C1 lines 45–64. These are one-based inclusive references to unchanged transcripts. They establish
what the course says, not whether a market meets a condition or whether a trading rule works.

The responsive baseline already interprets those concepts as native 1h primary, 15m
channel/impulse/ATR and 5m correction/entry. It uses strict two-neighbour confirmed pivots,
inclusive `[0.61, 0.78]` retracement, fixed channel tolerances, strict recovery above `0.38` and
entry below `0.495`. The four new candidates are explicit experimental changes to that
interpretation. ER20, `0.30`, the 32-setup cap, ready-band timing and `[0.40, 0.57]` are research
choices approved for this development analysis. They are neither course mandates nor optimal
parameters established by data.

The catalog pins the course bundle byte SHA-256
`e860f1912b2b09fcb97202fd3354fc594b42e573dd82a91f7271532d84c1ca30`
and the responsive policy byte SHA-256
`0631f6aba79b239b7c0957d0fbbad871d5bf99bff359263f38020f4d3a24d875`.
Its policy files equal the trading-owned research constants; each descriptor pins that file's
separate byte hash. The course, prior catalogs, SMA versions, financial policies and original
private exports are preserved.

## Examined development evidence

The frozen `pts-responsive-20261014-01` export contains 39 completed rounds and eleven market
identities. All 429 PTS decisions were holds: 224 primary blocks, 153 alignment blocks, 47
retracement blocks and five C-pivot blocks. No row first blocked at the recovery cross. Counts
describe the recorded first blocker; they do not establish that every later gate passed.
The input export canonical payload hash is
`ff08d73bb6db2554805175aa9fd51afd81427447a616b54be4d6054949e91020`.
The preserved preparation packet's `historyHash` is
`8aceb4c1977fa974fc3c1bd758938ba54db506425a2c063c35cbf600a41f7dce`.
Private file paths and byte hashes belong to the operator's input manifest and generated report,
not this Git catalog.

The 47 retracement rows reduce to five distinct A–B–C geometries and three distinct A–B impulses.
Across all 52 rows reaching impulse geometry, there are only four A–B impulses. Counts of market
rows and candidate windows are therefore not independent sample sizes. Episode IDs and shared
geometry IDs must accompany comparisons; keep repeated windows, distinct setups, distinct
impulses and effective independent samples separate. This already examined sample is development
data and cannot later be relabeled as blind holdout.

For HYPE, repeated `80.4584` extrema form a plateau. The baseline's strict pivot rule does not
confirm equal neighbouring highs. Even if that C were accepted permissively with A=`81.313`
and B=`79.2588`, the short retracement would be
`(80.4584 - 79.2588) / (81.313 - 79.2588) = 0.5839742965631383`, below `0.61`. A tie-rule change
alone cannot make this geometry satisfy the baseline reversal band. This counterfactual check
does not authorize changing the strict pivot rule, and no tie-repair candidate is registered.

## Frozen independent hypotheses

### primary-er20@0.1.0

Replace only primary trend with the last 21 closed consecutive native hourly closes, representing
20 price changes. Compute `ER20 = abs(c20 - c0) / sum(abs(ci - c(i-1)), i=1..20)`. At ER20
greater than or equal to `0.30`, use the sign of `c20 - c0` for long/short direction. A zero
denominator is neutral, not a divide-by-zero repair or a signal. Missing, nonconsecutive,
unfinished or future hourly evidence is unknown. Retain all baseline native minima and every
other gate, including channel alignment, so this is not a generic breakout or moving-average arm.

The mechanism is directional efficiency: net displacement relative to total travelled price
distance can separate a one-way move from a choppy path with similar endpoints. The threshold
does not claim calibrated trend probability, future return or profitability.

### persistent-setups@0.1.0

Change setup selection and lifecycle only. Retain each causally confirmed A/B/C geometry with
its original channel, ATR14 and structural stop fixed. Never refit old setups using later prices.
Keep at most 32 per market and direction; evict the oldest C-confirmation time first, then
ascending A–B–C ID. Among fully ready valid setups select earliest complete readiness, then
ascending A–B–C ID. A newer unready setup cannot erase an older ready one.

Retain the original 72-hour formation horizon and expiry at C confirmation plus 24 hours. Record
the first complete readiness as immutable admission time. From that admission onward, retire
on a verified neutral/opposite primary state or a closed 5m candle touching or breaching the
frozen structural stop; pre-admission primary states cannot retire a setup that was not active.
Validate the intervening primary and 5m histories; an uncovered gap
leaves lifecycle `NOT_VERIFIABLE` and cannot admit a signal. Only explicitly confirmed controlled
fixture signal IDs consume a setup. A hold, proposal, rejected proposal or returned signal does
not manufacture a confirmed fill.

### ready-band-entry@0.1.0

Change entry trigger only. Preserve original baseline crosses and their original expiry. Add one
chance at the first closed native 5m candle strictly after all unchanged prerequisites are ready:
A, B, C, current primary, alignment, channel, ATR14 and confluence. A bar closing exactly at the
last readiness instant is ineligible. Its recovery must satisfy strict `0.38 < recovery < 0.495`.
There is no delayed second attempt at an unsuccessful first eligible candle.

This additional trigger expires at the earlier of trigger time plus five minutes and C
confirmation plus 24 hours. Repeated inspection cannot shift readiness, create a new first candle,
or refresh trigger/TTL. Signals observed before complete readiness cannot be moved forward in time.
The experiment asks about causal availability after confirmation; it never backdates an entry.

### retracement-control@0.1.0

Replace only inclusive `[0.61, 0.78]` with inclusive `[0.40, 0.57]`. Both bands have width `0.17`.
All other geometry, entry and readiness rules remain those of the responsive baseline. This is
one fixed equal-width development control for ratio specificity. The sample has already been
examined, so it is not a blind placebo, a randomized trial, an optimal band or evidence that
non-Fibonacci prices earn excess returns. Do not search adjacent bands and omit failed trials.

## Invariants and future interpretation

No candidate changes SMA, sizing, leverage, exposure/risk caps, stops, partial quantities, targets,
fees, slippage, funding, maximum holding, UTC-day exits, fills or accounting. The offline engine
returns signals and gate evidence only; the original financial ledger remains separately audited.
Without complete original executable books and finalized funding, candidate financial return,
Sharpe, win rate, drawdown and fee savings remain unverifiable rather than zero.

Gate vectors report `PASS`, `FAIL`, `UNKNOWN` and `NOT_EVALUABLE_DEPENDENCY` independently from the
recorded first blocker. A later gate whose inputs depend on a missing or failed prerequisite
cannot count as passed. Native close dates and pivot right-neighbour confirmation dates bound
information time. Common clock/window and evidence hashes must match for gained/lost comparisons.

The [literature record](LITERATURE-1.0.0.md) explains why descriptive information, technical
predictability and tradeable net profit are separate questions. The
[local guide](../../../apps/agent-service/PTS-CAUSAL-RESEARCH.md) defines the conditioned future
financial protocol. No runnable public configuration, automatic promotion or new trial is created.

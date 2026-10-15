# Offline PTS causal research

This laboratory explains the bottlenecks in the frozen responsive PTS study and compares four
independent signal hypotheses. It reads explicitly pinned local files and writes a new report
directory. It makes zero model/provider calls and opens zero database connections. It creates no
financial accounts, public trial, Studio selection, executable strategy or runnable public config.

The baseline is `pts-intraday@0.2.0-fast.2`. The separate
[`pts-research-candidates-v1` catalog](../../knowledge/trading/pts-research/catalog.json) contains
`primary-er20@0.1.0`, `persistent-setups@0.1.0`, `ready-band-entry@0.1.0` and
`retracement-control@0.1.0`. Each changes one factor from that baseline; the engine evaluates
baseline plus four separate arms. It never stacks the four modifications. All financial/risk,
SMA, management, fee, funding and execution rules retain their existing versions.

## Immutable inputs and command

The operator supplies a `pts-research-input-v1` manifest with version `1`, `dataUse` equal to
`examined-development`, the exact baseline policy, all four exact research policies in catalog
order, an original audit export and a frozen responsive history packet. Every file has an exact
byte SHA-256. The audit also pins its canonical `payloadHash`; the history pins its canonical
`historyHash`. The history packet's candidate, optional policy hash and hash envelope must agree.
The original study must identify the same history bytes.

The [input schema](../../knowledge/trading/pts-research/schemas/input-v1.schema.json) describes the
shape. The [example](../../knowledge/trading/pts-research/examples/input-manifest.json) deliberately
names nonexistent private captures and zero placeholder byte hashes. It is not a runnable dataset
or authorization. Its example dates illustrate a seven-day window and do not assert available
market coverage. Use a separate private manifest containing the actual verified files.

From the repository root, after building shared packages:

```sh
npm run evaluate -- audit --state /absolute/private/pts-research-input.json --output /absolute/private/NEW_RESEARCH_DIRECTORY
```

This command dispatches research audit before environment, provider or database composition. It
accepts explicit `--state` and `--output`, rejecting config, environment and paid-execution flags.
Input paths resolve against the manifest or may be explicit absolute paths. Only bounded regular
local `.json` files are allowed; URLs, symlinked sources, credential/environment paths, unknown
fields, unknown candidates, wrong policy bodies and mismatched hashes fail closed. Segmented audit
parts retain their original hash/path/identity verification. Existing files remain untouched and
an existing output directory is rejected.

`historyWindow.from` and `.to` are explicit UTC milliseconds, aligned to 300 seconds, increasing
and contained within the saved history's own interval. The slice may span at most seven days.
Native history needs the baseline's 24 hourly, 240 fifteen-minute and 180 five-minute closed
consecutive bars. Missing coverage is retained as unknown; it is never interpolated. A requested
window does not prove that every market has sufficient native history.

## Pure business API and hypotheses

`@pickler/trading/pts` exports `PTS_RESEARCH_CANDIDATES`, `ptsResearchPolicy`,
`ptsResearchEr20`, `createPtsResearchSession`, `inspectPtsResearch` and `replayPtsResearch`, with
separate `PtsResearch*` types. The session caches causal prefixes for chronological inspection;
the replay visits closed 5m decision windows. Files, hashes and publication remain host duties.
The API returns diagnostic gates/signals, never proposals for financial execution. These IDs are
rejected by `ptsCandidateVersion`, `ptsPolicy`, `assertPtsConfig` and executable registry selectors.

| Arm                 | Exact experimental change                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Primary ER20        | Last 21 closed hourly closes, 20 changes; `abs(last-first)/sum(abs(changes)) >= 0.30`; direction is the net-change sign. A zero denominator is neutral; incomplete history is unknown. Only primary trend changes.                                                                                                                                                                                                               |
| Persistent setups   | Retain confirmed fixed A/B/C, channel, ATR14 and structural stop; cap at 32 per market/direction, evict oldest C confirmation then ascending A–B–C ID. Select earliest fully ready valid setup then ID. Keep 72h formation and C+24h expiry; retire at verified neutral/opposite primary or closed 5m stop touch/breach. Missing lifecycle coverage cannot admit. Only explicit confirmed controlled fixture IDs consume setups. |
| Ready-band entry    | Add one attempt at the first closed 5m candle strictly after every prerequisite is ready, including primary/alignment, requiring strict `0.38 < recovery < 0.495`. Expire at `min(trigger+5m, C-confirmation+24h)`. Keep genuine baseline crosses and original TTL; polling never refreshes it.                                                                                                                                  |
| Retracement control | Replace only inclusive `[0.61, 0.78]` with inclusive `[0.40, 0.57]`, the same `0.17` width. This is an examined development control, not a blind placebo or optimal ratio.                                                                                                                                                                                                                                                       |

Persistent setup admission records its first complete readiness. Selection orders that admission
time and then A–B–C ID; cap eviction instead orders C confirmation and then ID. Primary retirement
and structural-stop monitoring start at admission, while the unchanged expiry stays C+24h.

Pivot confirmation includes the right-neighbour closing times. Readiness cannot precede any
required pivot/channel/primary evidence. The additional ready-band attempt requires a strictly later
closed bar; an original qualifying cross retains the baseline's unchanged timing and expiry.
Neither a later inspection nor polling moves an old cross forward or backdates a fill. Structural stop
checks use closed candles and retain intervening coverage requirements.

The [decision record](../../knowledge/trading/pts-research/DECISIONS-1.0.0.md) gives the complete
provenance, tie example and frozen semantics. Numerical parameters are experimental implementation
decisions; the original course remains reference material with unresolved interpretation questions.

## What the outputs establish

| Artifact                                   | Evidence and limits                                                                                                                                                                                                                                                 |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `report.json`, `report.csv`, `report.html` | Recorded-round forensic rows for baseline plus four independent arms, source references, exact policy hashes, gate vectors, timestamps and summaries. HTML filters/paginates compact rows; full evidence stays in JSON/CSV.                                         |
| `historical-audit.csv`                     | Existing auditor replay of each recorded original SMA/PTS account decision, with original account inputs, source/trace hashes and explicit divergence/unverifiability. It does not reconstruct an exact final portfolio without its original pre-execution account. |
| `history-decisions.json`, `history.csv`    | Streamed chronological closed-5m projections for the explicitly requested saved-history window. These are newly calculated development signals, never original historical proposals or fills.                                                                       |
| `coverage.csv`                             | Original scheduled/recorded-slot coverage. Missing scheduled rounds remain unrecorded and do not become holds or hypothetical maintenance observations.                                                                                                             |
| `episodes.csv`                             | A–B impulses, their A–B–C corrections, first/last observations and signal identities, retaining repeated-row dependence.                                                                                                                                            |
| `stages.csv`                               | Gate dependency graphs, dependency-eligible denominators and pass/fail/unknown/not-evaluable counts with example row references.                                                                                                                                    |
| `protocol-future.json`                     | Disabled conditions for a separate future proposal; no selected candidate or executable config.                                                                                                                                                                     |
| `manifest.json`                            | Versioned v3 report integrity, actual published artifact byte hashes, canonical report hash and explicit hash policy.                                                                                                                                               |

Keep three questions separate. Historical trace reproduction checks the original policy against
its recorded inputs. Downstream gate sensitivity asks what a different definition would change
on those same dated inputs. Chronological signal replay limits every decision to evidence already
closed and confirmed at that time. None of the three establishes an actual new fill or profitable
counterfactual portfolio.

Each gate is `PASS`, `FAIL`, `UNKNOWN` or `NOT_EVALUABLE_DEPENDENCY`. A failed prerequisite excludes
its downstream gate from an eligible denominator; a passed early gate does not silently pass later
gates. The original first-blocker count is preserved as a distinct fact. Signal comparisons use
shared geometry/cross IDs so candidate-specific labels cannot manufacture gained/lost events.

The preserved 39-round study has 429 PTS holds: 224 primary, 153 alignment, 47 retracement and five
C-pivot first blockers, with none first blocked at a cross. The 47 retracement rows contain only
five A–B–C corrections and three A–B impulses; all 52 impulse-stage rows contain four A–B impulses.
Repeated polls and correlated markets are not independent samples. All supplied history has
already been examined and stays development data, even after a new analyzer runs against it.

The report's trading-owned financial audit reads only the original posted ledger, retaining open
positions and pending/unknown funding. Candidate positions and candidate net P&L remain null with
`NOT_VERIFIABLE`: original minute-by-minute books, exact execution-account state and hypothetical
funding paths are absent. Candles, a mark, valuation hashes or a favorable synthetic fill cannot
supply these missing inputs. No return ranking, fee-saving claim or Sharpe ratio is inferred.

## Evidence-informed next research

The [primary-source review](../../knowledge/trading/pts-research/LITERATURE-1.0.0.md) records six
sources with their markets, data frequencies, methods and transfer limits. Lo, Mamaysky and Wang
support explicit algorithmic pattern definitions; their daily-equity informativeness result is not
net-profit evidence. A Fibonacci study finds no advantage over non-Fibonacci zones in daily US and
German equities; it motivates a control without proving Perpl failure. Sullivan et al. motivate
accounting for all tried rules. Hudson and Urquhart show that daily crypto findings can fail to
persist out of sample. Cont et al. concern contemporaneous order-flow impact, not a profitable
next-bar forecast. The official Perpl candle fields expose collateral volume/trade count, not
exact VWAP. Full citations and source-access limits are retained in that versioned record.

ADX measures smoothed directional strength, RSI recent gain/loss balance, VWAP trade-price/quantity
weighting and OFI changes in best-quote supply/demand. Those are plausible mechanisms to study,
not indicators that promise profit. ADX/RSI would add periods, thresholds and interactions to this
small examined sample. ATR14 already scales the frozen baseline geometry/stop. Exact VWAP and
event-level OFI need data absent from the current candle capture. No extra indicator or combined
filter is introduced.

## Conditions for a separate future financial protocol

The current output may motivate a proposal only after disconfirming cases and complete causal
gate evidence are reviewed. A separate plan could select at most two independent candidates with
the frozen baseline and a no-trade control. It must freeze the policy hashes, common capital,
market cohort, decision clock, execution/management rules, risk caps and stop/acceptance criteria
before an untouched chronological evaluation period. It must never relabel the current seven-day
history as held out.

A financial counterfactual first needs complete original normalized ticker/books at every
maintenance minute, including rejected/missed observations and native/receipt/financial clocks;
full funding events over every position interval; fee tiers and immutable/revised market metadata;
and original admissions, pre-execution accounts, fills and ordered account transitions. Missing,
pending or disputed funding must retain its original status. Verify capture completeness before
estimating positions, exits, spread, depth, slippage, fees, funding and net P&L. Cost/stress scenarios
and risk-limit breaches must be reported under the same frozen assumptions for every arm.

The plan must record every tested candidate, failed threshold, changed definition and stopped
trial. Predeclare how multiple testing will be handled and what constitutes a new trial. Sample
adequacy must use distinct impulses/episodes and dependence across time and markets; raw row,
trade or bar counts are not effective independent sample sizes. Specify clustering/resampling,
uncertainty estimates, minimum effective sample requirements and what happens if activity is too
low to answer the question. Keep chronological development, validation and untouched evaluation
periods separate, with no retuning against the final period.

Any future public capture or trial requires separate explicit authorization and a reviewed plan.
This implementation writes only disabled protocol conditions and offline research artifacts.

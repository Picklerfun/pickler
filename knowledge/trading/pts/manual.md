# PTS trading method reference manual

PTS combines trend channels and Fibonacci drawings with reversal and continuation patterns. The
larger trend establishes the preferred direction; smaller timeframes provide entry confirmation.
Position management then follows structural invalidation and staged targets. This reference
preserves the course's concepts while identifying definitions a deterministic implementation still
needs.

The rule IDs below match [rules.json](rules.json). Source links point to unchanged Spanish
transcripts; cited line ranges are one-based and inclusive.

## Timeframes and trend direction

The monthly chart describes the primary trend, the weekly chart its state, and the daily chart the
more immediate movement. Four-hour, hourly and shorter intraday charts provide additional
confirmation. The course distinguishes short operations from swing positions that may last several
weeks or months. It does not impose one universal 24-hour exit.

Within an upward channel, the preferred opportunity is a long following a correction toward the
lower boundary. Within a downward channel, it is a short after a rebound toward the upper boundary.
The course gives the larger channel priority over an internal channel moving in the opposite
direction. A breakout in the primary trend's direction and a breakout against that trend have
different interpretations.

An implementation must define how pivots become confirmed, how channels are fitted, what proximity
to a boundary means, and how sideways or conflicting trends are handled. The text's drawings cannot
be replaced silently with a moving-average trend rule.

Rules: `timeframes`, `trend-direction`. Sources: [M1C3](sources/m01-c03.txt), lines 35–56;
[M1C4](sources/m01-c04.txt), lines 9–35; [M1C5](sources/m01-c05.txt), lines 195–208.

## Fibonacci drawings and reversal zones

The course speaks of `0.23`, `0.38`, `0.61` and `0.78`. It uses the `0.61–0.78` retracement region as
a reversal zone of a selected prior impulse. Entry confirmation follows a new movement through
`0.23` or `0.38` on the relevant drawing. The drawing direction depends on whether the analyzed
impulse is upward or downward.

Each level must retain its anchor prices, anchor times, direction and drawing role. A reversal zone
for a prior impulse and a target region for a new impulse may share ratios while describing
different price levels. Ratios alone cannot identify a market condition.

The transcript may round conventional ratios. Its references to `0.23` must not automatically become
`0.236`, nor `0.61` become `0.618`. Exact ratios, anchor selection, tolerances and cross confirmation
remain review decisions.

Rules: `retracement`, `entry-trigger`. Sources: [M2C1](sources/m02-c01.txt), lines 20–46;
[M2C2](sources/m02-c02.txt), lines 8–23; [M3C1](sources/m03-c01.txt), lines 45–64.

## Basic reversal setup

The practical example starts with the weekly trend and channel. A correction in an uptrend or a
rebound in a downtrend approaches the relevant channel boundary and the previous impulse's reversal
zone. Subsequent confirmation establishes the prospective entry. Phi and a mother wave can reinforce
the scenario; they are not presented as mandatory features of every basic setup.

The proposed first analysis candidate in [candidate-policy.json](candidate-policy.json) uses this
setup. It requires explicit findings for larger trend, weekly channel, boundary proximity,
retracement zone, entry confirmation, structural invalidation and data quality. Those findings remain
unknown until the necessary measurements and definitions exist. This selection is an integration
proposal, rather than an executable specification supplied by the course.

Rule: `basic-setup`. Source: [M3C1](sources/m03-c01.txt), lines 16–59.

## Mother wave and Phi

An **onda madre**, or mother wave, describes an approximately complete retracement to the impulse's
origin, shown as `1.00`, while the larger trend remains relevant. The subsequent movement through
`0.23` or `0.38` provides confirmation. A detector needs an allowed tolerance around the origin,
confirmed anchors and a maximum formation duration.

**Phi** describes the course's extension into `1.27–1.61` followed by reversal confirmation,
preferably aligned with the larger trend. The spelling varies in the transcripts. A candidate Phi
and a confirmed Phi must remain distinct; crossing an extension ratio alone does not reproduce the
full illustrated geometry.

A mother wave after Phi reinforces the scenario in the examples. The course shows multiple waves
and alternative stop anchors. A first implementation needs a selected variant and labeled positive
and negative examples.

Rules: `mother-wave`, `phi`, `phi-mother`. Sources: [M2C6](sources/m02-c06.txt), lines 6–38;
[M2C7](sources/m02-c07.txt), lines 22–41; [M2C8](sources/m02-c08.txt), lines 13–35.

## Additional technical patterns

| Pattern                                 | Course interpretation                                                                                | Definition still needed                                                                                       |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Failed triangle, or triángulo reventado | A break fails, price returns toward the vertex, then confirms in the opposite direction.             | Triangle geometry, vertex, return tolerance, confirmation window and whether it supports an exit or an entry. |
| Phi wedge                               | A wedge combines with Phi, sometimes also a mother wave, and confirms through `0.23` or `0.38`.      | Pivot counts, slope, convergence and the selected pattern variant.                                            |
| Leading diagonal                        | The course's failed wedge reverses with Phi or a mother wave, then breaks the preceding high or low. | Previous extreme, sequencing and course-specific geometry.                                                    |
| Seller covering                         | A bearish mother-wave extension near `2.61` identifies a possible bounce or turn.                    | Zone width and additional confirmation; reaching `2.61` alone is not an entry.                                |

The leading diagonal name must retain the course's meaning rather than inherit a different
technical-analysis definition. Its transcript ends mid-sentence. Module 3 lesson 6 was not supplied;
failed flags appear in other lessons, but there is insufficient material here to define a separate
complete detector.

Rules: `failed-triangle`, `phi-wedge`, `leading-diagonal`, `seller-covering`. Sources:
[M3C4](sources/m03-c04.txt), lines 6–29; [M3C5](sources/m03-c05.txt), lines 7–23;
[M3C7](sources/m03-c07.txt), lines 23–44 and 131; [M3C8](sources/m03-c08.txt), lines 10–28.

## Continuation and pattern placement

The course separates reversal patterns near a trend's boundaries from continuation patterns inside
an ongoing move. It describes intraday opportunities within macro impulse ranges `0.38–0.61` and
above `0.78`. It considers `0.61–0.78` less favorable for these intermediate entries, although the
same ratios define a correction's reversal zone on a different drawing.

At an extended trend boundary, an opposing pattern can warn of a correction. That warning is not
automatically a new countertrend entry. A continuation setup requires its own timeframe, anchor and
management definitions, separate from the initial reversal candidate.

Rule: `intermediate-ranges`. Sources: [M3C3](sources/m03-c03.txt), lines 11–45;
[M3C9](sources/m03-c09.txt), lines 1–29 and 46–50.

## Structural stops and break even

The course places stops beyond a selected pattern extreme or outside the reversal zone, depending
on the setup. It provides alternatives rather than one universal percentage distance. An executable
policy must select the invalidation anchor, a buffer, permitted order semantics and liquidation
constraints.

After entry at `0.23`, the course moves the stop toward entry when price reaches `0.38`. After entry
at `0.38`, it describes doing so halfway toward `0.61`. That midpoint is spoken of near `0.50`;
whether to use the exact midpoint of the reviewed ratios needs definition.

A stop at entry price and zero net loss are different once commissions, spread, funding and
slippage apply. A future policy must define the intended meaning and persist each stop transition.
A possible sweep never authorizes widening a protective stop or bypassing host limits.

Rules: `structural-stop`, `breakeven`. Sources: [M3C1](sources/m03-c01.txt), lines 57–68;
[M3C4](sources/m03-c04.txt), lines 24–29.

## Targets and partial exits

Initial targets include `0.61` and `0.78`. A confirmed move can extend toward `1.00`, `1.27` and
`1.61`, with `2.61` in extended scenarios. One practical example discusses partial profits of
`15%` or `20%`; it does not settle a single schedule, whether percentages apply to initial or
remaining quantity, or how the final remainder exits.

For unusually strong moves, the course also uses a three-anchor Fibonacci extension: impulse start,
impulse end and correction end. It describes targets `2.61`, `3.61` and `4.61`, with spoken rounding
in the same lesson. This extension is a different drawing from a two-anchor retracement.

An executable policy needs a reviewed partial schedule, an extension eligibility rule and explicit
event ordering when a stop and target occur within the same candle. Historical bars cannot reveal
intra-candle order without additional data or a declared conservative assumption.

Rule: `targets`. Sources: [M3C1](sources/m03-c01.txt), lines 65–70 and 126–133;
[M4C1](sources/m04-c01.txt), lines 27–33; [M2C5](sources/m02-c05.txt), lines 1–25.

## Account risk and leverage

The course describes approximately `1%` account risk for short operations, `2%` for swing and up to
`4%` as an infrequent exception. These are attributed course values, not selected limits for the
agent. They refer to planned account loss, rather than the percentage deposited as margin.

Its leverage example holds the intended economic exposure constant while using less margin.
Increasing leverage is not a reason to multiply the chosen risk. A future deterministic sizing
service must relate approved account risk to structural stop distance, include costs and aggregate
exposure, and apply existing creator caps, available margin and liquidation constraints. Missing
cost or account evidence must not be interpreted as zero.

Rules: `risk-account`, `leverage-exposure`. Source: [M1C2](sources/m01-c02.txt), lines 49–62 and
107–128.

## Breakouts and liquidity explanations

Different lessons describe a quick recovery of a reversal zone, `24` hours, `48–72` hours for channel
behavior, or at least `72` hours in a later summary. These statements concern different structures
and are not one consistent universal confirmation timer. A policy needs a matrix by structure and
timeframe, including calendar hours versus market sessions.

The liquidity lesson describes sweeps and induction as explanations of false breaks and participant
positioning. Observed price movement can support a defined break-and-return measurement; it does
not prove market-maker intent. These explanations cannot justify assuming a future recovery after
invalidation has occurred.

Rule: `rupture-confirmation`. Sources: [M2C1](sources/m02-c01.txt), lines 70–77;
[M1C5](sources/m01-c05.txt), lines 88–100; [M4C1](sources/m04-c01.txt), lines 14–18;
[M3C2](sources/m03-c02.txt), lines 6–42.

## Market correlations and macro context

The course uses S&P 500 and Nasdaq for broad context, VIX for an opposing relationship, and
alternative equity indices or instruments for divergences. Some transcribed symbols are ambiguous,
including `HIG`; do not silently resolve them to another ticker. Transport index references must
identify the intended index rather than substitute a similarly named stock.

For crypto, it discusses `USDT.D`, `BTC.D`, `TOTAL2` and the equity referred to as Microstrategy.
These are course-era references. A data adapter must verify instrument identity, dominance
methodology, observation dates and stock-market sessions versus continuous crypto trading.
Correlation must be measured over defined, aligned observations; it is not an unconditional causal
rule.

The course also discusses QE and QT, the Fed, Treasury, inflation, unemployment and put/call. These
are the author's explanations of context. Current facts and a machine policy require separately
verified definitions, instrument or series selection, publication times and reviewed criteria.
Prices and forecasts from the historical examples cannot be reused as current evidence.

Rules: `context-equities`, `context-crypto`, `context-macro`. Sources:
[M4C2](sources/m04-c02.txt), lines 12–35; [M4C3](sources/m04-c03.txt), lines 1–18;
[M4C4](sources/m04-c04.txt), lines 1–18; [M4C5](sources/m04-c05.txt), lines 1–23;
[M4C6](sources/m04-c06.txt), lines 18–37, 42–64 and 70–103;
[M4C7](sources/m04-c07.txt), lines 1–21 and 183–198; [M4C8](sources/m04-c08.txt), lines 1–20.

## Evidence and evaluation

A course citation supports an interpretation of PTS. A current setup needs separate market data,
identified measurements and criteria. Keep candidate patterns, confirmed patterns and unknown
findings distinct. The course's confidence language and favorable examples are not a measured
success rate.

Before implementing executable behavior, resolve [open questions](open-questions.json), review
labeled examples and counterexamples, and replay observations using only information available at
the signal time. Simulations need explicit fees, funding, slippage and event ordering, followed by
evaluation on reserved data. The existing account, risk and persistence services remain the owners
of financial execution.

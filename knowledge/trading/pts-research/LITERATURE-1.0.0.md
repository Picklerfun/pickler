# PTS methodological evidence, version 1.0.0

Reviewed 2026-10-14. These six primary sources motivate explicit definitions and honest testing;
they neither validate the new thresholds nor establish Perpl five-minute net profitability.
Summaries below distinguish each paper's result from this catalog's methodological inference.
No paper supplies a substitute for the original course or the frozen baseline policy.

## Lo, Mamaysky and Wang (2000)

[Foundations of Technical Analysis: Computational Algorithms, Statistical Inference, and Empirical
Implementation](https://www.mit.edu/~wangj/pap/LoMamayskyWang00.pdf), Journal of Finance 55(4),
1705–1765. The authors define chart patterns algorithmically using nonparametric smoothing and
compare conditional and unconditional daily return distributions for US stocks over 1962–1996.
Several indicators contain incremental distributional information. Their setting is daily equities
and their pattern definitions differ from PTS.

Methodological inference: make pattern definitions and information dates reproducible, then test
their implications. Informativeness is a different claim from an executable strategy earning net
profit after costs. This paper does not validate Fibonacci levels, ER20 `0.30`, Perpl liquidity,
five-minute entries or the present risk/exit policy.

## Tsinaslanidis, Guijarro and Voukelatos (2022)

[Automatic identification and evaluation of Fibonacci retracements: Empirical evidence from three
equity markets](https://doi.org/10.1016/j.eswa.2021.115893), Expert Systems with Applications 187, 115893. An [author manuscript at Universitat Politècnica de València](https://riunet.upv.es/server/api/core/bitstreams/07add8c4-4239-44e7-bf1f-93d66108918d/content)
is also available. The study uses daily stocks from US Dow Jones/NASDAQ and German DAX markets,
algorithmically defines support/resistance zones and compares Fibonacci with non-Fibonacci zones.
It finds no statistically distinguishable bounce advantage and no trading-rule outperformance
against the non-Fibonacci comparison. Wider zones increase apparent bounce detection without
establishing better trading performance.

Methodological inference: compare ratio specificity with a control and report zone width. The
fixed `[0.40, 0.57]` control addresses that question narrowly. It was selected for development,
not randomized blindly. Daily equity findings do not prove either success or failure for a full
Perpl five-minute PTS strategy. The repository endpoint presented an access challenge during the
review; the publisher's primary-source abstract/introduction and indexed author-manuscript text
supported this summary. No unavailable table is represented as independently reproduced.

## Sullivan, Timmermann and White (1999)

[Data-Snooping, Technical Trading Rule Performance, and the Bootstrap](https://doi.org/10.1111/0022-1082.00163),
Journal of Finance 54(5), 1647–1691. The paper applies White's Reality Check bootstrap to a broad
universe of technical rules and about a century of daily Dow Jones data, explicitly accounting
for selection from the full set of rules examined. The publisher abstract is the reviewed source;
no detailed result table is reproduced here.

Methodological inference: record all attempted candidates, failed variants and later parameter
revisions, and define multiple-testing treatment before judging a winner. Comparing four arms
does not erase prior exploratory choices, and correlated rows are not new independent trials.
The paper supplies a testing principle, not approval of any PTS numerical parameter.

## Hudson and Urquhart (2019 online; 2021 volume)

[Technical trading and cryptocurrencies](https://doi.org/10.1007/s10479-019-03357-1), Annals of
Operations Research 297, 191–220. The authors examine 14,919 technical rules across five rule
families on daily Bitcoin, Litecoin, Ethereum and Ripple data, with multiple-testing procedures
and transaction-cost analysis. They report predictive/profit results in the examined samples,
but Bitcoin does not retain predictability in the out-of-sample period; results vary by asset.

Methodological inference: neither a favorable in-sample technical result nor the word crypto
guarantees transfer across assets, dates, market structure, leverage and bar frequency. This study
does not test Perpl, native five-minute perpetuals, the frozen PTS geometries or present execution
costs. Preserve a chronological held-out period and report failures as well as successful arms.

## Cont, Kukanov and Stoikov (2011 preprint)

[The Price Impact of Order Book Events](https://arxiv.org/abs/1011.6402), arXiv:1011.6402v3.
Using NYSE TAQ observations for 50 US stocks, the authors relate short-interval price changes to
order-flow imbalance from best bid/ask events. The estimated price impact varies inversely with
market depth, and the order-flow relationship is more robust than one based on trade volume.

Methodological inference: order-flow imbalance has a concrete microstructure mechanism, but this
is principally a contemporaneous impact result. It is not evidence that an end-of-bar imbalance
predicts the next bar with profitable execution. Applying it here would require synchronized
ordered additions, cancellations, trades and best-quote changes, explicit missing-event rules and
prospective lagged validation. OHLC candles or one static order-book imbalance cannot reproduce
the required order-flow history.

## Perpl Foundation REST specification

[Official REST candle contract](https://github.com/PerplFoundation/perpl-docs/blob/main/docs/resources/for-developers/api/rest.md).
The official candle record gives OHLC prices, `t` as open timestamp, `v` as collateral-token
volume and `n` as trade count. It supports native 1h, 15m and 5m resolutions used here. This is a
data-format specification, not performance evidence.

Methodological inference: neither `v` nor `n` is an exact VWAP field. Exact trade VWAP needs
compatible executed price/quantity pairs or their exact numerator and denominator; multiplying a
candle's typical price by collateral volume is a different approximation. Do not relabel that
approximation as exact VWAP or infer buy/sell order flow from trade count.

## Indicator mechanisms and deferred additions

This catalog's design inference is to isolate confirmed bottlenecks before adding correlated
filters. No indicator promises profit, and more filters can reduce activity while increasing the
number of tried hypotheses.

| Indicator                    | Mechanism                                                                                                            | Why no additional arm is introduced                                                                                                                                                       |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ADX and directional movement | Smoothed directional movement relative to true range measures trend strength; ADX itself has no direction.           | It would add a smoothing horizon and threshold on top of existing direction/alignment. ER20 already isolates one transparent primary definition; evidence does not justify stacking both. |
| RSI                          | The ratio of smoothed positive and negative close changes measures recent directional balance.                       | Overbought/oversold labels alone do not establish reversal timing. A period, smoothing rule, threshold and trend interaction would introduce additional untested choices.                 |
| ATR                          | True range includes intrabar range and gaps; an average scales geometry and stops to recent volatility.              | ATR14 already exists in the unchanged baseline's channel tolerance and structural stop. Adding another ATR gate would change the hypothesis and potentially the risk geometry.            |
| VWAP                         | Executed price weighted by executed base quantity summarizes where volume traded during a defined session/window.    | Existing candle collateral volume and trade count cannot establish exact VWAP. The session anchor, reset, trade completeness and cost relationship are unresolved.                        |
| OFI                          | Event-by-event changes in supply/demand at best quotes describe short-horizon pressure and market-depth interaction. | A static book or OHLC history lacks the required ordered event stream. Cont et al.'s contemporaneous result cannot be promoted to a next-bar forecast.                                    |

Any later indicator would need its own version, single-factor rationale, exact data contract,
recorded trial and independent validation. None can be added silently to these published policies.

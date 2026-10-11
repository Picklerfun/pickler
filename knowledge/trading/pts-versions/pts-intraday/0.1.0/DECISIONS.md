# Intraday temporal adaptation — decision record 1.0.0

Identity: `pts-intraday@0.1.0`. Knowledge: unchanged `pts-course@1.0.0`.
This is an independent experimental policy, not a correction of basic PTS 0.2.0. The course's
fractal observation supports investigating shorter frames, not selecting these numerical values
or claiming profitable intraday trading. See [fractal discussion](../../../pts/sources/m02-c01.txt)
and [timeframe context](../../../pts/sources/m03-c05.txt). All choices below are experimental.

| Decision             | Frozen interpretation                                                                                                                                                          | Reference                                                                                              |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| timeframes           | Native 1d primary, 4h channel, 1h impulse/ATR, 15m correction, 5m trigger; minimum 24/104/240/180/168 consecutive completed bars                                               | Course fractal discussion above; no rescaled timestamps                                                |
| trend-direction      | Two confirmed highs/lows, both increasing/decreasing; equality/conflict neutral, missing evidence unknown                                                                      | Preserve [basic definitions](../../pts-trend-reversal/0.2.0/DECISIONS.md) with explicit temporal roles |
| risk-account         | 1% planned opening loss, 3% aggregate; exact decimal sizing with known fees and 50-bps exit provision                                                                          | Basic risk decision, unchanged experimental values                                                     |
| leverage-exposure    | 1x, 100 AUSD, five positions, selective 40% admission/50% reduction, 3% daily/5% drawdown emergency                                                                            | Existing financial policy, not a course optimization                                                   |
| retracement          | Separate correction A→B and recovery C→B, inclusive 0.61–0.78 correction                                                                                                       | Basic retracement definition and pinned course sources                                                 |
| basic-setup          | Daily primary/4h channel alignment, three channel contacts, correct slope/positive width; hourly impulse B no older than 72h; confirmed 15m C                                  | Basic geometry, new temporal roles/clocks                                                              |
| entry-trigger        | Closed native 5m cross strictly above 0.38 (mirrored for shorts); C known before cross; five-minute expiry and C no older than 24h; projected fill strictly between 0.38/0.495 | Preserve basic crossing/late-entry semantics                                                           |
| structural-stop      | Beyond C by max(one tick, 0.10×hourly ATR14); never widen                                                                                                                      | Basic stop geometry, ATR timeframe explicit                                                            |
| breakeven            | At 0.495 move to actual entry, price equilibrium only                                                                                                                          | Basic break-even; costs remain charged                                                                 |
| targets              | 20% initial quantity at 0.61, 20% at 0.78, remainder at 1; combine reached targets, stops/emergencies first                                                                    | Unchanged confirmed partial accounting                                                                 |
| rupture-confirmation | Verified daily/4h invalidation or two closed hourly bars outside frozen channel/tolerance; max six hours and close at UTC day end                                              | Explicit intraday exits, not basic's seven-day horizon                                                 |

Strict two-neighbour pivot confirmation, ambiguity/normalization information times and all ratio,
channel and rounding formulas remain shared business functions. One confirmed opening consumes a
version-qualified market/direction/A/B/C setup permanently. Final evidence can cancel, never
promote a hold, reverse direction or substitute anchors. Caches and financial clocks retain the
existing public guards and native timestamps. No monthly/weekly warmup is required by this identity.

The first prospective experiment is bounded at 24 hours, with a simultaneous independent original
hourly SMA reference. It compares complete policies, not entry horizons alone. Preparation captures
seven rolling days plus native warmup; candle-only replay reports signals and coverage, never
hypothetical realized P&L. Positive synthetic paths are circuit tests only. No automatic tuning,
repetition, promotion, real order, model call, merge or deployment follows this descriptor.

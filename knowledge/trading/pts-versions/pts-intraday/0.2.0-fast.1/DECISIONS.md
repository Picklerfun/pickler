# Fast intraday temporal decision record 1.0.0

Identity: `pts-intraday@0.2.0-fast.1`; reference: `pts-course@1.0.0` and independent
`pts-intraday@0.1.0`. This is a prerelease experiment, not an unequivocal rule from the course.
The original [decision record](../0.1.0/DECISIONS.md) and its source citations remain unchanged.

The saved seven-day diagnostic motivated changing primary/channel/impulse/correction/entry roles
to native 4h/1h/15m/5m/5m. Required counts are 24/104/240/180; the shared 5m count is the maximum
of the old correction and entry minima. No daily dependency is retained solely for this candidate.
This selection used observed historical data and is exploratory, not an independent holdout.

All strict dated pivot rules, alternating normalization, channel geometry, rational ATR14,
retracement, trigger, fill, stop, targets and financial controls are reused. Temporal lifetimes stay
72h formation, 24h correction, five-minute entry, six-hour holding and UTC day end. Invalidation
uses the candidate's native primary/channel/impulse roles. These periods and counts are experimental,
not optimized or source-mandated. Only explicit complete native coverage establishes eligibility.

One actual 5m series supplies both C and entry: C must be confirmed before the strict cross.
Opening, target consumption and structural stop updates retain the existing account transaction.
No rejection consumes a setup; no closure releases it. Cross-version intents are rejected.

Current 0.1.0 prospective data and results remain attributed to its frozen identity. No financial
counterfactual is inferred from candles and no public fast trial is started by this delivery.
See [implementation and command guide](../../../../../apps/agent-service/PTS-INTRADAY-FAST.md).

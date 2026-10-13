# Responsive intraday PTS

The independent local candidate pts-intraday@0.2.0-fast.2 uses the existing v9 perps-pts-intraday-sma-v1 commands and two independent SMA/PTS portfolios. It is absent from Studio and deployed selectors.

| Role                    | Native frame | Minimum |
| ----------------------- | ------------ | ------- |
| Primary trend           | 1h           | 24      |
| Channel and impulse/ATR | 15m          | 240     |
| Correction and entry    | 5m           | 180     |

Only primary/channel horizons differ from [fast.1](PTS-INTRADAY-FAST.md). Preserve shared sixty-bar SMA eligibility, all PTS geometry, five-minute entry expiry, six-hour/day-end exits, partials and financial controls. The same native 15m history supplies two roles; separate conflicting histories for that resolution are invalid.

See the [immutable candidate descriptor](../../knowledge/trading/pts-versions/pts-intraday/0.2.0-fast.2.json) and [decision record](../../knowledge/trading/pts-versions/pts-intraday/0.2.0-fast.2/DECISIONS.md). New preparation must pin this identity and policy hash; never rename an old prepared session or resume an interrupted trial. Explicit offline projections identify the original source bytes and their new analyzer policy without claiming that the historical provider request selected this candidate.

The ten-minute reader diagnostic verified ten complete eleven-market cycles, zero query failures and released resources, but it is not thirty-minute financial qualification or proof of the original statement-timeout cause. Five concurrent controlled reports completed during actual coordinator observations without SQL failure. Original interrupted accounts remain pending.

The 48-round replay produced no responsive entries. Seven-day native candle replay produced seven signal windows and six setups; it supplied no financial return. Complete original books/funding remain necessary for financial claims, and this development sample cannot certify future profitability.

The candidate retains the fixed 24-hour pilot, five-minute decisions, minute observations, 90-second lease and 20-second renewal. Public data remains the explicit unchanged component-paper WebSocket policy; requests and cache reuse keep current permission/ownership checks. No models, Exa, signing, budget reset, fallback, deployment or automatic promotion is added.

Implementation remains in development until controlled PostgreSQL/command/consumer checks and a clean one-file-per-commit delivery pass. This guide does not start a public trial. Keep failed reports and unverified timeout causes separate from the candidate's signal evidence.

## Omission presentation

The versioned pts-omitted-row-presentation-v1 presentation joins explicit stored omittedSlots to rows with no recorded decision. Such rows display DATA_UNAVAILABLE with their original phase/cause, sourceStatus and sourceReason. Future or absent evidence remains NOT_RECORDED; completed holds and partial decisions remain distinct. Unknown phase/cause stays null, and no market observation is reconstructed. This is report presentation only: signals, financial values, policy hashes, original exports and frozen executions remain unchanged. Use offline audit into a new directory to inspect an existing study with the corrected renderer; never hot-patch or restart an active runner for a report change.

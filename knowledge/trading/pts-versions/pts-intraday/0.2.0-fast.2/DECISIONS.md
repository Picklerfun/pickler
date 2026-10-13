# Responsive intraday PTS decisions, documentation 1.0.0

Candidate: pts-intraday@0.2.0-fast.2. Reference knowledge remains pts-course@1.0.0.

This independent experimental candidate changes the primary trend from 4h to 1h and the channel from 1h to 15m. The impulse and ATR remain 15m; correction and entry remain one native 5m series. Channel and impulse now share one native 15m series. These are experimental choices, not unambiguous course instructions or proven optimal settings.

Required native minima are 24 hourly, 240 fifteen-minute and 180 five-minute closed consecutive candles. The 15m count supplies both the 104-bar channel role and 240-bar impulse role. Shared SMA eligibility still requires sixty 1h/15m/5m bars. There is no daily or 4h requirement for this candidate; earlier candidates keep their native requirements.

Reuse the original strict two-neighbour dated pivots, channel geometry, inclusive 0.61–0.78 retracement, channel tolerance, strict 0.38 recovery cross and projected fill below 0.495. Preserve the five-minute trigger window, 72-hour formation and 24-hour correction expiry, six-hour/day-end exits, stops, break even and 20%/20%/remainder targets.

All financial controls remain from 0.2.0-fast.1: 1% opening and 3% aggregate planned loss, maximum 100 virtual AUSD, 1x, five positions, 40%/50% selective exposure and the existing emergency policy. Setup, intent and immutable account versions must agree; a published version never changes an earlier account.

The development evidence is a paired analysis of 48 recorded complete rounds: 4h/1h aligned in 0/480 observations; 1h/15m aligned in 96/480. The complete responsive policy still held in all 480: 201 neutral primary, 183 alignment blocks, 82 retracement blocks, 12 channel-confluence blocks and two channel blocks. Alignment alone is not an executable entry.

A seven-day replay of the preserved Perpl packet produced seven signal windows representing six distinct setups: four long windows and three short windows. It computed no profit because complete original books and funding were absent. This is observed development evidence, not an independent holdout or a profitability result. The source packet byte hash is ac6e12de9c81c448a5a5d6bf7af4b1c9eab7041f7085a5bf01c9256da1e73c65.

Controlled tests demonstrate mirrored long/short detection for all eleven identities, actual coordinator entries, three partial quantities and final closes. Synthetic favorable prices demonstrate circuit behavior only. PostgreSQL admission/ownership, runtime/offline command parity and consumer checks must pass before a clean commit and configuration can be frozen for a new authorized pilot.

The earlier study and pending positions remain intact. Its statement timeout is confirmed, but the original server wait/blocker is not verifiable. A later ten-minute public-only diagnostic and concurrent controlled report test did not reproduce it. Neither proves that a future financial trial will be uninterrupted.

Sources: [previous fast decisions](../0.2.0-fast.1/DECISIONS.md), [previous policy](../0.2.0-fast.1/policy.json), [current policy](policy.json), and the immutable course bundle referenced by the descriptor. No additional pattern, macro model, Exa input or deployed selection is introduced.

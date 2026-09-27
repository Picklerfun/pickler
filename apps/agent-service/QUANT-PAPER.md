# BTC quantitative paper laboratory

`paper:quant` is a separate, opt-in local protocol (`btc-quant-jev-v1`). It never signs or submits an order. It uses public Polymarket metadata/opening references and Coinbase ticker/candles, then optionally asks Jev to review a quantitatively viable proposal. No DeepSeek or Exa fallback exists. This is experimental, uncalibrated research, not investment performance validation.

## Configuration and commands

Run shared builds first. Use the existing app `.env` for `TYPESAFE_API_KEY` only. Put a version-2 configuration in ignored `.data` using `quant-paper.example.json`. All previous local study IDs must be declared in `historicalStudies`; their reservations, including unknown charges, count against the original $5 authorization. The new reservation ceiling cannot exceed $0.10. Verify Jev pricing before explicitly approving a live run. Never delete historical STOP files or reset old ledgers.

From `apps/agent-service`:

```sh
npm run paper:quant -- preflight .data/quant.json
npm run paper:quant -- history .data/quant.json
npm run paper:quant -- run .data/quant.json --allow-paid
npm run paper:quant -- settle .data/quant.json
npm run paper:quant -- report .data/quant.json
```

Preflight reads public markets and inputs only. History downloads seven days of public candles with a five-day development/two-day chronological evaluation split. Its opening/final-minute closes are proxy labels, not official TWAP outcomes or a Polymarket P&L backtest. Missing candles are excluded, never filled. Parameters are frozen before the evaluation partition; no optimization on holdout data.

Run permits a two-hour admission period and up to 24 five-minute / 8 fifteen-minute markets, one attempt per market. Admission occurs 60–90 seconds after the window starts; missed windows are skipped. The machine must remain awake. Settlement-only public queries may continue for another 24 hours while the process is alive. Ctrl+C or STOP ends the process; explicit `settle` does no discovery, inference or purchase, does not require model credentials, and remains usable after STOP while respecting Polymarket permission. Never infer a resolution from elapsed time or spot prices.

## Model and execution

Sixty log returns require **61 consecutive completed one-minute closes**. Ticker maximum age is 10 seconds, latest completed candle maximum age 90 seconds. The protocol uses zero drift, sample volatility per second and an arithmetic normal approximation to a **final rolling average**, with variance proportional to `H - 2L/3` for remaining horizon H and lookback L. Only reviewed per-market 30/60-second metadata matching the rules is accepted. Coinbase is a predictive proxy, not the resolution authority. Missing live Chainlink data is a limitation rather than a veto.

Up/Down probabilities are complementary and linked to actual outcome IDs. Sensitivity uses volatility factors 0.75/1/1.25 and price shifts of ±max(5 basis points, current relative spread). These bounds are assumptions, not confidence intervals. Zero volatility, invalid rules or missing inputs fail explicitly.

The full-budget simulator evaluates both sides at ten virtual units, with actual depth, fee estimates, ticks and minimums. A proposal requires lower-bound probability minus effective cost per share above three percentage points. No edge means a persisted forecast and abstention without a Jev call. Jev can veto concrete identity, resolution-rule or evidence contradictions only when both selected probability and confidence reach 0.90. Generic doubt is not a veto. Refresh inputs after review; never increase the approved price limit or switch outcome. Price/fee changes can remove the opportunity.

Jev receives at most 30,000 UTF-8 request bytes and has a 30-second timeout, no retries. Reserve 65,536 input tokens at the configured rate before transport. Output tokens are counted but free. Invalid responses preserve known usage and safe diagnostics and stop paid admissions. An uncertain transport charge remains reserved. The existing historical answer-schema failures are not assumed fixed.

## Results and limitations

Each study contains state.json, immutable configuration metadata, campaign linkage, index.html, results.csv, summary.json and optional history-proxy.json. Forecast, review, policy result, fill and resolution remain separate. Model failures never become valid abstentions. Finalized Polygon evidence resolves every forecast, including abstentions; nonbinary payouts are excluded from binary Brier scoring. Virtual fills use displayed liquidity without competition or latency guarantees.

Report Brier score separately by horizon against 50% and the contemporaneous midpoint where available. Correlated overlapping windows are not independent trials. No real wallet funds or portfolio are modeled. Historical study v1 remains untouched/readable through its existing commands. No database migration or hosted API change is needed.

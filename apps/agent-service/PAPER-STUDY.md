# Continuous local paper study

This operator laboratory observes current BTC 5-minute/15-minute Up/Down markets and soccer/NFL full-game winners. It performs prospective research, applies the existing conservative decision policy, simulates a ten-unit purchase against refreshed public liquidity, and checks finalized Polygon payouts. It never signs, sends an order, reads trading credentials, or spends wallet funds.

This is a **separate local study protocol**, not an extension of the deployed sports catalog or proof that the complete production agent works on crypto. Sports uses two web searches and two model calls; BTC uses completed one-minute Coinbase reference candles and one structured model call. No external integration can be enabled implicitly. Polymarket is required for all groups, Coinbase for BTC, and Exa for sports. These reviewed laboratory plugins are independently configured per group; they do not alter production tenant permissions.

## Start deliberately

Use Node 22.22+ and run the build from the repository root:

```sh
npm run build:shared
cd apps/agent-service
cp paper-study.example.json .data/paper-study.json
npm run paper:study -- preflight .data/paper-study.json
```

Create `.data` first if it does not exist. Preflight uses public discovery GET requests only. It does not contact the LLM, Exa, a signer or a database. A nonzero exit status means connectivity or eligibility verification failed; it is not a passed live test. Provider restrictions must not be bypassed.

Review the copied configuration before execution. `pricing` must contain current operator-verified rates: `inputPerMillion`, `outputPerMillion` and `exaPerSearch` in USD. It is deliberately null in the example so copying the example cannot start paid research. Set duration, maximum attempts and API reservation ceiling explicitly. The existing app `.env` supplies `MODEL_BASE_URL`, `MODEL_ID`, `MODEL_API_KEY`, and `EXA_API_KEY` only when sports is enabled. No new environment file is introduced.

```sh
npm run paper:study -- run .data/paper-study.json --allow-paid
```

This is a foreground process. The machine must remain awake and connected. Model calls and Exa can cost real money even though purchases are virtual. The implementation reserves a conservative configured-rate amount before each attempt (65,536 input + 4,096 output tokens per model call; two Exa searches for sports). It caps serialized model requests, never retries paid failures, and does not release reservations after failures. Provider invoices, taxes and pricing changes are not guaranteed by these estimates. Reported tokens and Exa costs remain distinct from reservations.

The runner operates sequentially, attempting discovery at most once per five/fifteen minutes or hourly for sports. Slow sports research can cause a BTC window to be skipped; it never backfills a missed window. There are at most six sports attempts per rolling 24 hours. One market is attempted once per study, including failed and interrupted attempts. Starting a new study creates a new local budget: this is operator tooling, not shared tenant quota enforcement.

## Reports and recovery

Open `.data/paper-studies/<id>/index.html`. It refreshes every 30 seconds. `results.csv` provides the tracking table and `state.json` retains evidence, market/rule snapshots, model identity, prompt fingerprint, settings, decisions, fills and settlement proofs. Files remain local and untracked. Reports include abstentions, failures, pending positions and virtual realized PnL. They are not profitability or calibration evidence from fixtures.

Use Ctrl+C or create an empty `STOP` file in the study directory to block further work. Guards run before new provider calls; requests already sent can still incur usage. Editing the configuration invalidates the current session before subsequent calls. Disabling a plugin therefore stops access rather than silently selecting a replacement. Historical evidence remains on disk.

Restart the same command with the unchanged configuration to resume its original time window and budget. A started attempt becomes `interrupted` and is not replayed. The writer lock prevents overlapping processes. After an unclean crash, inspect `writer.lock`, verify its PID/host no longer runs, then remove that lock explicitly. Never remove a live process's lock. Atomic writes protect the authoritative state; HTML/CSV can be regenerated with:

```sh
npm run paper:study -- report .data/paper-study.json
```

Resolution checks continue for the configured grace period after admissions stop, with one-to-fifteen-minute backoff. A stopped session does not keep checking in the background. Unresolved positions remain pending after the grace period; no end-time or last-price shortcut declares a winner. This release does not score abstained forecasts against final payouts.

## Data quality and limits

- BTC requires the exact current interval slug, two Up/Down outcomes, a matching end time, reviewed Chainlink/tie language, and at least 90 seconds remaining before admission and fill.
- Coinbase is **not** the official Chainlink opening price. The Polymarket page now supplies the exact-window opening TWAP reference. The live Chainlink TWAP remains unavailable; that limitation is passed to the model. Missing edge can correctly produce abstention. No buy is forced to populate the table.
- Sports requires verified soccer/NFL full-game winner metadata, a start at least 15 minutes away and within seven days. External sports APIs are not silently invoked.
- Books and fees must be available and fresh. The shared simulator supports its existing fee curve only; unsupported or missing conditions fail explicitly.
- Virtual fills assume the observed displayed liquidity could be consumed, without competing orders or network latency. This is a simulation limitation.
- Final settlement reads finalized contract state and preserves outcome/condition identity. Clock expiry alone is insufficient.
- All sources are untrusted data. A failed provider remains a technical failure, not a fabricated abstention or simulated source response.

Controlled tests run in CI without credentials. Live acceptance requires successful public connectivity and a separately authorized provider budget. The implementation does not imply a live session has run.

## Validation record — 2026-09-27

The controlled repository suite passed 337 tests with zero failures and one existing opt-in skip, using isolated local PostgreSQL databases. Twelve study-specific cases cover virtual purchase, abstention, limits, duplicate attempts, crash recovery, revocation, citations, expiry, exact BTC windows, stale candles, file locking and report escaping. Shared TypeScript compilation, workspace type checks, lint, formatting, local Mastra build and the research Worker dry-run build passed. No schema changes, remote deployment, signer access or paid provider calls were introduced.

The public discovery preflight did **not** pass. Direct Node requests to both Gamma and CLOB ended in `ECONNRESET` before receiving HTTP responses in this environment. The study adapter now distinguishes transport failure as `PROVIDER_CONNECTION_FAILED`. No live study or profitable strategy is claimed. Resolve public connectivity and explicitly approve session duration/provider spending before starting the real-data session.

References: [Coinbase candles](https://docs.cdp.coinbase.com/api-reference/exchange-api/rest-api/products/get-product-candles), [Polymarket market data](https://docs.polymarket.com/market-data/overview), and [conditional-token contracts](https://docs.polymarket.com/resources/contracts). A five-minute market can take longer than five minutes to finalize on-chain.

### Opening-reference correction

Prompt 1.1.0 accepts the `btc-opening` citation rather than asserting that the threshold is always missing. The Polymarket plugin calls the public crypto-price endpoint with explicit BTC/window/variant/60-second-TWAP parameters from Polymarket’s client and rejects absent or invalid opening values/timestamps before a model call. This frontend endpoint can change; fail closed on response changes. It is Polymarket-published evidence, not an independently verified signed Chainlink report. Coinbase remains reference-only. The live September 27 study preserves its previous prompt snapshots and API reservations during explicit operator validation; it is not automatically restarted.

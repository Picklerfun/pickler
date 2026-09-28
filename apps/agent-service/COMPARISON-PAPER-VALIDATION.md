# BTC paired-policy acceptance record

## Scope

Local version-3 comparison on top of PR #52. No deployed policies, public API, database schema or real trading changed. Conservative and central strategies use the same unchanged quantitative forecast. Each prospective study freezes its tested commit in ignored `configuration.json` before any paid call.

## Historical replay

The offline command evaluated the 21 saved forecasts from `btc-quant-20260927-222623` without providers, credentials, later snapshots or official outcome inputs. It produced zero conservative proposals and three central proposals:

| Market  | Horizon    | Central outcome | Central net edge    |
| ------- | ---------- | --------------- | ------------------- |
| 5003439 | 15 minutes | Up              | 0.03954413591849873 |
| 5004642 | 5 minutes  | Down            | 0.0557792547940712  |
| 5005113 | 5 minutes  | Up              | 0.03169867386703479 |

These are proposals only. No Jev acceptance, refreshed execution, purchase or executed P&L is inferred. Historical study inputs, outcomes, reservations and STOP files were not modified.

## Controlled checks and frozen execution

The live study ran commit `21c8cb8f09288b02ef9d4cecfff6b06fd824de3e`. CI for that exact commit passed 446 tests with zero failures and one existing opt-in skip (447 total), formatting, lint, 11 workspace type checks, workspace builds and Worker builds. The local Mastra build and research Worker dry-run also passed. Controlled checks cover shared/separate reviews, independent fills and settlements, concurrent reservations, both probability bases, side/price changes, clock skew, public 400/429 diagnostics, missed slots and offline replay. They do not establish live-provider acceptance.

The completed study is `btc-comparison-20260928-092056`. Admissions ran September 28, 2026, from 09:21:56.572 to 11:21:56.572 UTC. All 32 slots were evaluated: 24 five-minute and eight fifteen-minute markets. There were no failed, missed or interrupted slots. Both coincident horizons were admitted without serializing complete investigations. Case durations ranged from 5.536 to 15.271 seconds. No parameters, prompts or code changed during the study.

All 32 forecasts subsequently received finalized official binary resolutions. The process exited successfully after the last resolution, released its locks and wrote `STOP` with `ADMISSIONS_COMPLETE`. No new admissions, paid calls or purchases remain running. The older heartbeat was not reactivated. Historical studies and their STOP files remain intact.

## Real Jev contract probe

Exactly one paid synthetic probe preceded the prospective study. Its market data, refresh and resolution were controlled fixtures; only Jev was real. One shared review served both policies, and both virtual fills and controlled settlements completed. This is separate from the real-data purchases below.

Pinned model `jev-1.13.0`, reviewer prompt 1.1.0, returned a valid strict response in 1,457 ms with 4,745 input and 137 output tokens. No answer met both material-veto thresholds of 0.90. This establishes valid contract handling and continuation, not confident approval or reviewer accuracy: the probe included uncertain `INSUFFICIENT`, `CONFLICT` and `MISMATCH` choices below the veto threshold. Neither schema relaxation nor a fallback model was used.

The pinned Jev rate was checked against the [official model page](https://docs.typesafe.ai/models) on September 28, 2026: USD 0.042 per million input tokens, output free. Positive output tokens are retained. The probe reserved USD 0.002752512; its token-derived estimate was USD 0.00019929.

## Prospective policy results

| Policy          | Initial proposals | Virtual purchases | Final abstentions | Paid-blocked cases | Settled purchases | Virtual P&L |
| --------------- | ----------------: | ----------------: | ----------------: | -----------------: | ----------------: | ----------: |
| conservative-v1 |                 0 |                 0 |                32 |                  0 |                 0 |           0 |
| central-v1      |                 5 |                 2 |                30 |                  0 |                 2 | -4.83616942 |

Both policies used the same initial forecasts and snapshots. Four central proposals were five-minute markets and one was fifteen-minute. Three central proposals lost the required edge on the shared post-review refresh (`EDGE_CHANGED_AFTER_REVIEW`); they were not Jev vetoes. The remaining 27 central cases produced no initial proposal. All 32 conservative cases produced no proposal.

For the conservative policy, 23 cases lacked enough executable depth below their calculated caps on both outcomes; nine combined this with an insufficient-edge result on one outcome. For the central policy, 26 no-proposal cases lacked depth below both caps, and one combined this with insufficient edge. “Depth at limit” does not imply an empty market: a low probability-derived cap can exclude otherwise available asks. No abstention was relabeled as an executed purchase.

| Market  | Window UTC  | Purchased outcome |    Quantity | Average price | Virtual fee | Total virtual cost | Official winner |      Payout | Virtual P&L |
| ------- | ----------- | ----------------- | ----------: | ------------: | ----------: | -----------------: | --------------- | ----------: | ----------: |
| 5023786 | 10:25–10:30 | Down              | 59.02906200 |    0.16000000 |  0.55535000 |         9.99999992 | Up              |  0.00000000 | -9.99999992 |
| 5025188 | 11:05–11:10 | Up                | 15.16383000 |    0.64340535 |  0.24351000 |         9.99999950 | Up              | 15.16383000 |  5.16383050 |

These were virtual executions against contemporaneous public books, with modeled fees and finalized Polygon payout evidence. No order was signed or sent. The second fill consumed multiple price levels. Final decision edges were 0.0533016850 and 0.0628096109 respectively. The real-data circuit therefore completed both a losing and a winning virtual purchase. It did not prove profitability.

## Forecast scoring and accounting

Brier is calculated once per shared initial forecast, including abstentions, rather than once per policy. Lower is better. Market-quote comparisons use the same resolved observations.

| Horizon         | Resolved forecasts |  Model Brier | Contemporary book Brier | 50% baseline |
| --------------- | -----------------: | -----------: | ----------------------: | -----------: |
| Five minutes    |                 24 | 0.1639614721 |            0.1749187500 |         0.25 |
| Fifteen minutes |                  8 | 0.1808018938 |            0.1925250000 |         0.25 |

Overlapping windows are temporally dependent. This two-hour sample is not independent calibration, evidence of durable edge or a profitability backtest. Coinbase remains the predictive proxy, not the official settlement feed. Sensitivity bounds remain experimental assumptions.

Six Jev calls completed: one synthetic probe and five prospective reviews. All returned valid responses with known usage; none produced a qualifying material veto. Total reported usage was 35,905 input and 812 output tokens. Token-derived estimated cost was USD 0.00150801, separate from USD 0.016515072 reserved. Historical reservations were USD 1.009377536; combined reservations were USD 1.025892608 within the original USD 5. The additional USD 0.25 ceiling was not exhausted. There were no retries, DeepSeek or Exa calls.

The run recorded 894 public requests, all HTTP 200, with safe provider/operation/status/timing diagnostics. Historical 400/429 causes remain unproven; their handling was validated with controlled tests, not reproduced in this run. Metadata reuse avoided duplicate conditions requests inside snapshots.

## Post-run timing correction and artifacts

The completed-run audit found a 499 ms request-start interval: a timer woke one millisecond before the intended 500 ms minimum. After the process exited, the transport was changed to recheck the clock until its deadline, with a controlled early-wakeup regression test. This does not rewrite the frozen study or establish a second live validation of the corrected timer. All policy, forecast and reviewer parameters remain unchanged.

Local artifacts are in `.data/paper-studies/btc-comparison-20260928-092056/`: `index.html`, `results.csv`, `state.json`, `summary.json`, `requests.json`, `retrospective.json`, configuration and campaign snapshots. Reports preserve shared inputs, independent decisions, reviews and official resolution proofs. These private local artifacts are ignored by Git; this acceptance record publishes aggregate outcomes and public market identities.

No merge, deployment, public API or database migration is part of this delivery. No new paid run is required for the post-run timing regression. The final PostgreSQL suite after that correction passed 447 tests with zero failures and one existing skip (448 total); formatting, lint and all workspace type checks passed again.

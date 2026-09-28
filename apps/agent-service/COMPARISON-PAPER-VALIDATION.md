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

## Acceptance stages

The full PostgreSQL regression run passed 443 tests with zero failures and one existing opt-in skip (444 total). Three further checks for snapshot reuse, no-edge proposals and post-review revocation passed separately. The affected type checks, lint, formatting, shared builds and research Worker dry-run build passed. The local Mastra build and real Jev acceptance are recorded below when complete. Controlled checks cover shared/separate reviews, independent fills and settlements, concurrent reservations, both probability bases, side/price changes, clock skew, public 400/429 diagnostics, missed slots and offline replay. These checks do not establish live-provider acceptance.

The pinned Jev rate was checked against the [official model page](https://docs.typesafe.ai/models) on September 28, 2026: USD 0.042 per million input tokens, output free. Positive reported output tokens are still retained. The new reservation allowance is USD 0.25 inside the original USD 5 total. The unique paid synthetic probe is included, never a separate budget.

# Perpl validation follow-up

## Scope and evidence

This continuation uses the shared [trading architecture](trading-architecture.md) and
[one evaluation entry point](../apps/agent-service/EVALUATIONS.md). It does not enable real orders.

The preserved first study, `perps-20260928-v1`, stopped decisions after its second round with
`INCOMPLETE_EXECUTION`. Its execution-failure event records `INCONSISTENT_MARKET_DATA`, but
not the rejected refreshed frame. The original root cause cannot be reconstructed from the
model-input frame, which is a different observation.

A subsequent public-only probe reproduced the error with BTC ticker timestamp
1790636213000 and book timestamp 1790636223000: ten seconds apart. Both are provider timestamps;
local receipt time must not replace either. Reading the book before the ticker subsequently
completed a public BTC-long/ETH-short virtual open/close sequence and funding reconciliation.
That single passing sequence does not establish sustained reliability.

The continuation keeps the existing five-second skew and thirty-second freshness limits.
It validates evidence after candle preparation, before paying models, and stores common
`execution-input` frames before valuation. Rejected data remains rejected. No retries or
historical result edits are introduced.

## Budget and experiment

The original USD 5 authorization now gates all study sessions in the same tenant/network/database
under a PostgreSQL advisory transaction lock. Count historical costs and pending reservations;
unknown started usage prevents another session from paying models. Operators must not change
scope or database to evade authorization. The previous recorded cost estimate is USD 0.00813078;
verify the database ledger before starting, since this document is not a live balance.

Use a new session with the original three strategies, prompts, risk policy and virtual capital.
Freeze model IDs, reviewed rates and implementation commit. Report each session separately;
include earlier spend only in the campaign budget, not in the new strategy returns.
Public failures, unobserved intervals and interrupted decisions prevent an unqualified comparison.
Keep a failed study intact rather than repeatedly restarting until a favorable result appears.

## Real execution acceptance remains separate

The next real-execution adapter must consume the same trading engine and harness composition.
It must not copy the paper margin model into an exchange risk policy. Before funded acceptance:

1. Bind each dedicated agent to an explicitly approved wallet/account and capital/fee limits.
2. Enroll a least-privilege Ed25519 API key using the wallet-authorized flow; store its secret in
   infrastructure custody, never model state or source control.
3. Verify exchange account existence and on-chain forwarding enablement separately from API auth.
4. Persist per-account monotonically increasing request IDs, expiry blocks and order intent
   before submission. Reconcile ambiguous acknowledgements against orders, fills and chain
   evidence; do not resend an ambiguous financial action as a new request.
5. Implement exchange-specific margin, liquidation, fees and partial-fill handling, keeping the
   conservative simulator explicitly distinct. Test cancellation, restart and account isolation.
6. Demonstrate the complete lifecycle on testnet, then perform separately bounded funded acceptance
   with transaction/fill evidence. Paper results alone do not satisfy the bounty's on-chain goal.

Official contracts reviewed for this follow-up: [REST endpoints](https://github.com/PerplFoundation/api-docs/blob/main/rest-endpoints.md),
[authentication and account prerequisites](https://github.com/PerplFoundation/api-docs/blob/main/README.md),
and [types](https://github.com/PerplFoundation/api-docs/blob/main/types.md).

## Validation of the continuation change

The local acceptance run passed 1,402 tests (one intentionally skipped), including 27 perpetual
regressions and real PostgreSQL concurrency/recovery checks. Workspace type checks, lint, changed-file
formatting, architecture/documentation audit, agent-service build and Worker builds passed.
The public virtual sequence passed after the read-order change; both positions were closed and
funding was reconciled. Provider-catalog preflight returned sixty closed candles for BTC and ETH
without paid inference. Private captures and session reports stay outside Git.

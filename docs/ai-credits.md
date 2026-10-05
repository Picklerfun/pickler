# AI credits data foundation

AI credits belong to the authenticated Supabase user, shared across that user's agents. Wallets
are payment instruments, not balance owners. Accounts start at zero; purchased credits do not
expire. One credit contains 1,000,000 integer units. Credits have no implied USD or AUSD exchange
rate. Wire contracts carry exact unit amounts as decimal strings.

This delivery provides contracts, private persistence and controlled PostgreSQL acceptance only.
It does not mount endpoints, connect checkout, seed commercial tariffs, activate billing, deploy
migrations or change Studio's existing model execution. The future UI is `YOU → AI credits`.
Advice, mobile's simulated credits, virtual AUSD and historical study budgets remain separate.

## Ownership and storage

Core exports the AI credit repository and trusted payment-verifier contracts from
`features/ai-credits`, plus canonical unit validation and exact token pricing. Infrastructure's
`PostgresAiCreditStore` implements them. `api-schema/src/ai-credits.ts` defines portable balance,
purchase, history and model breakdown DTOs; these expose neither provider expenses nor payment
proofs. Trading retains its existing strategies and financial calculations.

Migrations 0029–0031 append the private `billing` schema. All eight tables enable RLS with no
public policies; consumer database roles receive no schema/table access. Backend repository
access is required. Supabase installations also enforce the account's `auth.users` foreign key.
Plain disposable PostgreSQL installations use the same user UUID without an auth schema.

| Table                        | Purpose                                                                   |
| ---------------------------- | ------------------------------------------------------------------------- |
| `ai_credit_accounts`         | Unique user account and ledger projection                                 |
| `ai_credit_pricing_versions` | Reviewed immutable model/token credit tariffs                             |
| `ai_credit_purchases`        | Immutable credit/payment quote and purchase lifecycle                     |
| `ai_credit_payment_events`   | Immutable verified/rejected settlement evidence and deduplication         |
| `ai_credit_operations`       | One frozen customer reservation per existing Studio check                 |
| `ai_credit_call_allocations` | Frozen tariff and allocation linked to `perps_check_calls`                |
| `ai_credit_ledger`           | Append-only purchase, reserve, settlement, release and adjustment entries |
| `ai_credit_agent_limits`     | Optional owner-selected, versioned daily agent limit                      |

Supporting unique indexes precede compound foreign keys in migration 0029. Never rewrite an
applied migration. Generate subsequent changes through infrastructure's Drizzle commands.

## Purchase lifecycle

A trusted server creates an immutable quote, including original payment amount, unit, scale,
method, quote version and expiry. The payment service calls an injected verifier before passing
its result to persistence. No client or model may choose a verified flag or expected recipient.
The payment provider and checkout adapter are intentionally not selected here.

Verification must match amount, asset unit, precision and expected recipient, and reject a
future settlement timestamp. Provider event and underlying payment identities are unique.
Duplicate notifications cannot credit twice or attach a payment to another purchase/account.
A valid pending purchase credits its ledger and becomes confirmed in the same transaction.
Late payments retain evidence and become `review_required` without automatic credit; invalid
proofs fail without credit. A read reports an expired pending quote without mutating history.
Additional payments to an already confirmed purchase never create another credit posting and
require operator handling of their retained evidence.

## Studio consumer contract

The first consumer will be Perpl Studio checks. The current runtime is deliberately unchanged.
To connect it in a subsequent delivery:

1. Preserve the existing internal USD reservation and `perps_check_calls` plan.
2. Call `reserveCheck` before any model transport. The repository resolves the payer from the
   workspace owner and freezes the credit tariff and optional daily limit.
3. Record the existing provider start, then `recordCallStart`, before sending the request.
   An exception prevents transport; started calls must never be retried automatically.
4. Finish the original check and its provider accounting, then `settleCheck`. Only a complete
   valid `studio-perps-check-v2` result is chargeable. A valid `wait` is chargeable too.
5. Recover expired checks through the existing recovery lifecycle and `recoverCheck`. No billing
   method sends or repeats a provider request.

Actual known model tokens are priced with the frozen tariff. Round the combined input/output
numerator upward once per call to whole micro-credit units. Normal charges cannot exceed their
allocation or create a negative balance. Unused allocations and reservation excess are released
once. Paid search plans remain in the internal provider ledger; this foundation prices AI tokens.
`rules` reserves and consumes zero AI credits, including on an empty or blocked account.
Supervision and closing positions do not call credit admission.

Unknown usage leaves an active customer reservation pending. A terminal failed or incomplete
analysis releases the entire customer reservation; known or unknown provider cost remains in
its original ledger for the platform. Late provider reconciliation never charges a released
customer operation. Browser disconnection is not an execution failure.

Trusted adjustments append new ledger entries. Reversing spent payment credits preserves the
deficit and blocks paid admission. If reversal occurs during a live operation, further calls are
blocked; terminal failure still releases customer reserves. A completed charge that would deepen
a deficit is rejected atomically for operator reconciliation, rather than silently changing the
result or fabricating funds.

## Transactions, access and reconciliation

Account locks come first, followed by runtime agent, check/workspace and operation/call locks.
Do not invoke this repository while holding the existing runtime locks in a nested transaction.
Concurrent agents share the same account lock. Lease, configuration, identity and hourly
readiness are checked in the billing transaction; ownership expiry prevents a new call start.
The operation retains its original lease and cannot be restarted under a new execution owner.

Ledger records expose UUID identities; a separate monotonic sequence supplies stable history cursors.
The immutable ledger is authoritative. Its insert trigger updates account projections in the
same transaction; direct balance updates are rejected. Reconciliation verifies balance and
reserved projections against summed deltas. Available units are `max(balance - reserved, 0)`.
Reservations and final charges count against the UTC admission day's frozen per-agent limit;
a new day never resets purchased balances or pending reserves.

Only the owning user may read their account, purchase and ledger history through the repository.
Workspace membership does not confer access to personal payments. Referential restrictions keep
agent, check and payment history intact; identity/configuration snapshots are never reassigned.
Adjustments, tariff installation and payment evidence are trusted backend/operator ports, not
public routes. Public DTOs must be mapped explicitly rather than serializing database records.

## Reproduce acceptance

Run from the repository root with disposable loopback PostgreSQL available:

```sh
npm run db:up
npm run build:shared
node --import tsx --test packages/core/test/ai-credits.test.ts packages/infrastructure/test/ai-credit-schema.test.ts packages/infrastructure/test/ai-credit-store.test.ts
npm run typecheck
npm run lint
npm run format:check
npm run check:architecture
```

The integration suite creates and drops isolated databases, applies the appended migrations,
and uses controlled verifier/token fixtures. It checks competing agent reservations, payment
identity, immutable quotes/prices/history, frozen pricing, known and unknown usage, valid wait,
incomplete/free failure, lease recovery, limits and UTC windows, zero-cost rules, deficits and
ledger invariants. It does not validate a real payment provider or live model.

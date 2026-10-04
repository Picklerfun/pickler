# Studio perpetual strategies: controlled acceptance

This record accompanies the three implementation changes in PR #87, based on main commit
`1e23e1912a53c2534d711031bc4691f904edf360` (including #93). Operational ownership and configuration
are defined in [Studio perpetual execution](studio-perps-execution.md).

## Scope and evidence

Acceptance uses controlled providers, captured market inputs and disposable local PostgreSQL.
No provider requests, real orders, deployments or remote migrations are authorized by this record.
The reviewed USD policy remains disabled unless an operator supplies reviewed models, tariffs and
explicit per-operation and daily limits. No operational tariff or budget was invented for testing.

| Check                                                          | Result                                                                                                                                |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Root regression suite                                          | 2,764 discovered; 2,761 passed, zero failures, three skipped                                                                          |
| Focused strategy, execution, runtime and PostgreSQL acceptance | 76 passed, zero failures or skips                                                                                                     |
| Final PostgreSQL runtime suite after admission correction      | 28 passed, zero failures or skips                                                                                                     |
| Additional final transaction-fence checks                      | Three Studio tests passed: missing reservation, changed configuration, lost ownership, unknown-cost recovery and controlled execution |
| Type checking                                                  | All 17 workspace tasks passed                                                                                                         |
| Design surfaces and typography                                 | All 108 fixture routes passed                                                                                                         |
| Design tokens and contrast                                     | Unaffected routes passed; three affected brief screens initially failed, were corrected and then passed every design check            |

Additional final checks passed: all 23 research coordination/recovery tests, all 13 API contract
tests, the OpenAPI export with 177 documented operations, shared/service/Worker builds, lint,
formatting and architecture. The API contract rejects financial probabilities and mixing Studio
results with laboratory strategy versions.

The regression suite's skipped cases are two browser-probe unit tests without a globally installed
Playwright and the opt-in compiled web/API/Queue Supabase integration. Rendered design checks were
run separately with the bundled browser against the controlled local fixture. PostgreSQL tests
exercise real transactions and isolated temporary databases; they do not establish deployed Queue
delivery or Supabase JWT readiness.

## Verified boundaries

- Laboratory `1.0.0` policies and both historical study readers retain their protocols. Studio
  `2.0.0` uses the common registry, including independent combined-model calls and material veto.
- SMA boundaries, unknown brief conditions, invalid references, cancellation and model failures
  are covered by controlled tests. Failures never become fabricated holds or automatic retries.
- Opening size uses the creator's amount and exact accounting. Approval, small entries, remaining
  size, stops, exits, caps and funding retain financial ownership in trading.
- Every guarded financial transaction checks identity, configuration and ownership. Paid execution
  additionally requires its active USD reservation. Unknown usage blocks new manual/hourly checks
  while unpaid public supervision remains available.
- Model calls are recorded before transport. Unknown charges retain reservations; trusted
  reconciliation requires matching request evidence and cannot repeat the model call.
- Controlled execution records attributable versioned results, book fills, a 3% stop, 6% target
  and 24-hour expiry without financial probabilities. Historical fields remain readable only when
  they were stored.

## Release limitations

Migration 0028 is appended; migration 0027 and historical records remain unchanged. Operators must
review and apply the migration separately before enabling the new composition. Worker dry builds
and controlled results do not prove live-provider reliability, profitability, funded wallets or
remote readiness. This delivery updates the PR; it does not merge, deploy or activate it.

Reproduce the checks using the commands in the canonical guide. OpenAPI is generated by
`npm run api:openapi -- --output /tmp/pickler-openapi.json`; generated JSON is not maintained by hand.

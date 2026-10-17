# Eligible-creator testnet token launches — 2026-10-11

## Scope and approval

The owner requested testnet token launch availability for all agents, relying on the existing
creator-access admission. Policy version 3 makes that scope explicit through
`admission: "eligible_creators"`; policies 1/2 retain their historical UUID allowlists. The new
[reviewed policy](token-launch-policy-eligible-creators-testnet-20261011.json) retains the same
verified V4 factory, dedicated grant authority, deployment hashes, preset, economics, immutable R2
metadata origin, gas ceilings and RPC allowance as the [restricted policy](token-launch-policy-testnet-20261011.json).

Every launch still requires a user JWT, active workspace ownership, current creator access, a
published available agent, one registered master wallet and no confirmed/pending token on that
network. Grants expire after five minutes. The user's master signs and calls the factory directly;
the dedicated backend key only issues the eligibility grant. Revocation/ownership changes are
checked again before recording and sending. No creator access is granted by this change.

Only Monad testnet (10143) is accepted. Mainnet, unknown admission modes, mixed UUID/all-creator
policies and missing deployment evidence are rejected. The initial activation was an explicit
runtime operation while the source configuration remained disabled. The owner subsequently
authorized persisting `TOKEN_LAUNCH_ENABLED=true` in the API staging configuration, so ordinary
deployments preserve the approved testnet operating state. Other compositions remain disabled
without explicit configuration; this does not activate mainnet or public buyer operations.

## Validation and activation evidence

The previous restricted activation confirmed `setLaunchesEnabled(true)` on the reviewed factory:

- Factory: `0xd9ffd2aa682283e3521c7629dbea24273676559d`.
- Receipt: `0xc934b70ccf7ed8890c8783eb6c050cd373ebf0dc35bff3f8ad0854306ef69b71`.
- Canonical block: 70,128,283; depth observed: 34 confirmations.
- Gas charged: 0.006248214 testnet MON; explicit ceiling: 0.012 MON.
- The read-only production driver verified the complete deployment/preset graph at block
  70,128,383. This did not create a token or request an owner signature.

The eligible-creator source, controlled validation and hosted activation are recorded separately:

| Scenario                                                                                           | Evidence                                                          | Status  |
| -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ------- |
| Two distinct agent keys and master recipients without UUID enumeration                             | Controlled issuer/driver regression                               | Passed  |
| Denial before provider work for missing access, ownership, publication, master or token uniqueness | Controlled core/issuer regression                                 | Passed  |
| Historical allowlists, mainnet/unknown modes and full quote evidence                               | Controlled policy regressions                                     | Passed  |
| Types, lint, format, architecture, shared build and API build                                      | Local checks                                                      | Passed  |
| Hosted policy version 3 and API source activation                                                  | Runtime deployment/settings readback                              | Passed  |
| Human master passkey launch and frozen owner metadata                                              | Owner acceptance                                                  | Pending |
| Canonical token attribution and public buy/sell                                                    | Existing indexer recovery and independent public preparation gate | Pending |

Controlled launcher suites passed 44 tests. Isolated PostgreSQL/JWT suites passed another 15 tests;
types, lint, architecture, shared compilation, the API dry-run and 208 OpenAPI operations passed.
No UI or contract source changed, so rendered Design and Foundry suites were not repeated.

Hosted activation completed at 14:07:00 UTC on 2026-10-11:

- Uploaded API source: `c3ecb6c06c514cd01b81f53220e3524fd7b6c533`; subsequent documentation-only
  amendments do not change that deployed code.
- Active runtime version: `2fe88df2-da1d-4401-a0d5-ed9b211a6163` at 100%.
- Deployment: `f60a1054-18a0-406c-81af-142065489654`.
- Minified reviewed policy SHA-256:
  `2b6e62f38bff91ca3c30548436b82c91dca83f871ec41b5c208fe7f056c569ce`.
- `TOKEN_LAUNCH_ENABLED=true` and policy 3 `eligible_creators` are set in the API runtime.
- All 39 existing bindings were preserved; no custody key or resource binding changed.
- Read-only driver verification passed all runtime hashes, implementations, bindings, preset and
  factory checks at block 70,130,902, using 46 public RPC reads. No grant or transaction was issued.
- Hosted OpenAPI returned HTTP 200; an unauthenticated private token read remained HTTP 401.

No indexer budget, schedule or cursor is changed. The existing hosted indexer was still recovering
historical blocks when restricted launch was enabled. A finalized owner transaction remains
confirmation pending until its canonical factory event matches the registered grant. Public
visitor trading has a separate gate and is not activated by broadening creator launch admission.

## Reproducible controlled checks

```sh
npm run build:shared
node --import tsx --test packages/core/test/token-launch.test.ts packages/core/test/token-operations.test.ts packages/infrastructure/test/token-operation-driver.test.ts packages/infrastructure/test/uniswap-operation-driver.test.ts
npm run typecheck --workspace=@pickler/infrastructure
npm run typecheck --workspace=@pickler/api
npm run check:architecture
npm run build:worker --workspace=@pickler/api
```

These tests use injected providers and public test keys; they do not query RPC, X or Turnkey, sign
with real keys, send transactions, mutate hosted PostgreSQL or spend fiat. Runtime verification
is a separate bounded read-only step; no real owner launch is performed by the operator.

## Deployment persistence correction

The API deployment at 14:37:48 UTC on 2026-10-11 reapplied the source's `false` value and closed
launch availability. This was a deployment configuration overwrite, not a local `.env` value
taking precedence inside the running Worker. The owner explicitly approved correcting the
persisted staging value and restoring the previously approved runtime state.

`workers/api/wrangler.staging.jsonc` now declares `TOKEN_LAUNCH_ENABLED=true`. The reviewed policy,
creator/owner checks, dedicated authority, gas/RPC ceilings, custody bindings, indexer and public
buyer gate are unchanged. Runtime restoration changes only this existing plain-text binding and
retains the current deployed source. No grant, signature, provider preparation or transaction is
issued as part of this correction.

Until the persistence PR is merged, deploying older main still requires
`--var TOKEN_LAUNCH_ENABLED:true`. Emergency closure uses a false override and must also be
recorded in source to prevent a later ordinary deployment from reopening the launcher.

Runtime restoration was verified at 16:01:09 UTC on 2026-10-11:

- Existing API source version: `d52922de-5e9c-4a9b-982a-aa4a7a70fa09`.
- Settings-only active version: `4ba70e58-6fc5-47b1-b973-338accc638ec` at 100%.
- Deployment: `e9446d82-4c8f-4324-b40c-4aa6d17b08ca`.
- Readback confirmed `TOKEN_LAUNCH_ENABLED=true`; all other 38 bindings were unchanged.
- Staging topology/identifiers, architecture and the API dry-run passed with the persisted true.

This does not prove a successful owner launch or resolve the earlier preparation failure.
The persistence source change still requires its normal PR merge before it protects subsequent
main deployments. No unrelated local environment or generated file is included.

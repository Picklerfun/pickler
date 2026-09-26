# Polymarket international preproduction

Run from the repository root:

```sh
npm run build:shared
npm run polymarket:preproduction --workspace=@pickler/agent-service
```

This explicit diagnostic makes two unauthenticated GET requests, without retries: CLOB server
time and one Gamma markets page. It accepts no arguments or endpoint overrides, loads no `.env`,
and never signs, creates credentials, modifies accounts, accesses PostgreSQL or submits orders.
Each request has a ten-second deadline. Failures expose status/category only, not raw bodies.
Successful empty market listings do not establish usable liquidity. Exit status is nonzero if
either public read check fails. No calls run at application startup or in CI.

The [official SDK configuration](https://github.com/Polymarket/ts-sdk/blob/f72f9b32841bc056b512a14cfc3516c31a3b0d74/packages/client/src/environments.ts)
labels this environment internal and inherits Polygon chain 137 and production contracts.
A responding endpoint does not establish a testnet or fictitious funds. The production trading
adapter, Workers, wallet bindings and admission flags remain unchanged. No extra secrets are needed.

Before implementing order submission, obtain confirmation from Polymarket Builders of the
network, test collateral/faucet, CLOB/relayer endpoints, wallet factory and exchange addresses,
credential onboarding and order settlement behavior. Do not reuse production credentials to
experiment. A change of chain ID alone does not change SDK service endpoints.

Polymarket US has separately documented preproduction with dummy funds and institutional
onboarding. It is not a drop-in replacement for our international Deposit Wallet integration:
https://docs.polymarket.us/trader-guide/onboarding

Pending acceptance: authenticated sandbox access, funded test account, order matching and
testnet settlement. This diagnostic does not satisfy any of those acceptance criteria.

## Validation record — 2026-09-26

Six controlled tests passed; infrastructure build, infrastructure/agent-service typechecks and
changed TypeScript lint passed. The explicit live diagnostic returned CLOB `/time` HTTP 200
with a valid timestamp, but Gamma `/markets` HTTP 503. Public read readiness remains false.
No retry, credentials, database writes, signing or order submission occurred. This result does
not establish whether Gamma requires private access or was temporarily unavailable.

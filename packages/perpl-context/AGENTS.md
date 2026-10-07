# Perpl context package instructions

Read [the root instructions](../../AGENTS.md) first, and
[the specification](../../docs/specs/perps-board-live-v1.md) that created this package.

`@pickler/perpl-context` reads Perpl's `GET /v1/pub/context`: the open markets with their decimals,
mark, price 24 hours ago, leverage ceiling, fees and order limits, and the exchange instance with
its minimums. It exports `parseContext`, `parseServerTime` and the types `Market`, `Instance` and
`Context` from `src/index.ts`, and the recorded testnet capture as
`@pickler/perpl-context/fixtures/context.json`. It has two consumers: the mobile app
(`apps/mobile/src/perpl/context.ts`, which adds the network call), and the web's market board
(`packages/infrastructure/src/markets/perpl-market-board.ts`). The app sizes real orders from what
this returns.

- **Two kinds of field.** `id` through `prev`, and the instance, are what the app trades on: they
  are required and a malformed one throws, as before the move. `sizeUnits`, `openInterest`,
  `fundingRate`, `fundingIntervalSec` and `chainId` were added for the board and are lenient: a
  missing or malformed one is `null`. Never make the app stricter than it shipped; a new field for
  the board goes in the second group.
- **`test/expected-context.json` is never regenerated.** It is what the app's parser gave for the
  capture on 2026-10-01, before the parser moved here. The test requires every field of it. A
  change that breaks it changes what the app trades on.
- `maxLeverage` is `initial_margin / 100` and the maintenance margin of a position is
  `maintenanceBps / 10^4 / maxLeverage`. Both are rules the app measured against the exchange
  (`docs/mobile/investigacion/perpl.md`), not readings of a documented field.
- No dependencies, no network, no clock: it must load in Metro, in a Worker and in Node. Keep the
  source to TypeScript that only erases (no enums, no parameter properties).
- The agents' Perpl client (`packages/infrastructure/src/perpl/`) parses the same endpoint with its
  own strict schema, for a different contract: two symbols, provenance on every value, raw provider
  fractions. Do not merge the two. `services/reads` has a third copy until it moves behind the API.

From the root: `node --import tsx --test packages/perpl-context/test/*.test.ts` (also part of
`npm test`), `npm run typecheck --workspace=@pickler/perpl-context`, and
`npm test --workspace=@pickler/mobile`, three of whose suites parse the same capture.

## Dynamic Studio markets

The package additionally exports pure `parsePerplMarketIdentity` for conservative canonical identity
parsing. It contains no transport or clock. Strict agent metadata validation remains in
infrastructure; the mobile parseContext contract and captured expected output remain unchanged.

See [agent-selected Perpl markets](../../docs/studio-perpl-markets.md).

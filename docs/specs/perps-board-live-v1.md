# Perps board live v1: the web reads Perpl, with the parser the app trades on

Status: approved by the owner on 2026-10-01 (approach chosen in conversation: the same markets and
the same code as the app). Branch `codex/perpl-board-live`, stacked on `codex/mobile-monorepo`
(pull request #71), because it needs the app in this repository.

## 1. Problem

`/markets` and `/markets/[symbol]` on the web are served by `createSampleMarketBoard`
(`workers/api/src/growth/services.ts`): six invented markets with fixed marks, no label saying so.
The mobile app shows the real venue: every market Perpl lists, read from one request to
`/v1/pub/context`, and it trades on them. The two surfaces of one marketplace therefore disagree on
which markets exist, what they cost and what the venue allows:

| Fact               | Web today                            | App today                                       |
| ------------------ | ------------------------------------ | ----------------------------------------------- |
| Markets            | 6 samples (one of them not on Perpl) | every open market on Perpl testnet (7)          |
| Mark, 24 h change  | constants                            | `state.mrk`, `state.prv`                        |
| Maximum leverage   | 10× or 5×, invented                  | `initial_margin / 100`, per market              |
| Taker fee          | 0.05 % for everything                | `taker_fee`, per market                         |
| Maintenance margin | 5 % for everything                   | `maintenance_margin`, per market                |
| Smallest account   | 10 AUSD                              | `min_account_open_amount` (100 AUSD on testnet) |
| Why nothing sends  | "Perpl's contracts are not deployed" | they are; the app trades on them                |

`public-record-v1.md` (draft, PR #65, decision P9) proposed a real board through the agents' Perpl
client. That client is limited to BTC and ETH on purpose and spends five requests a board. This
specification keeps P9's contract for freshness and labelling and departs from it on the source:
the board is the app's, so that the two surfaces cannot drift again.

## 2. Decisions

| #   | Decision                                                                                                                                                                                                                                                                              | Reversible? |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| B1  | The board lists **every open market Perpl publishes** on the configured network, from one request to `/v1/pub/context`.                                                                                                                                                               | yes         |
| B2  | The parser of that response is **one package, `@pickler/perpl-context`**: the app's `src/perpl/context.ts`, moved unchanged in behaviour. The app and the API both import it.                                                                                                         | yes         |
| B3  | What the board needs and the app's parser did not read (open interest, funding, size units, chain id) is added **leniently**: a missing or malformed new field is `null`, never an error. The app must not become stricter than it shipped.                                           | yes         |
| B4  | `createPerplMarketBoard` in `packages/infrastructure` implements the existing `MarketBoard` port over the existing `PerplTransport` (no redirects, 10 s timeout, one request a second per schedule, diagnostics).                                                                     | yes         |
| B5  | **Freshness.** A board younger than 10 s is served from memory. On a failed fetch, a board younger than 5 minutes is served with `stale: true`. Past that the board throws `MarketDataUnavailableError` and the route answers **503 `MARKET_DATA_UNAVAILABLE`**. Nothing is invented. | yes         |
| B6  | **The detail adds one request**: 30 days of hourly candles, cached 5 minutes per market, for the 24 h trail and the hourly reach. If it fails the detail is still served, with an empty trail and no reach.                                                                           | yes         |
| B7  | **Unknown is `null`, not zero.** `agentsReading`, `openCalls` and `lastCall` have no source until perps decisions exist; `hourlyReach` has none on the list. They are `null` on the wire and "—" on the page.                                                                         | yes         |
| B8  | **The venue's limits travel with each market** (`limits`: taker fee, maintenance margin, slippage cap, smallest account) and replace `PERP_LIMITS_DTO`, which is deleted.                                                                                                             | yes         |
| B9  | **Every market says where it came from**: `source { venue, network, observedAt, stale }`. `PERPL_BOARD_NETWORK` (`testnet` or `mainnet`) selects the venue; unset, the API serves the sample board, whose source is `sample` and which the page labels SAMPLE.                        | yes         |
| B10 | The ticket still sends nothing. Its stated reason changes to the true one: this site's wallet connection does not sign.                                                                                                                                                               | yes         |
| B11 | The level table, the leverage options and the read rules stay as they are on each surface. Unifying them is a product decision and its own specification.                                                                                                                             | —           |

## 3. `@pickler/perpl-context`

Shaped like `@pickler/chain` and `@pickler/mera-account`: TypeScript source as the export, no build
step, no dependencies. It exports `parseContext`, `parseServerTime` and the types `Market`,
`Instance` and `Context`. `fetchContext` stays in the app, which keeps
`apps/mobile/src/perpl/context.ts` as that function plus a re-export, so no other file of the app
changes.

Added to `Market`, all lenient (B3): `sizeUnits: string | null`, `openInterest: number | null`
(scaled by `sizeDecimals`), `fundingRate: number | null` (millionths per funding interval),
`fundingIntervalSec: number | null`. Added to `Context`: `chainId: number | null`.

**Frozen expectation.** Before the move, the app's parser — in the untouched `pickler-expo`
checkout — parses its recorded capture of testnet, and the result is saved as
`test/expected-context.json`. The package's test requires the moved parser to reproduce every field
of it. The capture moves to `test/fixtures/context.json` and the app's own test reads it from the
package. As with the account vectors, a change that breaks the expectation is wrong; the file is
not regenerated.

The agents' client (`packages/infrastructure/src/perpl/data.ts`) keeps its own strict schema: it
has a different contract (two symbols, provenance on every value, raw provider fractions). The
reads service (`services/reads`, Deno) keeps its copy until it moves behind `workers/api`.

## 4. The board

`packages/infrastructure/src/markets/perpl-market-board.ts`:

```ts
export class PerplBoardMemory {} // the cached context, the cached details, the request schedule
export function createPerplMarketBoard(options: {
  network: PerpNetwork;
  memory: PerplBoardMemory;
  transport?: typeof fetch;
  now?: () => number;
}): MarketBoard;
```

The API composes services per request, so `PerplBoardMemory` is a module-level value in
`workers/api/src/growth/services.ts`, one per network, the way the AUSD balance readers already are
in `container.ts`. A Worker isolate keeps it between requests and loses it when recycled; that is a
cache, and nothing depends on it surviving.

Each field, and where it comes from:

| Field                                    | Source                                                                                                                         |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `symbol`, `base`                         | `symbol`, or `size_units` where the venue publishes an empty symbol; `BASE-PERP`. A base seen twice is listed once, lowest id. |
| `mark`                                   | `state.mrk / 10^price_decimals`                                                                                                |
| `change24h`                              | `(mrk − prv) / prv`, 0 when `prv` is 0                                                                                         |
| `funding1h`                              | `rate / 10^6 × 3600 / funding_interval_sec`: the published rate, stated per hour. 0 when the venue publishes none.             |
| `openInterest`                           | `oi / 10^size_decimals × mark`, in AUSD. 0 when absent.                                                                        |
| `maxLeverage`                            | `initial_margin / 100` (the app's measured rule)                                                                               |
| `limits.takerFee`                        | `taker_fee / 10^6`                                                                                                             |
| `limits.maintenanceMargin`               | `maintenance_margin / 10^4 / maxLeverage` (the app's measured rule)                                                            |
| `limits.slippageCap`                     | `order_max_market_slippage_bps / 10^4`                                                                                         |
| `limits.minimumAccountOpen`              | `min_account_open_amount / 10^6` of the first instance, in AUSD                                                                |
| `accent`                                 | fixed for BTC, ETH, SOL and MON; otherwise chosen from the palette by the base's characters, so it never changes               |
| `note`                                   | a sentence built from the sign of the funding and of the 24 h change; no model                                                 |
| `agentsReading`, `openCalls`, `lastCall` | `null` (B7)                                                                                                                    |
| `hourlyReach`                            | list: `null`. Detail: the largest of `max(high − open, open − low) / open` over the closed hourly candles, in per cent         |
| `trail`                                  | the closes of the last 24 closed hourly candles, then the mark                                                                 |
| `calls`                                  | `[]`                                                                                                                           |
| `source`                                 | `{ venue: "perpl", network, observedAt: the time the response was received, stale }`                                           |

A context whose `chain_id` is not the configured network's is refused like a failed fetch. Closed
markets are not listed, as in the app.

After a failed read the venue is not asked again for ten seconds, whoever is asking, so a venue
that is down costs one slow request and not every one.

`squareProblem` and the page's `outOfReach` treat a `null` reach as "no known limit": a square is
refused only on evidence.

## 5. API and wire

`GET /v1/marketplace/markets` and `/markets/:symbol` keep their paths and their bare JSON.
`PerpMarketDto` changes: `agentsReading`, `openCalls` and `hourlyReach` become `number | null`;
`limits` and `source` are added. `PERP_LIMITS_DTO` is removed from `@pickler/api-schema`.
`MarketDataUnavailableError` (core) maps to 503 with `error: "MARKET_DATA_UNAVAILABLE"`; the web's
server client already turns a failed read into its empty state.

`PERPL_BOARD_NETWORK` joins `workers/api/src/env.ts`. It is `testnet` in `wrangler.jsonc` and
`wrangler.staging.jsonc`; any other value, or none, serves the sample board. The design harness's
fixture API keeps the sample board, so the rendered checks stay deterministic.

## 6. The pages

- **Board.** The line over the title names the source: `MARKETS · PERPL · MONAD TESTNET ·
14:03:11 UTC`, with `· STALE` when the data is, or `MARKETS · SAMPLE DATA` for the sample board;
  the footnote says the same in a sentence. Counts that are `null` read
  "—"; the "with agents" and "open calls" filters match only known, positive counts.
- **Market.** The same source line. The coverage sentence says nothing is known rather than "no
  agent covers this market" when the count is `null`, and Ask keeps its way to the agents directory.
- **Ticket.** Fee, maintenance margin, slippage cap and smallest account come from `market.limits`.
  The explanation of why nothing is sent no longer claims the contracts are missing.

The source is written in the line that already sits over each title, so there is no new token,
colour, class or component. Prices below one keep four significant figures: the venue lists
markets at fractions of a cent, which three fixed decimals printed as the same number.

## 7. Acceptance

1. The package's parser reproduces the frozen expectation, and the app's 303 tests still pass with
   no file of the app changed except `src/perpl/context.ts`, its test's fixture import and
   `package.json`.
2. Against the recorded capture, the board maps every field of §4 for all seven markets, with
   values asserted for BTC.
3. Freshness: a second read inside 10 s makes no request; a failed fetch inside 5 minutes serves
   the cached board with `stale: true`; after 5 minutes the board throws and the route answers 503
   `MARKET_DATA_UNAVAILABLE`; a context for the wrong chain is refused.
4. Detail: the trail and the reach are computed from recorded candles; a failed candle request
   still answers the detail, with an empty trail and a `null` reach.
5. With `PERPL_BOARD_NETWORK` unset the API serves the sample board, labelled as such.
6. `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm test`, `npm run build` and the
   design checks pass.
7. One live read of Perpl testnet through the adapter returns the markets the app lists. Recorded
   in the pull request, not asserted in CI.

## 8. Out of scope

Sending an order from the web (it needs a Mera signer there); one table of levels and leverage
options for both surfaces (B11); agent counts and calls on perps (they need perps decisions);
the order book on the web; moving the reads service; mainnet.

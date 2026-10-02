# Perps board live Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/markets` on the web serves every open Perpl market through the parser the mobile app trades on, labelled with its source and freshness, with the venue's limits per market.

**Architecture:** The app's context parser moves to `@pickler/perpl-context` behind a frozen expectation. `createPerplMarketBoard` in infrastructure implements the existing `MarketBoard` port over `PerplTransport`, with memory owned by the API's composition. Core's market gains `source` and `limits` and makes unknown counts `null`; the web renders them. Spec: `docs/specs/perps-board-live-v1.md`.

**Tech Stack:** TypeScript, `node:test` with `tsx`, Jest for the app, Hono on Workers, Next.js.

**Conventions:** worktree `/Users/Juvenal/Development/Pickler/pickler-perpl-board`, branch `codex/perpl-board-live`. The untouched app is `/Users/Juvenal/Development/pickler-expo` (read only). `$S` is the session scratchpad. Install with `npx -y npm@10.9.3`. Commit with `git commit -- <paths>`.

---

## File structure

| Path                                                                                           | Responsibility                                                     |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `packages/perpl-context/src/index.ts`                                                          | `parseContext`, `parseServerTime`, `Market`, `Instance`, `Context` |
| `packages/perpl-context/test/fixtures/context.json`                                            | The app's recorded capture of testnet (moved)                      |
| `packages/perpl-context/test/expected-context.json`                                            | What the app's parser gave for it before the move (frozen)         |
| `packages/perpl-context/test/context.test.ts`                                                  | The moved parser against the expectation; the lenient additions    |
| `apps/mobile/src/perpl/context.ts`                                                             | `fetchContext` and a re-export of the package                      |
| `packages/core/src/features/markets/domain/markets.ts`                                         | `MarketSource`, `MarketLimits`, nullable counts, the error         |
| `packages/infrastructure/src/markets/perpl-market-board.ts`                                    | The adapter and its memory                                         |
| `packages/infrastructure/src/markets/sample-market-board.ts`                                   | The sample board, with `source: sample` and its old limits         |
| `packages/api-schema/src/markets.ts`                                                           | The DTOs; `PERP_LIMITS_DTO` removed                                |
| `workers/api/src/growth/services.ts`, `market-responses.ts`, `env.ts`, `http/error-handler.ts` | Composition, mapping, the 503                                      |
| `apps/web/src/features/markets/`                                                               | Source line, "—" for unknowns, limits from the market              |

---

### Task 1: Freeze what the app's parser gives today

- [ ] In `pickler-expo/apps/mobile`, run a temporary script (deleted afterwards) that imports `./src/perpl/context` and writes `parseContext(fixture)` to `$S/expected-context.json`, with `bigint` values as decimal strings.
- [ ] `git -C /Users/Juvenal/Development/pickler-expo status --short` is empty.

### Task 2: `@pickler/perpl-context`

- [ ] `git mv apps/mobile/__tests__/fixtures/perpl/context.json packages/perpl-context/test/fixtures/context.json`; copy the expectation beside it.
- [ ] Write `test/context.test.ts` first: every field of every market and of the instance in the expectation is reproduced; `sizeUnits`, `openInterest`, `fundingRate`, `fundingIntervalSec` and `chainId` are read for BTC; a market without `funding`, `oi` or `size_units` parses with those `null`; `parseServerTime` keeps its three cases. Run it: fails, no module.
- [ ] `git mv apps/mobile/src/perpl/context.ts packages/perpl-context/src/index.ts`; remove `fetchContext` and the `viem` and config imports (`Address` becomes `` `0x${string}` ``); add the lenient fields; comments in English.
- [ ] New `apps/mobile/src/perpl/context.ts`: `fetchContext` as it was, importing `parseContext` and `parseServerTime` from the package, and `export { parseContext, parseServerTime, type Context, type Instance, type Market } from "@pickler/perpl-context"`.
- [ ] The app's `__tests__/perpl-context.test.ts` and any other test that read the fixture import it from `@pickler/perpl-context/fixtures/context.json`.
- [ ] `package.json`, `tsconfig.json`, `AGENTS.md` for the package; the app depends on it; the root `test` script and the root project map list it; `scripts/mobile/agent-infra/check.mjs` scope gains `packages/perpl-context`.
- [ ] Run: the package test, `npm test --workspace=@pickler/mobile` (303), `npm run typecheck`. Commit.

### Task 3: Core's market says where it came from

- [ ] Test first (`packages/core/test/markets.test.ts`, extending what exists): `byCoverage` orders `null` counts as zero; `squareProblem` with a `null` reach refuses nothing; `MarketDataUnavailableError` carries its code.
- [ ] `PerpMarket`: `agentsReading: number | null`, `openCalls: number | null`, `hourlyReach: number | null`, `limits: MarketLimits`, `source: MarketSource`. `MarketLimits { takerFee, maintenanceMargin, slippageCap, minimumAccountOpen }`. `MarketSource { venue: "perpl" | "sample"; network: "mainnet" | "testnet" | null; observedAt: string; stale: boolean }`. `MarketDataUnavailableError` with `code = "MARKET_DATA_UNAVAILABLE"`. Export from the index.
- [ ] The sample board fills `limits` with the former constants and `source` with `sample`.
- [ ] `PerpMarketDto`, `toPerpMarketDto`; delete `PERP_LIMITS_DTO`. The error handler maps the error to 503.
- [ ] The web compiles against the new DTO: `ticket.ts` and `trade-ticket.tsx` read `market.limits`; filters and counts handle `null`. No visual change on the sample board except the SAMPLE tag (Task 5).
- [ ] Run typecheck and `npm test`. Commit.

### Task 4: The adapter

- [ ] Tests first (`packages/infrastructure/test/perpl-market-board.test.ts`), with an injected `transport` serving the recorded capture and a recorded candles body, and an injected clock:
  - the list has the seven markets of the capture, BTC first by open interest among unknown coverage, with BTC's mark, change, funding per hour, open interest, leverage and limits asserted to the digit;
  - a second list inside 10 s makes no request; after 10 s it makes one;
  - a failing transport after a good read serves `stale: true` until 5 minutes, then throws `MarketDataUnavailableError`; with no good read it throws at once;
  - a capture whose `chain_id` is another network's is refused;
  - the detail has 25 trail points ending at the mark and a reach from the candles; a failing candle request gives `trail: []`, `hourlyReach: null`;
  - a symbol the venue does not list is `null`.
- [ ] Implement `PerplBoardMemory` and `createPerplMarketBoard`; export both from the infrastructure index.
- [ ] Compose in `workers/api/src/growth/services.ts` from `PERPL_BOARD_NETWORK`; `env.ts`, both wrangler configs, `.dev.vars.example`. A route test: unset serves the sample; the board throwing answers 503 with the code.
- [ ] Run typecheck, `npm test`, `npm run check:staging`. Commit.

### Task 5: The pages

- [ ] A source line on the board and on the market (`Tag` from `@pickler/ui`), "—" for `null` counts, the coverage sentence and Ask for an unknown count, the ticket's stated reason.
- [ ] `apps/web/test/` gains a test of the pure formatting (`sourceLine(source, now)`), which lives in `features/markets/lib/format.ts`.
- [ ] Run typecheck, lint, format, `npm test`, `npm run build`, and `npm run design:check` if Playwright is installed; otherwise CI's rendered job. Commit.

### Task 6: Live read, documents, delivery

- [ ] One read of Perpl testnet through the adapter from a script in `$S`; paste the markets and the request count into the pull request.
- [ ] `AGENTS.md` of infrastructure, core, api-schema, `workers/api`, `apps/web` and the mobile app updated where their statements changed; `docs/public-data-audit.md` gets a dated line that the board is no longer sample.
- [ ] Independent review (superpowers:requesting-code-review), fixes, push, pull request against `codex/mobile-monorepo`.

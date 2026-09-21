# What the public product invents, and what it would take to stop

Status: audit of 2026-09-21, against `codex/markets-perps`. It inventories the data the public
surface makes up, says what each piece needs behind it — an endpoint, a schema, a chain read, an
indexer — and what is already modelled and only needs wiring.

It makes concrete one sentence from [the integration guide](frontend-integration.md): _"Token
purchases, paid reads, rankings and settlement remain separate incomplete capabilities; existing
sample data must stay visibly labelled."_

## The shape of the problem

The public product is not fifty scattered fixtures. It is **three ports**, each with exactly one
implementation, and that implementation is a fixture:

| Port                                               | Implementation                 | Methods | Serves                                                                                  |
| -------------------------------------------------- | ------------------------------ | ------- | --------------------------------------------------------------------------------------- |
| `AgentDirectory` (`core/features/agents/ports`)    | `createSampleAgentDirectory`   | 9       | `/tokens`, `/agents`, `/reads`, `/leaderboard`, `/analytics`, `/portfolio`, `/activity` |
| `MarketBoard` (`core/features/markets/ports`)      | `createSampleMarketBoard`      | 2       | `/markets`, `/markets/[symbol]`                                                         |
| `LandingReadModel` (`core/features/landing/ports`) | `createSampleLandingReadModel` | 1       | `/`                                                                                     |

Every other port in core — access tokens, API keys, workspaces, the agent registry, applicants,
budget, profiles, signing, the waitlist — already has a real Supabase or PostgreSQL adapter. The
boundary is clean, which is the good news: replacing a fixture is writing a second implementation
of an interface that already exists, not rewriting the pages.

## What the three fixtures invent

Nearly 2,300 lines of fixtures, and the mechanism matters as much as the count: a static literal is a
number someone chose, while a derived one is a number that moves convincingly and is still fiction.

| Entity                   | Where                           | Count                                                       | How                                        |
| ------------------------ | ------------------------------- | ----------------------------------------------------------- | ------------------------------------------ |
| Agents                   | `sample-agent-directory.ts:58`  | 9                                                           | static                                     |
| Calls / picks            | same, `:297`                    | 23 across 7 beats                                           | static text, clock-relative timestamps     |
| Personas                 | `sample-personas.ts:26`         | 9                                                           | static                                     |
| Activity feed            | same, `:344`                    | 13                                                          | static, clock-relative                     |
| Reputation weights       | same, `:465`                    | 5                                                           | static                                     |
| Read services            | `sample-reads.ts:34`            | 9 (5 open)                                                  | static                                     |
| Paid reads               | same, `:184`                    | 5                                                           | static, literal date strings               |
| Perp markets             | `sample-market-board.ts:6`      | 6                                                           | static                                     |
| Agent squares            | same, `:100`                    | 8                                                           | static                                     |
| Landing snapshot         | `sample-landing-read-model.ts`  | 6 agents, 7 tape rows, 4 launches, 3 picks, 3 announcements | static, clock-relative                     |
| **Price candles**        | `sample-agent-directory.ts:667` | 936 per call                                                | **seeded generator**, rebuilt each request |
| **Daily series**         | same, `:640`                    | 2 series                                                    | **seeded generator**                       |
| **Calibration**          | same, `:608`                    | 7 buckets per agent                                         | derived from one scalar plus jitter        |
| **Score**                | same, `:596`                    | per agent                                                   | closed-form guess                          |
| **Analytics**            | same, `:970`                    | ~12 headline figures                                        | mix of literals and sums                   |
| **Addresses, tx hashes** | same, `:549`, `:880`            | all of them                                                 | **pattern-generated, exist on no network** |

The fixtures say so themselves, which is to their credit — every file opens with a comment naming
what is not real, and `sampleAddress()` is documented as _"A placeholder contract address derived
from the ticker. It exists on no network."_

Two details worth knowing before planning against them:

- **The landing keeps its own copy.** `sample-landing-read-model.ts` has an independent leaderboard
  literal that is not derived from the nine agents, so the landing and `/leaderboard` can disagree
  about the same agents today.
- **`in-memory-applicant-store.ts` is not a gap.** It is ephemeral by design and used only by
  tests; the deployed path is `createSupabaseApplicants`. Do not spend time on it.

## What is already modelled

`packages/infrastructure/src/persistence/product` defines more than the sample data uses:

| Schema     | Tables                                                                                       |
| ---------- | -------------------------------------------------------------------------------------------- |
| `identity` | profiles, handles, handle_history, **wallet_links**, workspaces, workspace_members, api_keys |
| `market`   | tokens, pools, fee_splits, trades, fee_payouts, holders, **candles**, indexer_cursors        |
| `agents`   | agents, agent_profiles, agent_configs, agent_credentials, agent_events                       |
| `budget`   | budgets, ledger_entries                                                                      |
| `growth`   | waitlist, applications                                                                       |
| `audit`    | events, idempotency_keys                                                                     |

Read `market` carefully before planning against it: it models **agent tokens on a bonding curve**,
projected from chain events. It is not the perpetuals venue. `market.trades` is a token buy or
sell, not a position on Perpl, and `market.candles` is a token price, not a mark.

The private research side (`pickler` schema: runs, events, agents, paper_orders, budget_*) holds
what agents actually produced. Nothing publishes from it, by design.

## The gaps, in the order they hurt

### 1. Paid reads have no schema at all

A read is what the product sells, and there is no table for one anywhere — not in `market`, not in
`agents`, not in the research schema. `agents.agent_events` is a generic log (`event_type` plus a
jsonb payload), not a modelled answer with two clocks.

Core already has the domain: `AgentRead`, `ReadAnswer`, `ReadService`, `readQuestion`,
`readQuestionAtLevel`, `DELIVERY_STATES`, `READ_EVALUATIONS`. What is missing is storage and a
write path. Note the shape this should take: an answer is not new work, it is a **publication** of
a research run that already exists privately. The bridge is a publish step and a payment, not a
second research pipeline.

Needs: a schema (`reads`, with the question, the agent, the payer's address, the two clocks, the
answer and its sources), a paid write endpoint, and a settlement job that writes the evaluation.

### 2. The agents' public record has no schema

The board ranks agents by their record, the profile lists their calls with outcomes and PnL, and
the leaderboard scores them. None of it is stored. `agentScore` in core computes a score from
calibration, volume and net — from inputs nothing persists.

Needs: picks (call, market, stake, entry, outcome, pnl, timestamps) as a projection of research
decisions, plus the aggregate the leaderboard reads. Until picks exist, the leaderboard and
`/analytics` cannot be anything but fiction, because they are functions of the same missing rows.

### 3. Perpetual markets have no schema and no source

`/markets` is served by `createSampleMarketBoard`: six markets with marks, funding, open interest
and the squares agents hold calls on. No venue is polled. There is no Perpl client anywhere in the
repo, and `@pickler/chain` knows Monad but not Robinhood Chain, where the tokens will launch.

Needs: a venue client for marks and funding (live, not stored), a schema only for what the venue
cannot answer — which agent has a call on which square, and a person's own positions.

### 4. Nothing on the backend knows what a wallet is

`identity.wallet_links` exists and nothing writes it. `/portfolio` and `/activity` sit behind
`ConnectGate` but render from the same sample endpoints as everyone else: the wallet decides what
is _shown_, never what is _fetched_. The server does not know who is asking.

This is less urgent than it looks. With the passkey account derived in the browser, identity works
client-side without a backend; what the server owes is the history a chain cannot give — which
reads this address paid for, and which agents it follows.

### 5. Sample data is labelled in one place out of seven

`LandingResponse` carries `source: "sample" | "live"` and the landing footer renders a `SAMPLE
DATA` tag from it. No other public DTO has the field, and no other public page carries the tag —
`/tokens`, `/agents`, `/reads`, `/leaderboard`, `/analytics` and the `/markets` pages added on this
branch all present invented figures with nothing to say so. The API sets
`X-Pickler-Data-Source: sample` on every `/v1/demo` response, so the information already reaches
the web and is dropped there.

This is the cheapest fix in the audit and the one with the clearest rule behind it.

## Hardcoding inside the web

A sweep of `apps/web/src` found that the pages themselves are disciplined: the landing, agents,
markets and wallet surfaces read DTOs and call `services.*`, and most literals are nav menus,
palettes, filter lists and formatting — those are right where they are. Two other kinds are not.

### Invented facts shown to real people

- `features/apply/lib/options.ts:66` — `BATCH = { invitesPerBatch: 40, nextBatch: "FRI" }`, rendered
  on the submitted screen as "INVITES PER BATCH" and "NEXT BATCH". The file admits it: _"Product
  copy, not computed."_ Real applicants read an operational fact nothing drives.
- `features/console/sections/overview.tsx:154` — a `0.00 MON` agent wallet balance marked "NOT WIRED
  YET". Honest today; it will keep reading zero after the wallet exists unless someone remembers.

### Business rules written as literals in the presentation layer

This is the systemic one. ESLint forbids the web from importing `@pickler/core`, so every rule the
UI needs has to be mirrored through `@pickler/api-schema` — and today most are hand-copied instead,
with nothing to catch a drift.

| Rule                                                                                             | Where                                                                         | Should come from                                                                                                           |
| ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Curve depth `160_000 / 3_400`, used to quote price impact                                        | `agents/components/trade-panel.tsx:31`                                        | the curve contract, or an `agent.token` field. It is invented money maths                                                  |
| Calibration thresholds (`< 4`, `< 10`) and score bands (`>= 70`, `>= 45`)                        | `agents/lib/reputation.ts:8`                                                  | `calibrationVerdict` already exists in core at `public-views.ts:169`; the web keeps a second copy and says so in a comment |
| Run limits: searches 2–3, pageReads 1–5, steps 3–12, duration, tokens, dailyRuns, interval 1–168 | `console/sections/limits.tsx:11`, again as denominators in `context.tsx:39`   | one exported range in `api-schema`                                                                                         |
| "Six tools is the ceiling"                                                                       | five places across `console/sections/skills.tsx` and `console/agent-form.tsx` | one exported constant                                                                                                      |
| "20 sources" cap                                                                                 | `console/sections/picks.tsx:428`                                              | an API field, or drop the denominator                                                                                      |
| "Picks settled more than 90 days ago count half"                                                 | `agents/components/leaderboard-page.tsx:138`                                  | the same weights payload that renders the meters directly above it                                                         |
| "10% of every settled win"                                                                       | `agents/components/token-page.tsx:156`                                        | a `buybackRate` field; the amount beside it is already real                                                                |

The fix is the same in every row and it already has a precedent in this repo:
`PERP_LIMITS_DTO`, `LEVERAGE_OPTIONS` and `LEVEL_OPTIONS` in `api-schema/src/markets.ts` mirror
core's market rules for exactly this reason, the way `CATEGORY_OPTIONS` mirrors `CATEGORIES`. Every
row above wants that treatment. None of them needs a table.

## The decision: only the landing stays sample

Decided 2026-09-21. `pickler.fun` itself may keep a sample snapshot — it is the marketing page and
it already labels itself. **Every other route must stop inventing.** That is a stricter rule than
"label it", and it changes what the work is, so it is worth being plain about what it costs.

Switching the fixtures off today does not make those pages real. It makes most of them empty,
because the tables behind them are either unwritten or undefined:

| Route                        | What it could show with no fixture                                             | Distance to real                                                                                                                                              |
| ---------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/markets`                   | nothing today                                                                  | **short** — a venue client for marks, funding and open interest. No schema, no contracts, no indexer. The one page on this list that is only integration work |
| `/agents`                    | the agents real creators registered in `agents.agents`, with no offer attached | **short-ish** — the read service (price, markets, SLA, slots) needs a small schema; the agents themselves already exist                                       |
| `/tokens`                    | empty                                                                          | **long** — needs the launch contracts and an indexer to fill `market.*`                                                                                       |
| `/reads`                     | empty                                                                          | **long** — needs a schema, a payment and the publish bridge                                                                                                   |
| `/leaderboard`, `/analytics` | zeros                                                                          | **long** — they are functions of picks and reads                                                                                                              |
| `/portfolio`, `/activity`    | the native balance, which is already real                                      | **medium** — history needs a per-address store                                                                                                                |

An empty page that says "no agent has launched a token yet" is honest, and it is better than nine
invented agents. But it is a product choice to ship that, not only an engineering one, so the two
ways to get there are worth naming:

- **Empty now.** Delete the fixtures, ship real empty states, and each page fills as its source
  lands. The site tells the truth from day one and looks unfinished for a while.
- **Real in order.** Keep each fixture only until its source exists, and remove it in the same
  change that makes the page real. Nothing ever looks empty; the fiction lives longer, and every
  day it does is a day someone can mistake it for a product.

Either way the fixtures stop being permanent furniture, and `/markets` goes first because it is the
only one whose distance is measured in days.

## What has to come from outside

Not all of it. Two of these are already done and one is smaller than it sounds.

| Dependency                         | State                                                                                                                                                                                                                                                                                                                                          |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AUSD / Agora**                   | **Done.** `@pickler/chain` carries the contract on Monad 143 and 10143, 6 decimals, the EIP-712 domain (`Agora Dollar`, not the symbol), EIP-2612 and EIP-3009 — verified 2026-09-16 by `eth_call` against each contract. There is no Agora service to integrate with: AUSD is an ERC-20 and a balance is one `balanceOf` over the public RPC. |
| **Monad RPC**                      | **Done.** Public endpoints in `@pickler/chain`; production uses provider URLs from bindings.                                                                                                                                                                                                                                                   |
| **Perpl market data**              | Missing, and small: marks, funding and open interest are public reads. Needs the endpoint, the symbol list, and whether a testnet instance exists. No key, no account, no contract, no signature. This is all `/markets` needs.                                                                                                                |
| **Perpl trading**                  | Missing and large: orders, fills, positions, reconciliation — wave 8 of the extraction plan, unstarted. `/markets` does not need it, because the ticket is already built and disabled.                                                                                                                                                         |
| **Launch contracts**               | Missing and unspecified. `token-launch.md` leaves the on-chain logic to the infra owner. No contracts, no indexer, no `/tokens`.                                                                                                                                                                                                               |
| **Robinhood Chain**                | Missing from `@pickler/chain`, which knows only Monad. The tokens launch there first.                                                                                                                                                                                                                                                          |
| **Payment destination for a read** | Missing. AUSD is ready as the means; where the money goes and what releases it is not designed.                                                                                                                                                                                                                                                |

The useful split is the first two rows against the rest: market data is read-only public data, and
trading is custody. They arrive separately, and the repo already separated them — the Perpl
market-data tool is listed apart from execution in `relayer-extraction/04-mastra-runtime.md:523`.

## What each capability needs

"Schema" means a table that does not exist. Several capabilities need no new schema at all — they
need something to _write_ the tables that are already defined.

| Capability                            | Endpoint                                                                       | Schema                                                        | Also needs                                                                              | Blocked by                                                          |
| ------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Sample labelling                      | no — add `source` to the public DTOs, or read the header the API already sends | none                                                          | —                                                                                       | nothing                                                             |
| Landing figures                       | `/v1/landing` exists                                                           | none                                                          | a `count()` on `WaitlistRepository`; the rows are already in `growth.waitlist`          | nothing                                                             |
| Agent tokens: price, holders, candles | shape exists (`/demo/agents`, `/demo/profiles/:ticker`)                        | **none — `market.*` is fully modelled and nothing writes it** | the launch contracts and **an indexer** to fill tokens, pools, trades, holders, candles | contracts not deployed                                              |
| Agent public record (picks)           | `/v1/agents/:handle`, `/v1/picks/:id`                                          | **yes** — a public projection of a research decision          | the publish bridge from the private `pickler.runs`                                      | the bridge, which is a product decision as much as code             |
| Paid reads                            | **yes** — `POST /v1/reads` (paid), `GET /v1/reads`, `GET /v1/reads/:id`        | **yes** — the read, its two clocks, the answer, its sources   | payment in AUSD, a settlement job at delivery + 24 h, the same publish bridge           | contracts, and picks first                                          |
| Leaderboard and analytics             | `/v1/leaderboard`, `/v1/analytics`                                             | none new — they are functions of picks and reads              | aggregation, and a materialised view once it is slow                                    | picks and reads                                                     |
| Perp marks, funding, open interest    | swap the adapter behind `/v1/markets`                                          | **none — live venue data, cache at most**                     | a Perpl client, which does not exist in the repo                                        | venue integration                                                   |
| Agent calls on a square               | part of `/v1/markets/:symbol`                                                  | **yes** — small: agent, market, level, horizon, state         | picks first, since a call is one                                                        | picks                                                               |
| A person's positions and history      | `/v1/positions`, `/v1/reads?address=`                                          | **yes** for history; positions can be read from the venue     | writing `identity.wallet_links`, which exists and nothing writes                        | wallet identity, which the passkey account now supplies client-side |

### The order this implies

1. **`/markets` against the real venue.** A Perpl client behind `MarketBoard`, replacing
   `createSampleMarketBoard`. No schema, no migration, no contracts — the port and the two
   endpoints already exist and the page does not change. It is the only route on the list that can
   be true this week, which is why it goes first now rather than last.
2. **Label whatever is still sample while it lasts.** The public DTOs need the `source` field
   `LandingResponse` already has. Cheap, and it stops being a permanent apology: each page drops
   the tag as it becomes real, and the landing keeps it for good.
3. **Mirror the duplicated rules through `api-schema`** and delete the hand-copies. Independent of
   everything else. Start with the curve depth, which is invented rather than merely copied.
4. **A read service schema**, so `/agents` can list the agents real creators registered along with
   what each one actually offers. The agents exist in `agents.agents`; the offer does not exist
   anywhere.
5. **Decide the publish bridge** — what turns a private research run into a public pick. Everything
   below waits on that one decision, and it is a product decision, not an engineering one.
6. **Picks, then reads, then the leaderboard**, in that order, because each is the input to the
   next and the leaderboard is a function of the first two.
7. **The indexer** whenever the contracts land, which is what finally fills `/tokens`. `market.*`
   is waiting for it and needs no design.

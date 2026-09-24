# The marketplace reads from the database

Every public screen in Pickler's marketplace is served from a fixture. `/agents` lists nineteen
agents that do not exist, `/leaderboard` ranks them, `/tokens` prices their tokens and `/reads`
shows reads somebody paid for. None of it is real, no adapter that reads Postgres exists, and
nothing on the page says so to a person.

This specification replaces the fixture with the database, makes the studio write everything the
marketplace shows, and designs the screens for the state that follows: a marketplace with nothing
in it yet, then one with a handful of agents that have never run.

It is written so that someone who did not take part in the conversation that produced it can
implement it. Where it makes a decision, it says why; where it found a gap, it names it.

---

## 1. What is there now

`workers/api/src/growth/services.ts` wires three sample adapters:

```ts
landing:  createSampleLandingReadModel(systemClock),
agents:   createSampleAgentDirectory(systemClock),   // 1,110 lines, 19 agents
markets:  createSampleMarketBoard(),                 // 151 lines
```

They implement real ports and are served over real HTTP, with `X-Pickler-Data-Source: sample` on
every response and a module header reading _"Explicit sample content only. Private research never
feeds these public endpoints."_ The separation is deliberate and well built. What it is not is
visible to anyone who is not reading the code.

**No other implementation of `AgentDirectory` exists.** This is not a disconnected adapter; the
other half was never written.

---

## 2. The audit: every public field, and where it comes from

The marketplace was designed against a fixture, and a fixture can invent any field without anything
objecting. So before deciding what to read, every field the public views display was traced to a
source. The result is the reason this specification is larger than "swap the adapter".

`AgentSummary`, `AgentProfile`, `AgentPersona`, `DirectoryAgent` and `Leaderboard` between them
need the following. Each row says where the value would come from, and whether that source is
written today.

| Source                                            | Fields                                                                                                                                     | Written today                                |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------- |
| `agents.agents`                                   | `name` `handle` `createdAt` `status` (`killedAt`)                                                                                          | **yes** — the studio, on create              |
| `identity.profiles` via `created_by`              | `creatorHandle`                                                                                                                            | **yes**                                      |
| `agents.agent_profiles`                           | `beat` `accent` `blurb` `xHandle`                                                                                                          | **no** — the table exists, nothing writes it |
| `pickler.runs.decision` (jsonb)                   | `resolved` `hitRate` `net` `openPicks` `calls` `decisions` `calibrationGap` `aliveDays`                                                    | once an agent has run                        |
| `market.tokens` `market.candles` `market.holders` | `ticker` `stage` `marketCap` `raised` `graduationTarget` `price` `address` `chain` `holders` `liquidity` `buybacks` `candles` `topHolders` | once the launchpad indexer runs (PR #37)     |
| the runtime's `config` jsonb                      | `venue` `vibe` `voice` `brief` `rules` `meters` `decides` `wrong`                                                                          | **yes, but private** — see §2.2              |
| **nowhere**                                       | **`followers`**                                                                                                                            | **no table, no config, nothing**             |
| **nowhere**                                       | `service` `askPrice` `answers` `reads`                                                                                                     | paid reads have no persistence               |

Three findings follow.

### 2.1 The profile is collected and thrown away

`createAgentSchema` in `packages/api-schema/src/console.ts` requires `config.marketScope` — the form
says _"Choose a category and subcategory"_ — so the agent's beat already travels in the create
request. It lands in the runtime's `config` jsonb and nothing copies it to `agent_profiles`, which
is the table the public reads.

`accent`, `blurb` and `xHandle` are not collected at all. An agent created today reaches the
marketplace with a name and a handle and nothing else — no category, no colour, no sentence about
itself. On a table where the accent is what tells one agent from another, that is an agent nobody
can tell apart.

**The studio writes the profile in the same transaction that creates the agent.** `directory.ts`
already writes four tables atomically on create; `agent_profiles` becomes the fifth. The form asks
for `accent` and `blurb`, with `xHandle` optional. It does not ask for the beat again — it is derived
from `marketScope`, which is already there.

### 2.2 Some public fields live in private configuration

`venue`, `vibe`, `voice`, `brief` and `rules` are read by the persona screen and live only in
`pickler.agents.config` — the runtime's private configuration. Reading them from there would mean
the public marketplace reaching into the private research runtime to paint an agent's public face.
That crosses a boundary the repository keeps on purpose: _"Private research never feeds these
public endpoints."_

**The public ones are promoted to `agent_profiles`.** `venue`, `vibe` and `voice` are facts about
how the agent presents itself and belong beside `blurb`. `brief` and `rules` are the agent's
operating instructions: they stay private, and the persona screen stops showing them. If the product
wants an agent's rules to be public, that is a decision to make on purpose, with a field written on
purpose — not a leak from a jsonb blob.

### 2.3 Some public fields have no source at all

**`followers` does not exist anywhere.** No table, no configuration, nothing to derive it from. Two
screens display it, and today it comes from the fixture. It is an entire social feature — following
an agent — that nobody has built and that the screen already promises.

**It comes off the screen.** Showing a follower count that is always zero is worse than showing
none: it says the feature exists and nobody uses it. When following is built, the field comes back
with a source behind it.

`service`, `askPrice`, `answers` and `reads` are paid reads, which have no persistence and are their
own specification. They are out of scope here (§7) and the screens that show them are handled in
§4.

---

## 3. A real agent comes from three places, and only one exists today

After §2, an agent's public record is assembled from three schemas:

- **Identity**, from `agents.agents` left-joined to `agents.agent_profiles`. Left, because agents
  created before this work have no profile row and are still agents.
- **The record**, aggregated from `pickler.runs` where `decision` is present. The shape of that
  jsonb decides what can be counted and **must be read before the query is written**, not assumed.
- **The token**, from `market.tokens` by `agent_id`, left-joined, with the newest `market.candles`
  row for a price. Left again: most agents will have no token.

An agent a person creates today has identity and nothing else. It has no record because it has
never run, and no token because none was launched. That is not a broken state — it is the first
state every agent passes through, and the marketplace has never had to draw it.

---

## 4. What the screens do when there is little or nothing

**A new agent is shown, and told apart from a proven one.** It appears on `/agents` and on its own
profile with what it has — name, handle, beat, accent, blurb — and every figure it does not have is
said as such rather than as a zero. "No picks yet" is a fact; `0%` is a claim about a record that
does not exist. This is the discipline the account screen already uses, where six panels say what
custody has not built rather than rendering empty wallets.

**But it is excluded from the rankings.** `/leaderboard` ranks by record, so an agent with no
resolved picks has no place in it. `/tokens` lists tokens, and an agent that has not launched one is
not a token.

| Screen         | Agent with identity only            | Nothing at all |
| -------------- | ----------------------------------- | -------------- |
| `/agents`      | listed, record marked absent        | empty state    |
| `/agents/[h]`  | profile, record marked absent       | 404            |
| `/tokens`      | **not listed**                      | empty state    |
| `/tokens/[t]`  | —                                   | 404            |
| `/leaderboard` | **not ranked**                      | empty state    |
| `/markets`     | unaffected — markets are not agents | as today       |
| `/reads`       | out of scope                        | out of scope   |

**Five empty states have to be designed.** Today every one of these screens always has content, so
none has ever drawn nothing. An empty state is a screen, not an absence: it says what will appear
here and what a person can do about it. `/console?state=empty` is the model — a designed screen
with its own copy, not a blank page with a spinner removed. Each gets an id a check can name, so
the design harness proves the empty state rather than a container that exists either way.

---

## 5. The sample adapters are deleted

`createSampleAgentDirectory` and `createSampleMarketBoard` go, with `sample-agent-directory.ts` and
`sample-market-board.ts`. There is one read path and it is the real one. The `/v1/demo` mount and
its `X-Pickler-Data-Source: sample` header go with them; the routes it served move to `/v1` beside
`landing`, because they are no longer demos.

`createSampleLandingReadModel` **stays**. The landing is a marketing page, sample content there is
understood as such by everyone who sees it, and it is not what this specification is about.

**This costs something and the cost is worth stating.** `scripts/design/routes.mjs` measures 32
routes, and six of them are these screens. With the fixture gone they render their empty states —
which is not nothing: **the empty state is exactly what a person sees at launch**, it is a designed
screen, and measuring it is measuring something real.

What is genuinely lost is the ability to measure a **populated** screen — a leaderboard with rows, a
token card with a price, a profile with a record. No check will render those until real data
exists. That is a gap in coverage and it is recorded here rather than papered over. If it becomes
painful, the answer is a harness-only seed against the test database `packages/infrastructure/test/`
already uses — test data for a test, which is a different thing from development data pretending to
be a product. That is deliberately not part of this work.

---

## 6. The endpoints, and what each one reads

With the demo mount gone, the public API is one mount with one source per route. No route serves
invented content and no field arrives from a private table.

| Route                                | Reads                                                            | Empty answer       |
| ------------------------------------ | ---------------------------------------------------------------- | ------------------ |
| `GET /v1/agents`                     | identity ⨝ record ⨝ token, excluding killed                      | `[]`               |
| `GET /v1/personas/:handle`           | identity ⨝ record, by handle                                     | `404`              |
| `GET /v1/profiles/:ticker`           | token → agent → identity ⨝ record                                | `404`              |
| `GET /v1/profiles/:ticker/picks/:id` | one run's decision                                               | `404`              |
| `GET /v1/leaderboard`                | record only, agents with ≥1 resolved pick                        | `{ rows: [] }`     |
| `GET /v1/analytics?range=`           | aggregate over runs in range                                     | zeros, and says so |
| `GET /v1/directory`                  | **out of scope** — filters on a read service that does not exist | see §7             |
| `GET /v1/reads` · `/reads/:id`       | **out of scope**                                                 | see §7             |

`GET /v1/markets` and `/markets/:symbol` are perpetual markets, not agents, and are not touched
here — but `createSampleMarketBoard` is their only source, so they get the same treatment: a real
adapter over `market.*`, or an honest empty state. Decide which when reading what the launchpad
indexer writes.

**Failure propagates.** A query that fails is a failure, never an empty list. "No agents yet" and
"we could not read the agents" are different facts and only one is safe to render — the rule the
custody and wallet-link stores already follow, each with a test that goes red when a `try/catch`
is added.

**A killed agent is not deleted.** `killed_at` is set, because an agent with history is never
removed. Listings exclude it; its profile still serves, so a link to a record that existed does not
become a 404.

---

## 7. Out of scope, named so nobody fills it in by accident

**Paid reads**, including `listReads`, `getRead`, `listDirectory` and the `service`, `askPrice`,
`answers` and `reads` fields of the persona. No persistence exists and this specification does not
invent it. Until that work lands, the routes return an honest empty state and the persona screen
does not draw a read service.

**Following an agent.** `followers` comes off the screen until there is a table.

**The launchpad indexer** that fills `market.*` — PR #37. This adapter reads whatever it writes and
draws "no token" when it has written nothing.

**A harness seed**, per §5.

**Agents' private `brief` and `rules` on the public persona**, per §2.2 — removed rather than
promoted, until someone decides they should be public.

---

## 8. Testing

The adapter is tested against a real Postgres, as `custody-store.test.ts` and
`wallet-identity-store.test.ts` are; `packages/infrastructure/test/database.ts` throws rather than
skipping when the database is absent, so the tests go red instead of quietly green.

The tests that matter are about absence, because absence is the normal case at launch:

- An agent with no runs lists with a null record, not a zero one.
- An agent with no token lists with a null token, not a placeholder.
- An agent with no profile row still lists.
- A killed agent is absent from listings and present on its own profile.
- A failing query raises rather than returning `[]`.
- The leaderboard excludes an agent with no resolved pick, and includes one with exactly one.

And for the studio side:

- Creating an agent writes `agent_profiles` in the same transaction, and a failure after
  `agents.agents` rolls both back.
- The beat written to the profile equals `config.marketScope`'s category.

Each is proved to fail before it is believed: make the query `COALESCE` a null record to zero, or
catch and return `[]`, or drop the profile insert, and confirm that exactly the test naming that
rule goes red.

---

## 9. Order of work

1. **Read `pickler.runs.decision`'s actual shape** and write down what a resolved pick looks like.
   Everything in "the record" depends on it and nothing here assumes it.
2. **The studio writes the profile.** Form, schema, transaction. This is independent of the
   marketplace and unblocks it.
3. **`PostgresAgentDirectory`**, method by method, with the database tests.
4. **The empty states**, with ids, and the design routes pointed at them.
5. **Delete the sample adapters**, move the routes off `/v1/demo`, and run every check.

The first two can proceed while the launchpad's token tables are still empty. Nothing here waits
on PR #37.
